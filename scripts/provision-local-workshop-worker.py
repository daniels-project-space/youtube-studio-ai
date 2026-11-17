#!/usr/bin/env python3
"""Prepare the isolated Studio worker identity and private database relay."""
import hmac
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
CONFIG = Path('/etc/youtube-studio-workshop')
BIN = Path('/opt/youtube-studio-workshop-worker')
UNIT = Path('/etc/systemd/system/youtube-studio-workshop-relay.service')
WORKER_ENV = CONFIG/'trigger-worker.env'
KEY_FILE = CONFIG/'trigger-production.key'
if os.geteuid() != 0 or sys.argv[1:] != ['--install']:
    raise SystemExit('Run as root with --install')
if any(p.exists() for p in (BIN, UNIT, WORKER_ENV, KEY_FILE)):
    raise SystemExit('A target already exists; inspect it instead of overwriting')
if not CONFIG.is_dir() or CONFIG.stat().st_uid != 0 or CONFIG.stat().st_mode & 0o077:
    raise SystemExit('Studio workshop configuration is not private')
for service in ('youtube-automation-trigger.service', 'youtube-studio-workshop-convex.service'):
    subprocess.run(['systemctl','is-active','--quiet',service],check=True)
subprocess.run(['id','youtubeworkshop'],check=True,stdout=subprocess.DEVNULL)
with socket.socket() as sock: sock.bind(('172.30.240.1',39403))
sql = '''SELECT r."apiKey" FROM "RuntimeEnvironment" r JOIN "Project" p ON p.id=r."projectId" WHERE p."externalRef"='proj_dqyvctmalaifbqvylvfm' AND p.name='YouTube Studio AI' AND r.type='PRODUCTION' AND r."archivedAt" IS NULL'''
key = subprocess.check_output(['docker','exec','youtube-automation-trigger-postgres-1','psql','-U','postgres','-d','main','-Atc',sql],text=True).strip()
automation = Path('/etc/youtube-automation/trigger-production.key').read_text().strip()
if not key or '\n' in key or hmac.compare_digest(key, automation):
    raise RuntimeError('Studio Trigger project identity is missing or matches Automation')
pem = (CONFIG/'jwt-private.pem').read_text().replace('\n','\\n')
values = {
    'YOUTUBE_STUDIO_WORKSHOP_TRIGGER_LOCAL':'1', 'TRIGGER_PROJECT_REF':'proj_dqyvctmalaifbqvylvfm',
    'TRIGGER_API_URL':'http://127.0.0.1:39400', 'YTS_WORKER_CONVEX_URL':'http://172.30.240.1:39403',
    'STUDIO_CONVEX_ISSUER':'http://127.0.0.1:39440', 'STUDIO_CONVEX_AUDIENCE':'youtube-studio-workshop-vps',
    'STUDIO_CONVEX_JWT_PRIVATE_KEY':pem, 'STUDIO_OWNER_ID':'owner_daniel',
}
def write_private(path, content):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as out:
        out.write(content);out.flush();os.fsync(out.fileno())
for value in values.values():
    if "'" in value or '\n' in value: raise RuntimeError('Unsafe worker environment')
write_private(KEY_FILE,key+'\n')
write_private(WORKER_ENV,''.join(f"{name}='{value}'\n" for name,value in values.items()))
BIN.mkdir(mode=0o755)
relay=BIN/'relay.py'
shutil.copyfile(ROOT/'scripts/workshop-worker-relay.py',relay);relay.chmod(0o755)
UNIT.write_text('[Unit]\nDescription=Studio workshop private worker database bridge\n'
    'Requires=youtube-automation-trigger.service youtube-studio-workshop-convex.service\n'
    'After=youtube-automation-trigger.service youtube-studio-workshop-convex.service\n\n'
    '[Service]\nUser=youtubeworkshop\nExecStart=/usr/bin/python3 /opt/youtube-studio-workshop-worker/relay.py\n'
    'Restart=on-failure\nRestartSec=3\nNoNewPrivileges=true\nPrivateTmp=true\nMemoryMax=128M\n\n'
    '[Install]\nWantedBy=multi-user.target\n')
UNIT.chmod(0o644)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','youtube-studio-workshop-relay.service'],check=True,stdout=subprocess.DEVNULL)
subprocess.run(['systemctl','is-active','--quiet','youtube-studio-workshop-relay.service'],check=True)
print('Studio worker identity and isolated database relay installed; no task was started')
