"""Offline API smoke test of the built image, never an inference qualification."""
import http.client
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time


def main():
    with tempfile.TemporaryDirectory(prefix="studio-render-smoke-") as temporary:
        root = Path(temporary)
        token = secrets.token_hex(32)
        env = {
            **os.environ,
            "MODEL_ROOT": str(root / "models"),
            "MINIMAX_H3_WORKER_TOKEN": token,
            "MINIMAX_H3_RECEIPT_ROOT": str(root / "receipts"),
        }
        child = subprocess.Popen(
            ["python", "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8080"],
            cwd="/app/h3", env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            def request(method, path, authenticated=False):
                connection = http.client.HTTPConnection("127.0.0.1", 8080, timeout=2)
                try:
                    headers = {"x-worker-authorization": f"Bearer {token}"} if authenticated else {}
                    connection.request(method, path, headers=headers)
                    response = connection.getresponse()
                    return response.status, json.loads(response.read())
                finally:
                    connection.close()

            deadline = time.monotonic() + 30
            while True:
                try:
                    status, health = request("GET", "/healthz")
                    break
                except OSError:
                    if child.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError("isolated worker API did not start")
                    time.sleep(0.1)
            assert status == 200 and health["schema"] == "minimax-h3-worker/v1"
            assert health["ready"] is False and health["persistentCacheReady"] is False
            key = "a" * 64
            assert request("GET", f"/v1/videos/{key}")[0] == 401
            assert request("GET", f"/v1/videos/{key}", True) == (200, {"status": "pending"})
            assert request("POST", "/control/drain")[0] == 401
            assert request("POST", "/control/drain", True) == (200, {"draining": True, "busy": False})
            assert request("GET", "/healthz")[1]["draining"] is True
            assert not list((root / "receipts").glob("*.json"))
            pin = subprocess.check_output(["git", "-C", os.environ["COMFY_ROOT"], "rev-parse", "HEAD"], text=True).strip()
            assert pin == "f938505952476e48a12687eac696cdc94d48a3fe"
            print(json.dumps({"apiSmoke": "passed", "comfyCommit": pin, "inferenceExecuted": False,
                              "authentication": "enforced", "emptyCache": "not-ready"}))
        finally:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    main()
