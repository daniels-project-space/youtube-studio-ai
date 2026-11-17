#!/usr/bin/env python3
"""Create private Automation web credentials and save the password to Hub Vault."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

CONFIG = Path('/etc/youtube-automation')
BOOTSTRAP = CONFIG/'web-password-bootstrap.env'
OUTPUT = CONFIG/'web.env'
if os.geteuid() != 0 or sys.argv[1:] != ['--provision']:
    raise SystemExit('Run as root with --provision')
if not CONFIG.is_dir() or CONFIG.stat().st_uid != 0 or CONFIG.stat().st_mode & 0o077 or OUTPUT.exists():
    raise SystemExit('Private Automation configuration is missing or web credentials already exist')
if not BOOTSTRAP.exists():
    password = secrets.token_urlsafe(24)
    fd = os.open(BOOTSTRAP, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        out.write('LOCAL_WEB_PASSWORD='+password+'\n')
        out.flush()
        os.fsync(out.fileno())
info = BOOTSTRAP.lstat()
if not info.st_uid == 0 or info.st_mode & 0o077 or not info.st_size < 512 or not BOOTSTRAP.is_file():
    raise SystemExit('Bootstrap credential is not private')
line = BOOTSTRAP.read_text().strip()
if not line.startswith('LOCAL_WEB_PASSWORD='):
    raise SystemExit('Bootstrap credential is invalid')
password = line.split('=',1)[1]
if len(password) < 24 or len(password) > 128:
    raise SystemExit('Bootstrap password length is invalid')
vault = subprocess.run(['ai-vault','--reconcile-dotenv','youtube-automation',str(BOOTSTRAP),
                        '--key','LOCAL_WEB_PASSWORD','--source-label','youtube-automation-local-web'],
                       capture_output=True,text=True,timeout=60)
if vault.returncode:
    raise SystemExit('Could not save the local login credential to Project Hub Vault')
result = json.loads(vault.stdout)
if len(result.get('results',[])) != 1 or result['results'][0].get('status') not in ('inserted','already-current'):
    raise SystemExit('A different credential already exists in Project Hub Vault; no value was replaced')
verify_code = ('import hmac,os,pathlib,sys; '
               'v=pathlib.Path(sys.argv[1]).read_text().strip().split("=",1)[1]; '
               'sys.exit(0 if hmac.compare_digest(v,os.environ["YTA_VAULT_PASSWORD"]) else 1)')
verified = subprocess.run(['ai-vault','youtube-automation','LOCAL_WEB_PASSWORD=YTA_VAULT_PASSWORD','--',
                           sys.executable,'-c',verify_code,str(BOOTSTRAP)],capture_output=True,timeout=60)
if verified.returncode:
    raise SystemExit('Vault credential readback did not match; bootstrap retained')
salt = secrets.token_bytes(16)
digest = hashlib.scrypt(password.encode(),salt=salt,n=16384,r=8,p=1,dklen=32)
verifier = 'scrypt$'+salt.hex()+'$'+digest.hex()
pem = (CONFIG/'jwt-private.pem').read_text().replace('\n','\\n')
values = {
    'NODE_ENV':'production', 'HOSTNAME':'127.0.0.1', 'PORT':'39362',
    'YTA_LOCAL_WEB_ORIGIN':'http://127.0.0.1:39362',
    'NEXT_PUBLIC_CONVEX_URL':'http://127.0.0.1:39320', 'CONVEX_URL':'http://127.0.0.1:39320',
    'STUDIO_OWNER_ID':'owner_daniel', 'STUDIO_CONVEX_ISSUER':'http://127.0.0.1:39340',
    'STUDIO_CONVEX_AUDIENCE':'youtube-automation-vps', 'STUDIO_CONVEX_JWT_PRIVATE_KEY':pem,
    'STUDIO_SESSION_SECRET':secrets.token_hex(32), 'YOUTUBE_AUTOMATION_PRIVATE':'1',
    'YOUTUBE_AUTOMATION_PASSWORD_SCRYPT':verifier,
}
fd = os.open(OUTPUT, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd,'w') as out:
    for key,value in values.items():
        if "'" in value or '\n' in value: raise RuntimeError('Unsafe environment value')
        out.write(f"{key}='{value}'\n")
    out.flush()
    os.fsync(out.fileno())
BOOTSTRAP.unlink()
print('Local web credentials provisioned; owner password saved and verified in Project Hub Vault')
