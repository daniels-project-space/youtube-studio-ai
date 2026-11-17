#!/usr/bin/env python3
"""Deploy current Automation backend code to its fixed loopback instance."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
if os.geteuid() != 0 or os.sys.argv[1:] != ['--deploy']:
    raise SystemExit('Run as root with --deploy')
if subprocess.run(['systemctl','is-active','--quiet','youtube-automation-convex.service']).returncode:
    raise SystemExit('Dedicated Automation backend is not running')
admin_path = Path('/etc/youtube-automation/convex-admin-key')
info = admin_path.lstat()
if not info.st_uid == 0 or info.st_mode & 0o077 or not admin_path.is_file():
    raise SystemExit('Local backend admin credential is not private')
admin = admin_path.read_text().strip()
env = os.environ.copy()
for key in ('CONVEX_DEPLOYMENT','CONVEX_DEPLOY_KEY','CONVEX_SELF_HOSTED_URL','CONVEX_SELF_HOSTED_ADMIN_KEY',
            'NEXT_PUBLIC_CONVEX_URL','NEXT_PUBLIC_CONVEX_SITE_URL','STUDIO_CONVEX_ISSUER','STUDIO_CONVEX_JWKS_URL','STUDIO_CONVEX_AUDIENCE'):
    env.pop(key, None)
env.update(CONVEX_SELF_HOSTED_URL='http://127.0.0.1:39320', CONVEX_SELF_HOSTED_ADMIN_KEY=admin,
           CI='1', DISABLE_TELEMETRY='1')
cli = str(root/'node_modules/.bin/convex')
with tempfile.TemporaryDirectory(prefix='youtube-automation-deploy-') as temp:
    app = Path(temp)
    for directory in ('src','convex'):
        shutil.copytree(root/directory,app/directory)
    for filename in ('package.json','tsconfig.json'):
        shutil.copy2(root/filename,app/filename)
    (app/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
    def run(*args):
        result = subprocess.run([cli,*args],cwd=app,env=env,capture_output=True,text=True,timeout=240)
        if result.returncode:
            detail = (result.stdout+'\n'+result.stderr)[-2000:].replace(admin,'[redacted]')
            raise RuntimeError(f'Local backend {args[0]} failed: {detail}')
    for name,value in [('STUDIO_CONVEX_ISSUER','http://127.0.0.1:39340'),
                       ('STUDIO_CONVEX_JWKS_URL','http://127.0.0.1:39340/api/auth/convex-jwks'),
                       ('STUDIO_CONVEX_AUDIENCE','youtube-automation-vps')]:
        run('env','set',name,value)
    run('dev','--once','--typecheck','disable','--codegen','disable','--tail-logs','disable')
print('Deployed Automation backend code to the dedicated loopback database')
