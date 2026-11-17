#!/usr/bin/env python3
"""Deploy the real backend to a disposable loopback instance using synthetic data.

Requires Python cryptography, the project's installed dependencies, and an
official convex-local-backend binary supplied by --backend. No production
credentials or data are used; the temporary backend is stopped on exit.
"""
import argparse, base64, hashlib, json, os, secrets, shutil, socket, subprocess, tempfile, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

parser=argparse.ArgumentParser()
parser.add_argument('--backend',required=True,help='path to official convex-local-backend')
parser.add_argument('--secure-launcher',help='compiled instance-secret argument protection library')
parser.add_argument('--baseline',help='optional private channel baseline for disposable import qualification')
parser.add_argument('--baseline-sha256',help='expected SHA-256 of the optional baseline')
options=parser.parse_args()
binary=str(Path(options.backend).resolve(strict=True))
baseline=None
if options.baseline:
    path=Path(options.baseline)
    if path.resolve(strict=True)!=path or not str(path).startswith('/var/lib/youtube-automation/baselines/'):
        raise RuntimeError('baseline path must be the private canonical baseline path')
    info=path.lstat()
    if info.st_uid!=os.getuid() or info.st_mode & 0o077 or not path.is_file(): raise RuntimeError('baseline permissions are unsafe')
    content=path.read_bytes()
    if hashlib.sha256(content).hexdigest()!=options.baseline_sha256: raise RuntimeError('baseline hash mismatch')
    baseline=json.loads(content)
    if baseline.get('version')!='youtube-automation-channel-baseline/v1':raise RuntimeError('unsupported baseline')
repo=Path(__file__).resolve().parent.parent
cli=str(repo/'node_modules/.bin/convex')
def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1',0)); return s.getsockname()[1]
def b64(x): return base64.urlsafe_b64encode(x).rstrip(b'=').decode()
key=ec.generate_private_key(ec.SECP256R1()); pub=key.public_key().public_numbers()
values={'crv':'P-256','kty':'EC','x':b64(pub.x.to_bytes(32,'big')),'y':b64(pub.y.to_bytes(32,'big'))}
import hashlib
kid=b64(hashlib.sha256(json.dumps(values,separators=(',',':')).encode()).digest())
jwks=json.dumps({'keys':[{**values,'alg':'ES256','use':'sig','kid':kid}]}).encode()
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path!='/api/auth/convex-jwks': self.send_error(404); return
        self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(jwks)
    def log_message(self,*args): pass
