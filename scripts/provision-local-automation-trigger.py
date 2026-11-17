#!/usr/bin/env python3
"""Install the isolated, loopback-only Automation job service once on a VPS."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess

import bcrypt

ROOT = Path(__file__).resolve().parents[1]
DATA = Path('/var/lib/youtube-automation/trigger')
ENV = Path('/etc/youtube-automation/trigger.env')
UNIT = Path('/etc/systemd/system/youtube-automation-trigger.service')
RELAY_UNIT = Path('/etc/systemd/system/youtube-automation-convex-relay.service')
RELAY = Path('/opt/youtube-automation-trigger/relay.py')
NETWORK = ipaddress.ip_network('172.30.240.0/24')

def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install', action='store_true', required=True)
    parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Run as root')
    for path in (DATA, ENV, UNIT, RELAY_UNIT, RELAY.parent):
        if path.exists():
            raise SystemExit(f'Refusing to overwrite existing path: {path}')
    run('systemctl', 'is-active', '--quiet', 'youtube-automation-convex.service')
    run('id', 'youtubeautomation', stdout=subprocess.DEVNULL)
    existing = subprocess.check_output(['docker', 'compose', 'ls', '--all', '--format', 'json'], text=True)
    if any(p['Name'] == 'youtube-automation-trigger' for p in json.loads(existing)):
        raise SystemExit('Automation Trigger project already exists; inspect it first')
    ids = subprocess.check_output(['docker', 'network', 'ls', '-q'], text=True).split()
    networks = json.loads(subprocess.check_output(['docker', 'network', 'inspect', *ids], text=True))
    for network in networks:
        if network['Name'].startswith('yta-automation-trigger-'):
            raise SystemExit('Automation Trigger network already exists')
        for config in network.get('IPAM', {}).get('Config') or []:
            if config.get('Subnet') and NETWORK.overlaps(ipaddress.ip_network(config['Subnet'])):
                raise SystemExit('Private worker subnet overlaps an existing Docker network')
    for port in (39400, 39401, 39402):
        with socket.socket() as sock:
            sock.bind(('0.0.0.0', port))

    DATA.mkdir(mode=0o700)
    shutil.copytree(ROOT / 'deploy/local-trigger', DATA, dirs_exist_ok=True)
    (DATA / 'registry').mkdir(mode=0o700)
    password = secrets.token_hex(24)
    auth = b'automation:' + bcrypt.hashpw(password.encode(), bcrypt.gensalt()) + b'\n'
    auth_file = DATA / 'registry/auth.htpasswd'
    auth_file.write_bytes(auth)
    auth_file.chmod(0o600)
    values = {name: secrets.token_hex(32) for name in (
        'SESSION_SECRET', 'MAGIC_LINK_SECRET', 'ENCRYPTION_KEY', 'PROVIDER_SECRET',
        'COORDINATOR_SECRET', 'MANAGED_WORKER_SECRET', 'POSTGRES_PASSWORD',
        'CLICKHOUSE_PASSWORD', 'OBJECT_STORE_SECRET_ACCESS_KEY')}
    values['ENCRYPTION_KEY'] = secrets.token_hex(16)
    values.update(DOCKER_REGISTRY_PASSWORD=password, TRIGGER_IMAGE_TAG='v4.5.9',
                  APP_ORIGIN='http://127.0.0.1:39400', LOGIN_ORIGIN='http://127.0.0.1:39400',
                  API_ORIGIN='http://172.30.240.1:39400', DEV_OTEL_EXPORTER_OTLP_ENDPOINT='http://webapp:3000/otel',
                  DOCKER_REGISTRY_URL='127.0.0.1:39401', DOCKER_REGISTRY_USERNAME='automation',
                  DOCKER_REGISTRY_NAMESPACE='youtube-automation', OBJECT_STORE_ACCESS_KEY_ID='automationlocal',
                  POSTGRES_DB='main', RESTART_POLICY='unless-stopped', NODE_MAX_OLD_SPACE_SIZE='1024')
    ENV.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
    ENV.chmod(0o600)
    compose = ('/usr/bin/docker compose --env-file /etc/youtube-automation/trigger.env '
               '--project-name youtube-automation-trigger '
               '--project-directory /var/lib/youtube-automation/trigger/webapp '
               '-f /var/lib/youtube-automation/trigger/webapp/compose.yml '
               '-f /var/lib/youtube-automation/trigger/worker/compose.yml '
               '-f /var/lib/youtube-automation/trigger/limits.yml')
    UNIT.write_text('[Unit]\nDescription=YouTube Automation local job service\n'
                    'Requires=docker.service\nAfter=docker.service\n\n[Service]\nType=oneshot\n'
                    f'ExecStart={compose} up -d\nExecStop={compose} stop\n'
                    'RemainAfterExit=yes\nTimeoutStartSec=300\nTimeoutStopSec=120\n\n'
                    '[Install]\nWantedBy=multi-user.target\n')
    RELAY.parent.mkdir(mode=0o755)
    shutil.copyfile(ROOT / 'scripts/local-convex-relay.py', RELAY)
    RELAY.chmod(0o755)
    RELAY_UNIT.write_text('[Unit]\nDescription=YouTube Automation private worker database bridge\n'
                          'Requires=youtube-automation-trigger.service youtube-automation-convex.service\n'
                          'After=youtube-automation-trigger.service youtube-automation-convex.service\n\n'
                          '[Service]\nUser=youtubeautomation\nExecStart=/usr/bin/python3 /opt/youtube-automation-trigger/relay.py\n'
                          'Restart=on-failure\nRestartSec=3\nNoNewPrivileges=true\nPrivateTmp=true\nMemoryMax=128M\n\n'
                          '[Install]\nWantedBy=multi-user.target\n')
    run('systemctl', 'daemon-reload')
    run('systemctl', 'enable', '--now', 'youtube-automation-trigger.service')
    run('systemctl', 'is-active', '--quiet', 'youtube-automation-trigger.service')
    run('systemctl', 'enable', '--now', 'youtube-automation-convex-relay.service')
    run('systemctl', 'is-active', '--quiet', 'youtube-automation-convex-relay.service')
    print('Installed local Automation job service and private database bridge')

if __name__ == '__main__':
    main()
