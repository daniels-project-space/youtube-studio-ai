#!/usr/bin/env python3
"""Install a clean standalone Studio workshop build as an isolated loopback service."""
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

root = Path(__file__).resolve().parent.parent
target = Path('/opt/youtube-studio-workshop-web')
state = Path('/var/lib/youtube-studio-workshop-web')
unit = Path('/etc/systemd/system/youtube-studio-workshop-web.service')
envfile = Path('/etc/youtube-studio-workshop/web.env')
account = 'youtubeworkshop'
if os.geteuid() != 0 or sys.argv[1:] != ['--install']:
    raise SystemExit('Run as root with --install')
if target.exists() or state.exists() or unit.exists():
    raise SystemExit('Web service paths already exist; refusing to overwrite')
try:
    pwd.getpwnam(account)
    raise SystemExit('Service account already exists; inspect it before installing')
except KeyError:
    pass
if not envfile.is_file() or envfile.stat().st_uid != 0 or envfile.stat().st_mode & 0o077:
    raise SystemExit('Private web credentials are missing')
if subprocess.run(['git','diff','--quiet'],cwd=root).returncode or subprocess.run(['git','diff','--cached','--quiet'],cwd=root).returncode:
    raise SystemExit('Commit tracked changes before building a release')
revision = subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
build = json.loads((root/'.next/required-server-files.json').read_text())
config = build.get('config',{})
if config.get('env',{}).get('RELEASE_SHA') != revision or config.get('output') != 'standalone':
    raise SystemExit('Build revision or standalone output does not match the current commit')
if not any(b'http://127.0.0.1:39420' in path.read_bytes() for path in (root/'.next/static/chunks').glob('*.js')):
    raise SystemExit('Build does not contain the expected local backend address')
for service in ('youtube-studio-workshop-convex.service','youtube-studio-workshop-jwks.service'):
    if subprocess.run(['systemctl','is-active','--quiet',service]).returncode:
        raise SystemExit('Required local backend service is unavailable')
with socket.socket() as sock:
    sock.bind(('127.0.0.1',39462))
subprocess.run(['useradd','--system','--user-group','--home-dir','/nonexistent','--shell','/usr/sbin/nologin',account],check=True)
user = pwd.getpwnam(account)
target.mkdir(mode=0o755)
(target/'releases').mkdir(mode=0o755)
release = target/'releases'/revision
shutil.copytree(root/'.next/standalone',release,symlinks=True)
shutil.copytree(root/'.next/static',release/'.next/static',symlinks=True,dirs_exist_ok=True)
shutil.copytree(root/'public',release/'public',symlinks=True,dirs_exist_ok=True)
for path in release.rglob('*'):
    if path.is_symlink() and not path.resolve(strict=True).is_relative_to(release):
        raise RuntimeError('Standalone build contains a symlink outside its release')
state.mkdir(mode=0o700)
os.chown(state,user.pw_uid,user.pw_gid)
cache = state/'next-cache'
cache.mkdir(mode=0o700)
os.chown(cache,user.pw_uid,user.pw_gid)
cache_link = release/'.next/cache'
if cache_link.exists() or cache_link.is_symlink():
    raise RuntimeError('Unexpected existing release cache; inspect before installing')
cache_link.symlink_to(cache,target_is_directory=True)
(target/'current').symlink_to(release,target_is_directory=True)
service = f'''[Unit]\nDescription=YouTube Studio AI workshop private VPS interface\nAfter=network.target youtube-studio-workshop-convex.service youtube-studio-workshop-jwks.service\nWants=youtube-studio-workshop-convex.service youtube-studio-workshop-jwks.service\n[Service]\nUser={account}\nGroup={account}\nWorkingDirectory={target}/current\nEnvironmentFile={envfile}\nExecStart=/usr/bin/node {target}/current/server.js\nRestart=on-failure\nRestartSec=3\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nReadWritePaths={state}\nMemoryMax=2048M\nCPUQuota=200%\n[Install]\nWantedBy=multi-user.target\n'''
unit.write_text(service)
unit.chmod(0o644)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','youtube-studio-workshop-web.service'],check=True,stdout=subprocess.DEVNULL)
for _ in range(80):
    try:
        with urllib.request.urlopen('http://127.0.0.1:39462/operator-login',timeout=1) as response:
            if response.status == 200: break
    except Exception:
        time.sleep(.25)
else:
    raise RuntimeError('Dedicated web service did not become healthy')
try:
    urllib.request.urlopen('http://127.0.0.1:39462/api/auth/convex-token',timeout=3)
    raise RuntimeError('Anonymous channel token request unexpectedly succeeded')
except urllib.error.HTTPError as error:
    if error.code != 401: raise
print(f'Installed private loopback Studio workshop interface at revision {revision}; anonymous channel tokens rejected')
