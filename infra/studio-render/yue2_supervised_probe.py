"""Run one operator-provided evaluation through the actual runtime supervisor."""
import argparse
import json
from pathlib import Path

from music_runtime.cli import DEFAULT_STATE
from music_runtime.config import parse_json, validate_job
from music_runtime.supervisor import run_supervised, validate_execution_policy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", type=Path, required=True)
    parser.add_argument("--policy", type=Path, required=True)
    args = parser.parse_args()
    job = validate_job(parse_json(args.job.read_text()))
    policy = validate_execution_policy(parse_json(args.policy.read_text()))
    result = run_supervised(job, DEFAULT_STATE, Path("/mnt/yue2-hf-cache"),
                            execution_policy=policy)
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    return 0 if result["status"] == "completed" else 3


if __name__ == "__main__":
    raise SystemExit(main())
