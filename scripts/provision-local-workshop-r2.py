#!/usr/bin/env python3
"""Install a Studio-only broker for short-lived, bucket-scoped R2 keys."""
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
CONFIG = Path('/etc/youtube-studio-workshop')
PARENT = Path('/etc/youtube-automation/r2-broker.json')
BROKER = CONFIG/'r2-broker.json'
TOKEN = CONFIG/'r2-broker-token'
INSTALL = Path('/opt/youtube-studio-workshop-r2')
UNIT = Path('/etc/systemd/system/youtube-studio-workshop-r2.service')
if os.geteuid() != 0 or sys.argv[1:] != ['--install']:
    raise SystemExit('Run as root with --install')
if any(p.exists() or p.is_symlink() for p in (BROKER, TOKEN, INSTALL, UNIT)):
    raise SystemExit('Studio broker target already exists; inspect it before proceeding')
for path in (PARENT, CONFIG/'web.env', CONFIG/'trigger-worker.env'):
    if not path.is_file() or path.stat().st_uid != 0 or path.stat().st_mode & 0o077:
        raise SystemExit('A required configuration file is not private')
for host in ('127.0.0.1', '172.30.240.1'):
    with socket.socket() as sock: sock.bind((host,39405))
settings = ('R2_ACCOUNT_ID','R2_BUCKET','R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','YTS_R2_BROKER_URL','YTS_R2_BROKER_TOKEN')
for path in (CONFIG/'web.env', CONFIG/'trigger-worker.env'):
    if any(line.partition('=')[0] in settings for line in path.read_text().splitlines()):
        raise SystemExit('Studio R2 settings already exist; inspect them before proceeding')
parent = json.loads(PARENT.read_text())
if any(not isinstance(parent.get(k),str) or not parent[k] for k in ('apiToken','parentAccessKeyId','accountId')):
    raise SystemExit('Scoped credential issuer is incomplete')
if len(parent['accountId']) != 32 or any(c not in '0123456789abcdef' for c in parent['accountId'].lower()):
    raise SystemExit('Scoped credential issuer account is invalid')
token = secrets.token_hex(32)
def write_private(path, text):
    fd = os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as out: out.write(text);out.flush();os.fsync(out.fileno())
write_private(BROKER,json.dumps({k:parent[k] for k in ('apiToken','parentAccessKeyId','accountId')} | {'brokerToken':token}))
write_private(TOKEN,token+'\n')
INSTALL.mkdir(mode=0o755)
shutil.copyfile(ROOT/'scripts/local-workshop-r2-broker.py',INSTALL/'broker.py')
(INSTALL/'broker.py').chmod(0o755)
UNIT.write_text('''[Unit]
Description=Studio workshop scoped R2 credential broker
Requires=youtube-automation-trigger.service
After=youtube-automation-trigger.service network-online.target
[Service]
DynamicUser=yes
LoadCredential=broker.json:/etc/youtube-studio-workshop/r2-broker.json
ExecStart=/usr/bin/python3 /opt/youtube-studio-workshop-r2/broker.py
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
MemoryMax=128M
CPUQuota=50%
[Install]
WantedBy=multi-user.target
''')
UNIT.chmod(0o644)
for path,host in ((CONFIG/'web.env','127.0.0.1'),(CONFIG/'trigger-worker.env','172.30.240.1')):
    values={'R2_ACCOUNT_ID':parent['accountId'],'R2_BUCKET':'youtube-studio-ai-private',
            'YTS_R2_BROKER_URL':f'http://{host}:39405/v1/credentials','YTS_R2_BROKER_TOKEN':token}
    with path.open('a') as out:
        for name,value in values.items(): out.write(f'{name}={json.dumps(value)}\n')
        out.flush();os.fsync(out.fileno())
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','youtube-studio-workshop-r2.service'],check=True,stdout=subprocess.DEVNULL)
subprocess.run(['systemctl','is-active','--quiet','youtube-studio-workshop-r2.service'],check=True)
print('Studio scoped credential broker installed; no bucket data or lifecycle changed')
