#!/usr/bin/env python3
"""Install the pinned, loopback-only Studio workshop database and signing endpoint.

This creates new dedicated paths and refuses to overwrite an existing setup.
It does not deploy application code, import channels, or enable schedules.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time
import urllib.request
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

ROOT = Path(__file__).resolve().parent.parent
BINARY = Path('/root/.cache/convex/binaries/precompiled-2026-10-22-1447815/convex-local-backend')
BINARY_SHA = '044eedfe569b1550d5003683aec7fceb4dcee3f82abf00ab9baf1c10d3ca0b4c'
OPT = Path('/opt/youtube-studio-workshop')
CONFIG = Path('/etc/youtube-studio-workshop')
DATA = Path('/var/lib/youtube-studio-workshop/backend')
UNITS = Path('/etc/systemd/system')
PORT, SITE_PORT, JWKS_PORT = 39420, 39421, 39440
NAME = 'youtube-studio-workshop-vps'

def private(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())

def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

def main():
    if os.geteuid() != 0 or os.sys.argv[1:] not in (['--install'], ['--resume-empty-install']):
        raise RuntimeError('Run as root with --install or --resume-empty-install')
    resume = os.sys.argv[1:] == ['--resume-empty-install']
    targets = [DATA.parent, UNITS/'youtube-studio-workshop-convex.service', UNITS/'youtube-studio-workshop-jwks.service']
    if any(path.exists() for path in targets):
        raise RuntimeError('A target already exists; inspect it instead of overwriting')
    for path in (OPT, CONFIG):
        if path.exists() and (not resume or not path.is_dir() or path.stat().st_uid != 0 or path.stat().st_mode & 0o077 or any(path.iterdir())):
            raise RuntimeError(f'Cannot reuse nonempty or non-private setup directory: {path}')
    if hashlib.sha256(BINARY.read_bytes()).hexdigest() != BINARY_SHA:
        raise RuntimeError('The qualified Convex binary digest differs')
    for port in (PORT, SITE_PORT, JWKS_PORT):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', port))
    OPT.mkdir(mode=0o700, exist_ok=resume)
    CONFIG.mkdir(mode=0o700, exist_ok=resume)
    DATA.parent.mkdir(mode=0o700)
    DATA.mkdir(mode=0o700)
    bindir = OPT/'bin'
    bindir.mkdir(mode=0o700)
    backend = bindir/'convex-local-backend'
    shutil.copyfile(BINARY, backend)
    backend.chmod(0o700)
    loader = bindir/'convex-secret-launch.so'
    subprocess.run(['cc', '-shared', '-fPIC', '-O2', '-Wall', '-Wextra', '-Werror',
                    '-o', str(loader), str(ROOT/'scripts/convex-secret-launch.c'), '-ldl'], check=True)
    loader.chmod(0o700)
    jwks_server = bindir/'vps-local-jwks.py'
    shutil.copyfile(ROOT/'scripts/vps-local-jwks.py', jwks_server)
    jwks_server.chmod(0o700)
    secret = secrets.token_hex(32)
    private(CONFIG/'backend.env', f'YTA_CONVEX_INSTANCE_SECRET={secret}\nLD_PRELOAD={loader}\n'.encode())
    env = os.environ.copy()
    env.update(YTA_CONVEX_INSTANCE_SECRET=secret, LD_PRELOAD=str(loader))
    admin = subprocess.check_output([str(backend), 'keygen', 'admin-key', '--instance-name', NAME], env=env)
    private(CONFIG/'convex-admin-key', admin.strip()+b'\n')
    key = ec.generate_private_key(ec.SECP256R1())
    private(CONFIG/'jwt-private.pem', key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    pub = key.public_key().public_numbers()
    jwk = {'crv':'P-256', 'kty':'EC', 'x':b64(pub.x.to_bytes(32,'big')), 'y':b64(pub.y.to_bytes(32,'big'))}
    jwk['kid'] = b64(hashlib.sha256(json.dumps(jwk,separators=(',',':')).encode()).digest())
    jwk.update(alg='ES256', use='sig')
    private(CONFIG/'jwks.json', json.dumps({'keys':[jwk]},separators=(',',':')).encode())
    jwks_unit = f'''[Unit]\nDescription=YouTube Studio AI workshop local signing public keys\n[Service]\nExecStart=/usr/bin/python3 {jwks_server} --port {JWKS_PORT} --jwks {CONFIG}/jwks.json\nRestart=on-failure\nUMask=0077\nNoNewPrivileges=true\nMemoryMax=128M\n[Install]\nWantedBy=multi-user.target\n'''
    backend_unit = f'''[Unit]\nDescription=YouTube Studio AI workshop local Convex database\nAfter=network.target youtube-studio-workshop-jwks.service\nRequires=youtube-studio-workshop-jwks.service\n[Service]\nWorkingDirectory={DATA}\nEnvironmentFile={CONFIG}/backend.env\nExecStart={backend} --interface 127.0.0.1 --port {PORT} --site-proxy-port {SITE_PORT} --instance-name {NAME} --disable-beacon --redact-logs-to-client\nRestart=on-failure\nUMask=0077\nNoNewPrivileges=true\nMemoryMax=1536M\nCPUQuota=200%\n[Install]\nWantedBy=multi-user.target\n'''
    private(UNITS/'youtube-studio-workshop-jwks.service', jwks_unit.encode())
    private(UNITS/'youtube-studio-workshop-convex.service', backend_unit.encode())
    subprocess.run(['systemctl','daemon-reload'],check=True)
    subprocess.run(['systemctl','enable','--now','youtube-studio-workshop-jwks.service','youtube-studio-workshop-convex.service'],check=True,stdout=subprocess.DEVNULL)
    for _ in range(80):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/version',timeout=1) as response:
                if response.status == 200: break
        except Exception:
            time.sleep(.25)
    else:
        raise RuntimeError('Local backend did not become healthy; inspect the dedicated service')
    pid = int(subprocess.check_output(['systemctl','show','-p','MainPID','--value','youtube-studio-workshop-convex.service'],text=True))
    if not pid or secret.encode() in Path(f'/proc/{pid}/cmdline').read_bytes():
        raise RuntimeError('Backend command-line secret check failed')
    print('Installed dedicated loopback Studio workshop backend and signing endpoint; no channel data imported')

if __name__ == '__main__':
    main()
