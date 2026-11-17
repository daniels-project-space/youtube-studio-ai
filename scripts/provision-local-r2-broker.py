#!/usr/bin/env python3
"""Install a private broker using vault-injected R2 parent credentials."""
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path('/etc/youtube-automation/r2-broker.json')
TOKEN = Path('/etc/youtube-automation/r2-broker-token')
INSTALL = Path('/opt/youtube-automation-r2')
UNIT = Path('/etc/systemd/system/youtube-automation-r2-broker.service')
WEB_ENV = Path('/etc/youtube-automation/web.env')
WORKER_ENV = Path('/etc/youtube-automation/trigger-worker.env')

def private_file(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as file:
        file.write(data)

def main():
    if os.geteuid() != 0 or sys.argv[1:] != ['--install']:
        raise SystemExit('Run as root with --install and vault-injected parent credentials')
    for path in (CONFIG, TOKEN, INSTALL, UNIT):
        if path.exists() or path.is_symlink():
            raise SystemExit(f'Existing broker path: {path}; inspect before proceeding')
    for host in ('127.0.0.1', '172.30.240.1'):
        with socket.socket() as sock:
            sock.bind((host, 39404))
    parent, parent_id, account = (os.environ.get(key, '') for key in
                                  ('YTA_PARENT_TOKEN', 'YTA_PARENT_ID', 'YTA_ACCOUNT'))
    if not parent or not parent_id or len(account) != 32 or any(c not in '0123456789abcdef' for c in account.lower()):
        raise SystemExit('Vault-injected parent credentials are missing or invalid')
    settings = ('R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
                'YTA_R2_BROKER_URL', 'YTA_R2_BROKER_TOKEN')
    for path in (WEB_ENV, WORKER_ENV):
        if not path.is_file() or path.stat().st_uid != 0 or path.stat().st_mode & 0o077:
            raise SystemExit('Private runtime configuration is missing or not root-only')
        if any(line.partition('=')[0] in settings for line in path.read_text().splitlines()):
            raise SystemExit('R2 runtime settings already exist; inspect before proceeding')
    url = f'https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/youtube-automation/lifecycle'
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + parent})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            rules = json.load(response).get('result', {}).get('rules', [])
    except Exception:
        raise SystemExit('Dedicated bucket lifecycle could not be verified') from None
    if not any(x.get('enabled') and x.get('abortMultipartUploadsTransition', {}).get('condition', {}).get('maxAge') == 604800 for x in rules):
        raise SystemExit('Dedicated bucket is missing multipart cleanup')
    if not any(x.get('enabled') and x.get('conditions', {}).get('prefix') == 'diagnostics/' and
               x.get('deleteObjectsTransition', {}).get('condition', {}).get('maxAge') == 604800 for x in rules):
        raise SystemExit('Dedicated bucket is missing diagnostics expiry')
    token = secrets.token_hex(32)
    private_file(CONFIG, json.dumps({'apiToken': parent, 'parentAccessKeyId': parent_id,
                                     'accountId': account, 'brokerToken': token}))
    private_file(TOKEN, token)
    INSTALL.mkdir(mode=0o755)
    shutil.copyfile(ROOT / 'scripts/local-r2-credential-broker.py', INSTALL / 'broker.py')
    (INSTALL / 'broker.py').chmod(0o755)
    UNIT.write_text('''[Unit]
Description=YouTube Automation scoped R2 credential broker
Requires=youtube-automation-trigger.service
After=youtube-automation-trigger.service network-online.target
[Service]
DynamicUser=yes
LoadCredential=broker.json:/etc/youtube-automation/r2-broker.json
ExecStart=/usr/bin/python3 /opt/youtube-automation-r2/broker.py
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
    for path, host in ((WEB_ENV, '127.0.0.1'), (WORKER_ENV, '172.30.240.1')):
        values = {'R2_ACCOUNT_ID': account, 'R2_BUCKET': 'youtube-automation',
                  'YTA_R2_BROKER_URL': f'http://{host}:39404/v1/credentials', 'YTA_R2_BROKER_TOKEN': token}
        with path.open('a') as file:
            for key, value in values.items():
                file.write(f'{key}={json.dumps(value)}\n')
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', '--now', 'youtube-automation-r2-broker.service'], check=True)
    subprocess.run(['systemctl', 'is-active', '--quiet', 'youtube-automation-r2-broker.service'], check=True)
    print('Installed isolated R2 credential broker; rebuild and validate both runtimes before use')

if __name__ == '__main__':
    main()
