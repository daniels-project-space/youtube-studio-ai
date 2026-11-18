import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "stage-local-automation-web.py"
SPEC = importlib.util.spec_from_file_location("stage_web_test", SCRIPT)
STAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STAGE)


class WebStageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "Fixture")
        (self.repo / "package.json").write_text(json.dumps({"scripts": {"build:vps": "node build.cjs"}}))
        (self.repo / "public").mkdir()
        (self.repo / "public/asset.txt").write_text("committed\n")
        (self.repo / "build.cjs").write_text("""
const fs = require("fs");
const path = require("path");
for (const name of ["HOME", "TMPDIR", "XDG_CACHE_HOME", "npm_config_cache"]) {
  if (!process.env[name].startsWith(path.resolve("..", ".build-environment") + path.sep)) {
    throw new Error("build environment is not isolated: " + name);
  }
}
fs.mkdirSync(".next/standalone", {recursive:true});
fs.mkdirSync(".next/static/chunks", {recursive:true});
fs.writeFileSync(".next/standalone/server.js", "fixture server");
fs.writeFileSync(".next/static/chunks/app.js", "http://127.0.0.1:39320");
fs.writeFileSync(".next/required-server-files.json", JSON.stringify({
  config: {output:"standalone", env:{RELEASE_SHA:process.env.RELEASE_SHA}}
}));
""")
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        self.commit = self.git("rev-parse", "HEAD").strip()
        (self.repo / "public/asset.txt").write_text("dirty\n")
        (self.repo / "untracked-secret").write_text("not part of commit")

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], text=True)

    def call(self, *args):
        return subprocess.run(["/usr/bin/python3", str(SCRIPT), *map(str, args)],
                              text=True, capture_output=True, check=False,
                              env={"PATH": os.environ["PATH"], "PYTHONDONTWRITEBYTECODE": "1"})

    def prepare(self, name):
        stage = self.root / name
        result = self.call("prepare", "--repo", self.repo, "--commit", self.commit, "--output", stage)
        self.assertEqual(result.returncode, 0, result.stderr)
        return stage, json.loads(result.stdout)

    def build(self, stage, digest, commit=None, min_free=1):
        return self.call("build", "--stage", stage, "--commit", commit or self.commit,
                         "--source-sha256", digest, "--min-free-bytes", min_free)

    def test_dirty_checkout_is_excluded_and_two_builds_match(self):
        stage1, receipt1 = self.prepare("one")
        stage2, receipt2 = self.prepare("two")
        self.assertEqual(receipt1, receipt2)
        archive = subprocess.check_output(["git", "-C", str(self.repo), "archive", "--format=tar", self.commit])
        self.assertEqual(receipt1["archive_sha256"], hashlib.sha256(archive).hexdigest())
        self.assertEqual((stage1 / "source/public/asset.txt").read_text(), "committed\n")
        self.assertFalse((stage1 / "source/untracked-secret").exists())
        for stage, receipt in ((stage1, receipt1), (stage2, receipt2)):
            result = self.build(stage, receipt["source"]["sha256"])
            self.assertEqual(result.returncode, 0, result.stderr)
        build1 = json.loads((stage1 / "build-receipt.json").read_text())
        build2 = json.loads((stage2 / "build-receipt.json").read_text())
        self.assertEqual(build1, build2)
        self.assertEqual(build1["commit"], self.commit)
        self.assertIsNone(build1["dependencies"])
        self.assertEqual((self.repo / "public/asset.txt").read_text(), "dirty\n")

    def test_rejects_changed_source_and_wrong_approval(self):
        stage, receipt = self.prepare("stage")
        digest = receipt["source"]["sha256"]
        self.assertNotEqual(self.build(stage, "0" * 64).returncode, 0)
        self.assertNotEqual(self.build(stage, digest, "0" * 40).returncode, 0)
        (stage / "source/public/asset.txt").write_text("changed\n")
        result = self.build(stage, digest)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("differs from the commit archive", result.stderr)
        self.assertFalse((stage / "build-receipt.json").exists())

    def test_rejects_reuse_and_untracked_stage_inputs(self):
        stage, receipt = self.prepare("stage")
        self.assertNotEqual(self.call("prepare", "--repo", self.repo, "--commit", self.commit,
                                      "--output", stage).returncode, 0)
        (stage / "source/extra.txt").write_text("unexpected")
        self.assertNotEqual(self.build(stage, receipt["source"]["sha256"]).returncode, 0)

    def test_rejects_build_that_changes_source(self):
        build_script = self.repo / "build.cjs"
        build_script.write_text(build_script.read_text() + '\nfs.writeFileSync("public/asset.txt", "changed");\n')
        self.git("add", "build.cjs")
        self.git("commit", "-qm", "mutating build")
        self.commit = self.git("rev-parse", "HEAD").strip()
        stage, receipt = self.prepare("mutating")
        result = self.build(stage, receipt["source"]["sha256"])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("changed during the build", result.stderr)
        self.assertFalse((stage / "build-receipt.json").exists())

    def test_insufficient_space_fails_before_build(self):
        stage, receipt = self.prepare("space")
        result = self.build(stage, receipt["source"]["sha256"], min_free=2 ** 100)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Insufficient staging filesystem space", result.stderr)
        self.assertFalse((stage / ".build-environment").exists())
        self.assertFalse((stage / "source/.next").exists())
        self.assertFalse((stage / "build-receipt.json").exists())

    def test_bounded_build_stops_only_its_own_process_group(self):
        process = mock.Mock(pid=1234, args=["npm"], returncode=None)
        process.poll.side_effect = [None, None]
        with mock.patch.object(STAGE.subprocess, "Popen", return_value=process) as popen, \
             mock.patch.object(STAGE.shutil, "disk_usage", return_value=mock.Mock(free=99)), \
             mock.patch.object(STAGE.os, "killpg") as kill:
            with self.assertRaisesRegex(ValueError, "free-space reserve"):
                STAGE.run_bounded_build(self.root, {}, 100)
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        kill.assert_called_once_with(1234, STAGE.signal.SIGTERM)
        process.wait.assert_called_once_with(timeout=10)

    def test_invalid_reserve_fails_before_build(self):
        stage, receipt = self.prepare("reserve")
        result = self.call("build", "--stage", stage, "--commit", self.commit,
                           "--source-sha256", receipt["source"]["sha256"],
                           "--min-free-bytes", 100, "--reserve-free-bytes", 100)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("reserve", result.stderr)
        self.assertFalse((stage / ".build-environment").exists())

    def test_only_exact_next_generated_type_paths_are_restored(self):
        workspace = self.root / "evidence"
        workspace.mkdir()
        path = self.repo / "next-env.d.ts"
        original = (b'/// <reference types="next" />\n'
                    b'import "./.next/dev/types/routes.d.ts";\n'
                    b'import "./.next/dev/types/root-params.d.ts";\n')
        generated = original.replace(b".next/dev/types/", b".next/types/")
        path.write_bytes(generated)
        STAGE.restore_generated_next_env(self.repo, workspace, original)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual((workspace / "next-env.generated.d.ts").read_bytes(), generated)
        path.write_bytes(generated + b"unexpected\n")
        with self.assertRaisesRegex(ValueError, "Unexpected change"):
            STAGE.restore_generated_next_env(self.repo, workspace, original)

    def test_untracked_generated_next_types_are_retained_only_if_exact(self):
        workspace = self.root / "evidence"
        workspace.mkdir()
        path = self.repo / "next-env.d.ts"
        path.write_bytes(b"unexpected")
        with self.assertRaisesRegex(ValueError, "Unexpected generated"):
            STAGE.restore_generated_next_env(self.repo, workspace, None)
        expected = (b'/// <reference types="next" />\n'
                    b'/// <reference types="next/image-types/global" />\n'
                    b'import "./.next/types/routes.d.ts";\n'
                    b'import "./.next/types/root-params.d.ts";\n\n'
                    b'// NOTE: This file should not be edited\n'
                    b'// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.\n')
        path.write_bytes(expected)
        STAGE.restore_generated_next_env(self.repo, workspace, None)
        self.assertFalse(path.exists())
        self.assertEqual((workspace / "next-env.generated.d.ts").read_bytes(), expected)

    def test_requires_positive_explicit_space_threshold(self):
        stage, receipt = self.prepare("threshold")
        digest = receipt["source"]["sha256"]
        self.assertNotEqual(self.build(stage, digest, min_free=0).returncode, 0)
        result = self.call("build", "--stage", stage, "--commit", self.commit, "--source-sha256", digest)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((stage / ".build-environment").exists())

    def test_rejects_dependency_hardlinked_to_external_file(self):
        stage, receipt = self.prepare("hardlink")
        outside = self.root / "external-dependency"
        outside.write_text("preserve me")
        deps = stage / "source/node_modules"
        deps.mkdir()
        os.link(outside, deps / "linked")
        result = self.build(stage, receipt["source"]["sha256"])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Hard-linked dependency is not isolated", result.stderr)
        self.assertEqual(outside.read_text(), "preserve me")
        self.assertFalse((stage / ".build-environment").exists())
        self.assertFalse((stage / "source/.next").exists())

    def test_accepts_hardlinks_confined_to_dependency_tree(self):
        deps = self.root / "isolated-dependencies"
        deps.mkdir()
        (deps / "one").write_text("same bytes")
        os.link(deps / "one", deps / "two")
        result = STAGE.inventory(deps, allow_internal_links=True, reject_hardlinks=True)
        self.assertEqual(result["entries"], 2)
        os.link(deps / "one", self.root / "outside")
        with self.assertRaisesRegex(ValueError, "not isolated"):
            STAGE.inventory(deps, allow_internal_links=True, reject_hardlinks=True)


if __name__ == "__main__":
    unittest.main()
