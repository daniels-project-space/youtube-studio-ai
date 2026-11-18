import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock

from scripts.tests.test_stage_local_automation_web import WebStageTests


SCRIPT = Path(__file__).resolve().parents[1] / "release-staged-automation-web.py"
SPEC = importlib.util.spec_from_file_location("staged_web_release", SCRIPT)
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class StagedReleaseTests(unittest.TestCase):
    def setUp(self):
        self.fixture = WebStageTests("test_dirty_checkout_is_excluded_and_two_builds_match")
        self.fixture.setUp()
        repo = self.fixture.repo
        package = json.loads((repo / "package.json").read_text())
        package["packageManager"] = "pnpm@11.5.1"
        (repo / "package.json").write_text(json.dumps(package))
        (repo / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")
        (repo / "pnpm-workspace.yaml").write_text("allowBuilds: {}\n")
        self.fixture.git("add", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml")
        self.fixture.git("commit", "-qm", "locked fixture")
        self.fixture.commit = self.fixture.git("rev-parse", "HEAD").strip()
        self.stage, source_receipt = self.fixture.prepare("release-stage")
        source = self.stage / "source"
        (source / "node_modules").mkdir()
        (source / "node_modules/fixture.js").write_text("fixture")
        sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
        qualification = {"version": 1, "commit": self.fixture.commit, "source": source_receipt["source"],
                         "source_receipt_sha256": sha(self.stage / "source-receipt.json"),
                         "inputs": {name: sha(source / name) for name in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml")},
                         "pnpm": "11.5.1", "install": "fresh-store-frozen-copy",
                         "rebuild": "offline-network-namespace",
                         "dependencies": RELEASE.stage_tools.inventory(source / "node_modules", allow_internal_links=True, reject_hardlinks=True)}
        (self.stage / "dependency-receipt.json").write_text(json.dumps(qualification))
        result = self.fixture.build(self.stage, source_receipt["source"]["sha256"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.digest = hashlib.sha256((self.stage / "build-receipt.json").read_bytes()).hexdigest()
        self.target = self.fixture.root / "installed"
        self.releases = self.target / "releases"
        self.releases.mkdir(parents=True)
        self.prior = self.releases / "previous"
        self.prior.mkdir()
        (self.prior / "server.js").write_text("old release")
        (self.target / "current").symlink_to(self.prior, target_is_directory=True)
        self.cache = self.fixture.root / "cache"
        self.cache.mkdir()
        (self.prior / '.next').mkdir()
        (self.prior / '.next/cache').symlink_to(self.cache, target_is_directory=True)
        self.prior_digest = RELEASE.stage_tools.inventory(self.prior, allow_internal_links=True,
                                                          excluded_paths=frozenset({'.next/cache'}))['sha256']
        self.events = []

    def tearDown(self):
        self.fixture.tearDown()

    def run_release(self, verify=None):
        return RELEASE.release(
            self.stage, self.fixture.repo, self.fixture.commit, self.digest,
            self.target, self.cache,
            lambda: self.events.append("restart"),
            verify or (lambda: self.events.append("verify")),
            seal=lambda path: None,
            approved_prior_sha256=self.prior_digest,
        )

    def test_approved_release_switches_and_retains_predecessor(self):
        destination = self.run_release()
        self.assertEqual((self.target / "current").resolve(), destination)
        self.assertEqual((destination / "server.js").read_text(), "fixture server")
        self.assertEqual((destination / "public/asset.txt").read_text(), "committed\n")
        self.assertEqual((destination / ".next/cache").resolve(), self.cache)
        self.assertEqual((self.prior / "server.js").read_text(), "old release")
        self.assertEqual(self.events, ["restart", "verify"])

    def test_failed_health_restores_and_verifies_predecessor(self):
        calls = []
        def verify():
            calls.append((self.target / "current").resolve())
            if len(calls) == 1:
                raise RuntimeError("synthetic health failure")
        with self.assertRaisesRegex(RuntimeError, "previous release was restored and verified"):
            self.run_release(verify)
        self.assertEqual((self.target / "current").resolve(), self.prior)
        self.assertEqual(self.events, ["restart", "restart"])
        self.assertEqual(calls[-1], self.prior)
        self.assertTrue((self.releases / self.fixture.commit).is_dir())

    def test_tampering_or_wrong_approval_never_switches(self):
        with self.assertRaisesRegex(ValueError, "approved digest"):
            RELEASE.release(self.stage, self.fixture.repo, self.fixture.commit, "0" * 64,
                            self.target, self.cache, lambda: self.fail("restart"),
                            lambda: self.fail("verify"), seal=lambda path: None, approved_prior_sha256=self.prior_digest)
        (self.stage / "source/.next/static/chunks/app.js").write_text("tampered")
        with self.assertRaisesRegex(ValueError, "static differs"):
            self.run_release()
        self.assertEqual((self.target / "current").resolve(), self.prior)
        self.assertEqual(self.events, [])

    def test_changed_predecessor_never_switches(self):
        (self.prior / 'server.js').write_text('tampered predecessor')
        with self.assertRaisesRegex(ValueError, 'Prior release does not match'):
            self.run_release()
        self.assertEqual((self.target / 'current').resolve(), self.prior)
        self.assertEqual(self.events, [])

    def test_changed_predecessor_during_preparation_never_switches(self):
        def corrupt_prior(_path):
            (self.prior / 'server.js').write_text('tampered while preparing')
        with self.assertRaisesRegex(ValueError, 'Prior release does not match'):
            RELEASE.release(self.stage, self.fixture.repo, self.fixture.commit, self.digest,
                            self.target, self.cache, lambda: self.fail('restart'), lambda: self.fail('verify'),
                            seal=corrupt_prior, approved_prior_sha256=self.prior_digest)
        self.assertEqual((self.target / 'current').resolve(), self.prior)

    def test_changed_cache_boundary_never_switches(self):
        (self.prior / '.next/cache').unlink()
        other = self.fixture.root / 'wrong-cache'; other.mkdir()
        (self.prior / '.next/cache').symlink_to(other, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'cache boundary changed'):
            self.run_release()
        self.assertEqual((self.target / 'current').resolve(), self.prior)

    def test_missing_or_altered_dependency_qualification_refuses_release(self):
        path = self.stage / "dependency-receipt.json"
        original = path.read_text()
        path.unlink()
        with self.assertRaisesRegex(ValueError, "lack the approved"):
            self.run_release()
        path.write_text(original.replace("fresh-store-frozen-copy", "unverified-copy"))
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.run_release()
        self.assertEqual(self.events, [])

    def test_forged_receipts_cannot_claim_another_git_source(self):
        receipt_path = self.stage / "build-receipt.json"
        source_path = self.stage / "source-receipt.json"
        receipt = json.loads(receipt_path.read_text())
        source_receipt = json.loads(source_path.read_text())
        receipt["tree"] = source_receipt["tree"] = "0" * 40
        receipt_path.write_text(json.dumps(receipt))
        source_path.write_text(json.dumps(source_receipt))
        self.digest = hashlib.sha256(receipt_path.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "does not match the Git commit export"):
            self.run_release()
        self.assertEqual((self.target / "current").resolve(), self.prior)
        self.assertEqual(self.events, [])

    def test_change_during_copy_is_rejected(self):
        original = RELEASE.shutil.copytree
        def copy_and_change(src, dst, *args, **kwargs):
            result = original(src, dst, *args, **kwargs)
            if isinstance(src, Path) and src == self.stage / "source/.next/standalone":
                (self.stage / "source/.next/static/chunks/app.js").write_text("changed during copy")
            return result
        with mock.patch.object(RELEASE.shutil, "copytree", side_effect=copy_and_change):
            with self.assertRaisesRegex(ValueError, "differs from the approved output"):
                self.run_release()
        self.assertEqual((self.target / "current").resolve(), self.prior)
        self.assertEqual(self.events, [])

    def test_change_during_sealing_is_rejected(self):
        def corrupt(path):
            (path / "server.js").write_text("changed during sealing")
        with self.assertRaisesRegex(ValueError, "Sealed release differs"):
            RELEASE.release(self.stage, self.fixture.repo, self.fixture.commit, self.digest,
                            self.target, self.cache, lambda: self.fail("restart"),
                            lambda: self.fail("verify"), seal=corrupt, approved_prior_sha256=self.prior_digest)
        self.assertEqual((self.target / "current").resolve(), self.prior)

    def test_sealing_preserves_executable_bits(self):
        executable = self.fixture.root / "executable"
        executable.write_text("fixture")
        executable.chmod(0o700)
        with mock.patch.object(RELEASE.os, "chown"), mock.patch.object(RELEASE.os, "lchown"):
            RELEASE.seal_release(self.fixture.root)
        self.assertEqual(executable.stat().st_mode & 0o111, 0o100)

    def test_legacy_lock_blocks_staged_before_preparation(self):
        legacy = RELEASE.legacy
        def attempt_staged():
            with self.assertRaises(BlockingIOError):
                self.run_release()
        with mock.patch.object(legacy, "TARGET", self.target), \
             mock.patch.object(legacy.os, "geteuid", return_value=0), \
             mock.patch.object(legacy.sys, "argv", ["release", "--release"]), \
             mock.patch.object(legacy, "release", side_effect=attempt_staged):
            legacy.main()
        self.assertEqual((self.target / "current").resolve(), self.prior)
        self.assertEqual(self.events, [])
        with legacy.release_lock(self.target):
            pass

    def test_staged_lock_blocks_legacy_through_verification(self):
        legacy = RELEASE.legacy
        def attempt_legacy():
            with mock.patch.object(legacy, "TARGET", self.target), \
                 mock.patch.object(legacy.os, "geteuid", return_value=0), \
                 mock.patch.object(legacy.sys, "argv", ["release", "--release"]), \
                 mock.patch.object(legacy, "release") as legacy_release:
                with self.assertRaises(BlockingIOError):
                    legacy.main()
                legacy_release.assert_not_called()
        self.run_release(attempt_legacy)
        self.assertEqual(self.events, ["restart"])

    def test_lock_remains_held_during_rollback_verification(self):
        calls = []
        def fail_then_verify():
            calls.append(True)
            with self.assertRaises(BlockingIOError):
                with RELEASE.legacy.release_lock(self.target):
                    self.fail("lock unexpectedly acquired")
            if len(calls) == 1:
                raise RuntimeError("synthetic health failure")
        with self.assertRaisesRegex(RuntimeError, "restored and verified"):
            self.run_release(fail_then_verify)
        self.assertEqual(len(calls), 2)

    def test_separate_process_lock_blocks_staged_release(self):
        code = """import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location('legacy', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with module.release_lock(pathlib.Path(sys.argv[2])):
    print('locked', flush=True)
    sys.stdin.read(1)
"""
        process = subprocess.Popen([sys.executable, "-c", code, str(SCRIPT.parent / "release-local-automation-web.py"),
                                    str(self.target)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(process.stdout.readline().strip(), "locked")
            with self.assertRaises(BlockingIOError):
                self.run_release()
            self.assertEqual(self.events, [])
        finally:
            process.communicate("x", timeout=5)
        self.assertEqual(process.returncode, 0)


if __name__ == "__main__":
    unittest.main()
