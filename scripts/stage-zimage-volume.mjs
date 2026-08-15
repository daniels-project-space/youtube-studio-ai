#!/usr/bin/env node
/**
 * Fetch the pinned Z-Image tree into the managed volume and write the exact
 * tree hash manifest consumed by the sealed Novita worker.  It never touches
 * arbitrary legacy Z-Image folders and deletes its RTX 4090 on every exit.
 */
import crypto from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MODEL = "Tongyi-MAI/Z-Image-Turbo";
const REVISION = "f332072aa78be7aecdf3ee76d5c247082da564a6";
const PRODUCT_ID = "4090.16c96g.v2";
const CLUSTER_ID = "us-ca-nas-2";
const VOLUME_ID = "384d629d-839f-4224-abef-64dfc2d751bf";
const IMAGE = "pytorch/pytorch@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385";
const RATE_USD_PER_HOUR = 0.17;
const MAX_STAGE_SECONDS = 4 * 60 * 60;
const MAX_STAGE_USD = 0.68;
const API = "https://api.novita.ai/gpu-instance/openapi/v1";
for (const key of ["NOVITA_API_KEY", "HF_TOKEN", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"]) {
  if (!process.env[key]?.trim()) throw new Error(`${key} is required`);
}
if (RATE_USD_PER_HOUR * MAX_STAGE_SECONDS / 3_600 > MAX_STAGE_USD) {
  throw new Error("Z-Image stage cap exceeds the approved shared $3 budget");
}
const bucket = process.env.R2_BUCKET || "youtube-studio-ai";
const nonce = crypto.randomBytes(12).toString("hex");
const receiptKey = `novita/staging/z-image-${nonce}.json`;
const scriptKey = `novita/staging/scripts/z-image-${nonce}.py`;
const s3 = new S3Client({
  region: "auto", endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const headers = { authorization: `Bearer ${process.env.NOVITA_API_KEY}`, "content-type": "application/json", "user-agent": "youtube-studio-ai/zimage-stage" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function novita(path, init = {}) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Novita ${path.split("?")[0]} failed with HTTP ${response.status}`);
  const body = await response.text();
  return body ? JSON.parse(body) : {};
}

async function getReceipt() {
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: receiptKey }));
    return JSON.parse(await object.Body.transformToString());
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return undefined;
    throw error;
  }
}

async function deleteAndVerify(instanceId) {
  for (const path of ["/gpu/instance/stop", "/gpu/instance/delete"]) {
    try { await novita(path, { method: "POST", body: JSON.stringify({ instanceId }) }); } catch { /* idempotent teardown */ }
  }
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const current = await novita(`/gpu/instance?instanceId=${encodeURIComponent(instanceId)}`);
      if (["", "deleted", "removed", "terminated"].includes(String(current?.status || current?.data?.status || "").toLowerCase())) return;
    } catch { return; }
    await sleep(5_000);
  }
  throw new Error("Z-Image staging worker deletion could not be verified");
}

const receiptUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: receiptKey, ContentType: "application/json" }), { expiresIn: MAX_STAGE_SECONDS + 900 });
const script = String.raw`import hashlib,json,os,pathlib,shutil,sys,traceback,urllib.request
model=${JSON.stringify(MODEL)}
revision=${JSON.stringify(REVISION)}
root=pathlib.Path('/network')
target=root/'models'/'z-image'
stage=root/'.staging'/('z-image-'+revision+'-'+${JSON.stringify(nonce)})
def digest(path):
  h=hashlib.sha256()
  with path.open('rb') as source:
    for chunk in iter(lambda:source.read(8*1024*1024),b''): h.update(chunk)
  return h.hexdigest()
def put(value):
  body=json.dumps(value,separators=(',',':'),sort_keys=True).encode()
  request=urllib.request.Request(os.environ['ZIMAGE_STAGE_RECEIPT_URL'],data=body,method='PUT',headers={'Content-Type':'application/json','Content-Length':str(len(body))})
  urllib.request.urlopen(request,timeout=120).read()
try:
  if target.exists():
    manifest_path=target/'.model-manifest.json'
    if not manifest_path.is_file(): raise RuntimeError('managed Z-Image target exists without a verified tree manifest')
    manifest=json.loads(manifest_path.read_text())
    if manifest.get('model')!=model or manifest.get('revision')!=revision: raise RuntimeError('managed Z-Image target pin differs')
  else:
    stat=os.statvfs(root)
    if stat.f_bavail*stat.f_frsize < 35*1024**3: raise RuntimeError('managed volume has less than 35 GiB free for the pinned Z-Image tree')
    stage.mkdir(parents=True,exist_ok=True)
    __import__('subprocess').check_call([sys.executable,'-m','pip','install','--break-system-packages','--disable-pip-version-check','--no-input','huggingface_hub[hf_xet]==0.36.0'])
    os.environ['HF_XET_HIGH_PERFORMANCE']='1'
    from huggingface_hub import snapshot_download
    snapshot_download(repo_id=model,revision=revision,token=os.environ['HF_TOKEN'],local_dir=str(stage))
    shutil.rmtree(stage/'.cache',ignore_errors=True)
    files=[]
    for path in sorted(stage.rglob('*')):
      if path.is_file() and path.name!='.model-manifest.json':
        relative=path.relative_to(stage).as_posix()
        files.append({'path':relative,'sha256':digest(path),'sizeBytes':path.stat().st_size})
    if not files: raise RuntimeError('pinned Z-Image snapshot is empty')
    manifest={'contract':'z-image-volume-tree/v1','model':model,'revision':revision,'files':files}
    (stage/'.model-manifest.json').write_text(json.dumps(manifest,separators=(',',':'),sort_keys=True),encoding='utf-8')
    target.parent.mkdir(parents=True,exist_ok=True)
    stage.replace(target)
  manifest=json.loads((target/'.model-manifest.json').read_text())
  canonical=json.dumps(manifest,separators=(',',':'),sort_keys=True).encode()
  put({'contract':'z-image-volume-stage/v1','ok':True,'model':model,'revision':revision,'target':str(target),'manifestSha256':hashlib.sha256(canonical).hexdigest(),'fileCount':len(manifest.get('files',[]))})
except Exception as error:
  try: put({'contract':'z-image-volume-stage/v1','ok':False,'errorType':type(error).__name__,'message':str(error)[:300]})
  finally: raise`;
await s3.send(new PutObjectCommand({ Bucket: bucket, Key: scriptKey, Body: script, ContentType: "text/x-python" }));
const scriptUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: scriptKey }), { expiresIn: MAX_STAGE_SECONDS + 900 });
const created = await novita("/gpu/instance/create", {
  method: "POST",
  body: JSON.stringify({
    name: `yt-render-4090-stage-zimage-${nonce.slice(0, 12)}`,
    productId: PRODUCT_ID, clusterId: CLUSTER_ID, gpuNum: 1, kind: "gpu", billingMode: "spot", imageUrl: IMAGE,
    rootfsSize: 120, networkStorages: [{ Id: VOLUME_ID, mountPoint: "/network" }],
    command: "python -c \"import os,urllib.request;exec(urllib.request.urlopen(os.environ['ZIMAGE_STAGE_SCRIPT_URL']).read())\"",
    envs: [
      { key: "ZIMAGE_STAGE_SCRIPT_URL", value: scriptUrl }, { key: "ZIMAGE_STAGE_RECEIPT_URL", value: receiptUrl },
      { key: "HF_TOKEN", value: process.env.HF_TOKEN },
    ],
  }),
});
const instanceId = String(created.id || "");
if (!instanceId) throw new Error("Novita did not return a Z-Image staging worker identity");
console.log(JSON.stringify({ event: "created", instanceId, receiptKey, maxUsd: MAX_STAGE_USD }));
try {
  let receipt;
  for (let attempt = 0; attempt < MAX_STAGE_SECONDS / 5; attempt += 1) {
    receipt = await getReceipt();
    if (receipt) break;
    await sleep(5_000);
  }
  if (!receipt?.ok) throw new Error(`Z-Image stage failed: ${String(receipt?.message || "missing receipt")}`);
  console.log(JSON.stringify({ event: "verified", instanceId, receiptKey, manifestSha256: receipt.manifestSha256, fileCount: receipt.fileCount }));
} finally {
  await deleteAndVerify(instanceId);
  console.log(JSON.stringify({ event: "deletedVerified", instanceId }));
}
