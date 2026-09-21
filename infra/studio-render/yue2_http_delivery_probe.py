"""Verify real retained GPU audio over authenticated HTTP without inference."""
import argparse
import hashlib
import http.client
import json
from pathlib import Path
import secrets
import shutil
import tempfile
import threading

from music_runtime.http_worker import WorkerHTTPServer
from music_runtime.runner import inspect_job
from music_runtime.store import unseal
from music_runtime.worker import Worker


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    args = parser.parse_args()
    if not args.job_id or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in args.job_id):
        raise ValueError("Invalid job id")
    source = args.state / "jobs" / args.job_id
    before = inspect_job(source)
    if before["attempts"][-1]["status"] != "completed":
        raise ValueError("A verified completed source is required")
    attempts = sorted((source / "attempts").iterdir())
    terminal = unseal(attempts[-1] / "terminal.json")
    expected = terminal["artifacts"]
    job = unseal(source / "job.json")
    artifacts = ("audio-native.wav", "audio-unclipped.wav", "headroom-status.json")
    for name in artifacts:
        if name not in expected:
            raise ValueError("Source is missing required delivery evidence")
    with tempfile.TemporaryDirectory(prefix="studio-yue-http-") as directory:
        root = Path(directory)
        # The production ledger is mounted read-only. Only this disposable copy
        # gets an HTTP admission record; no dispatcher thread is ever started.
        shutil.copytree(source, root / "jobs" / args.job_id)
        worker = Worker(root, args.cache_dir)
        token = secrets.token_urlsafe(48)
        server = WorkerHTTPServer(("127.0.0.1", 0), worker, token)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def request(path, authorized=True):
            connection = http.client.HTTPConnection(*server.server_address, timeout=30)
            try:
                connection.request("GET", path, headers={"Authorization": f"Bearer {token}"} if authorized else {})
                response = connection.getresponse()
                return response.status, dict(response.getheaders()), response.read()
            finally:
                connection.close()

        try:
            # Adoption is local and can only select the previously completed job.
            _, adopted = worker.submit(job)
            assert adopted["state"] == "completed"
            path = f"/v1/jobs/{args.job_id}"
            assert request(path, False)[0] == 401
            status, _, body = request(path)
            assert status == 200 and json.loads(body)["state"] == "completed"
            retained = {}
            for name in artifacts:
                url = f"{path}/artifacts/{name}"
                assert request(url, False)[0] == 401
                status, headers, body = request(url)
                actual = {"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}
                assert status == 200 and actual == expected[name]
                assert headers["X-Content-SHA256"] == actual["sha256"]
                assert int(headers["Content-Length"]) == len(body)
                assert headers["Content-Type"] == ("audio/wav" if name.endswith(".wav") else "application/json")
                retained[name] = actual
            assert worker.thread is None
            assert inspect_job(root / "jobs" / args.job_id) == before
            assert inspect_job(source) == before
            print(json.dumps({"schema": "studio-yue2-http-delivery/v1", "jobId": args.job_id,
                              "authenticatedDelivery": retained, "anonymousDenied": True,
                              "sourceLedgerUnchanged": True, "newInferences": 0,
                              "productionApproved": False}, sort_keys=True))
        finally:
            server.shutdown()
            thread.join(timeout=10)
            server.server_close()
            worker.close()


if __name__ == "__main__":
    main()
