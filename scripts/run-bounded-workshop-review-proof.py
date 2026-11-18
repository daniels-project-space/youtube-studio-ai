#!/usr/bin/env python3
"""Run the disposable workshop review backend proof with a strict disk floor."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--reserve-free-bytes', type=int, required=True)
    args = parser.parse_args()
    if os.readlink('/proc/self/ns/net') == os.readlink('/proc/1/ns/net'):
        raise ValueError('A separate network namespace is required')
    subprocess.run(['/usr/sbin/ip', 'link', 'set', 'lo', 'up'], check=True)
    if subprocess.check_output(['/usr/sbin/ip', 'route']).strip():
        raise ValueError('Unexpected network route')
    if args.reserve_free_bytes <= 0 or shutil.disk_usage('/tmp').free < args.reserve_free_bytes + 500_000_000:
        raise ValueError('Insufficient starting disk margin')
    root = Path(__file__).resolve().parent.parent
    paths = ['scripts/test-workshop-review-backend.mjs', 'scripts/test-channel-research-backend.mjs',
             'convex/workshopDesignImports.ts', 'convex/studioFunctions.ts', 'src/lib/workshopDesignTransport.ts',
             'src/lib/channelPipelineWriteFence.ts', 'src/lib/durationCandidateFamily.ts']
    def hashes(): return {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in paths}
    before = hashes()
    fixture = tempfile.mkdtemp(prefix='channel-research-proof-', dir='/tmp')
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/tmp', 'TMPDIR': '/tmp', 'CI': '1',
           'NEXT_TELEMETRY_DISABLED': '1', 'CHANNEL_RESEARCH_PROOF_DIR': fixture}
    process = None
    try:
        process = subprocess.Popen(['/usr/bin/node', str(root / 'scripts/test-workshop-review-backend.mjs')],
                                   cwd=root, env=env, start_new_session=True)
        while process.poll() is None:
            if shutil.disk_usage('/tmp').free < args.reserve_free_bytes:
                raise ValueError('Disk floor reached; disposable proof stopped')
            time.sleep(.25)
        if process.returncode:
            raise ValueError(f'Disposable proof exited {process.returncode}')
        if hashes() != before:
            raise ValueError('Source changed during the proof')
        print('Source SHA-256:', before, flush=True)
    finally:
        if process is not None and process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        shutil.rmtree(fixture)


if __name__ == '__main__':
    main()
