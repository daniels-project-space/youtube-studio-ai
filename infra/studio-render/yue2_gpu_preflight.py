"""Offline checks in the deployed YuE2 image; never music qualification."""
import hashlib
import json
import os
from pathlib import Path


def main():
    from music_runtime.supervisor import DESCENDANT_POLICY, _contain_child

    # Apply the real inference child's restrictions before cold GPU imports.
    _contain_child(os.getppid())
    from music_runtime.config import effective_config
    from music_runtime.official import OfficialBackend
    import torch

    evidence = OfficialBackend().preflight(effective_config("/mnt/yue2-hf-cache"))
    kernels = []
    for dtype in (torch.float32, torch.bfloat16):
        matrix = torch.tensor([[1, 2], [3, 4]], device="cuda:0", dtype=dtype)
        product = matrix @ torch.eye(2, device="cuda:0", dtype=dtype)
        torch.cuda.synchronize()
        if not torch.equal(product, matrix):
            raise RuntimeError("CUDA matrix product verification failed")
        kernels.append(str(dtype))
    print(json.dumps({
        "schema": "youtube-studio-yue2-gpu-preflight/v1",
        "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "containment": DESCENDANT_POLICY,
        "kernel_dtypes_verified": kernels,
        "runtime": evidence,
        "inference_executed": False,
        "production_approved": False,
    }, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
