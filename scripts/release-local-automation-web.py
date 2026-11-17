#!/usr/bin/env python3
"""Release a built private Automation interface, retaining and restoring its predecessor."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
TARGET = Path('/opt/youtube-automation-web')
CACHE = Path('/var/lib/youtube-automation-web/next-cache')
CURRENT = TARGET / 'current'
TEMP_LINK = TARGET / 'current.next'

def run(*args):
    return subprocess.run(args, cwd=ROOT, check=True, stdout=subprocess.DEVNULL)

def verify():
    for _ in range(100):
        try:
            with urllib.request.urlopen('http://127.0.0.1:39362/operator-login', timeout=1) as response:
                if response.status == 200:
                    break
        except (OSError, urllib.error.URLError):
            time.sleep(.3)
    else:
        raise RuntimeError('Private login did not become available')
    try:
        urllib.request.urlopen('http://127.0.0.1:39362/api/auth/convex-token', timeout=3)
    except urllib.error.HTTPError as error:
        if error.code == 401:
            return
        raise
    raise RuntimeError('Anonymous token request unexpectedly succeeded')

def switch(release):
    TEMP_LINK.symlink_to(release, target_is_directory=True)
    try:
        os.replace(TEMP_LINK, CURRENT)
    finally:
        if TEMP_LINK.is_symlink():
            TEMP_LINK.unlink()
    run('systemctl', 'restart', 'youtube-automation-web.service')

def main():
    if os.geteuid() != 0 or sys.argv[1:] != ['--release']:
        raise SystemExit('Run as root with --release')
    if not CURRENT.is_symlink() or not CACHE.is_dir() or TEMP_LINK.exists() or TEMP_LINK.is_symlink():
        raise SystemExit('Existing web service is not in the expected state')
    run('git', 'diff', '--quiet')
    run('git', 'diff', '--cached', '--quiet')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    config = json.loads((ROOT / '.next/required-server-files.json').read_text()).get('config', {})
    if config.get('env', {}).get('RELEASE_SHA') != revision or config.get('output') != 'standalone':
        raise SystemExit('Build is not a standalone package of the current revision')
    if not any(b'http://127.0.0.1:39320' in p.read_bytes() for p in (ROOT / '.next/static/chunks').glob('*.js')):
        raise SystemExit('Build does not contain the local database address')
    prior = CURRENT.resolve(strict=True)
    if not prior.is_relative_to(TARGET / 'releases'):
        raise SystemExit('Prior release is outside the retained release directory')
    release = TARGET / 'releases' / revision
    if release.exists():
        raise SystemExit('This release already exists; inspect it before retrying')
    shutil.copytree(ROOT / '.next/standalone', release, symlinks=True)
    shutil.copytree(ROOT / '.next/static', release / '.next/static', symlinks=True, dirs_exist_ok=True)
    shutil.copytree(ROOT / 'public', release / 'public', symlinks=True, dirs_exist_ok=True)
    for directory, dirs, files in os.walk(release, followlinks=False):
        os.chown(directory, 0, 0)
        os.chmod(directory, 0o755)
        for name in dirs + files:
            path = Path(directory) / name
            if path.is_symlink():
                if not path.resolve(strict=True).is_relative_to(release):
                    raise RuntimeError('Release contains a symlink outside its directory')
                os.lchown(path, 0, 0)
            elif path.is_file():
                os.chown(path, 0, 0)
                os.chmod(path, 0o755 if path.stat().st_mode & 0o111 else 0o644)
    cache_link = release / '.next/cache'
    if cache_link.exists() or cache_link.is_symlink():
        raise RuntimeError('Unexpected existing build cache')
    cache_link.symlink_to(CACHE, target_is_directory=True)
    try:
        switch(release)
        verify()
    except Exception:
        switch(prior)
        verify()
        raise
    print(f'Private Automation web release {revision} is running; previous release retained')

if __name__ == '__main__':
    main()
