#!/usr/bin/env python3
"""Install a committed stage's pnpm dependencies into a fresh, isolated store."""
import argparse
import base64
import binascii
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import yaml

spec = importlib.util.spec_from_file_location("stage_tools", Path(__file__).with_name("stage-local-automation-web.py"))
stage_tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage_tools)


def digest(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Required regular file is missing: {path.name}")
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def validate_lockfile(path):
    try:
        lock = yaml.safe_load(path.read_bytes())
    except yaml.YAMLError as error:
        raise ValueError("Invalid pnpm lockfile") from error
    if not isinstance(lock, dict) or str(lock.get("lockfileVersion")) != "9.0":
        raise ValueError("Unsupported pnpm lockfile")
    if set(lock.get("importers", {})) != {"."}:
        raise ValueError("Only the single committed workspace importer is supported")
    packages = lock.get("packages")
    if not isinstance(packages, dict) or not packages:
        raise ValueError("Lockfile has no pinned package resolutions")
    for package in packages.values():
        resolution = package.get("resolution") if isinstance(package, dict) else None
        if not isinstance(resolution, dict) or set(resolution) != {"integrity"}:
            raise ValueError("Lockfile contains an unqualified package resolution")
        integrity = resolution["integrity"]
        if not isinstance(integrity, str) or not integrity.startswith("sha512-"):
            raise ValueError("Package resolution requires SHA-512 integrity")
        try:
            raw = base64.b64decode(integrity[7:], validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("Invalid package integrity") from error
        if len(raw) != 64:
            raise ValueError("Invalid package integrity")
    def reject_external(value):
        if isinstance(value, dict):
            for item in value.values():
                reject_external(item)
        elif isinstance(value, list):
            for item in value:
                reject_external(item)
        elif isinstance(value, str) and value.startswith(("link:", "file:", "git:", "git+", "http:", "https:")):
            raise ValueError("Lockfile contains an unqualified external dependency reference")
    reject_external(lock.get("importers"))
    reject_external(lock.get("snapshots"))


def run_bounded(command, source, env, reserve):
    process = subprocess.Popen(command, cwd=source, env=env, start_new_session=True)
    try:
        while process.poll() is None:
            if shutil.disk_usage(source).free < reserve:
                raise ValueError("Dependency installation crossed its free-space floor")
            time.sleep(1)
        if process.returncode:
            raise subprocess.CalledProcessError(process.returncode, command)
        if shutil.disk_usage(source).free < reserve:
            raise ValueError("Dependency installation crossed its free-space floor")
    finally:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=10)
            except ProcessLookupError:
                process.wait()
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()


def qualify(stage, commit, source_sha, minimum, reserve):
    stage = stage.resolve(strict=True)
    stage_tools.assert_stage_location(stage)
    if os.geteuid() != 0 or not stage.is_relative_to(Path("/tmp")):
        raise ValueError("Qualification requires a root-owned disposable stage under /tmp for sandboxing")
    source = stage / "source"
    if source.is_symlink() or not source.is_dir():
        raise ValueError("Stage source must be a directory")
    receipt_path = stage / "source-receipt.json"
    source_receipt_hash = digest(receipt_path)
    receipt = json.loads(receipt_path.read_text())
    if (not re.fullmatch(r"[0-9a-f]{40}", commit) or not re.fullmatch(r"[0-9a-f]{64}", source_sha)
            or receipt.get("commit") != commit or receipt.get("source", {}).get("sha256") != source_sha):
        raise ValueError("Stage source receipt does not match approval")
    if minimum <= 0 or reserve <= 0 or reserve >= minimum:
        raise ValueError("A positive free-space floor below the starting minimum is required")
    if shutil.disk_usage(stage).free < minimum:
        raise ValueError("Insufficient free space to start dependency installation")
    deps = source / "node_modules"
    environment = stage / ".dependency-environment"
    for path in (deps, environment, stage / "dependency-receipt.json", source / ".next"):
        if path.exists() or path.is_symlink():
            raise ValueError(f"Stage is not fresh: {path.name}")
    if stage_tools.inventory(source) != receipt["source"]:
        raise ValueError("Staged source differs from its receipt")
    for name in (".npmrc", ".pnpmfile.cjs", ".pnpmfile.mjs"):
        if (source / name).exists() or (source / name).is_symlink():
            raise ValueError(f"Unreviewed package manager configuration: {name}")
    files = {name: digest(source / name) for name in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml")}
    validate_lockfile(source / "pnpm-lock.yaml")
    package = json.loads((source / "package.json").read_text())
    match = re.fullmatch(r"pnpm@(\d+\.\d+\.\d+)", package.get("packageManager", ""))
    if not match:
        raise ValueError("packageManager must pin an exact pnpm version")
    if any(name in package.get("scripts", {}) for name in ("preinstall", "install", "postinstall", "prepublish", "prepare")):
        raise ValueError("Root install lifecycle scripts require separate review")
    pnpm = shutil.which("pnpm")
    bwrap = shutil.which("bwrap")
    setpriv = shutil.which("setpriv")
    if not pnpm or not bwrap or not setpriv:
        raise ValueError("Pinned pnpm, bubblewrap and setpriv are required")
    environment.mkdir(mode=0o700)
    for name in ("home", "tmp", "cache", "store"):
        (environment / name).mkdir(mode=0o700)
    corepack_source = Path.home() / ".cache/node/corepack/v1/pnpm" / match.group(1)
    corepack_target = environment / "corepack/v1/pnpm" / match.group(1)
    shutil.copytree(corepack_source, corepack_target, symlinks=True)
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(environment / "home"),
           "TMPDIR": str(environment / "tmp"), "XDG_CACHE_HOME": str(environment / "cache"),
           "COREPACK_HOME": str(environment / "corepack"), "COREPACK_ENABLE_NETWORK": "0",
           "CI": "1", "npm_config_update_notifier": "false",
           "npm_config_registry": "https://registry.npmjs.org/"}
    version = subprocess.check_output([pnpm, "--version"], cwd=source, env=env, text=True).strip()
    if version != match.group(1):
        raise ValueError("Installed pnpm does not match the committed version")
    store = str(environment / "store")
    install = [pnpm, "install", "--frozen-lockfile", "--ignore-scripts", "--verify-store-integrity",
               "--package-import-method=copy", "--store-dir", store]
    rebuild = [bwrap, "--ro-bind", "/", "/", "--bind", str(stage), str(stage),
               "--unshare-net", "--unshare-pid", "--die-with-parent", "--",
               setpriv, "--reuid=65534", "--regid=65534", "--clear-groups",
               pnpm, "rebuild", "--pending", "--store-dir", store]
    run_bounded(install, source, env, reserve)
    for directory, dirs, filenames in os.walk(stage, followlinks=False):
        os.chown(directory, 65534, 65534, follow_symlinks=False)
        for name in dirs + filenames:
            os.chown(Path(directory) / name, 65534, 65534, follow_symlinks=False)
    run_bounded(rebuild, source, env, reserve)
    if digest(receipt_path) != source_receipt_hash or stage_tools.inventory(source, frozenset({"node_modules"})) != receipt["source"]:
        raise ValueError("Source changed during dependency installation")
    if {name: digest(source / name) for name in files} != files:
        raise ValueError("Lockfile or package configuration changed during installation")
    dependencies = stage_tools.inventory(deps, allow_internal_links=True, reject_hardlinks=True)
    result = {"version": 1, "commit": commit, "source": receipt["source"],
              "source_receipt_sha256": source_receipt_hash, "inputs": files,
              "pnpm": version, "node": subprocess.check_output(["node", "--version"], env=env, text=True).strip(),
              "dependencies": dependencies, "install": "fresh-store-frozen-copy",
              "rebuild": "offline-network-namespace"}
    (stage / "dependency-receipt.json").write_text(json.dumps(result, sort_keys=True, indent=2) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--stage", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--min-free-bytes", type=int, required=True)
    parser.add_argument("--reserve-free-bytes", type=int, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(qualify(args.stage, args.commit, args.source_sha256,
                                 args.min_free_bytes, args.reserve_free_bytes), sort_keys=True))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Dependency qualification refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
