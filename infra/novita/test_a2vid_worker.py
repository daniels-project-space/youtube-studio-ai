import importlib.util
import json
import subprocess
import time
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("a2vid_worker.py")
SPEC = importlib.util.spec_from_file_location("novita_a2vid_worker", MODULE_PATH)
a2vid = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(a2vid)


def digest(letter: str) -> str:
    return letter * 64


class A2VidWorkerContractTests(unittest.TestCase):
    @staticmethod
    def _seal(unsigned):
        manifest_hash = a2vid._hash(unsigned)
        return {**unsigned, "manifestSha256": manifest_hash}, manifest_hash

    def _profile(self, *, gpu="RTX 4090", minimum_vram_gb=24):
        components = [
            {
                "id": component_id,
                "path": f"a2vid/{component_id}.safetensors",
                "sha256": digest(chr(ord("a") + index)),
                "sizeBytes": 1_000 + index,
            }
            for index, component_id in enumerate(a2vid.COMPONENT_IDS)
        ]
        return {
            "contractVersion": a2vid.CONTRACT_VERSION,
            "id": a2vid.PROFILE_ID,
            "phase": a2vid.PHASE,
            "model": "Lightricks/LTX-2.5",
            "modelRevision": "a" * 40,
            "runtimeRepository": "Lightricks/LTX-2",
            "runtimeRevision": "b" * 40,
            "pipeline": "a2vid_two_stage",
            "width": 1280,
            "height": 704,
            "steps": 8,
            "fps": 25,
            "precision": "bf16",
            "quantization": "fp8-cast",
            "offload": "cpu",
            "stageOneWidth": 640,
            "stageOneHeight": 352,
            "spatialUpscaleFactor": 2,
            "requiredGpuSku": gpu,
            "minimumVramGb": minimum_vram_gb,
            "licenseReceiptFingerprint": digest("c"),
            "components": components,
            "benchmarkOnly": True,
            "allowFallback": False,
        }

    def _manifest(self, *, gpu="RTX 4090", minimum_vram_gb=24):
        profile = self._profile(gpu=gpu, minimum_vram_gb=minimum_vram_gb)
        profile_hash = a2vid._hash(profile)
        manifest_id = "audio_video-" + "d" * 32
        models = [
            {
                "id": component["id"],
                "kind": "file",
                "repository": "Lightricks/LTX-2.5",
                "revision": profile["modelRevision"],
                "manifestSha256": component["sha256"],
                "sizeBytes": component["sizeBytes"],
                "sourcePath": f"models/{component['path']}",
                "localPath": f"models/{component['path']}",
            }
            for component in profile["components"]
        ]
        job_id = "music-visual-01"
        headers = {
            "x-amz-meta-manifest-id": manifest_id,
            "x-amz-meta-profile-sha256": profile_hash,
            "x-amz-meta-job-id": job_id,
        }
        unsigned = {
            "contractVersion": a2vid.CONTRACT_VERSION,
            "manifestId": manifest_id,
            "phase": a2vid.PHASE,
            "gpuSku": gpu,
            "gpuCount": 1,
            "expiresAt": int(time.time() * 1_000) + 120_000,
            "maxCostUsd": 2.5,
            "maxRuntimeSeconds": 600,
            "profile": profile,
            "profileSha256": profile_hash,
            "models": models,
            "jobs": [{
                "id": job_id,
                "prompt": "A deliberate music-video dolly through glowing geometric space",
                "seed": 42,
                "width": 1280,
                "height": 704,
                "steps": 8,
                "frames": 121,
                "fps": 25,
                "timeoutSeconds": 600,
                "audio": {
                    "getUrl": "https://objects.example/music.wav",
                    "sha256": digest("d"),
                    "contentType": "audio/wav",
                    "startMs": 0,
                    "endMs": 4_840,
                },
                "openingInput": {
                    "getUrl": "https://objects.example/opening.png",
                    "sha256": digest("e"),
                    "contentType": "image/png",
                },
                "endingInput": {
                    "getUrl": "https://objects.example/ending.png",
                    "sha256": digest("f"),
                    "contentType": "image/png",
                },
                "artifact": {"putUrl": "https://objects.example/output.mp4", "headers": headers},
            }],
            "checkpoint": {
                "getUrl": "https://objects.example/checkpoint.json",
                "putUrl": "https://objects.example/checkpoint.json?write=1",
            },
            "heartbeat": {"putUrl": "https://objects.example/heartbeat.json"},
            "completion": {"putUrl": "https://objects.example/completion.json"},
        }
        return self._seal(unsigned)

    def test_valid_manifest_builds_only_the_official_a2vid_command(self):
        manifest, manifest_hash = self._manifest()
        parsed = a2vid.validate_manifest(manifest, manifest_hash)
        self.assertEqual(parsed["phase"], "audio_video")
        self.assertEqual(parsed["profile"]["pipeline"], "a2vid_two_stage")
        self.assertEqual(len(parsed["models"]), 6)
        job = parsed["jobs"][0]
        model_paths = {spec["id"]: Path("/") / spec["id"] for spec in parsed["models"]}
        command = a2vid.build_a2vid_command(
            job,
            parsed["profile"],
            model_paths,
            Path("/output/music.mp4"),
            Path("/input/music.wav"),
            Path("/input/opening.png"),
            Path("/input/ending.png"),
        )
        self.assertEqual(command[command.index("-m") + 1], "ltx_pipelines.a2vid_two_stage")
        self.assertIn("--audio-path", command)
        self.assertIn("--distilled-lora", command)
        self.assertEqual(command.count("--image"), 2)
        self.assertNotIn("ltx_pipelines.distilled", command)

    def test_profile_and_audio_drift_fail_before_gpu_or_model_work(self):
        manifest, _ = self._manifest()
        unsigned = {key: value for key, value in manifest.items() if key != "manifestSha256"}
        unsigned["profile"] = {**unsigned["profile"], "pipeline": "distilled"}
        unsigned["profileSha256"] = a2vid._hash(unsigned["profile"])
        drifted, drifted_hash = self._seal(unsigned)
        with self.assertRaisesRegex(ValueError, "sealed self-hosted benchmark contract"):
            a2vid.validate_manifest(drifted, drifted_hash)

        manifest, _ = self._manifest()
        unsigned = {key: value for key, value in manifest.items() if key != "manifestSha256"}
        job = {**unsigned["jobs"][0], "audio": {**unsigned["jobs"][0]["audio"], "endMs": 1_000}}
        unsigned["jobs"] = [job]
        drifted, drifted_hash = self._seal(unsigned)
        with self.assertRaisesRegex(ValueError, "2–20 second"):
            a2vid.validate_manifest(drifted, drifted_hash)

    def test_gpu_attestation_requires_the_exact_sealed_novita_sku_and_memory(self):
        manifest, manifest_hash = self._manifest(gpu="RTX 5090", minimum_vram_gb=32)
        parsed = a2vid.validate_manifest(manifest, manifest_hash)
        original_run = a2vid.subprocess.run
        try:
            a2vid.subprocess.run = lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, "NVIDIA GeForce RTX 5090, 32768 MiB\n", "")
            a2vid._assert_gpu(parsed)
            a2vid.subprocess.run = lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, "NVIDIA GeForce RTX 4090, 24576 MiB\n", "")
            with self.assertRaisesRegex(RuntimeError, "sealed SKU or VRAM"):
                a2vid._assert_gpu(parsed)
        finally:
            a2vid.subprocess.run = original_run

    def test_a2vid_worker_and_image_context_are_separate(self):
        source = MODULE_PATH.read_text("utf8")
        dockerfile = MODULE_PATH.with_name("Dockerfile.a2vid").read_text("utf8")
        self.assertIn("ltx_pipelines.a2vid_two_stage", source)
        self.assertNotIn('"-m", "ltx_pipelines.distilled"', source)
        self.assertIn("ENTRYPOINT [\"/opt/LTX-2/.venv/bin/python\", \"/opt/novita-worker/a2vid_worker.py\"]", dockerfile)
        self.assertIn("ARG LTX_RUNTIME_REVISION", dockerfile)
        self.assertNotIn("ARG LTX_RUNTIME_REVISION=", dockerfile)

    def test_checkpoint_never_accepts_direct_image_to_video_output_evidence(self):
        manifest, manifest_hash = self._manifest()
        parsed = a2vid.validate_manifest(manifest, manifest_hash)
        original_request = a2vid.common._request
        target = {"getUrl": "https://objects.example/checkpoint.json"}
        completed_payload = {
            "manifestId": parsed["manifestId"],
            "completedJobIds": [parsed["jobs"][0]["id"]],
            "audioVideoOutputs": {parsed["jobs"][0]["id"]: {"pipeline": "a2vid_two_stage"}},
        }
        try:
            a2vid.common._request = lambda *_args, **_kwargs: json.dumps(completed_payload).encode("utf8")
            completed, outputs = a2vid._load_a2vid_checkpoint(target, parsed["manifestId"], parsed["jobs"][0]["id"])
            self.assertEqual(completed, {parsed["jobs"][0]["id"]})
            self.assertEqual(outputs[parsed["jobs"][0]["id"]]["pipeline"], "a2vid_two_stage")

            direct_payload = {**completed_payload, "audioVideoOutputs": {}, "videoOutputs": completed_payload["audioVideoOutputs"]}
            a2vid.common._request = lambda *_args, **_kwargs: json.dumps(direct_payload).encode("utf8")
            with self.assertRaisesRegex(ValueError, "must cover every completed job"):
                a2vid._load_a2vid_checkpoint(target, parsed["manifestId"], parsed["jobs"][0]["id"])
        finally:
            a2vid.common._request = original_request


if __name__ == "__main__":
    unittest.main()
