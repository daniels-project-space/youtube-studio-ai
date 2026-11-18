#!/usr/bin/env python3
"""Release an independently approved staged web build, retaining its predecessor."""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


def load_sibling(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


stage_tools = load_sibling("web_stage_tools", "stage-local-automation-web.py")
legacy = load_sibling("web_legacy_health", "release-local-automation-web.py")


def check_stage(stage, repo, commit, approved_receipt):
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or not re.fullmatch(r"[0-9a-f]{64}", approved_receipt):
        raise ValueError("Expected a full commit and approved receipt SHA-256")
    stage = stage.resolve(strict=True)
    stage_tools.assert_stage_location(stage)
    receipt_path = stage / "build-receipt.json"
    if receipt_path.is_symlink() or not receipt_path.is_file():
        raise ValueError("Build receipt must be a regular file")
    body = receipt_path.read_bytes()
    if hashlib.sha256(body).hexdigest() != approved_receipt:
        raise ValueError("Build receipt does not match the approved digest")
    receipt = json.loads(body)
    if receipt.get("version") != 1 or receipt.get("commit") != commit:
        raise ValueError("Build receipt commit does not match")
    source = stage / "source"
    if source.is_symlink() or not source.is_dir():
        raise ValueError("Stage source must be a directory")
    source_receipt = json.loads((stage / "source-receipt.json").read_text())
    for field in ("commit", "tree", "archive_sha256", "source"):
        if receipt.get(field) != source_receipt.get(field):
            raise ValueError("Build and source receipts differ")
    with tempfile.TemporaryDirectory(prefix="yta-web-source-attest-") as scratch:
        fresh = stage_tools.prepare(repo, commit, Path(scratch) / "export")
        if fresh != source_receipt:
            raise ValueError("Source receipt does not match the Git commit export")
    if stage_tools.inventory(source, frozenset({".next", "node_modules"})) != receipt["source"]:
        raise ValueError("Staged source changed since the build")
    deps = source / "node_modules"
    if deps.is_symlink():
        raise ValueError("Dependencies must not be an external symlink")
    actual_deps = stage_tools.inventory(deps, allow_internal_links=True, reject_hardlinks=True) if deps.exists() else None
    if actual_deps != receipt.get("dependencies"):
        raise ValueError("Staged dependencies changed since the build")
    qualification = stage_tools.qualified_dependencies(stage, source_receipt, actual_deps)
    if not qualification or qualification != receipt.get("dependency_qualification_sha256"):
        raise ValueError("Staged dependencies lack the approved frozen-install qualification")
    for path in (source / ".next", source / ".next/standalone", source / ".next/static",
                 source / ".next/static/chunks", source / "public"):
        if path.is_symlink() or not path.is_dir() or not path.resolve(strict=True).is_relative_to(source):
            raise ValueError("Unexpected staged output directory")
    for key, path in (("standalone", source / ".next/standalone"),
                      ("static", source / ".next/static"), ("public", source / "public")):
        if stage_tools.inventory(path, allow_internal_links=True) != receipt.get(key):
            raise ValueError(f"Staged {key} differs from the approved receipt")
    config = json.loads((source / ".next/required-server-files.json").read_text()).get("config", {})
    if config.get("output") != "standalone" or config.get("env", {}).get("RELEASE_SHA") != commit:
        raise ValueError("Build metadata does not match the approved commit")
    return source, receipt, body


def seal_release(root):
    for directory, dirs, files in os.walk(root, followlinks=False):
        os.chown(directory, 0, 0)
        os.chmod(directory, 0o755)
        for name in dirs + files:
            path = Path(directory) / name
            if path.is_symlink():
                if not path.resolve(strict=True).is_relative_to(root):
                    raise ValueError("Copied release has an external symlink")
                os.lchown(path, 0, 0)
            elif path.is_file():
                os.chown(path, 0, 0)
                os.chmod(path, 0o644 | (path.stat().st_mode & 0o111))


def atomic_switch(target, destination):
    current = target / "current"
    temporary = target / "current.next"
    if temporary.exists() or temporary.is_symlink():
        raise ValueError("A pending release link already exists")
    temporary.symlink_to(destination, target_is_directory=True)
    try:
        os.replace(temporary, current)
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def release(stage, repo, commit, approved_receipt, target, cache, restart, verify, seal=seal_release, *, approved_prior_sha256):
    target = target.resolve(strict=True)
    releases = (target / "releases").resolve(strict=True)
    if releases.parent != target or not cache.is_dir():
        raise ValueError("Installed web paths are not in the expected state")
    with legacy.release_lock(target):
        current = target / "current"
        if not current.is_symlink():
            raise ValueError("Current web release is not a symlink")
        prior = current.resolve(strict=True)
        if prior.parent != releases or not prior.is_dir():
            raise ValueError("Prior release is outside the retained release directory")
        if not re.fullmatch(r"[0-9a-f]{64}", approved_prior_sha256):
            raise ValueError("Expected the approved prior package SHA-256")
        def check_prior():
            prior_cache = prior / '.next/cache'
            if not prior_cache.is_symlink() or prior_cache.resolve(strict=True) != cache.resolve(strict=True):
                raise ValueError("Prior release cache boundary changed")
            actual = stage_tools.inventory(prior, allow_internal_links=True, excluded_paths=frozenset({'.next/cache'}))
            if actual['sha256'] != approved_prior_sha256:
                raise ValueError("Prior release does not match the approved package")
        check_prior()
        destination = releases / commit
        if destination.exists() or destination.is_symlink():
            raise ValueError("Release already exists; inspect it before retrying")
        source, receipt, body = check_stage(stage, repo, commit, approved_receipt)
        private = Path(tempfile.mkdtemp(prefix=".staged-", dir=releases))
        candidate = private / "release"
        shutil.copytree(source / ".next/standalone", candidate, symlinks=True)
        if stage_tools.inventory(candidate, allow_internal_links=True) != receipt["standalone"]:
            raise ValueError("Copied standalone output does not match the approved receipt")
        excluded = frozenset({"public", ".next/static", ".next/cache"})
        retained = stage_tools.inventory(candidate, allow_internal_links=True, excluded_paths=excluded)
        for relative in ("public", ".next", ".next/static", ".next/cache"):
            if (candidate / relative).is_symlink():
                raise ValueError("Copied release has a symlink at an overlay boundary")
        shutil.copytree(source / ".next/static", candidate / ".next/static", symlinks=True, dirs_exist_ok=True)
        shutil.copytree(source / "public", candidate / "public", symlinks=True, dirs_exist_ok=True)
        if (stage_tools.inventory(candidate, allow_internal_links=True, excluded_paths=excluded) != retained or
                stage_tools.inventory(candidate / ".next/static", allow_internal_links=True) != receipt["static"] or
                stage_tools.inventory(candidate / "public", allow_internal_links=True) != receipt["public"]):
            raise ValueError("Copied release differs from the approved output")
        if not (candidate / "server.js").is_file():
            raise ValueError("Copied standalone server is missing")
        cache_link = candidate / ".next/cache"
        if cache_link.exists() or cache_link.is_symlink():
            raise ValueError("Unexpected existing build cache")
        metadata = candidate / ".approved-build-receipt.json"
        if metadata.exists() or metadata.is_symlink():
            raise ValueError("Standalone output already contains release metadata")
        metadata.write_bytes(body)
        seal(candidate)
        if (stage_tools.inventory(candidate, allow_internal_links=True,
                                  excluded_paths=excluded | {".approved-build-receipt.json"}) != retained or
                stage_tools.inventory(candidate / ".next/static", allow_internal_links=True) != receipt["static"] or
                stage_tools.inventory(candidate / "public", allow_internal_links=True) != receipt["public"] or
                metadata.read_bytes() != body):
            raise ValueError("Sealed release differs from the approved output")
        cache_link.symlink_to(cache, target_is_directory=True)
        if current.resolve(strict=True) != prior:
            raise ValueError("Current release changed during preparation")
        check_prior()
        # Reserve the final name without replacing any existing release.
        destination.mkdir(mode=0o700)
        os.rename(candidate, destination)
        private.rmdir()
        atomic_switch(target, destination)
        try:
            restart()
            verify()
        except Exception as error:
            try:
                check_prior()
                atomic_switch(target, prior)
                restart()
                verify()
                check_prior()
            except Exception as rollback_error:
                raise RuntimeError(f"Release failed and rollback verification failed: {rollback_error}") from error
            raise RuntimeError("Release failed; previous release was restored and verified") from error
        return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--release", action="store_true", required=True)
    parser.add_argument("--stage", type=Path, required=True)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--receipt-sha256", required=True)
    parser.add_argument("--prior-package-sha256", required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Release requires root")
    try:
        path = release(args.stage, args.repo, args.commit, args.receipt_sha256,
                       Path("/opt/youtube-automation-web"), Path("/var/lib/youtube-automation-web/next-cache"),
                       lambda: subprocess.run(["systemctl", "restart", "youtube-automation-web.service"], check=True),
                       legacy.verify, approved_prior_sha256=args.prior_package_sha256)
        print(f"Staged web release is running: {path}")
    except (ValueError, OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Staged web release refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
