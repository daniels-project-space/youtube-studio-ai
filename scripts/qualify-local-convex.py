#!/usr/bin/env python3
"""Disposable localhost Convex deployment and restart qualification.

Uses only synthetic records and an ephemeral instance secret; never connects to
the existing Studio deployment. Requires the official local backend executable.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.request


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", required=True, help="absolute path to Convex backend binary")
    args = parser.parse_args()
    binary = str(Path(args.backend).resolve(strict=True))
    repo = Path(__file__).resolve().parent.parent
    cli = str(repo / "node_modules/.bin/convex")
    api_port, site_port = free_port(), free_port()
    while site_port == api_port:
        site_port = free_port()
    instance, secret = "automation-qualification", secrets.token_hex(32)
    with tempfile.TemporaryDirectory(prefix="studio-convex-proof-") as root:
        root = Path(root)
        (root / "convex").mkdir()
        (root / "data").mkdir()
        (root / "package.json").write_text(json.dumps({"name": "convex-local-proof", "private": True, "version": "1.0.0", "dependencies": {"convex": "1.43.0"}}))
        (root / "node_modules").symlink_to(repo / "node_modules", target_is_directory=True)
        (root / "convex/probe.ts").write_text('import { mutationGeneric, queryGeneric } from "convex/server";\nexport const write = mutationGeneric({args:{},handler:async(ctx)=>await ctx.db.insert("proof",{value:"persisted"})});\nexport const read = queryGeneric({args:{},handler:async(ctx)=>await ctx.db.query("proof").collect()});\n')
        command = [binary, "--interface", "127.0.0.1", "--port", str(api_port), "--site-proxy-port", str(site_port), "--instance-name", instance, "--instance-secret", secret, "--disable-beacon", "--redact-logs-to-client"]

        def start():
            process = subprocess.Popen(command, cwd=root / "data", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(80):
                if process.poll() is not None:
                    raise RuntimeError("local backend exited at startup")
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{api_port}/version", timeout=1) as response:
                        if response.status == 200:
                            return process
                except Exception:
                    time.sleep(0.25)
            stop(process)
            raise RuntimeError("local backend startup timed out")

        def stop(process):
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

        process = None
        try:
            process = start()
            admin = subprocess.check_output([binary, "keygen", "admin-key", "--instance-name", instance, "--instance-secret", secret], text=True).strip()
            env = os.environ.copy()
            for key in ("CONVEX_DEPLOYMENT", "CONVEX_DEPLOY_KEY", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"):
                env.pop(key, None)
            env.update({"CONVEX_SELF_HOSTED_URL": f"http://127.0.0.1:{api_port}", "CONVEX_SELF_HOSTED_ADMIN_KEY": admin, "CI": "1", "DISABLE_TELEMETRY": "1"})
            result = subprocess.run([cli, "dev", "--once", "--typecheck", "disable", "--codegen", "disable", "--tail-logs", "disable"], cwd=root, env=env, capture_output=True, text=True, timeout=90)
            if result.returncode:
                raise RuntimeError("local deployment failed: " + result.stderr[-1500:].replace(admin, "[redacted]").replace(secret, "[redacted]"))

            def call(kind, function):
                request = urllib.request.Request(f"http://127.0.0.1:{api_port}/api/{kind}", data=json.dumps({"path": function, "args": {}, "format": "json"}).encode(), headers={"content-type": "application/json", "authorization": f"Convex {admin}"})
                with urllib.request.urlopen(request, timeout=10) as response:
                    return json.load(response)

            write = call("mutation", "probe:write")
            before = call("query", "probe:read")
            stop(process)
            process = None
            process = start()
            after = call("query", "probe:read")
            if write.get("status") != "success" or len(before.get("value", [])) != 1 or before.get("value") != after.get("value"):
                raise RuntimeError("local write/read/restart verification failed")
            print("LOCAL CONVEX PASS: isolated code deployment, write, read and restart persistence")
        finally:
            if process is not None:
                stop(process)


if __name__ == "__main__":
    main()
