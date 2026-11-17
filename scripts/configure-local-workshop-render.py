#!/usr/bin/env python3
"""Bind the private worker to its verified workshop render project."""
import json
import os
from pathlib import Path
import sys

config = Path('/etc/youtube-studio-workshop')
metadata, secret, worker = (config/name for name in ('hrs-project.json','hrs-project-token.env','trigger-worker.env'))
if os.geteuid() != 0 or sys.argv[1:] != ['--configure']:
    raise SystemExit('Run as root with --configure')
for path in (metadata,secret,worker):
    if not path.is_file() or path.stat().st_uid != 0 or path.stat().st_mode & 0o077:
        raise SystemExit('Workshop render or worker configuration is not private')
project = json.loads(metadata.read_text())
line = secret.read_text().strip()
if not line.startswith('HRS_YOUTUBE_PROJECT_TOKEN='):
    raise SystemExit('Workshop render credential is invalid')
token = line.split('=',1)[1]
if (project.get('baseUrl') != 'https://hyper-render-api.87.106.233.113.nip.io' or
    project.get('output',{}).get('bucket') != 'youtube-studio-ai-private' or
    project.get('output',{}).get('prefix') != 'projects/youtube-studio-workshop/' or
    not isinstance(project.get('id'),str) or not token):
    raise SystemExit('Workshop render identity does not match its destination')
values = {'HRS_YOUTUBE_BASE_URL':project['baseUrl'],'HRS_YOUTUBE_PROJECT_TOKEN':token,
          'HRS_WORKSHOP_PROJECT_ID':project['id'],'HRS_WORKSHOP_OUTPUT_PREFIX':project['output']['prefix']}
if any(line.partition('=')[0] in values for line in worker.read_text().splitlines()):
    raise SystemExit('Worker render configuration already exists; inspect it before proceeding')
if any("'" in value or '\n' in value for value in values.values()):
    raise SystemExit('Unsafe render configuration value')
with worker.open('a') as out:
    for name,value in values.items(): out.write(f"{name}='{value}'\n")
    out.flush();os.fsync(out.fileno())
print('Verified workshop render identity bound to local worker configuration; no job submitted')
