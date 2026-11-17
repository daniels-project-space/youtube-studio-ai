#!/usr/bin/env python3
"""Create separate local workshop credentials without exposing their values.

The bootstrap password remains root-only until it can be reconciled into the
Project Hub vault. Do not delete it before verifying vault readback.
"""
import hashlib
import os
from pathlib import Path
import secrets
import sys

config = Path('/etc/youtube-studio-workshop')
bootstrap = config/'web-password-bootstrap.env'
output = config/'web.env'
if os.geteuid() != 0 or sys.argv[1:] != ['--provision']:
    raise SystemExit('Run as root with --provision')
if not config.is_dir() or config.stat().st_uid != 0 or config.stat().st_mode & 0o077 or bootstrap.exists() or output.exists():
    raise SystemExit('Private workshop configuration is missing or web credentials already exist')
password = secrets.token_urlsafe(24)
salt = secrets.token_bytes(16)
digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
verifier = 'scrypt$'+salt.hex()+'$'+digest.hex()
pem = (config/'jwt-private.pem').read_text().replace('\n','\\n')
values = {
    'NODE_ENV':'production', 'HOSTNAME':'127.0.0.1', 'PORT':'39462',
    'YTS_LOCAL_WEB_ORIGIN':'http://127.0.0.1:39462',
    'NEXT_PUBLIC_CONVEX_URL':'http://127.0.0.1:39420', 'CONVEX_URL':'http://127.0.0.1:39420',
    'STUDIO_OWNER_ID':'owner_daniel', 'STUDIO_CONVEX_ISSUER':'http://127.0.0.1:39440',
    'STUDIO_CONVEX_AUDIENCE':'youtube-studio-workshop-vps', 'STUDIO_CONVEX_JWT_PRIVATE_KEY':pem,
    'STUDIO_SESSION_SECRET':secrets.token_hex(32), 'YOUTUBE_STUDIO_WORKSHOP_PRIVATE':'1',
    'YOUTUBE_STUDIO_WORKSHOP_PASSWORD_SCRYPT':verifier,
}
def write_private(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        out.write(text)
        out.flush()
        os.fsync(out.fileno())

write_private(bootstrap, 'LOCAL_WEB_PASSWORD='+password+'\n')
for value in values.values():
    if "'" in value or '\n' in value:
        raise RuntimeError('Unsafe environment value; bootstrap retained')
write_private(output, ''.join(f"{key}='{value}'\n" for key, value in values.items()))
print('Private workshop web credentials provisioned; root-only bootstrap retained for vault reconciliation')
