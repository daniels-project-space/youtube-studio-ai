#!/usr/bin/env node
/**
 * Audit the persistent Novita volume before removing only proven-obsolete LTX
 * assets.  `--apply` is deliberately separate from the default inventory run.
 */
import crypto from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

for (const key of ["NOVITA_API_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"]) {
  if (!process.env[key]) throw new Error(`${key} is required`);
}
const unexpectedArgs = process.argv.slice(2).filter((arg) => arg !== "--apply");
if (unexpectedArgs.length) throw new Error("usage: node scripts/cleanup-ltx-volume.mjs [--apply]");
const apply = process.argv.includes("--apply");
const nonce = crypto.randomBytes(12).toString("hex");
const bucket = process.env.R2_BUCKET || "youtube-studio-ai";
const receiptKey = `novita/cleanup/ltx-volume-${nonce}.json`;
const scriptKey = `novita/cleanup/scripts/ltx-volume-${nonce}.py`;
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const script = String.raw`import json,os,pathlib,shutil,subprocess,urllib.request
root=pathlib.Path('/network').resolve()
apply=${apply ? "True" : "False"}
def disk_rows():
  output=subprocess.run(['du','-x','-B1','-d','2',str(root)],check=True,text=True,capture_output=True).stdout
  rows=[]
  for line in output.splitlines():
    size,sep,path=line.partition(chr(9))
    if not sep: continue
    candidate=pathlib.Path(path)
    try: relative=str(candidate.resolve().relative_to(root)) or '.'
    except ValueError: continue
    rows.append({'path':'/network' if relative=='.' else '/network/'+relative,'bytes':int(size)})
  return sorted(rows,key=lambda row:row['bytes'],reverse=True)[:100]
def candidate_rows(rows):
  candidates=[]
  for row in rows:
    relative=pathlib.PurePosixPath(row['path']).relative_to('/network')
    pieces=[part.lower() for part in relative.parts]
    reason=None
    if any('ltx-2.3' in part or 'ltx23' in part for part in pieces): reason='obsolete_ltx_2_3'
    if len(pieces)==2 and pieces[0]=='.staging' and pieces[1].startswith('ltx-2.5-'): reason='abandoned_ltx_2_5_stage'
    if reason: candidates.append({**row,'reason':reason})
  return candidates
usage=shutil.disk_usage(root)
rows=disk_rows()
candidates=candidate_rows(rows)
removed=[]
if apply:
  for candidate in candidates:
    target=(root/pathlib.PurePosixPath(candidate['path']).relative_to('/network')).resolve()
    if root not in target.parents or target==root: raise RuntimeError('unsafe cleanup target')
    if target.exists():
      shutil.rmtree(target)
      removed.append(str(target))
  usage=shutil.disk_usage(root)
  rows=disk_rows()
payload=json.dumps({
  'contract':'ltx-volume-inventory/v2','ok':True,'apply':apply,
  'disk':{'total':usage.total,'used':usage.used,'free':usage.free},
  'largest':rows,'candidates':candidates,'removed':removed,
  'preserved':['/network/loras','/network/models/z-image','/network/runtime/ltx-2.5-*'],
},separators=(',',':')).encode()
request=urllib.request.Request(os.environ['VOLUME_RECEIPT_URL'],data=payload,method='PUT',headers={'Content-Type':'application/json','Content-Length':str(len(payload))})
urllib.request.urlopen(request,timeout=120).read()`;

await s3.send(new PutObjectCommand({ Bucket: bucket, Key: scriptKey, Body: script, ContentType: "text/x-python" }));
const [scriptUrl, receiptUrl] = await Promise.all([
  getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: scriptKey }), { expiresIn: 1_800 }),
  getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: receiptKey, ContentType: "application/json" }), { expiresIn: 1_800 }),
]);
const base = "https://api.novita.ai/gpu-instance/openapi/v1";
const headers = { authorization: `Bearer ${process.env.NOVITA_API_KEY}`, "content-type": "application/json", "user-agent": "youtube-studio-ai/ltx-volume" };
const request = async (path, init = {}) => {
  const response = await fetch(base + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`Novita ${path} ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
};
const created = await request("/gpu/instance/create", {
  method: "POST",
  body: JSON.stringify({
    name: `yt-render-4090-${apply ? "cleanup" : "audit"}-ltx-${nonce.slice(0, 12)}`,
    productId: "4090.16c96g.v2",
    clusterId: "us-ca-nas-2",
    gpuNum: 1,
    kind: "gpu",
    billingMode: "spot",
    imageUrl: "pytorch/pytorch@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385",
    rootfsSize: 120,
    networkStorages: [{ Id: "384d629d-839f-4224-abef-64dfc2d751bf", mountPoint: "/network" }],
    command: "python -c \"import os,urllib.request;exec(urllib.request.urlopen(os.environ['VOLUME_SCRIPT_URL']).read())\"",
    envs: [{ key: "VOLUME_SCRIPT_URL", value: scriptUrl }, { key: "VOLUME_RECEIPT_URL", value: receiptUrl }],
  }),
});
const createdData = created?.data && typeof created.data === "object" ? created.data : created;
const instanceId = String(createdData?.id || "");
if (!instanceId) throw new Error("Novita did not return a volume worker identity");
try {
  let receipt;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: receiptKey }));
      receipt = JSON.parse(await object.Body.transformToString());
      break;
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (!receipt?.ok) throw new Error("volume inventory receipt missing or invalid");
  console.log(JSON.stringify(receipt));
} finally {
  for (const path of ["/gpu/instance/stop", "/gpu/instance/delete"]) {
    try { await request(path, { method: "POST", body: JSON.stringify({ instanceId }) }); } catch { /* deletion is idempotent */ }
  }
  let deleted = false;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const current = await request(`/gpu/instance?instanceId=${encodeURIComponent(instanceId)}`);
      const status = String(current?.status || current?.data?.status || "").toLowerCase();
      if (["deleted", "removed", "terminated"].includes(status)) { deleted = true; break; }
    } catch { deleted = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (!deleted) throw new Error("volume worker deletion could not be verified");
  console.log(JSON.stringify({ event: "volume_worker_deleted" }));
}
