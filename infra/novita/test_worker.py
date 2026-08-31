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

    def test_current_distilled_worker_cannot_be_mislabeled_as_audio_to_video(self):
        """A2Vid needs its own pinned full-model worker path, not a phase rename."""
        manifest, _ = self._sealed_manifest()
        unsigned = {key: value for key, value in manifest.items() if key != "manifestSha256"}
        unsigned["phase"] = "audio_video"
        unsigned["manifestId"] = "audio_video-" + "c" * 32
        unsigned["profile"] = worker.approved_profile("production", "video")
        unsigned["profileSha256"] = worker.sha256_bytes(worker.canonical_bytes(unsigned["profile"]))
        unsigned["runtimeRepository"] = worker.LTX_RUNTIME_REPOSITORY
        unsigned["runtimeRevision"] = worker.LTX_RUNTIME_REVISION
        unsigned["jobs"] = [{
            "id": "music-loop-01",
            "prompt": "A calm music visual",
            "seed": 7,
            "width": 1280,
            "height": 704,
            "steps": 8,
            "frames": 17,
            "fps": 25,
            "artifact": {
                "putUrl": "https://objects.example/music-loop-01.mp4?write=1",
                "headers": {
                    "x-amz-meta-manifest-id": unsigned["manifestId"],
                    "x-amz-meta-profile-sha256": unsigned["profileSha256"],
                    "x-amz-meta-job-id": "music-loop-01",
                },
            },
        }]
        a2vid, digest = self._seal(unsigned)
        with self.assertRaisesRegex(ValueError, "invalid render manifest phase"):
            worker.validate_manifest(a2vid, digest)

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
        stack_job = {
            **job,
            "prompt": "faceless mannequin makes a slow deliberate orbit through the archive",
            "creativeAdapterStack": {
                "version": worker.CREATIVE_ADAPTER_STACK_VERSION,
                "adapters": [
                    {"id": "ltx-creative-faceless-mannequin", "strength": 0.52, "triggerTokens": ["faceless mannequin"]},
                    {"id": "ltx-creative-deliberate-orbit", "strength": 0.42, "triggerTokens": ["slow deliberate orbit"]},
                ],
                "benchmark": {
                    "rtx4090ProfileBenchmarked": True,
                    "visualVerdict": "pass",
                    "calibratedAdapters": [
                        {"id": "ltx-creative-faceless-mannequin", "strength": 0.52},
                        {"id": "ltx-creative-deliberate-orbit", "strength": 0.42},
                    ],
                    "qualityDeltas": [
                        {"metric": "material_identity_consistency", "baselineScore": 7.2, "adaptedScore": 8.3},
                        {"metric": "camera_motion_adherence", "baselineScore": 7.1, "adaptedScore": 8.2},
                    ],
                    "evidence": {
                        "version": "ltx-creative-adapter-benchmark-evidence/v1",
                        "evidenceManifestKey": "benchmarks/stack/evidence.json",
                        "immutableEvidenceObjectVersionId": "r2-version-stack-001",
                        "evidenceSha256": "a" * 64,
                        "outputVideoKey": "benchmarks/stack/output.mp4",
                        "outputVideoSha256": "b" * 64,
                        "outputDurationMs": 5_000,
                        "outputArtifactReceiptFingerprint": "c" * 64,
                        "visualReviewReceiptFingerprint": "d" * 64,
                        "reviewedAt": "2026-08-23T00:00:00Z",
                        "reviewedBy": "visual-qa",
                    },
                },
            },
        }
        stack_command = worker.build_video_command(
            stack_job,
            {"pipeline": "distilled", "quantization": "fp8-cast", "offload": "cpu"},
            {
                **models,
                "ltx-creative-faceless-mannequin": Path("/models/loras/faceless.safetensors"),
                "ltx-creative-deliberate-orbit": Path("/models/loras/orbit.safetensors"),
            },
            Path("/output/adapter-stack.mp4"),
            Path("/input/still.png"),
        )
        lora_indices = [index for index, value in enumerate(stack_command) if value == "--lora"]
        self.assertEqual(
            [stack_command[index + 1:index + 3] for index in lora_indices],
            [
                ["/models/loras/faceless.safetensors", "0.52"],
                ["/models/loras/orbit.safetensors", "0.42"],
            ],
            "a quality-benchmarked complementary stack must become repeatable LTX --lora flags",
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

    def test_shared_zimage_and_ltx_manifest_hydrates_only_the_active_phase(self):
        ltx_specs = []
        for model_id, (relative_path, digest, size) in worker.LTX_FILE_CONTRACTS.items():
            ltx_specs.append({
                "id": model_id, "kind": "file", "sourcePath": f"models/LTX-2.5/{relative_path}",
                "localPath": f"ltx-2.5/{relative_path}", "manifestSha256": digest, "sizeBytes": size,
                "repository": worker.LTX_MODEL, "revision": worker.LTX_REVISION,
            })
        zimage = {
            "id": "z-image-turbo", "kind": "tree", "sourcePath": "models/z-image",
            "localPath": "z-image", "manifestSha256": "a" * 64,
            "repository": worker.ZIMAGE_MODEL, "revision": worker.ZIMAGE_REVISION,
        }
        self.assertEqual(
            worker.validate_model_specs([zimage, *ltx_specs], "image", None),
            [zimage],
        )
        self.assertEqual(
            worker.validate_model_specs([zimage, *ltx_specs], "video", "distilled"),
            ltx_specs,
        )

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
                "contractVersion": "ltx-creative-adapter/v3",
                "role": "material-style",
                "baseModel": worker.LTX_MODEL,
                "baseRevision": worker.LTX_REVISION,
                "runtimeRevision": worker.LTX_RUNTIME_REVISION,
                "triggerTokens": ["faceless mannequin"],
                "benchmark": {
                    "rtx4090ProfileBenchmarked": True,
                    "visualVerdict": "pass",
                    "qualityDelta": {
                        "metric": "material_identity_consistency",
                        "baselineScore": 7.2,
                        "adaptedScore": 8.1,
                    },
                    "evidence": {
                        "version": "ltx-creative-adapter-benchmark-evidence/v1",
                        "evidenceManifestKey": "benchmarks/faceless/evidence.json",
                        "immutableEvidenceObjectVersionId": "r2-version-adapter-001",
                        "evidenceSha256": "b" * 64,
                        "outputVideoKey": "benchmarks/faceless/output.mp4",
                        "outputVideoSha256": "c" * 64,
                        "outputDurationMs": 5_000,
                        "outputArtifactReceiptFingerprint": "d" * 64,
                        "visualReviewReceiptFingerprint": "e" * 64,
                        "reviewedAt": "2026-08-23T00:00:00Z",
                        "reviewedBy": "visual-qa",
                    },
                },
            },
        }
        self.assertEqual(
            worker.validate_model_specs(specs + [adapter], "video", "distilled", {adapter_id}),
            specs + [adapter],
        )
        camera_adapter = {
            **adapter,
            "id": "ltx-creative-deliberate-orbit",
            "manifestSha256": "f" * 64,
            "sourcePath": "models/LTX-2.5/loras/orbit.safetensors",
            "localPath": "ltx-2.5/loras/orbit.safetensors",
            "creativeAdapter": {
                **adapter["creativeAdapter"],
                "role": "camera-control",
                "triggerTokens": ["slow deliberate orbit"],
                "benchmark": {
                    **adapter["creativeAdapter"]["benchmark"],
                    "qualityDelta": {
                        "metric": "camera_motion_adherence",
                        "baselineScore": 7.1,
                        "adaptedScore": 8.2,
                    },
                },
            },
        }
        stack_job = {
            "prompt": "faceless mannequin makes a slow deliberate orbit through the archive",
            "creativeAdapterStack": {
                "version": worker.CREATIVE_ADAPTER_STACK_VERSION,
                "adapters": [
                    {"id": adapter_id, "strength": 0.52, "triggerTokens": ["faceless mannequin"]},
                    {"id": camera_adapter["id"], "strength": 0.42, "triggerTokens": ["slow deliberate orbit"]},
                ],
                "benchmark": {
                    "rtx4090ProfileBenchmarked": True,
                    "visualVerdict": "pass",
                    "calibratedAdapters": [
                        {"id": adapter_id, "strength": 0.52},
                        {"id": camera_adapter["id"], "strength": 0.42},
                    ],
                    "qualityDeltas": [
                        {"metric": "material_identity_consistency", "baselineScore": 7.2, "adaptedScore": 8.3},
                        {"metric": "camera_motion_adherence", "baselineScore": 7.1, "adaptedScore": 8.2},
                    ],
                    "evidence": adapter["creativeAdapter"]["benchmark"]["evidence"],
                },
            },
        }
        selected_specs = worker.validate_model_specs(
            specs + [adapter, camera_adapter],
            "video",
            "distilled",
            worker.requested_creative_adapter_ids([stack_job], "video"),
        )
        worker.validate_creative_adapter_stacks([stack_job], selected_specs, "video")
        with self.assertRaisesRegex(ValueError, "stack contract is invalid"):
            worker.requested_creative_adapter_ids([
                {
                    **stack_job,
                    "creativeAdapterStack": {
                        **stack_job["creativeAdapterStack"],
                        "adapters": [
                            *stack_job["creativeAdapterStack"]["adapters"],
                            {"id": "ltx-creative-extra-detail", "strength": 0.2, "triggerTokens": ["archive"]},
                        ],
                    },
                },
            ], "video")
        with self.assertRaisesRegex(ValueError, "stack contract is invalid"):
            worker.requested_creative_adapter_ids([
                {
                    **stack_job,
                    "creativeAdapterStack": {
                        **stack_job["creativeAdapterStack"],
                        "benchmark": {
                            **stack_job["creativeAdapterStack"]["benchmark"],
                            "calibratedAdapters": [
                                {"id": adapter_id, "strength": 0.8},
                                {"id": camera_adapter["id"], "strength": 0.8},
                            ],
                        },
                    },
                },
            ], "video")
        with self.assertRaisesRegex(ValueError, "exactly match its combined RTX 4090 benchmark calibration"):
            worker.validate_creative_adapter_stacks([
                {
                    **stack_job,
                    "creativeAdapterStack": {
                        **stack_job["creativeAdapterStack"],
                        "adapters": [
                            {**stack_job["creativeAdapterStack"]["adapters"][0], "strength": 0.51},
                            stack_job["creativeAdapterStack"]["adapters"][1],
                        ],
                    },
                },
            ], selected_specs, "video")
        with self.assertRaisesRegex(ValueError, "exact selected roles"):
            worker.validate_creative_adapter_stacks([
                {
                    **stack_job,
                    "creativeAdapterStack": {
                        **stack_job["creativeAdapterStack"],
                        "benchmark": {
                            **stack_job["creativeAdapterStack"]["benchmark"],
                            "qualityDeltas": [stack_job["creativeAdapterStack"]["benchmark"]["qualityDeltas"][0], {"metric": "visual_style_coherence", "baselineScore": 7.1, "adaptedScore": 8.2}],
                        },
                    },
                },
            ], selected_specs, "video")
        missing_evidence = {
            **adapter,
            "creativeAdapter": {
                **adapter["creativeAdapter"],
                "benchmark": {"rtx4090ProfileBenchmarked": True, "visualVerdict": "pass"},
            },
        }
        with self.assertRaisesRegex(ValueError, "exact benchmarked LTX 2.5 adapter"):
            worker.validate_model_specs(specs + [missing_evidence], "video", "distilled", {adapter_id})
        weak_quality = {
            **adapter,
            "creativeAdapter": {
                **adapter["creativeAdapter"],
                "benchmark": {
                    **adapter["creativeAdapter"]["benchmark"],
                    "qualityDelta": {
                        **adapter["creativeAdapter"]["benchmark"]["qualityDelta"],
                        "adaptedScore": 7.9,
                    },
                },
            },
        }
        with self.assertRaisesRegex(ValueError, "exact benchmarked LTX 2.5 adapter"):
            worker.validate_model_specs(specs + [weak_quality], "video", "distilled", {adapter_id})
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
            def audible_output(command, *_args, **_kwargs):
                if command[0] == "ffprobe":
                    return worker.subprocess.CompletedProcess(
                        command, 0, json.dumps({"streams": [{"codec_type": "video", "width": 1280, "height": 704}, {"codec_type": "audio"}]}), "",
                    )
                return worker.subprocess.CompletedProcess(command, 0, "", "mean_volume: -32.0 dB")

            worker.subprocess.run = audible_output
            self.assertEqual(worker.probe_video_output(Path("/tmp/clip.mp4"), 1280, 704), {"outputWidth": 1280, "outputHeight": 704, "hasAudio": True})
            def wrong_geometry(command, *_args, **_kwargs):
                return worker.subprocess.CompletedProcess(
                    command, 0, json.dumps({"streams": [{"codec_type": "video", "width": 640, "height": 352}, {"codec_type": "audio"}]}), "",
                )

            worker.subprocess.run = wrong_geometry
            with self.assertRaisesRegex(RuntimeError, "geometry"):
                worker.probe_video_output(Path("/tmp/clip.mp4"), 1280, 704)
            def video_only(command, *_args, **_kwargs):
                return worker.subprocess.CompletedProcess(
                    command, 0, json.dumps({"streams": [{"codec_type": "video", "width": 1280, "height": 704}]}), "",
                )

            worker.subprocess.run = video_only
            with self.assertRaisesRegex(RuntimeError, "generated audio"):
                worker.probe_video_output(Path("/tmp/clip.mp4"), 1280, 704)
            def digital_silence(command, *_args, **_kwargs):
                if command[0] == "ffprobe":
                    return worker.subprocess.CompletedProcess(
                        command, 0, json.dumps({"streams": [{"codec_type": "video", "width": 1280, "height": 704}, {"codec_type": "audio"}]}), "",
                    )
                return worker.subprocess.CompletedProcess(command, 0, "", "mean_volume: -91.0 dB")

            worker.subprocess.run = digital_silence
            with self.assertRaisesRegex(RuntimeError, "no usable generated audio"):
                worker.probe_video_output(Path("/tmp/clip.mp4"), 1280, 704)
        finally:
            worker.subprocess.run = original_run

    def test_native_720p_x2_smoke_profile_is_exact_and_vram_bounded(self):
        image_profile = worker.approved_profile(worker.LTX_25_720P_NATIVE_X2_SMOKE_PROFILE_ID, "image")
        self.assertTrue(image_profile["benchmarkOnly"])
        self.assertEqual((image_profile["width"], image_profile["height"]), (1280, 704))
        profile = worker.approved_profile(worker.LTX_25_720P_NATIVE_X2_SMOKE_PROFILE_ID, "video")
        self.assertTrue(profile["benchmarkOnly"])
        self.assertEqual((profile["stageOneWidth"], profile["stageOneHeight"]), (1280, 704))
        self.assertEqual((profile["width"], profile["height"], profile["maxFrames"]), (2560, 1408, 17))
        self.assertEqual(profile["maxSampledPeakVramMib"], 22_000)

        original_run = worker.subprocess.run
        try:
            worker.subprocess.run = lambda argv, **_kwargs: worker.subprocess.CompletedProcess(argv, 0, "21999\n", "")
            self.assertEqual(worker._sample_vram_mib(22_000), 21_999)
            worker.subprocess.run = lambda argv, **_kwargs: worker.subprocess.CompletedProcess(argv, 0, "22001\n", "")
            with self.assertRaisesRegex(RuntimeError, "exceeded 22000 MiB"):
                worker._sample_vram_mib(22_000)

            def exact_smoke_output(command, *_args, **_kwargs):
                if command[0] == "ffprobe":
                    return worker.subprocess.CompletedProcess(
                        command,
                        0,
                        json.dumps({"streams": [
                            {"codec_type": "video", "width": 2560, "height": 1408, "avg_frame_rate": "25/1", "nb_read_frames": "17"},
                            {"codec_type": "audio"},
                        ]}),
                        "",
                    )
                return worker.subprocess.CompletedProcess(command, 0, "", "mean_volume: -32.0 dB")

            worker.subprocess.run = exact_smoke_output
            self.assertEqual(
                worker.probe_video_output(Path("/tmp/smoke.mp4"), 2560, 1408, expected_frames=17, expected_fps=25),
                {"outputWidth": 2560, "outputHeight": 1408, "hasAudio": True, "frameCount": 17, "frameRate": 25},
            )
        finally:
            worker.subprocess.run = original_run

    def test_native_720p_x2_input_geometry_receipt_requires_1280x704_stills(self):
        profile = worker.approved_profile(worker.LTX_25_720P_NATIVE_X2_SMOKE_PROFILE_ID, "video")
        source_hash = "a" * 64
        original_run = worker.subprocess.run
        try:
            def exact_input(command, *_args, **_kwargs):
                return worker.subprocess.CompletedProcess(
                    command,
                    0,
                    json.dumps({"streams": [{"codec_type": "video", "width": 1280, "height": 704}]}),
                    "",
                )

            worker.subprocess.run = exact_input
            initial = worker.probe_input_geometry(Path("/tmp/native-initial.png"), source_hash)
            self.assertEqual(initial, {"sha256": source_hash, "width": 1280, "height": 704})
            worker.assert_native_input_geometry_receipt("initial", initial, profile)

            def wrong_input(command, *_args, **_kwargs):
                return worker.subprocess.CompletedProcess(
                    command,
                    0,
                    json.dumps({"streams": [{"codec_type": "video", "width": 1280, "height": 736}]}),
                    "",
                )

            worker.subprocess.run = wrong_input
            wrong = worker.probe_input_geometry(Path("/tmp/native-wrong.png"), source_hash)
            with self.assertRaisesRegex(RuntimeError, "1280x704"):
                worker.assert_native_input_geometry_receipt("initial", wrong, profile)
        finally:
            worker.subprocess.run = original_run

        proof = {
            "outputWidth": 2560, "outputHeight": 1408,
            "stageOneWidth": 1280, "stageOneHeight": 704,
            "spatialUpscaleFactor": 2, "pipeline": "distilled",
            "quantization": "fp8-cast", "offload": "cpu",
            "frameCount": 17, "frameRate": 25, "hasAudio": True,
            "sampledPeakVramMib": 21_999,
            "inputGeometry": {"initial": initial},
        }
        worker.assert_video_output_proof(proof, profile)
        with self.assertRaisesRegex(ValueError, "invalid input geometry"):
            worker.assert_video_output_proof(
                {**proof, "inputGeometry": {"initial": {**initial, "height": 736}}},
                profile,
            )

    def test_native_720p_x2_smoke_manifest_allows_only_one_exact_17_frame_job(self):
        profile = worker.approved_profile(worker.LTX_25_720P_NATIVE_X2_SMOKE_PROFILE_ID, "video")
        manifest_id = "video-" + "c" * 32
        profile_hash = worker.sha256_bytes(worker.canonical_bytes(profile))
        job = {
            "id": "smoke-01", "prompt": "A small bounded smoke clip", "seed": 42,
            "width": 2560, "height": 1408, "steps": 8, "frames": 17, "fps": 25, "timeoutSeconds": 600,
            "input": {"getUrl": "https://objects.example/smoke-input.png", "sha256": "a" * 64},
            "artifact": {"putUrl": "https://objects.example/smoke.mp4", "headers": {
                "x-amz-meta-manifest-id": manifest_id, "x-amz-meta-profile-sha256": profile_hash, "x-amz-meta-job-id": "smoke-01",
            }},
        }
        unsigned = {
            "contractVersion": worker.CONTRACT_VERSION, "manifestId": manifest_id, "phase": "video",
            "gpuSku": worker.REQUIRED_GPU_SKU, "gpuCount": worker.REQUIRED_GPU_COUNT,
            "expiresAt": int(time.time() * 1000) + 60_000, "maxCostUsd": 1.25,
            "profile": profile, "profileSha256": profile_hash,
            "runtimeRepository": worker.LTX_RUNTIME_REPOSITORY, "runtimeRevision": worker.LTX_RUNTIME_REVISION,
            "checkpoint": {"getUrl": "https://objects.example/checkpoint.json", "putUrl": "https://objects.example/checkpoint.json"},
            "heartbeat": {"putUrl": "https://objects.example/heartbeat.json"},
            "completion": {"putUrl": "https://objects.example/completion.json"}, "jobs": [job],
        }
        manifest, digest = self._seal(unsigned)
        self.assertEqual(worker.validate_manifest(manifest, digest)["profile"]["id"], profile["id"])
        missing_input_job = {key: value for key, value in job.items() if key != "input"}
        missing_input, missing_input_digest = self._seal({**unsigned, "jobs": [missing_input_job]})
        with self.assertRaisesRegex(ValueError, "requires a native-720p x2 initial still"):
            worker.validate_manifest(missing_input, missing_input_digest)
        two_jobs, two_digest = self._seal({**unsigned, "jobs": [job, {**job, "id": "smoke-02", "artifact": {**job["artifact"], "headers": {**job["artifact"]["headers"], "x-amz-meta-job-id": "smoke-02"}}}]})
        with self.assertRaisesRegex(ValueError, "exactly one job"):
            worker.validate_manifest(two_jobs, two_digest)
        wrong_frame, wrong_digest = self._seal({**unsigned, "jobs": [{**job, "frames": 9}]})
        with self.assertRaisesRegex(ValueError, "exactly 17 smoke frames"):
            worker.validate_manifest(wrong_frame, wrong_digest)

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

    def test_failure_receipt_preserves_renderer_root_cause_tail(self):
        message = worker._bounded_error_message(RuntimeError("trace-start " + "x" * 2_000 + " ROOT_CAUSE"))
        self.assertLessEqual(len(message), 1_200)
        self.assertIn("diagnostic tail", message)
        self.assertTrue(message.endswith("ROOT_CAUSE"))


if __name__ == "__main__":
    unittest.main()
