#!/usr/bin/env python3
"""Stage and verify a commit-bound web build without installing or releasing it."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import stat
import subprocess
import sys
import tarfile
import time


def assert_stage_location(path):
    for protected in (Path("/opt/youtube-automation-web"), Path("/var/lib/youtube-automation-web")):
        if path.resolve().is_relative_to(protected):
            raise ValueError("Staging must not use installed web-service directories")


def run_git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


def inventory(root, excluded=frozenset(), allow_internal_links=False, excluded_paths=frozenset(),
              reject_hardlinks=False):
    root = root.resolve(strict=True)
    entries = []
    hardlinks = {}
    def fail_walk(error):
        raise error
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=fail_walk):
        dirs.sort()
        files.sort()
        for name in dirs[:] + files:
            path = Path(directory, name)
            relative = path.relative_to(root).as_posix()
            if relative.split("/", 1)[0] in excluded or relative in excluded_paths:
                if name in dirs:
                    dirs.remove(name)
                continue
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode):
                if not allow_internal_links or not path.resolve(strict=True).is_relative_to(root):
                    raise ValueError(f"Unexpected symlink in {relative}")
                entries.append([relative, "link", os.readlink(path)])
                if name in dirs:
                    dirs.remove(name)
            elif stat.S_ISREG(info.st_mode):
                if reject_hardlinks and info.st_nlink > 1:
                    key = (info.st_dev, info.st_ino)
                    count, links, first = hardlinks.get(key, (0, info.st_nlink, relative))
                    if links != info.st_nlink:
                        raise ValueError(f"Hard-linked dependency changed while hashing: {relative}")
                    hardlinks[key] = (count + 1, links, first)
                with path.open("rb") as stream:
                    content = hashlib.file_digest(stream, "sha256").hexdigest()
                    after = os.fstat(stream.fileno())
                if (info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink) != (
                        after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_nlink):
                    raise ValueError(f"File changed while hashing: {relative}")
                entries.append([relative, "file", info.st_mode & 0o111, content])
            elif not stat.S_ISDIR(info.st_mode):
                raise ValueError(f"Unexpected file type in {relative}")
    for count, links, relative in hardlinks.values():
        if count != links:
            raise ValueError(f"Hard-linked dependency is not isolated: {relative}")
    encoded = json.dumps(entries, ensure_ascii=True, separators=(",", ":")).encode()
    return {"sha256": hashlib.sha256(encoded).hexdigest(), "entries": len(entries)}


def prepare(repo, revision, output):
    repo = repo.resolve(strict=True)
    output = output.absolute()
    assert_stage_location(output)
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Commit must be a full lowercase Git SHA-1")
    if run_git(repo, "rev-parse", "--verify", revision + "^{commit}") != revision:
        raise ValueError("Commit does not match a commit object")
    if output.resolve().is_relative_to(repo):
        raise ValueError("Staging directory must be outside the source repository")
    output.mkdir(mode=0o700)
    source = output / "source"
    source.mkdir(mode=0o700)
    process = subprocess.Popen(["git", "-C", str(repo), "archive", "--format=tar", revision],
                               stdout=subprocess.PIPE)
    digest = hashlib.sha256()
    class HashedStream:
        def read(self, size=-1):
            data = process.stdout.read(size)
            digest.update(data)
            return data
    stream = HashedStream()
    try:
        with tarfile.open(fileobj=stream, mode="r|") as tar:
            for member in tar:
                if not (member.isdir() or member.isfile()):
                    raise ValueError("Commit archive contains an unsupported file type")
                tar.extract(member, source, filter="data")
        while stream.read(1024 * 1024):
            pass
        if process.wait() != 0:
            raise ValueError("Git archive failed")
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
        process.wait()
    archive_hash = digest.hexdigest()
    receipt = {
        "version": 1, "commit": revision,
        "tree": run_git(repo, "rev-parse", revision + "^{tree}"),
        "archive_sha256": archive_hash, "source": inventory(source),
    }
    (output / "source-receipt.json").write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n")
    return receipt


def run_bounded_build(source, env, reserve_free_bytes):
    process = subprocess.Popen(["npm", "run", "build:vps"], cwd=source, env=env, start_new_session=True)
    try:
        while process.poll() is None:
            if reserve_free_bytes and shutil.disk_usage(source).free < reserve_free_bytes:
                raise ValueError("Build stopped: staging filesystem crossed the free-space reserve")
            time.sleep(1)
        if process.returncode:
            raise subprocess.CalledProcessError(process.returncode, process.args)
        if reserve_free_bytes and shutil.disk_usage(source).free < reserve_free_bytes:
            raise ValueError("Build stopped: staging filesystem crossed the free-space reserve")
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()


def restore_generated_next_env(source, workspace, original):
    path = source / "next-env.d.ts"
    if original is None:
        if not path.exists() and not path.is_symlink():
            return
        expected = (b'/// <reference types="next" />\n'
                    b'/// <reference types="next/image-types/global" />\n'
                    b'import "./.next/types/routes.d.ts";\n'
                    b'import "./.next/types/root-params.d.ts";\n\n'
                    b'// NOTE: This file should not be edited\n'
                    b'// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.\n')
        if path.is_symlink() or not path.is_file() or path.read_bytes() != expected:
            raise ValueError("Unexpected generated Next type entry")
        path.rename(workspace / "next-env.generated.d.ts")
        return
    if path.is_symlink() or not path.is_file():
        raise ValueError("Generated Next type entry is missing or not a regular file")
    actual = path.read_bytes()
    if actual == original:
        return
    expected = original.replace(b'"./.next/dev/types/routes.d.ts"', b'"./.next/types/routes.d.ts"')
    expected = expected.replace(b'"./.next/dev/types/root-params.d.ts"', b'"./.next/types/root-params.d.ts"')
    if expected == original or actual != expected:
        raise ValueError("Unexpected change to generated Next type entry")
    (workspace / "next-env.generated.d.ts").write_bytes(actual)
    path.write_bytes(original)


def qualified_dependencies(stage, source_receipt, dependencies):
    path = stage / "dependency-receipt.json"
    if not path.exists() and not path.is_symlink():
        return None
    if path.is_symlink() or not path.is_file() or dependencies is None:
        raise ValueError("Dependency qualification receipt or installed dependencies are invalid")
    body = path.read_bytes()
    proof = json.loads(body)
    source = stage / "source"
    def sha(path):
        if path.is_symlink() or not path.is_file():
            raise ValueError("Dependency qualification input is missing")
        with path.open("rb") as stream:
            return hashlib.file_digest(stream, "sha256").hexdigest()
    inputs = {name: sha(source / name) for name in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml")}
    if (proof.get("version") != 1 or proof.get("commit") != source_receipt["commit"]
            or proof.get("source") != source_receipt["source"]
            or proof.get("source_receipt_sha256") != sha(stage / "source-receipt.json")
            or proof.get("inputs") != inputs or proof.get("dependencies") != dependencies
            or proof.get("install") != "fresh-store-frozen-copy"
            or proof.get("rebuild") != "offline-network-namespace"
            or json.loads((source / "package.json").read_text()).get("packageManager") != "pnpm@" + str(proof.get("pnpm"))):
        raise ValueError("Dependency qualification does not match the staged source and dependencies")
    return hashlib.sha256(body).hexdigest()


def build(stage, expected_commit, expected_source, min_free_bytes, reserve_free_bytes=0):
    stage = stage.resolve(strict=True)
    assert_stage_location(stage)
    source = stage / "source"
    if source.is_symlink() or not source.is_dir():
        raise ValueError("Stage source must be a directory")
    receipt_path = stage / "source-receipt.json"
    receipt = json.loads(receipt_path.read_text())
    if (not re.fullmatch(r"[0-9a-f]{40}", expected_commit) or
            not re.fullmatch(r"[0-9a-f]{64}", expected_source) or
            receipt.get("commit") != expected_commit or receipt.get("source", {}).get("sha256") != expected_source):
        raise ValueError("Stage receipt does not match the approved commit and source digest")
    if ((stage / "build-receipt.json").exists() or (source / ".next").exists() or
            (source / ".next").is_symlink()):
        raise ValueError("Stage already contains build output")
    if min_free_bytes <= 0:
        raise ValueError("Minimum free bytes must be positive")
    if reserve_free_bytes < 0 or reserve_free_bytes >= min_free_bytes:
        raise ValueError("Free-space reserve must be nonnegative and below the minimum starting space")
    available = shutil.disk_usage(stage).free
    if available < min_free_bytes:
        raise ValueError(f"Insufficient staging filesystem space: {available} available, {min_free_bytes} required")
    excluded = frozenset({".next", "node_modules"})
    if inventory(source, excluded) != receipt["source"]:
        raise ValueError("Staged source differs from the commit archive")
    deps = source / "node_modules"
    if deps.is_symlink():
        raise ValueError("Dependencies must not be an external symlink")
    dependencies = inventory(deps, allow_internal_links=True, reject_hardlinks=True) if deps.exists() else None
    dependency_qualification = qualified_dependencies(stage, receipt, dependencies)
    workspace = stage / ".build-environment"
    workspace.mkdir(mode=0o700)
    for name in ("home", "tmp", "cache", "npm-cache"):
        (workspace / name).mkdir(mode=0o700)
    next_env = source / "next-env.d.ts"
    original_next_env = next_env.read_bytes() if next_env.is_file() and not next_env.is_symlink() else None
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": str(workspace / "home"), "TMPDIR": str(workspace / "tmp"),
        "XDG_CACHE_HOME": str(workspace / "cache"), "npm_config_cache": str(workspace / "npm-cache"),
        "npm_config_update_notifier": "false",
        "NEXT_PUBLIC_CONVEX_URL": "http://127.0.0.1:39320",
        "RELEASE_SHA": receipt["commit"],
        "CI": "1", "NEXT_TELEMETRY_DISABLED": "1",
    }
    run_bounded_build(source, env, reserve_free_bytes)
    restore_generated_next_env(source, workspace, original_next_env)
    if inventory(source, excluded) != receipt["source"]:
        raise ValueError("Staged source changed during the build")
    if (inventory(deps, allow_internal_links=True, reject_hardlinks=True) if deps.exists() else None) != dependencies:
        raise ValueError("Dependencies changed during the build")
    if qualified_dependencies(stage, receipt, dependencies) != dependency_qualification:
        raise ValueError("Dependency qualification changed during the build")
    for relative in (".next", ".next/standalone", ".next/static", ".next/static/chunks", "public"):
        path = source / relative
        if path.is_symlink() or not path.is_dir() or not path.resolve(strict=True).is_relative_to(source):
            raise ValueError(f"Unexpected build output directory: {relative}")
    config = json.loads((source / ".next/required-server-files.json").read_text()).get("config", {})
    if config.get("output") != "standalone" or config.get("env", {}).get("RELEASE_SHA") != receipt["commit"]:
        raise ValueError("Build does not identify the staged standalone commit")
    if not (source / ".next/standalone/server.js").is_file():
        raise ValueError("Standalone server is missing")
    chunks = list((source / ".next/static/chunks").glob("*.js"))
    if not any(b"http://127.0.0.1:39320" in path.read_bytes() for path in chunks):
        raise ValueError("Build does not contain the local database address")
    result = {
        "version": 1, "commit": receipt["commit"], "tree": receipt["tree"],
        "archive_sha256": receipt["archive_sha256"], "source": receipt["source"],
        "dependencies": dependencies,
        "dependency_qualification_sha256": dependency_qualification,
        "standalone": inventory(source / ".next/standalone", allow_internal_links=True),
        "static": inventory(source / ".next/static", allow_internal_links=True),
        "public": inventory(source / "public", allow_internal_links=True),
        "node": subprocess.check_output(["node", "--version"], env=env, text=True).strip(),
        "npm": subprocess.check_output(["npm", "--version"], env=env, text=True).strip(),
    }
    (stage / "build-receipt.json").write_text(json.dumps(result, sort_keys=True, indent=2) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("prepare")
    create.add_argument("--repo", type=Path, required=True)
    create.add_argument("--commit", required=True)
    create.add_argument("--output", type=Path, required=True)
    compile_stage = sub.add_parser("build")
    compile_stage.add_argument("--stage", type=Path, required=True)
    compile_stage.add_argument("--commit", required=True)
    compile_stage.add_argument("--source-sha256", required=True)
    compile_stage.add_argument("--min-free-bytes", required=True, type=int,
                               help="operator-selected minimum free space before starting; not a reservation")
    compile_stage.add_argument("--reserve-free-bytes", default=0, type=int,
                               help="stop the isolated build below this free-space floor; sampled, not reserved")
    args = parser.parse_args()
    try:
        result = (prepare(args.repo, args.commit, args.output) if args.command == "prepare" else
                  build(args.stage, args.commit, args.source_sha256, args.min_free_bytes, args.reserve_free_bytes))
        print(json.dumps(result, sort_keys=True))
    except (ValueError, OSError, subprocess.CalledProcessError, tarfile.TarError) as error:
        print(f"Web staging refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