http=HTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=http.serve_forever,daemon=True).start()
issuer=f'http://127.0.0.1:{http.server_port}'
api,site=free_port(),free_port()
while site==api: site=free_port()
instance='youtube-automation-real-proof'; secret=secrets.token_hex(32)
with tempfile.TemporaryDirectory(prefix='yt-real-convex-') as path:
    app=Path(path)/'app'; app.mkdir()
    for directory in ('src','convex'):
        shutil.copytree(repo/directory,app/directory)
    for filename in ('package.json','tsconfig.json'):
        shutil.copy2(repo/filename,app/filename)
    (app/'node_modules').symlink_to(repo/'node_modules',target_is_directory=True)
    command=[binary,'--interface','127.0.0.1','--port',str(api),'--site-proxy-port',str(site),'--instance-name',instance,'--instance-secret',secret,'--disable-beacon','--redact-logs-to-client']
    server_env=os.environ.copy()
    if options.secure_launcher:
        command.remove('--instance-secret');command.remove(secret)
        server_env.update(LD_PRELOAD=str(Path(options.secure_launcher).resolve(strict=True)),YTA_CONVEX_INSTANCE_SECRET=secret)
    def start():
        process=subprocess.Popen(command,cwd=path,env=server_env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for _ in range(80):
            if process.poll() is not None: raise RuntimeError('backend exited during startup')
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{api}/version',timeout=1) as r:
                    if r.status==200:
                        if options.secure_launcher and secret.encode() in Path(f'/proc/{process.pid}/cmdline').read_bytes(): raise RuntimeError('instance secret appeared in backend command line')
                        return process
            except Exception: time.sleep(.25)
        process.terminate(); process.wait(timeout=15); raise RuntimeError('backend did not start')
    process=start()
    try:
        keygen=[binary,'keygen','admin-key','--instance-name',instance]
        if not options.secure_launcher:keygen.extend(['--instance-secret',secret])
        admin=subprocess.check_output(keygen,env=server_env,text=True).strip()
        env=os.environ.copy()
        for name in ['CONVEX_DEPLOYMENT','CONVEX_DEPLOY_KEY','CONVEX_SELF_HOSTED_URL','CONVEX_SELF_HOSTED_ADMIN_KEY','NEXT_PUBLIC_CONVEX_URL','NEXT_PUBLIC_CONVEX_SITE_URL','STUDIO_CONVEX_ISSUER','STUDIO_CONVEX_JWKS_URL','STUDIO_CONVEX_AUDIENCE'] : env.pop(name,None)
        env.update({'CONVEX_SELF_HOSTED_URL':f'http://127.0.0.1:{api}','CONVEX_SELF_HOSTED_ADMIN_KEY':admin,'CI':'1','DISABLE_TELEMETRY':'1'})
        def run(args,timeout=120):
            result=subprocess.run([cli,*args],cwd=app,env=env,capture_output=True,text=True,timeout=timeout)
            if result.returncode:
                diagnostic=(result.stdout+'\n'+result.stderr)[-2500:].replace(admin,'[redacted]').replace(secret,'[redacted]')
                raise RuntimeError(f"{' '.join(args[:2])} failed ({result.returncode}): {diagnostic}")
        for name,value in [('STUDIO_CONVEX_ISSUER',issuer),('STUDIO_CONVEX_JWKS_URL',issuer+'/api/auth/convex-jwks'),('STUDIO_CONVEX_AUDIENCE','youtube-automation-local'),('YOUTUBE_LOCAL_IMPORT_ENABLED','1')]: run(['env','set',name,value])
        print('local environment set; deploying real Automation backend',flush=True)
        run(['dev','--once','--typecheck','disable','--codegen','disable','--tail-logs','disable'],240)
        def token(owner):
            token_env=env.copy()
            token_env.update({
                'STUDIO_CONVEX_JWT_PRIVATE_KEY':key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode(),
                'STUDIO_CONVEX_ISSUER':issuer,'STUDIO_CONVEX_AUDIENCE':'youtube-automation-local',
                'LOCAL_PROOF_OWNER':owner,
            })
            return subprocess.check_output([str(repo/'node_modules/.bin/tsx'),'-e',
                'import { issueStudioConvexToken } from "./src/lib/studioConvexAuth"; process.stdout.write(issueStudioConvexToken({role:"service",ownerId:process.env.LOCAL_PROOF_OWNER}).token)'],
                cwd=app,env=token_env,text=True,timeout=20).strip()
        def call(kind,path,args,auth):
            headers={'content-type':'application/json'}
            if auth:headers['authorization']='Bearer '+auth
            request=urllib.request.Request(f'http://127.0.0.1:{api}/api/{kind}',data=json.dumps({'path':path,'args':args,'format':'json'}).encode(),headers=headers)
            try:
                with urllib.request.urlopen(request,timeout=25) as response: return response.status,json.load(response)
            except urllib.error.HTTPError as error:
                return error.code,json.loads(error.read())
        def query(auth,owner):return call('query','channels:listChannels',{'ownerId':owner},auth)
        status, authorized=query(token('owner-a'),'owner-a'); _,other=query(token('owner-a'),'owner-b'); _,anonymous=query(None,'owner-a')
        ok=authorized.get('status')=='success' and authorized.get('value')==[] and other.get('status')!='success' and anonymous.get('status')!='success'
        print(json.dumps({'deployment':'passed','signedServiceOwnQuery':authorized.get('status'),'crossOwnerRejected':other.get('status')!='success','anonymousRejected':anonymous.get('status')!='success','passed':ok}),flush=True)
        if not ok:raise RuntimeError('real backend authentication qualification failed')
        channel={'ownerId':'owner-a','slug':'local-proof','name':'Disposable proof','identity':{'persona':'calm','bannedWords':[],'requiredCallbacks':[],'styleGrammar':'calm','palette':['#123456'],'thumbnailTemplate':'default','topicPool':[],'cadence':'manual'},'template':'C','pipeline':[{'block':'echo_seed','params':{'topic':'local-proof'}},{'block':'echo_sink'}],'budget':1,'status':'draft'}
        _,foreign_write=call('mutation','channels:createChannel',{**channel,'ownerId':'owner-b'},token('owner-a'))
        _,anonymous_write=call('mutation','channels:createChannel',channel,None)
        if foreign_write.get('status')=='success' or anonymous_write.get('status')=='success':
            raise RuntimeError('unauthorized channel mutation was accepted')
        _,created=call('mutation','channels:createChannel',channel,token('owner-a'))
        if created.get('status')!='success':raise RuntimeError('channel create failed: '+str(created.get('errorMessage','unknown'))[:1000])
        _,before=query(token('owner-a'),'owner-a')
        process.terminate();process.wait(timeout=15);process=start()
        _,after=query(token('owner-a'),'owner-a')
        passed=before.get('status')=='success' and after.get('status')=='success' and before.get('value')==after.get('value') and len(after.get('value',[]))==1
        print(json.dumps({'realChannelCreate':'passed','restartPersistence':passed}),flush=True)
        if not passed:raise RuntimeError('real channel persistence failed')
        # Exercise the actual import mutation in another empty owner namespace.
        owner='owner-import'
        base={**channel,'ownerId':owner,'_id':'source-base','_creationTime':123,'slug':'base','status':'active',
              'schedule':{'frequency':'weekly','enabled':True,'localTime':'14:00'},'scriptPlaybook':{'fixture':'retained'}}
        sibling={**base,'_id':'source-sibling','slug':'sibling','groupId':'source-base'}
        imported_args={'ownerId':owner,'sourceFileSha256':'a'*64,'channels':[base,sibling]}
        _,denied=call('mutation','channelImport:importBaseline',imported_args,token('owner-a'))
        if denied.get('status')=='success': raise RuntimeError('cross-owner channel import accepted')
        _,result=call('mutation','channelImport:importBaseline',imported_args,token(owner))
        if result.get('status')!='success':raise RuntimeError('channel import failed: '+str(result.get('errorMessage','unknown'))[:1000])
        _,replay=call('mutation','channelImport:importBaseline',imported_args,token(owner))
        _,readback=query(token(owner),owner)
        rows=readback.get('value',[]); byslug={row['slug']:row for row in rows}
        if (replay.get('value',{}).get('reused') is not True or len(rows)!=2 or
            byslug['base']['status']!='paused' or byslug['base']['schedule']['enabled'] is not False or
            byslug['base']['scriptPlaybook']!={'fixture':'retained'} or
            byslug['sibling'].get('groupId')!=byslug['base']['_id']):
            raise RuntimeError('channel import readback, group remapping, pause, or replay failed: '+str({'replayStatus':replay.get('status'),'replayError':replay.get('errorMessage'),'count':len(rows),'slugs':list(byslug)}))
        _,conflict=call('mutation','channelImport:importBaseline',{**imported_args,'sourceFileSha256':'b'*64},token(owner))
        if conflict.get('status')=='success':raise RuntimeError('different channel baseline unexpectedly overwrote the import')
        changed=[{**base,'name':'changed'},sibling]
        _,conflict=call('mutation','channelImport:importBaseline',{**imported_args,'channels':changed},token(owner))
        if conflict.get('status')=='success':raise RuntimeError('different channel content with same file hash was accepted')
        occupied={**base,'ownerId':'owner-a'}
        _,conflict=call('mutation','channelImport:importBaseline',{'ownerId':'owner-a','sourceFileSha256':'c'*64,'channels':[occupied]},token('owner-a'))
        if conflict.get('status')=='success':raise RuntimeError('nonempty destination was overwritten')
        print('local baseline import, replay, owner isolation, group mapping and paused schedules: passed',flush=True)
        if baseline is not None:
            owner=baseline['ownerId']; sources=baseline['channels']
            imported_args={'ownerId':owner,'sourceFileSha256':options.baseline_sha256,'channels':sources}
            _,result=call('mutation','channelImport:importBaseline',imported_args,token(owner))
            if result.get('status')!='success':raise RuntimeError('captured baseline import failed: '+str(result.get('errorMessage','unknown'))[:1000])
            mapping={entry['sourceId']:entry['channelId'] for entry in result['value']['mappings']}
            _,readback=query(token(owner),owner);rows=readback.get('value',[])
            if len(rows)!=len(sources) or len(mapping)!=len(sources):raise RuntimeError('captured baseline count mismatch')
            byid={row['_id']:row for row in rows}
            for source in sources:
                expected={**source,'status':'paused'}
                expected.pop('_id');expected.pop('_creationTime')
                if 'schedule' in expected:expected['schedule']={**expected['schedule'],'enabled':False}
                if 'groupId' in expected:expected['groupId']=mapping[expected['groupId']]
                actual=dict(byid[mapping[source['_id']]]);actual.pop('_id');actual.pop('_creationTime')
                if actual!=expected:raise RuntimeError('captured channel readback differs from expected paused settings')
            process.terminate();process.wait(timeout=15);process=start()
            _,after=query(token(owner),owner)
            if after.get('status')!='success' or after.get('value')!=rows:raise RuntimeError('imported channels changed after restart')
            import_env=env.copy()
            import_env.update({'CONVEX_URL':f'http://127.0.0.1:{api}',
                'STUDIO_CONVEX_JWT_PRIVATE_KEY':key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode(),
                'STUDIO_CONVEX_ISSUER':issuer,'STUDIO_CONVEX_AUDIENCE':'youtube-automation-local'})
            invoked=subprocess.run([str(repo/'node_modules/.bin/tsx'),'scripts/import-channel-baseline.ts','--import',options.baseline,options.baseline_sha256],cwd=repo,env=import_env,capture_output=True,text=True,timeout=30)
            if invoked.returncode: raise RuntimeError('local import command failed its replay/readback')
            cli_result=json.loads(invoked.stdout)
            if cli_result.get('reused') is not True or cli_result.get('verifiedChannels')!=len(rows):raise RuntimeError('import command replay/readback mismatch')
            if 'folderMetadata' in baseline:
                command=[str(repo/'node_modules/.bin/tsx'),'scripts/import-channel-folders.ts','--import',options.baseline,options.baseline_sha256]
                for _ in range(2):
                    invoked=subprocess.run(command,cwd=repo,env=import_env,capture_output=True,text=True,timeout=30)
                    if invoked.returncode:raise RuntimeError('local room import failed')
                    if json.loads(invoked.stdout).get('verifiedRooms')!=len(baseline['folderMetadata']):raise RuntimeError('room import count mismatch')
                print('captured channel rooms imported and replayed without duplicates',flush=True)
            print(json.dumps({'capturedBaselineChannelsVerified':len(rows),'groupRemapping':'verified','schedules':'paused','restartAndImportCommand':'passed'}),flush=True)
    finally:
        process.terminate()
        try:process.wait(timeout=15)
        except subprocess.TimeoutExpired:process.kill();process.wait()
        http.shutdown()
