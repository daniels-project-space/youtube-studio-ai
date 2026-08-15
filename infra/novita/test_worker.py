import importlib.util
import json
import tempfile
import threading
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
            "gpuSku": worker.REQUIRED_GPU_SKU,
            "gpuCount": worker.REQUIRED_GPU_COUNT,
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

    def test_manifest_requires_exactly_one_rtx_4090(self):
        manifest, _ = self._sealed_manifest()
        wrong_sku = {key: value for key, value in manifest.items() if key != "manifestSha256"}
        wrong_sku["gpuSku"] = "RTX 4090D"
        wrong_sku_manifest, wrong_sku_digest = self._seal(wrong_sku)
        with self.assertRaisesRegex(ValueError, "exactly one RTX 4090"):
            worker.validate_manifest(wrong_sku_manifest, wrong_sku_digest)

        wrong_count = {key: value for key, value in manifest.items() if key != "manifestSha256"}
        wrong_count["gpuCount"] = 2
        wrong_count_manifest, wrong_count_digest = self._seal(wrong_count)
        with self.assertRaisesRegex(ValueError, "exactly one RTX 4090"):
            worker.validate_manifest(wrong_count_manifest, wrong_count_digest)

    def test_host_attestation_only_accepts_one_rtx_4090(self):
        original_run = worker.subprocess.run
        calls = []

        def fake_run(argv, **kwargs):
            calls.append((argv, kwargs))
            return worker.subprocess.CompletedProcess(argv, 0, "NVIDIA GeForce RTX 4090 24GB\n", "")

        try:
            worker.subprocess.run = fake_run
            worker.assert_rtx_4090_host()
            self.assertEqual(calls[0][0], ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"])
            self.assertTrue(calls[0][1]["check"])

            worker.subprocess.run = lambda argv, **kwargs: worker.subprocess.CompletedProcess(
                argv, 0, "NVIDIA H100 80GB HBM3\n", "",
            )
            with self.assertRaisesRegex(RuntimeError, "exactly one RTX 4090"):
                worker.assert_rtx_4090_host()

            worker.subprocess.run = lambda argv, **kwargs: worker.subprocess.CompletedProcess(
                argv, 0, "RTX 4090\nRTX 4090\n", "",
            )
            with self.assertRaisesRegex(RuntimeError, "exactly one RTX 4090"):
                worker.assert_rtx_4090_host()
        finally:
            worker.subprocess.run = original_run

    def test_unpinned_ltx_runtime_is_rejected(self):
        profile = worker.approved_profile("production", "video")
        unsigned = {
            "contractVersion": worker.CONTRACT_VERSION,
            "manifestId": "video-" + "b" * 32,
            "phase": "video",
            "gpuSku": worker.REQUIRED_GPU_SKU,
            "gpuCount": worker.REQUIRED_GPU_COUNT,
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

    def test_manifest_validates_optional_sealed_runtime_cap(self):
        manifest, _ = self._sealed_manifest()
        for invalid in (True, 59, worker.MAX_WORKER_RUNTIME_SECONDS + 1, 61.5):
            unsigned = {key: value for key, value in manifest.items() if key != "manifestSha256"}
            unsigned["maxRuntimeSeconds"] = invalid
            bounded, digest = self._seal(unsigned)
            with self.assertRaisesRegex(ValueError, "maxRuntimeSeconds"):
                worker.validate_manifest(bounded, digest)

        unsigned = {key: value for key, value in manifest.items() if key != "manifestSha256"}
        unsigned["expiresAt"] = int(time.time() * 1000) + 600_000
        unsigned["maxRuntimeSeconds"] = worker.MIN_WORKER_RUNTIME_SECONDS
        bounded, digest = self._seal(unsigned)
        accepted = worker.validate_manifest(bounded, digest)
        before = time.monotonic()
        deadline, deadline_at = worker.sealed_deadline(accepted)
        self.assertLessEqual(deadline - before, worker.MIN_WORKER_RUNTIME_SECONDS + 1)
        self.assertLessEqual(deadline_at, int(time.time() * 1000) + worker.MIN_WORKER_RUNTIME_SECONDS * 1_000 + 100)

    def test_sealed_deadline_arms_stop_fence(self):
        event = threading.Event()
        timer = worker.arm_sealed_deadline(time.monotonic() + 0.02, event)
        try:
            self.assertTrue(event.wait(0.5), "sealed deadline must stop the worker cooperatively")
        finally:
            timer.cancel()

    def test_deadline_check_interrupts_model_or_inference_work(self):
        worker.STOP.clear()
        try:
            with self.assertRaisesRegex(InterruptedError, "sealed lifetime"):
                worker._check_deadline(time.monotonic() - 0.01)
            self.assertTrue(worker.STOP.is_set())
        finally:
            worker.STOP.clear()

    def test_ltx_25_cli_contract_uses_split_components_and_rtx_4090_execution_mode(self):
        models = {
            "ltx-transformer": Path("/models/transformer.safetensors"),
            "ltx-text-encoder": Path("/models/text-encoder.safetensors"),
            "ltx-video-vae": Path("/models/video-vae.safetensors"),
            "ltx-audio-vae": Path("/models/audio-vae.safetensors"),
            "ltx-spatial-upscaler": Path("/models/upscaler.safetensors"),
        }
        job = {
            "prompt": "A slow dolly push",
            "seed": 42,
            "height": 704,
            "width": 1280,
            "frames": 121,
            "fps": 25,
            "steps": 8,
        }
        command = worker.build_video_command(
            job,
            {"pipeline": "distilled", "quantization": "fp8-cast", "offload": "cpu"},
            models,
            Path("/output/clip.mp4"),
            Path("/input/still.png"),
        )
        self.assertEqual(command[2], "ltx_pipelines.distilled")
        self.assertEqual(command[command.index("--transformer-path") + 1], "/models/transformer.safetensors")
        self.assertEqual(command[command.index("--text-encoder-path") + 1], "/models/text-encoder.safetensors")
        self.assertEqual(command[command.index("--video-vae-path") + 1], "/models/video-vae.safetensors")
        self.assertEqual(command[command.index("--audio-vae-path") + 1], "/models/audio-vae.safetensors")
        self.assertEqual(command[command.index("--quantization") + 1], "fp8-cast")
        self.assertEqual(command[command.index("--offload") + 1], "cpu")
        self.assertIn("--image", command)
        for legacy in ("--gemma-root", "--distilled-checkpoint-path", "--checkpoint-path", "--distilled-lora", "--negative-prompt"):
            self.assertNotIn(legacy, command)

        endpoint_command = worker.build_video_command(
            job,
            {"pipeline": "distilled", "quantization": "fp8-cast", "offload": "cpu"},
            models,
            Path("/output/endpoint.mp4"),
            Path("/input/start.png"),
            Path("/input/end.png"),
        )
        image_indices = [index for index, value in enumerate(endpoint_command) if value == "--image"]
        self.assertEqual(len(image_indices), 2)
        self.assertEqual(
            endpoint_command[image_indices[0]:image_indices[0] + 4],
            ["--image", "/input/start.png", "0", "1.0"],
        )
        self.assertEqual(
            endpoint_command[image_indices[1]:image_indices[1] + 4],
            ["--image", "/input/end.png", str(job["frames"] - 1), "1.0"],
        )

        with self.assertRaisesRegex(ValueError, "unsupported LTX pipeline"):
            worker.build_video_command(job, {"pipeline": "two-stage-hq"}, models, Path("/output/nope.mp4"), None)

        adapter_job = {
            **job,
            "prompt": "faceless mannequin enters the archive",
            "creativeAdapter": {
                "id": "ltx-creative-faceless-mannequin",
                "strength": 0.8,
                "triggerTokens": ["faceless mannequin"],
            },
        }
        adapter_command = worker.build_video_command(
            adapter_job,
            {"pipeline": "distilled", "quantization": "fp8-cast", "offload": "cpu"},
            {**models, "ltx-creative-faceless-mannequin": Path("/models/loras/faceless.safetensors")},
            Path("/output/adapter.mp4"),
            Path("/input/still.png"),
        )
        self.assertEqual(
            adapter_command[adapter_command.index("--lora") + 1:adapter_command.index("--lora") + 3],
            ["/models/loras/faceless.safetensors", "0.8"],
        )

    def test_ltx_model_specs_require_official_file_hashes_and_sizes(self):
        specs = []
        for model_id, (relative_path, digest, size) in worker.LTX_FILE_CONTRACTS.items():
            specs.append({
                "id": model_id, "kind": "file", "sourcePath": f"models/LTX-2.5/{relative_path}",
                "localPath": f"ltx-2.5/{relative_path}", "manifestSha256": digest, "sizeBytes": size,
                "repository": worker.LTX_MODEL, "revision": worker.LTX_REVISION,
            })
        self.assertEqual(worker.validate_model_specs(specs, "video", "distilled"), specs)
        specs[0] = {**specs[0], "manifestSha256": "f" * 64}
        with self.assertRaisesRegex(ValueError, "official pinned LTX file"):
            worker.validate_model_specs(specs, "video", "distilled")

    def test_ltx_creative_adapter_requires_exact_runtime_and_benchmark(self):
        specs = []
        for model_id, (relative_path, digest, size) in worker.LTX_FILE_CONTRACTS.items():
            specs.append({
                "id": model_id, "kind": "file", "sourcePath": f"models/LTX-2.5/{relative_path}",
                "localPath": f"ltx-2.5/{relative_path}", "manifestSha256": digest, "sizeBytes": size,
                "repository": worker.LTX_MODEL, "revision": worker.LTX_REVISION,
            })
        adapter_id = "ltx-creative-faceless-mannequin"
        adapter = {
            "id": adapter_id,
            "kind": "file",
            "sourcePath": "models/LTX-2.5/loras/faceless.safetensors",
            "localPath": "ltx-2.5/loras/faceless.safetensors",
            "manifestSha256": "a" * 64,
            "repository": worker.LTX_MODEL,
            "revision": worker.LTX_REVISION,
            "creativeAdapter": {
                "contractVersion": "ltx-creative-adapter/v1",
                "role": "material-style",
                "baseModel": worker.LTX_MODEL,
                "baseRevision": worker.LTX_REVISION,
                "runtimeRevision": worker.LTX_RUNTIME_REVISION,
                "triggerTokens": ["faceless mannequin"],
                "benchmark": {"rtx4090ProfileBenchmarked": True, "visualVerdict": "pass"},
            },
        }
        self.assertEqual(
            worker.validate_model_specs(specs + [adapter], "video", "distilled", {adapter_id}),
            specs + [adapter],
        )
        self.assertEqual(
            worker.validate_model_specs(specs + [adapter], "video", "distilled"),
            specs,
            "a cached but unselected adapter must not be hydrated into an ordinary LTX job",
        )
        with self.assertRaisesRegex(ValueError, "exact benchmarked"):
            worker.validate_model_specs(specs + [{**adapter, "creativeAdapter": {**adapter["creativeAdapter"], "runtimeRevision": "b" * 40}}], "video", "distilled", {adapter_id})
        with self.assertRaisesRegex(ValueError, "trigger tokens"):
            worker.requested_creative_adapter_ids([{
                "creativeAdapter": {"id": adapter_id, "strength": 0.8, "triggerTokens": ["faceless mannequin"]},
                "prompt": "cinematic archive exterior",
            }], "video")

    def test_ltx_25_profile_and_ffprobe_gate_require_the_sealed_x2_target(self):
        profile = worker.approved_profile("production", "video")
        self.assertEqual(profile["model"], "Lightricks/LTX-2.5")
        self.assertEqual((profile["width"], profile["height"]), (1280, 704))
        self.assertEqual((profile["stageOneWidth"], profile["stageOneHeight"]), (640, 352))
        self.assertEqual(profile["spatialUpscaleFactor"], 2)
        self.assertEqual(profile["quantization"], "fp8-cast")
        self.assertEqual(profile["offload"], "cpu")

        original_run = worker.subprocess.run
        try:
            worker.subprocess.run = lambda *_args, **_kwargs: worker.subprocess.CompletedProcess(
                ["ffprobe"], 0, json.dumps({"streams": [{"codec_type": "video", "width": 1280, "height": 704}]}), "",
            )
            self.assertEqual(worker.probe_video_output(Path("/tmp/clip.mp4"), 1280, 704), {"outputWidth": 1280, "outputHeight": 704})
            worker.subprocess.run = lambda *_args, **_kwargs: worker.subprocess.CompletedProcess(
                ["ffprobe"], 0, json.dumps({"streams": [{"codec_type": "video", "width": 640, "height": 352}]}), "",
            )
            with self.assertRaisesRegex(RuntimeError, "geometry"):
                worker.probe_video_output(Path("/tmp/clip.mp4"), 1280, 704)
        finally:
            worker.subprocess.run = original_run

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
