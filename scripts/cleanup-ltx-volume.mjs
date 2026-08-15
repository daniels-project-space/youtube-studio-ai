#!/usr/bin/env node
import crypto from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

for (const key of ["NOVITA_API_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"]) if (!process.env[key]) throw new Error(`${key} is required`);
const nonce = crypto.randomBytes(12).toString("hex");
const bucket = process.env.R2_BUCKET || "youtube-studio-ai";
const receiptKey = `novita/cleanup/ltx-volume-${nonce}.json`;
const scriptKey = `novita/cleanup/scripts/ltx-volume-${nonce}.py`;
const s3 = new S3Client({region:"auto",endpoint:process.env.R2_ENDPOINT,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}});
const script = String.raw`import json,os,pathlib,shutil,urllib.request
root=pathlib.Path('/network').resolve()
targets=[root/'ckpts']+sorted((root/'.staging').glob('ltx-2.5-*'))
removed=[]
for path in targets:
  if not path.exists(): continue
  resolved=path.resolve()
  if resolved == root/'loras' or not str(resolved).startswith(str(root)+'/'): raise RuntimeError('unsafe cleanup target')
  if resolved.name != 'ckpts' and not (resolved.parent == root/'.staging' and resolved.name.startswith('ltx-2.5-')): raise RuntimeError('unexpected cleanup target')
  shutil.rmtree(resolved)
  removed.append(str(resolved))
payload=json.dumps({'contract':'ltx-volume-cleanup/v1','ok':True,'removed':removed,'preserved':['/network/loras','/network/models/z-image']},separators=(',',':')).encode()
request=urllib.request.Request(os.environ['CLEANUP_RECEIPT_URL'],data=payload,method='PUT',headers={'Content-Type':'application/json','Content-Length':str(len(payload))})
urllib.request.urlopen(request,timeout=120).read()`;
await s3.send(new PutObjectCommand({Bucket:bucket,Key:scriptKey,Body:script,ContentType:"text/x-python"}));
const [scriptUrl, receiptUrl] = await Promise.all([
  getSignedUrl(s3,new GetObjectCommand({Bucket:bucket,Key:scriptKey}),{expiresIn:1800}),
  getSignedUrl(s3,new PutObjectCommand({Bucket:bucket,Key:receiptKey,ContentType:"application/json"}),{expiresIn:1800}),
]);
const base="https://api.novita.ai/gpu-instance/openapi/v1";
const headers={authorization:`Bearer ${process.env.NOVITA_API_KEY}`,"content-type":"application/json","user-agent":"youtube-studio-ai/ltx-cleanup"};
const req=async(path,init={})=>{const r=await fetch(base+path,{...init,headers:{...headers,...(init.headers||{})}});if(!r.ok)throw new Error(`Novita ${path} ${r.status}`);const t=await r.text();return t?JSON.parse(t):{}};
const created=await req('/gpu/instance/create',{method:'POST',body:JSON.stringify({name:`yt-render-4090-cleanup-ltx-${nonce.slice(0,12)}`,productId:'4090.16c96g.v2',clusterId:'us-ca-nas-2',gpuNum:1,kind:'gpu',billingMode:'spot',imageUrl:'pytorch/pytorch@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385',rootfsSize:120,networkStorages:[{Id:'384d629d-839f-4224-abef-64dfc2d751bf',mountPoint:'/network'}],command:"python -c \"import os,urllib.request;exec(urllib.request.urlopen(os.environ['CLEANUP_SCRIPT_URL']).read())\"",envs:[{key:'CLEANUP_SCRIPT_URL',value:scriptUrl},{key:'CLEANUP_RECEIPT_URL',value:receiptUrl}]})});
const id=String(created.id||''); if(!id)throw new Error('no cleanup worker id');
try { let receipt; for(let i=0;i<60;i++){try{const o=await s3.send(new GetObjectCommand({Bucket:bucket,Key:receiptKey}));receipt=JSON.parse(await o.Body.transformToString());break;}catch(error){if(error?.$metadata?.httpStatusCode!==404)throw error;}await new Promise(r=>setTimeout(r,5000));} if(!receipt?.ok)throw new Error('cleanup receipt missing or invalid'); console.log(JSON.stringify(receipt)); }
finally {
  for (const p of ['/gpu/instance/stop','/gpu/instance/delete']) try { await req(p,{method:'POST',body:JSON.stringify({instanceId:id})}); } catch {}
  let deleted=false;
  for (let i=0;i<24;i++) {
    try {
      const current=await req(`/gpu/instance?instanceId=${encodeURIComponent(id)}`);
      const status=String(current?.status||current?.data?.status||'').toLowerCase();
      if (['deleted','removed','terminated'].includes(status)) { deleted=true; break; }
    } catch { deleted=true; break; }
    await new Promise(r=>setTimeout(r,5000));
  }
  if (!deleted) throw new Error(`cleanup worker ${id} was not confirmed deleted`);
  console.log(JSON.stringify({event:'cleanup_worker_deleted',instanceId:id}));
}
