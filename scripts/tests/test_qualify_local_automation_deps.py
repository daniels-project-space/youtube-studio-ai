import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest import mock

from scripts.tests.test_stage_local_automation_web import WebStageTests

SCRIPT = Path(__file__).resolve().parents[1] / "qualify-local-automation-deps.py"
SPEC = importlib.util.spec_from_file_location("qualify_deps_test", SCRIPT)
QUAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(QUAL)


class DependencyQualificationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = WebStageTests("test_dirty_checkout_is_excluded_and_two_builds_match")
        self.fixture.setUp()
        package = json.loads((self.fixture.repo / "package.json").read_text())
        package["packageManager"] = "pnpm@11.5.1"
        (self.fixture.repo / "package.json").write_text(json.dumps(package))
        (self.fixture.repo / "pnpm-lock.yaml").write_text(
            "lockfileVersion: '9.0'\nimporters: {.: {}}\npackages:\n  fixture@1.0.0:\n"
            "    resolution: {integrity: 'sha512-" + "A" * 86 + "=='}\nsnapshots: {}\n")
        (self.fixture.repo / "pnpm-workspace.yaml").write_text("allowBuilds: {}\n")
        self.fixture.git("add", ".")
        self.fixture.git("commit", "-qm", "locked fixture")
        self.fixture.commit = self.fixture.git("rev-parse", "HEAD").strip()
        self.stage, self.source_receipt = self.fixture.prepare("deps")

    def tearDown(self):
        self.fixture.tearDown()

    def qualify(self, run):
        def output(command, **kwargs):
            return "v22.22.0\n" if command[0] == "node" else "11.5.1\n"
        with mock.patch.object(QUAL.shutil, "which", side_effect=lambda name: "/usr/bin/" + name), \
             mock.patch.object(QUAL.shutil, "copytree"), \
             mock.patch.object(QUAL.os, "chown"), \
             mock.patch.object(QUAL.subprocess, "check_output", side_effect=output), \
             mock.patch.object(QUAL, "run_bounded", side_effect=run):
            return QUAL.qualify(self.stage, self.fixture.commit, self.source_receipt["source"]["sha256"], 100, 50)

    def test_fresh_frozen_install_and_isolated_rebuild_bind_receipt(self):
        commands = []
        def run(command, source, env, reserve):
            commands.append(command)
            if len(commands) == 1:
                (source / "node_modules").mkdir()
                (source / "node_modules/package.js").write_text("fixture")
            self.assertEqual(reserve, 50)
        proof = self.qualify(run)
        self.assertIn("--frozen-lockfile", commands[0])
        self.assertIn("--ignore-scripts", commands[0])
        self.assertIn("--package-import-method=copy", commands[0])
        self.assertEqual(commands[1][0:4], ["/usr/bin/bwrap", "--ro-bind", "/", "/"])
        self.assertIn("--unshare-net", commands[1])
        self.assertIn("--reuid=65534", commands[1])
        self.assertIn("--pending", commands[1])
        self.assertEqual(proof["source"], self.source_receipt["source"])
        stage = QUAL.stage_tools
        sha = stage.qualified_dependencies(self.stage, self.source_receipt, proof["dependencies"])
        self.assertIsNotNone(sha)
        (self.stage / "source/node_modules/package.js").write_text("changed")
        changed = stage.inventory(self.stage / "source/node_modules", allow_internal_links=True, reject_hardlinks=True)
        with self.assertRaisesRegex(ValueError, "does not match"):
            stage.qualified_dependencies(self.stage, self.source_receipt, changed)

    def test_failed_install_does_not_create_receipt(self):
        def fail(*args):
            raise subprocess.CalledProcessError(1, "pnpm")
        with self.assertRaises(subprocess.CalledProcessError):
            self.qualify(fail)
        self.assertFalse((self.stage / "dependency-receipt.json").exists())

    def test_modified_lock_is_rejected_before_install(self):
        (self.stage / "source/pnpm-lock.yaml").write_text("changed")
        with self.assertRaisesRegex(ValueError, "differs"):
            self.qualify(lambda *args: self.fail("install must not run"))

    def test_lockfile_rejects_weak_or_external_resolution(self):
        lock = self.stage / "source/pnpm-lock.yaml"
        good = lock.read_text()
        for bad in (good.replace("sha512-", "sha1-"),
                    good.replace("resolution: {integrity:", "resolution: {tarball: 'https://example.invalid/x', integrity:"),
                    good.replace("snapshots: {}", "snapshots: {fixture: {dependencies: {x: 'file:../elsewhere'}}}")):
            lock.write_text(bad)
            with self.assertRaises(ValueError):
                QUAL.validate_lockfile(lock)

    def test_rejects_preexisting_dependencies_and_low_space(self):
        (self.stage / "source/node_modules").mkdir()
        with self.assertRaisesRegex(ValueError, "not fresh"):
            self.qualify(lambda *args: self.fail("install must not run"))
        with self.assertRaisesRegex(ValueError, "Insufficient free space"):
            QUAL.qualify(self.stage, self.fixture.commit, self.source_receipt["source"]["sha256"], 2**100, 50)


if __name__ == "__main__":
    unittest.main()
