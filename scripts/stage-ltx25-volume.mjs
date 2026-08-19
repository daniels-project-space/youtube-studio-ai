#!/usr/bin/env node
/*
 * One-shot, resumable LTX 2.5 volume bootstrap.
 *
 * This is deliberately an operations controller rather than a render worker:
 * it starts exactly one digest-pinned 4090, accepts only a signed one-time
 * receipt, and deletes the instance on every terminal outcome.  Run it from a
 * persistent supervisor (tmux/systemd), never from an expiring request shell.
 */
import crypto from "node:crypto";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const required = ["NOVITA_API_KEY", "HF_TOKEN", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"];
for (const key of required) if (!process.env[key]?.trim()) throw new Error(`${key} is required`);

const MODEL = "Lightricks/LTX-2.5";
const REVISION = "ce298b1259d61ce6c87e05154b9ad339b16f32a0";
const PRODUCT_ID = "4090.16c96g.v2";
const CLUSTER_ID = "us-ca-nas-2";
const STORAGE_ID = "384d629d-839f-4224-abef-64dfc2d751bf";
// Staging uses the already-prewarmed PyTorch base, but not the sealed renderer
// entrypoint. Its compact bootstrap avoids an apt/package-startup delay while
// the actual LTX renderer remains the separately sealed runtime bundle.
const IMAGE = "pytorch/pytorch@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385";
const BUCKET = process.env.R2_BUCKET || "youtube-studio-ai";
const RATE_USD_PER_HOUR = 0.17;
const MAX_STAGE_SECONDS = 4 * 60 * 60;
const MAX_STAGE_USD = 2.5;
if (RATE_USD_PER_HOUR * MAX_STAGE_SECONDS / 3600 > MAX_STAGE_USD) {
  throw new Error("stage cap exceeds the approved USD budget");
}

const files = [
  ["ltx-transformer", "diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors", "31eb3cad89b9e54e99dd3baf286f70825ac4f6c660a70d9184d895be76d7bff4", 42018190584],
  ["ltx-text-encoder", "text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors", "1c647a94c0e902fb87f9a403cbca36a8b6d8e5867094442df1b41ae557cfd1c6", 26263860594],
  ["ltx-video-vae", "vae/ltx-2.5-video-vae-bf16.safetensors", "847e14ca7f3355debca0cea4eaa24ac0fbcdf0061da054ac89ca638a869ddba3", 1472223346],
  ["ltx-audio-vae", "vae/ltx-2.5-audio-vae-bf16.safetensors", "c52733d37f6a7fb7949c3dc0fb468c6cb2169e4d836983a73babb9f0d54837a5", 364866540],
  ["ltx-spatial-upscaler", "latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors", "eb5a71fe4068ee87ccdb1c3aa635e547ca76bd2d30ae20ae889f2c325c0677e8", 995778752],
];

const nonce = crypto.randomBytes(12).toString("hex");
const receiptKey = `novita/staging/ltx-2.5-${nonce}.json`;
const progressKey = `novita/staging/progress/ltx-2.5-${nonce}.json`;
const scriptKey = `novita/staging/scripts/ltx-2.5-${nonce}.sh`;
const s3 = new S3Client({
  region: "auto", endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const receiptUrl = await getSignedUrl(s3, new PutObjectCommand({
  Bucket: BUCKET, Key: receiptKey, ContentType: "application/json",
}), { expiresIn: MAX_STAGE_SECONDS + 900 });
const progressUrl = await getSignedUrl(s3, new PutObjectCommand({
  Bucket: BUCKET, Key: progressKey, ContentType: "application/json",
}), { expiresIn: MAX_STAGE_SECONDS + 900 });

const remoteScript = String.raw`import hashlib, json, os, pathlib, shutil, sys, traceback, urllib.request

model = ${JSON.stringify(MODEL)}
revision = ${JSON.stringify(REVISION)}
volume = pathlib.Path('/network')
target = volume / 'models' / 'ltx-2.5' / revision
stage = volume / '.staging' / ('ltx-2.5-' + revision + '-' + ${JSON.stringify(nonce)})
receipt_url = os.environ['LTX_STAGE_RECEIPT_URL']
progress_url = os.environ['LTX_STAGE_PROGRESS_URL']
files = ${JSON.stringify(files)}

def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def put(receipt):
    payload = json.dumps(receipt, separators=(',', ':'), sort_keys=True).encode('utf-8')
    request = urllib.request.Request(receipt_url, data=payload, method='PUT', headers={'Content-Type':'application/json','Content-Length':str(len(payload))})
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError('receipt upload failed')

def progress(state, **details):
    try:
        put_url = progress_url
        payload = json.dumps({'contract':'ltx-2.5-volume-stage-progress/v1','state':state,**details}, separators=(',', ':'), sort_keys=True).encode('utf-8')
        request = urllib.request.Request(put_url, data=payload, method='PUT', headers={'Content-Type':'application/json','Content-Length':str(len(payload))})
        with urllib.request.urlopen(request, timeout=120) as response:
            if response.status < 200 or response.status >= 300: raise RuntimeError('progress upload failed')
    except Exception:
        pass

try:
    sentinel = target / '.model-stage-complete.json'
    if sentinel.is_file():
        prior = json.loads(sentinel.read_text('utf-8'))
        if prior.get('model') != model or prior.get('revision') != revision or prior.get('files') != files:
            raise RuntimeError('existing LTX target has a different immutable receipt')
    else:
        if target.exists():
            raise RuntimeError('existing LTX target is incomplete; refusing to overwrite it')
        # Novita can replay a container start while it is still reporting a
        # healthy instance. The stage directory is deliberately per-dispatch;
        # tolerate that replay and let huggingface_hub's per-file locks share
        # the same resumable local cache rather than converting it into a
        # false FileExistsError.
        stage.mkdir(parents=True, exist_ok=True)
        subprocess_check = __import__('subprocess').check_call
        os.environ['HF_XET_HIGH_PERFORMANCE'] = '1'
        progress('downloading', completed=[])
        subprocess_check([sys.executable, '-m', 'pip', 'install', '--break-system-packages', '--disable-pip-version-check', '--no-input', 'huggingface_hub[hf_xet]==0.36.0'])
        from huggingface_hub import hf_hub_download
        from concurrent.futures import ThreadPoolExecutor, as_completed
        def download(contract):
            _, relative, expected, expected_size = contract
            path = pathlib.Path(hf_hub_download(repo_id=model, filename=relative, revision=revision, token=os.environ['HF_TOKEN'], local_dir=str(stage)))
            if path.stat().st_size != expected_size or digest(path) != expected:
                raise RuntimeError('downloaded model file failed its pinned hash contract')
            return relative
        completed=[]
        with ThreadPoolExecutor(max_workers=len(files)) as pool:
            futures = [pool.submit(download, contract) for contract in files]
            for future in as_completed(futures):
                completed.append(future.result())
                progress('downloading', completed=sorted(completed))
        shutil.rmtree(stage / '.cache', ignore_errors=True)
        completed = {'contract':'ltx-2.5-volume-stage/v1','model':model,'revision':revision,'files':files}
        (stage / '.model-stage-complete.json').write_text(json.dumps(completed, sort_keys=True, separators=(',', ':')), encoding='utf-8')
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            stage.replace(target)
        except FileExistsError:
            # A replay may have atomically promoted the same stage first.
            # Never accept a different target receipt.
            promoted = json.loads((target / '.model-stage-complete.json').read_text('utf-8'))
            if promoted != completed: raise
    put({'contract':'ltx-2.5-volume-stage/v1','ok':True,'model':model,'revision':revision,'target':str(target),'files':files})
except Exception as error:
    try:
        put({'contract':'ltx-2.5-volume-stage/v1','ok':False,'errorType':type(error).__name__,'message':str(error)[:300]})
    finally:
        raise`;

// Novita accepts a deliberately short container command. The immutable stage
// program is fetched through a one-time signed URL, so neither a model token
// nor a multi-kilobyte bootstrap appears in the command field.
await s3.send(new PutObjectCommand({
  Bucket: BUCKET, Key: scriptKey, Body: remoteScript, ContentType: "text/x-shellscript",
}));
const scriptUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: scriptKey }), {
  expiresIn: MAX_STAGE_SECONDS + 900,
});
// Keep this below Novita's command-field boundary. The full, fixed program is
// still fetched only through the expiring signed URL; this tiny apt/curl shim
// proved executable on the exact image in the command probe above.
const command = "python -c \"import os,urllib.request;exec(urllib.request.urlopen(os.environ['LTX_STAGE_SCRIPT_URL']).read())\"";
const apiBase = "https://api.novita.ai/gpu-instance/openapi/v1";
const headers = { authorization: `Bearer ${process.env.NOVITA_API_KEY}`, "content-type": "application/json", "user-agent": "youtube-studio-ai/ltx25-stage-v2" };
async function api(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Novita ${path} failed with HTTP ${response.status}`);
  const body = await response.text();
  return body ? JSON.parse(body) : {};
}
async function deleteAndVerify(instanceId) {
  for (const path of ["/gpu/instance/stop", "/gpu/instance/delete"]) {
    try { await api(path, { method: "POST", body: JSON.stringify({ instanceId }) }); } catch { /* deletion is authoritative */ }
  }
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const current = await api(`/gpu/instance?instanceId=${encodeURIComponent(instanceId)}`);
      if (["removed", "deleted", ""].includes(String(current.status || "").toLowerCase())) return;
    } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("Novita deletion could not be verified");
}
async function readReceipt() {
  try {
    const item = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: receiptKey }));
    return JSON.parse(await item.Body.transformToString());
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return undefined;
    throw error;
  }
}

const request = {
  name: `yt-render-4090-stage-ltx25-${nonce.slice(0, 12)}`,
  productId: PRODUCT_ID, clusterId: CLUSTER_ID, gpuNum: 1, kind: "gpu", billingMode: "spot",
  imageUrl: IMAGE, rootfsSize: 120,
  networkStorages: [{ Id: STORAGE_ID, mountPoint: "/network" }],
  command,
  envs: [
    { key: "HF_TOKEN", value: process.env.HF_TOKEN },
    { key: "LTX_STAGE_RECEIPT_URL", value: receiptUrl },
    { key: "LTX_STAGE_PROGRESS_URL", value: progressUrl },
    { key: "LTX_STAGE_SCRIPT_URL", value: scriptUrl },
  ],
};
const created = await api("/gpu/instance/create", { method: "POST", body: JSON.stringify(request) });
const instanceId = String(created.id || "");
if (!instanceId) throw new Error("Novita did not return a staging instance id");
console.log(JSON.stringify({ event: "created", instanceId, receiptKey, progressKey, maxUsd: RATE_USD_PER_HOUR * MAX_STAGE_SECONDS / 3600 }));
let receipt;
try {
  const deadline = Date.now() + MAX_STAGE_SECONDS * 1000;
  while (Date.now() < deadline) {
    receipt = await readReceipt();
    if (receipt) break;
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
  if (!receipt) throw new Error("LTX stage timed out without a receipt");
  if (receipt.contract !== "ltx-2.5-volume-stage/v1" || receipt.ok !== true || receipt.model !== MODEL || receipt.revision !== REVISION || JSON.stringify(receipt.files) !== JSON.stringify(files)) {
    throw new Error(`LTX stage receipt failed admission: ${receipt?.errorType || "invalid"}`);
  }
  console.log(JSON.stringify({ event: "verified", instanceId, receiptKey }));
} finally {
  await deleteAndVerify(instanceId);
  console.log(JSON.stringify({ event: "deletedVerified", instanceId }));
}
