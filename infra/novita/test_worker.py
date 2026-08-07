import importlib.util
import json
import tempfile
import time
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("worker.py")
SPEC = importlib.util.spec_from_file_location("novita_worker", MODULE_PATH)
worker = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(worker)


class WorkerContractTests(unittest.TestCase):
    @staticmethod
    def _seal(unsigned):
        digest = worker.sha256_bytes(worker.canonical_bytes(unsigned))
        return {**unsigned, "manifestSha256": digest}, digest

    def _sealed_manifest(self):
        profile = worker.approved_profile("draft", "image")
        manifest_id = "image-" + "a" * 32
        profile_hash = worker.sha256_bytes(worker.canonical_bytes(profile))
        unsigned = {
            "contractVersion": worker.CONTRACT_VERSION,
            "manifestId": manifest_id,
            "phase": "image",
            "expiresAt": int(time.time() * 1000) + 60_000,
            "maxCostUsd": 1.25,
            "profile": profile,
            "profileSha256": profile_hash,
            "checkpoint": {
                "getUrl": "https://objects.example/checkpoint.json",
                "putUrl": "https://objects.example/checkpoint.json?write=1",
            },
            "heartbeat": {"putUrl": "https://objects.example/heartbeat.json"},
            "completion": {"putUrl": "https://objects.example/completion.json"},
            "jobs": [{
                "id": "shot-01",
                "prompt": "A clean studio still",
                "seed": 42,
                "width": 1280,
                "height": 736,
                "steps": 9,
                "guidanceScale": 0,
                "artifact": {
                    "putUrl": "https://objects.example/shot-01.png?write=1",
                    "headers": {
                        "x-amz-meta-manifest-id": manifest_id,
                        "x-amz-meta-profile-sha256": profile_hash,
                        "x-amz-meta-job-id": "shot-01",
                    },
                },
            }],
        }
        return self._seal(unsigned)

    def test_manifest_is_hash_bound_and_pinned(self):
        manifest, digest = self._sealed_manifest()
        self.assertEqual(worker.validate_manifest(manifest, digest)["phase"], "image")
        manifest["jobs"][0]["id"] = "changed"
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            worker.validate_manifest(manifest, digest)

    def test_unpinned_ltx_runtime_is_rejected(self):
        profile = worker.approved_profile("production", "video")
        unsigned = {
            "contractVersion": worker.CONTRACT_VERSION,
            "manifestId": "video-" + "b" * 32,
            "phase": "video",
            "expiresAt": int(time.time() * 1000) + 60_000,
            "maxCostUsd": 2,
            "profile": profile,
            "profileSha256": worker.sha256_bytes(worker.canonical_bytes(profile)),
            "runtimeRepository": worker.LTX_RUNTIME_REPOSITORY,
            "runtimeRevision": "0" * 40,
            "jobs": [{
                "id": "shot-01",
                "prompt": "A slow dolly push",
                "width": 1920,
                "height": 1088,
                "steps": 40,
                "frames": 121,
                "fps": 25,
            }],
        }
        _, digest = self._seal(unsigned)
        with self.assertRaisesRegex(ValueError, "official LTX runtime"):
            worker.validate_manifest({**unsigned, "manifestSha256": digest}, digest)

    def test_manifest_requires_cost_cap_and_rejects_profile_drift(self):
        manifest, _ = self._sealed_manifest()
        unsigned = {key: value for key, value in manifest.items() if key not in ("manifestSha256", "maxCostUsd")}
        no_cap, no_cap_digest = self._seal(unsigned)
        with self.assertRaisesRegex(ValueError, "spend cap"):
            worker.validate_manifest(no_cap, no_cap_digest)

        unsigned = {key: value for key, value in manifest.items() if key != "manifestSha256"}
        unsigned["jobs"] = [{**unsigned["jobs"][0], "steps": 10}]
        drifted, drifted_digest = self._seal(unsigned)
        with self.assertRaisesRegex(ValueError, "drifts"):
            worker.validate_manifest(drifted, drifted_digest)

    def test_ltx_cli_contract_matches_distilled_and_hq_modules(self):
        models = {
            "gemma-3-12b": Path("/models/gemma"),
            "ltx-spatial-upscaler": Path("/models/upscaler.safetensors"),
            "ltx-distilled": Path("/models/distilled.safetensors"),
            "ltx-dev": Path("/models/dev.safetensors"),
            "ltx-distilled-lora": Path("/models/lora.safetensors"),
        }
        job = {
            "prompt": "A slow dolly push",
            "negativePrompt": "flicker",
            "seed": 42,
            "height": 1088,
            "width": 1920,
            "frames": 121,
            "fps": 25,
            "steps": 40,
        }
        distilled = worker.build_video_command(
            job,
            {"pipeline": "distilled", "guidanceScale": 1},
            models,
            Path("/output/draft.mp4"),
            Path("/input/still.png"),
        )
        self.assertEqual(distilled[2], "ltx_pipelines.distilled")
        self.assertIn("--distilled-checkpoint-path", distilled)
        self.assertNotIn("--checkpoint-path", distilled)
        self.assertNotIn("--num-inference-steps", distilled)

        hq = worker.build_video_command(
            job,
            {"pipeline": "two-stage-hq", "guidanceScale": 4},
            models,
            Path("/output/production.mp4"),
            None,
        )
        self.assertEqual(hq[2], "ltx_pipelines.ti2vid_two_stages_hq")
        self.assertEqual(hq[hq.index("--video-cfg-guidance-scale") + 1], "4.0")
        self.assertEqual(hq[hq.index("--distilled-lora") + 2], "0.8")
        self.assertEqual(hq[hq.index("--num-inference-steps") + 1], "40")
        self.assertEqual(hq[hq.index("--negative-prompt") + 1], "flicker")

    def test_ltx_model_specs_require_official_file_hashes_and_sizes(self):
        specs = [{
            "id": "gemma-3-12b", "kind": "tree", "sourcePath": "gemma", "localPath": "gemma",
            "manifestSha256": "a" * 64, "repository": worker.GEMMA_MODEL, "revision": "c" * 40,
        }]
        for model_id in ("ltx-dev", "ltx-distilled-lora", "ltx-spatial-upscaler"):
            filename, digest, size = worker.LTX_FILE_CONTRACTS[model_id]
            specs.append({
                "id": model_id, "kind": "file", "sourcePath": f"ltx/{filename}",
                "localPath": f"ltx/{filename}", "manifestSha256": digest, "sizeBytes": size,
            })
        self.assertEqual(worker.validate_model_specs(specs, "video", "two-stage-hq"), specs)
        specs[1] = {**specs[1], "manifestSha256": "f" * 64}
        with self.assertRaisesRegex(ValueError, "official pinned LTX file"):
            worker.validate_model_specs(specs, "video", "two-stage-hq")

    def test_artifact_upload_streams_file_and_binds_length(self):
        captured = {}

        class Response:
            status = 200

            @staticmethod
            def read(_limit):
                return b""

        class Connection:
            def __init__(self, host, port, timeout):
                captured.update({"host": host, "port": port, "timeout": timeout})

            def request(self, method, path, body, headers):
                captured.update({"method": method, "path": path, "body": body.read(), "headers": headers})

            @staticmethod
            def getresponse():
                return Response()

            @staticmethod
            def close():
                return None

        original = worker.http.client.HTTPSConnection
        worker.http.client.HTTPSConnection = Connection
        try:
            with tempfile.TemporaryDirectory() as directory:
                artifact = Path(directory) / "clip.mp4"
                artifact.write_bytes(b"rendered-video")
                worker._put_file("https://objects.example/render.mp4?signature=bound", artifact, {"Content-Type": "video/mp4"})
        finally:
            worker.http.client.HTTPSConnection = original
        self.assertEqual(captured["body"], b"rendered-video")
        self.assertEqual(captured["headers"]["Content-Length"], str(len(b"rendered-video")))
        self.assertEqual(captured["path"], "/render.mp4?signature=bound")

    def test_file_cache_hydration_verifies_source_and_local_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            volume, cache = root / "volume", root / "cache"
            volume.mkdir()
            source = volume / "models" / "checkpoint.bin"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"immutable-model-bytes")
            digest = worker.sha256_file(source)
            spec = {
                "id": "test-model",
                "kind": "file",
                "sourcePath": "models/checkpoint.bin",
                "localPath": "test/checkpoint.bin",
                "manifestSha256": digest,
                "sizeBytes": source.stat().st_size,
            }
            target = worker.hydrate_model(spec, volume, cache)
            self.assertEqual(target.read_bytes(), source.read_bytes())
            source.write_bytes(b"tampered")
            self.assertEqual(worker.hydrate_model(spec, volume, cache).read_bytes(), b"immutable-model-bytes")

    def test_tree_cache_uses_a_verified_file_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            volume, cache = root / "volume", root / "cache"
            tree = volume / "z-image"
            tree.mkdir(parents=True)
            model_file = tree / "transformer" / "weights.bin"
            model_file.parent.mkdir()
            model_file.write_bytes(b"z-image-weights")
            tree_manifest = {
                "files": [{
                    "path": "transformer/weights.bin",
                    "sizeBytes": model_file.stat().st_size,
                    "sha256": worker.sha256_file(model_file),
                }],
            }
            (tree / ".model-manifest.json").write_text(json.dumps(tree_manifest), "utf-8")
            digest = worker.sha256_bytes(worker.canonical_bytes(tree_manifest))
            target = worker.hydrate_model({
                "id": "z-image-turbo",
                "kind": "tree",
                "sourcePath": "z-image",
                "localPath": "z-image-local",
                "manifestSha256": digest,
            }, volume, cache)
            self.assertEqual((target / "transformer" / "weights.bin").read_bytes(), b"z-image-weights")
            self.assertTrue((target / ".verified-model.json").is_file())
            (target / "transformer" / "weights.bin").write_bytes(b"x" * len(b"z-image-weights"))
            repaired = worker.hydrate_model({
                "id": "z-image-turbo",
                "kind": "tree",
                "sourcePath": "z-image",
                "localPath": "z-image-local",
                "manifestSha256": digest,
            }, volume, cache)
            self.assertEqual((repaired / "transformer" / "weights.bin").read_bytes(), b"z-image-weights")

    def test_checkpoint_cannot_claim_jobs_outside_manifest(self):
        original = worker._request
        worker._request = lambda _url, **_kwargs: json.dumps({
            "manifestId": "image-" + "a" * 32,
            "completedJobIds": ["shot-01", "other-job"],
        }).encode()
        try:
            with self.assertRaisesRegex(ValueError, "outside"):
                worker._load_checkpoint(
                    {"getUrl": "https://objects.example/checkpoint.json"},
                    "image-" + "a" * 32,
                    {"shot-01"},
                )
        finally:
            worker._request = original

    def test_model_paths_cannot_escape_mounts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "escapes approved root"):
                worker.hydrate_model({
                    "id": "escape-test",
                    "kind": "file",
                    "sourcePath": "../outside",
                    "localPath": "inside",
                    "manifestSha256": "a" * 64,
                }, root / "volume", root / "cache")

    def test_http_transport_rejects_non_tls_urls(self):
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            worker._request("http://example.invalid/object")


if __name__ == "__main__":
    unittest.main()
