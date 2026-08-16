#!/usr/bin/env node
/**
 * Produce three real, small LTX 2.5 I2V benchmark clips without opening the
 * channel renderer to unbenchmarked paid work.  It is intentionally an
 * operator-only proof: each worker gets a sealed manifest, starts only after
 * the preceding evidence is complete, and is deleted before the next phase.
 *
 * Usage (with secrets supplied only by the vault wrapper):
 *   node scripts/run-ltx25-benchmark.mjs <admitted-ltx-model-manifest-key>
 */
import crypto from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const LTX_MODEL = "Lightricks/LTX-2.5";
const LTX_REVISION = "ce298b1259d61ce6c87e05154b9ad339b16f32a0";
const ZIMAGE_MODEL = "Tongyi-MAI/Z-Image-Turbo";
const ZIMAGE_REVISION = "f332072aa78be7aecdf3ee76d5c247082da564a6";
const PRODUCT_ID = "4090.16c96g.v2";
const CLUSTER_ID = "us-ca-nas-2";
const VOLUME_ID = "384d629d-839f-4224-abef-64dfc2d751bf";
const BASE_IMAGE = "pytorch/pytorch@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385";
const RUNTIME_BUNDLE_KEY = process.env.NOVITA_RUNTIME_BUNDLE_KEY
  || "novita/runtime/ltx-2.5/e2ffc92c14097acb14a28ba679ea6106d372259288e6ee16fa6490ea5933a377.tar.gz";
const RUNTIME_BUNDLE_SHA256 = process.env.NOVITA_RUNTIME_BUNDLE_SHA256
  || "e2ffc92c14097acb14a28ba679ea6106d372259288e6ee16fa6490ea5933a377";
const API = "https://api.novita.ai/gpu-instance/openapi/v1";
const STAGE_MAX_USD = 0.68;
const TOTAL_MAX_USD = 3;
const PROBE_MAX_SECONDS = 300;
const DEFAULT_PHASE_MAX_SECONDS = 6_600;
const URL_TTL_SECONDS = 10_800;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("benchmark manifest contains an undefined value");
  return encoded;
}

function sealManifest(unsigned) {
  if (!/^(image|video)-[a-f0-9]{32}$/.test(unsigned.manifestId || "")) {
    throw new Error("benchmark worker manifest identity is invalid");
  }
  return { ...unsigned, manifestSha256: crypto.createHash("sha256").update(canonicalJson(unsigned)).digest("hex") };
}

function buildWorkerRequest({ name, manifestUrl, manifestSha256, jobIds }) {
  if (!/^yt-render-[a-z0-9-]+$/.test(name) || !/^[a-f0-9]{64}$/.test(manifestSha256)) {
    throw new Error("benchmark worker identity is invalid");
  }
  return {
    name,
    productId: PRODUCT_ID,
    clusterId: CLUSTER_ID,
    gpuNum: 1,
    kind: "gpu",
    billingMode: "spot",
    imageUrl: BASE_IMAGE,
    command: "python -c \"import os,urllib.request;exec(urllib.request.urlopen(os.environ['NOVITA_RUNTIME_BOOTSTRAP_URL']).read())\"",
    rootfsSize: 120,
    networkStorages: [{ Id: VOLUME_ID, mountPoint: "/network" }],
    envs: [
      { key: "NOVITA_JOB_MANIFEST_URL", value: manifestUrl },
      { key: "NOVITA_MANIFEST_SHA256", value: manifestSha256 },
      { key: "NOVITA_MODEL_VOLUME", value: "/network" },
      { key: "NOVITA_LOCAL_MODEL_CACHE", value: "/workspace/model-cache" },
      { key: "NOVITA_RUNTIME_BUNDLE_URL", value: null },
      { key: "NOVITA_RUNTIME_BUNDLE_SHA256", value: RUNTIME_BUNDLE_SHA256 },
      { key: "NOVITA_RUNTIME_BOOTSTRAP_URL", value: null },
    ],
    __jobIds: jobIds,
  };
}

function runtimeBootstrapSource() {
  return String.raw`import fcntl,hashlib,os,pathlib,shutil,tarfile,tempfile,urllib.request
sha=os.environ['NOVITA_RUNTIME_BUNDLE_SHA256']
root=pathlib.Path('/network/runtime/ltx-2.5-'+sha)
compatibility=root/'.torch-cu118-2.7.1'
def runtime_ready():
  return (root/'.ready').is_file() and (root/'.ready').read_text().strip()==sha and compatibility.is_file() and compatibility.read_text().strip()=='torch==2.7.1+cu118'
def ensure_cuda_compatibility():
  if compatibility.is_file() and compatibility.read_text().strip()=='torch==2.7.1+cu118': return
  python=root/'opt/LTX-2/.venv/bin/python'
  if not python.is_file(): raise RuntimeError('portable Python is missing before CUDA compatibility install')
  import subprocess,sys
  subprocess.run([sys.executable,'-m','pip','install','--no-cache-dir','uv==0.10.6'],check=True,stdout=subprocess.DEVNULL)
  subprocess.run(['uv','pip','install','--python',str(python),'--reinstall','torch==2.7.1','torchvision==0.22.1','torchaudio==2.7.1','--index-url','https://download.pytorch.org/whl/cu118'],check=True,stdout=subprocess.DEVNULL)
  evidence=subprocess.check_output([str(python),'-c',"import torch;print(torch.__version__+'|'+str(torch.version.cuda)+'|'+str(torch.cuda.is_available()))"],text=True).strip()
  if evidence!='2.7.1+cu118|11.8|True': raise RuntimeError('CUDA-compatible Torch verification failed: '+evidence)
  compatibility.write_text('torch==2.7.1+cu118\\n')
def exec_worker():
  python=str(root/'opt/LTX-2/.venv/bin/python')
  os.execv(python,[python,str(root/'opt/novita-worker/worker.py')])
if runtime_ready(): exec_worker()
lock=root.with_name(root.name+'.lock')
lock.parent.mkdir(parents=True,exist_ok=True)
with lock.open('a+b') as handle:
  fcntl.flock(handle,fcntl.LOCK_EX)
  if runtime_ready(): exec_worker()
  if (root/'.ready').is_file() and (root/'.ready').read_text().strip()==sha:
    ensure_cuda_compatibility()
    exec_worker()
  if root.exists(): raise RuntimeError('runtime root exists without matching ready receipt')
  stage=pathlib.Path(tempfile.mkdtemp(prefix='.ltx-runtime-stage.',dir='/network/runtime'))
  try:
    archives=[item for item in pathlib.Path('/network/runtime').glob('.ltx-runtime-stage.*/runtime.tar.gz') if item.is_file()]
    bundle=max(archives,key=lambda item:item.stat().st_size,default=stage/'runtime.tar.gz')
    request=urllib.request.Request(os.environ['NOVITA_RUNTIME_BUNDLE_URL'],headers={'Range':'bytes=0-0'})
    with urllib.request.urlopen(request) as response:
      content_range=str(response.headers.get('Content-Range') or '')
    if '/' not in content_range: raise RuntimeError('runtime server does not support verified byte ranges')
    total=int(content_range.rsplit('/',1)[1])
    descriptor=os.open(bundle,os.O_RDWR|os.O_CREAT,0o600)
    try:
      os.ftruncate(descriptor,total)
      from concurrent.futures import ThreadPoolExecutor
      def fetch_range(start):
        end=min(total-1,start+32*1024*1024-1)
        request=urllib.request.Request(os.environ['NOVITA_RUNTIME_BUNDLE_URL'],headers={'Range':f'bytes={start}-{end}'})
        with urllib.request.urlopen(request) as response: payload=response.read()
        if len(payload)!=end-start+1: raise RuntimeError('runtime range length mismatch')
        os.pwrite(descriptor,payload,start)
      with ThreadPoolExecutor(max_workers=8) as pool: list(pool.map(fetch_range,range(0,total,32*1024*1024)))
    finally: os.close(descriptor)
    if hashlib.sha256(bundle.read_bytes()).hexdigest()!=sha: raise RuntimeError('runtime bundle SHA-256 mismatch')
    with tarfile.open(bundle,'r:gz') as archive:
      for member in archive.getmembers():
        target=(stage/member.name).resolve()
        if target!=stage and stage not in target.parents: raise RuntimeError('runtime archive path escapes staging root')
        if not (member.isdir() or member.isfile() or member.issym() or member.islnk()): raise RuntimeError('runtime archive has unsupported member type')
      for member in archive.getmembers(): archive.extract(member,stage)
    # The old sealed archive omitted uv's CPython installation although its
    # virtual environment points at it. Recreate only that pinned interpreter
    # inside this immutable runtime root, then relocate in-archive /opt links.
    for link in stage.rglob('*'):
      if not link.is_symlink(): continue
      destination=os.readlink(link)
      if not destination.startswith('/opt/'): continue
      relocated=stage/destination.lstrip('/')
      if not relocated.exists() and destination.startswith('/opt/uv/python/'):
        import subprocess,sys
        environment=dict(os.environ,UV_PYTHON_INSTALL_DIR=str(stage/'opt/uv/python'),UV_NO_CACHE='1')
        subprocess.run([sys.executable,'-m','pip','install','--no-cache-dir','uv==0.10.6'],check=True,stdout=subprocess.DEVNULL)
        subprocess.run(['uv','python','install','3.12.12'],check=True,env=environment,stdout=subprocess.DEVNULL)
      if not relocated.exists(): raise RuntimeError('runtime archive has unresolved /opt symlink')
      link.unlink()
      link.symlink_to(os.path.relpath(relocated,link.parent))
    if not (stage/'opt/LTX-2/.venv/bin/python').is_file() or not (stage/'opt/novita-worker/worker.py').is_file(): raise RuntimeError('runtime archive is incomplete')
    (stage/'.ready').write_text(sha+'\n')
    if bundle.parent!=stage: shutil.rmtree(bundle.parent,ignore_errors=True)
    os.replace(stage,root)
    ensure_cuda_compatibility()
  except BaseException:
    shutil.rmtree(stage,ignore_errors=True)
    raise
exec_worker()
`;
}

const ltxManifestKey = process.argv[2];
if (!/^novita\/model-manifests\/ltx-2\.5-[a-f0-9-]+\.json$/.test(ltxManifestKey || "")) {
  throw new Error("pass the admitted LTX 2.5 model manifest key");
}
if (!/^novita\/runtime\/ltx-2\.5\/[a-f0-9]{64}\.tar\.(?:zst|gz)$/.test(RUNTIME_BUNDLE_KEY)
  || !/^[a-f0-9]{64}$/.test(RUNTIME_BUNDLE_SHA256)) {
  throw new Error("runtime bundle must have an immutable LTX 2.5 R2 key and SHA-256 identity");
}
for (const key of ["NOVITA_API_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"]) {
  if (!process.env[key]?.trim()) throw new Error(`${key} is required`);
}

const bucket = process.env.R2_BUCKET || "youtube-studio-ai";
const nonce = crypto.randomBytes(12).toString("hex");
const root = `novita/benchmarks/ltx-2.5/${nonce}`;
const activeWorkers = new Set();
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const headers = {
  authorization: `Bearer ${process.env.NOVITA_API_KEY}`,
  "content-type": "application/json",
  "user-agent": "youtube-studio-ai/ltx25-benchmark",
};

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function novita(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Novita ${path.split("?")[0]} failed with HTTP ${response.status}`);
  const body = await response.text();
  return body ? JSON.parse(body) : {};
}

async function objectBytes(key) {
  const item = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await item.Body.transformToByteArray());
}

async function jsonIfPresent(key) {
  try {
    return JSON.parse((await objectBytes(key)).toString("utf8"));
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return undefined;
    throw error;
  }
}

async function putJson(key, value) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(value),
    ContentType: "application/json",
  }));
}

async function signedGet(key, expiresIn = URL_TTL_SECONDS) {
  return await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

async function signedPut(key, contentType, metadata = {}) {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, Metadata: metadata });
  return await getSignedUrl(s3, command, {
    expiresIn: URL_TTL_SECONDS,
    unhoistableHeaders: new Set(Object.keys(metadata).map((name) => `x-amz-meta-${name}`)),
  });
}

async function deleteAndVerify(instanceId) {
  for (const path of ["/gpu/instance/stop", "/gpu/instance/delete"]) {
    try { await novita(path, { method: "POST", body: JSON.stringify({ instanceId }) }); } catch { /* delete is idempotent */ }
  }
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const current = await novita(`/gpu/instance?instanceId=${encodeURIComponent(instanceId)}`);
      const status = String(current?.status || current?.data?.status || "").toLowerCase();
      if (["", "deleted", "removed", "terminated"].includes(status)) return;
    } catch { return; }
    await sleep(5_000);
  }
  throw new Error(`Novita worker ${instanceId} deletion could not be verified`);
}

async function ensureBundlePresent() {
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: RUNTIME_BUNDLE_KEY }));
  if (!head.ContentLength || head.ContentLength < 1) throw new Error("sealed LTX runtime bundle is unavailable");
}

async function probeZImageVolume() {
  const receiptKey = `${root}/zimage-volume-receipt.json`;
  const scriptKey = `${root}/zimage-volume-probe.py`;
  const script = String.raw`import hashlib,json,os,pathlib,urllib.request
payload={'contract':'zimage-volume-probe/v1','ok':False}
try:
  candidates=[pathlib.Path('/network/models/z-image'),pathlib.Path('/network/z-image'),pathlib.Path('/network/models/Z-Image-Turbo')]
  source=next((item.resolve() for item in candidates if (item/'.model-manifest.json').is_file()),None)
  if source is None: raise RuntimeError('no approved Z-Image volume manifest found')
  manifest=json.loads((source/'.model-manifest.json').read_text())
  canonical=json.dumps(manifest,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
  files=manifest.get('files') if isinstance(manifest,dict) else None
  if not isinstance(files,list) or not files: raise RuntimeError('Z-Image volume manifest has no files')
  payload.update({'ok':True,'sourcePath':str(source.relative_to('/network')),'manifestSha256':hashlib.sha256(canonical).hexdigest(),'fileCount':len(files)})
except Exception as error:
  root=pathlib.Path('/network')
  candidates=[]
  for directory,names,files in os.walk(root):
    relative=pathlib.Path(directory).relative_to(root)
    if len(relative.parts)>4:
      names[:]=[]
      continue
    if '.model-manifest.json' in files or 'z' in pathlib.Path(directory).name.lower():
      candidates.append(str(relative))
      if len(candidates)>=16: break
  payload['error']=f'{type(error).__name__}: {error}'[:240]
  payload['candidates']=candidates
body=json.dumps(payload,separators=(',',':')).encode()
request=urllib.request.Request(os.environ['PROBE_RECEIPT_URL'],data=body,method='PUT',headers={'Content-Type':'application/json','Content-Length':str(len(body))})
urllib.request.urlopen(request,timeout=120).read()`;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: scriptKey, Body: script, ContentType: "text/x-python" }));
  const [scriptUrl, receiptUrl] = await Promise.all([
    signedGet(scriptKey),
    signedPut(receiptKey, "application/json"),
  ]);
  const created = await novita("/gpu/instance/create", {
    method: "POST",
    body: JSON.stringify({
      name: `yt-render-ltx25-zprobe-${nonce.slice(0, 12)}`,
      productId: PRODUCT_ID,
      clusterId: CLUSTER_ID,
      gpuNum: 1,
      kind: "gpu",
      billingMode: "spot",
      imageUrl: BASE_IMAGE,
      rootfsSize: 120,
      networkStorages: [{ Id: VOLUME_ID, mountPoint: "/network" }],
      command: "python -c \"import os,urllib.request;exec(urllib.request.urlopen(os.environ['PROBE_SCRIPT_URL']).read())\"",
      envs: [{ key: "PROBE_SCRIPT_URL", value: scriptUrl }, { key: "PROBE_RECEIPT_URL", value: receiptUrl }],
    }),
  });
  const instanceId = String(created.id || "");
  if (!instanceId) throw new Error("Novita did not return a Z-Image volume probe identity");
  activeWorkers.add(instanceId);
  try {
    const deadline = Date.now() + PROBE_MAX_SECONDS * 1_000;
    while (Date.now() < deadline) {
      const receipt = await jsonIfPresent(receiptKey);
      if (receipt) {
        if (receipt.ok === true) return receipt;
        throw new Error(`Z-Image volume probe failed: ${String(receipt.error || "unknown")}; candidates=${JSON.stringify(receipt.candidates || [])}`);
      }
      await sleep(5_000);
    }
    throw new Error("Z-Image volume probe did not return before its hard deadline");
  } finally {
    await deleteAndVerify(instanceId);
    activeWorkers.delete(instanceId);
  }
}

function imageProfile() {
  return {
    contractVersion: "1.0.0", id: "draft", phase: "image", model: ZIMAGE_MODEL,
    revision: ZIMAGE_REVISION, checkpoint: "Z-Image-Turbo", width: 1280, height: 736,
    steps: 9, guidanceScale: 0, precision: "bf16", candidates: 1,
    infrastructure: { provider: "novita", capacityMode: "spot", weightStorage: "local-persistent-disk", cacheMount: "/workspace/model-cache", checkpointing: true, idleShutdownSeconds: 300, elasticGpuCeiling: 8 },
    allowFallback: false,
  };
}

function videoProfile() {
  return {
    contractVersion: "1.0.0", id: "draft", phase: "video", model: LTX_MODEL,
    revision: LTX_REVISION, checkpoint: "ltx-2.5-22b-distilled-transformer-bf16.safetensors",
    width: 1280, height: 704, steps: 8, guidanceScale: 1, precision: "bf16", candidates: 1,
    infrastructure: { provider: "novita", capacityMode: "spot", weightStorage: "local-persistent-disk", cacheMount: "/workspace/model-cache", checkpointing: true, idleShutdownSeconds: 300, elasticGpuCeiling: 8 },
    fps: 25, pipeline: "distilled", twoStageRefine: true,
    textEncoderCheckpoint: "gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
    videoVaeCheckpoint: "ltx-2.5-video-vae-bf16.safetensors",
    audioVaeCheckpoint: "ltx-2.5-audio-vae-bf16.safetensors",
    spatialUpscalerCheckpoint: "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
    quantization: "fp8-cast", offload: "cpu", spatialUpscaleFactor: 2,
    stageOneWidth: 640, stageOneHeight: 352, allowFallback: false,
  };
}

const testScenes = [
  {
    id: "mannequin-archive",
    still: "Cinematic 16:9 evidence archive at blue hour, original faceless porcelain mannequin investigator, matte featureless head with no human likeness, charcoal herringbone overcoat, oxblood scarf, leather gloves, a sealed evidence envelope on a walnut desk, rain traced window, practical tungsten lamp, restrained 1970s editorial crime-documentary palette, volumetric atmosphere, exact wardrobe and props locked, no text, no logos, no gore.",
    motion: "Slow deliberate dolly push past the rain-streaked foreground toward the faceless mannequin as its gloved hand stops just short of the sealed envelope; subtle rain movement and lamp flicker, controlled parallax, no morphing, no new objects, preserve the exact wardrobe, mannequin silhouette, desk, envelope, lighting and room geometry from the reference frame. Native room tone only, soft rain and distant traffic, no dialogue, no narration, no music.",
  },
  {
    id: "mannequin-corridor",
    still: "Cinematic 16:9 apartment corridor before dawn, original faceless porcelain mannequin witness, matte featureless head with no human likeness, ivory wool turtleneck beneath a tailored navy 1980s trench coat, folded newspaper and brass key on a narrow table, receding hallway practical lights, humid window shadows, restrained documentary tension, exact clothing silhouette and objects locked, no text, no logos, no gore.",
    motion: "Measured lateral truck right through the corridor foreground while the faceless mannequin turns its torso toward the brass key without revealing a face; slight curtain movement and practical-light flicker, layered depth, motivated tension, no morphing, no new people or props, preserve the exact mannequin, navy trench, ivory turtleneck, newspaper, key, hallway and lighting from the reference frame. Native building tone only, distant lift cable and floorboards, no dialogue, no narration, no music.",
  },
  {
    id: "mannequin-platform",
    still: "Cinematic 16:9 early-morning train platform in light fog, original faceless porcelain mannequin courier, matte featureless head with no human likeness, dark green raincoat, mustard knit scarf, worn brown satchel, a timetable board out of focus with no readable text, wet platform reflections, distant train lights, elegant archival thriller composition, exact wardrobe and platform props locked, no logos, no gore.",
    motion: "Slow crane rise from wet platform reflections to the faceless mannequin holding the satchel as distant train light grows through fog; rain and scarf move naturally, restrained cinematic tension, no morphing, no new objects or people, preserve exact mannequin silhouette, green raincoat, mustard scarf, satchel, fog, platform and lighting from the reference frame. Native station ambience only, rain and distant train approach, no dialogue, no narration, no music.",
  },
];

async function buildPhaseManifest({ phase, profile, models, jobs, maxRuntimeSeconds }) {
  const phaseRoot = `${root}/${phase}`;
  const manifestKey = `${phaseRoot}/control/manifest.json`;
  const checkpointKey = `${phaseRoot}/control/checkpoint.json`;
  const heartbeatKey = `${phaseRoot}/control/heartbeat.json`;
  const completionKey = `${phaseRoot}/control/completion.json`;
  const profileSha256 = sha256(canonicalJson(profile));
  const [checkpointGetUrl, checkpointPutUrl, heartbeatPutUrl, completionPutUrl] = await Promise.all([
    signedGet(checkpointKey), signedPut(checkpointKey, "application/json"),
    signedPut(heartbeatKey, "application/json"), signedPut(completionKey, "application/json"),
  ]);
  const completedJobs = await Promise.all(jobs.map(async (job) => {
    const key = `${phaseRoot}/outputs/${job.id}.${phase === "image" ? "png" : "mp4"}`;
    const artifactPutUrl = await signedPut(key, phase === "image" ? "image/png" : "video/mp4", {
      "manifest-id": "pending", "profile-sha256": profileSha256, "job-id": job.id,
    });
    return { ...job, artifact: { key, putUrl: artifactPutUrl, contentType: phase === "image" ? "image/png" : "video/mp4", headers: {
      "Content-Type": phase === "image" ? "image/png" : "video/mp4",
      "x-amz-meta-manifest-id": "pending", "x-amz-meta-profile-sha256": profileSha256, "x-amz-meta-job-id": job.id,
    } } };
  }));
  const core = { contractVersion: "2.0.0", phase, profile, profileSha256, jobs: completedJobs.map((job) => ({ ...job, artifact: { ...job.artifact, putUrl: "sealed-later", headers: { ...job.artifact.headers, "x-amz-meta-manifest-id": "sealed-later" } } })), models, expiresAt: Date.now() + maxRuntimeSeconds * 1_000 };
  const manifestId = `${phase}-${sha256(canonicalJson(core)).slice(0, 32)}`;
  const finalizedJobs = completedJobs.map((job) => ({ ...job, artifact: { ...job.artifact, headers: { ...job.artifact.headers, "x-amz-meta-manifest-id": manifestId } } }));
  // Signed metadata must match the final manifest identity. Re-sign only the
  // artifact URLs after that identity is known, never send a mutable header.
  for (const job of finalizedJobs) {
    job.artifact.putUrl = await signedPut(job.artifact.key, job.artifact.contentType, {
      "manifest-id": manifestId, "profile-sha256": profileSha256, "job-id": job.id,
    });
  }
  const unsigned = {
    contractVersion: "2.0.0", phase, manifestId, gpuSku: "RTX 4090", gpuCount: 1,
    expiresAt: Date.now() + maxRuntimeSeconds * 1_000, maxCostUsd: 2.3,
    maxRuntimeSeconds, profile, profileSha256,
    ...(phase === "video" ? { runtimeRepository: "Lightricks/LTX-2", runtimeRevision: "fd4ded7f2d88d3da713abcdd4ad41ecc4a9314ca" } : {}),
    models,
    checkpoint: { key: checkpointKey, getUrl: checkpointGetUrl, putUrl: checkpointPutUrl, headers: { "Content-Type": "application/json" } },
    heartbeat: { key: heartbeatKey, putUrl: heartbeatPutUrl, headers: { "Content-Type": "application/json" } },
    completion: { key: completionKey, putUrl: completionPutUrl, headers: { "Content-Type": "application/json" } },
    jobs: finalizedJobs,
  };
  const manifest = sealManifest(unsigned);
  await putJson(manifestKey, manifest);
  return { manifest, manifestKey, completionKey };
}

async function executePhase({ phase, manifest, manifestKey, completionKey, maxRuntimeSeconds }) {
  const manifestUrl = await signedGet(manifestKey);
  const runtimeUrl = await signedGet(RUNTIME_BUNDLE_KEY);
  const bootstrapKey = `${root}/${phase}/control/runtime-bootstrap.py`;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: bootstrapKey, Body: runtimeBootstrapSource(), ContentType: "text/x-python" }));
  const bootstrapUrl = await signedGet(bootstrapKey);
  const request = buildWorkerRequest({
    name: `yt-render-ltx25-benchmark-${phase}-${nonce.slice(0, 10)}`,
    manifestUrl, manifestSha256: manifest.manifestSha256, jobIds: manifest.jobs.map((job) => job.id),
  });
  request.envs.find((item) => item.key === "NOVITA_RUNTIME_BUNDLE_URL").value = runtimeUrl;
  request.envs.find((item) => item.key === "NOVITA_RUNTIME_BOOTSTRAP_URL").value = bootstrapUrl;
  delete request.__jobIds;
  const created = await novita("/gpu/instance/create", { method: "POST", body: JSON.stringify(request) });
  const instanceId = String(created.id || "");
  if (!instanceId) throw new Error(`Novita did not return ${phase} benchmark worker identity`);
  activeWorkers.add(instanceId);
  try {
    const deadline = Date.now() + maxRuntimeSeconds * 1_000;
    while (Date.now() < deadline) {
      const completion = await jsonIfPresent(completionKey);
      if (completion?.status === "done") {
        if (completion.manifestId !== manifest.manifestId || completion.gpuSku !== "RTX 4090" || completion.gpuCount !== 1) {
          throw new Error(`${phase} benchmark returned invalid GPU/manifest evidence`);
        }
        const expected = manifest.jobs.map((job) => job.id).sort();
        if (JSON.stringify([...(completion.completedJobIds || [])].sort()) !== JSON.stringify(expected)) {
          throw new Error(`${phase} benchmark completion omitted or duplicated a required job`);
        }
        return completion;
      }
      if (completion?.status === "failed" || completion?.status === "interrupted") {
        throw new Error(`${phase} benchmark worker failed: ${String(completion.error || "unknown")}`);
      }
      await sleep(15_000);
    }
    throw new Error(`${phase} benchmark exceeded its hard worker deadline`);
  } finally {
    await deleteAndVerify(instanceId);
    activeWorkers.delete(instanceId);
  }
}

async function outputSha256(key) {
  return sha256(await objectBytes(key));
}

async function assertArtifacts(manifest) {
  for (const job of manifest.jobs) {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: job.artifact.key }));
    const metadata = head.Metadata || {};
    if (!head.ContentLength || metadata["manifest-id"] !== manifest.manifestId || metadata["profile-sha256"] !== manifest.profileSha256 || metadata["job-id"] !== job.id) {
      throw new Error(`artifact metadata is incomplete for ${job.id}`);
    }
  }
}

async function main() {
  await ensureBundlePresent();
  const ltxModels = JSON.parse((await objectBytes(ltxManifestKey)).toString("utf8"));
  if (!Array.isArray(ltxModels) || ltxModels.length !== 5 || !ltxModels.every((model) => model?.repository === LTX_MODEL && model?.revision === LTX_REVISION)) {
    throw new Error("admitted LTX model manifest is not the exact official LTX 2.5 file set");
  }
  const productCatalog = await novita(`/products?productName=4090&billingMethod=spot&gpuNum=1&clusterId=${encodeURIComponent(CLUSTER_ID)}`);
  const products = Array.isArray(productCatalog.products)
    ? productCatalog.products
    : Array.isArray(productCatalog.data)
      ? productCatalog.data
      : Array.isArray(productCatalog.data?.list) ? productCatalog.data.list : [];
  const product = products.find((item) => item?.id === PRODUCT_ID);
  const rawSpotRate = Number(product?.spotPriceUsdPerHour ?? product?.spotPrice ?? 0.17);
  // Novita's OpenAPI serializes spotPrice as USD × 100,000, while a future
  // normalized client may supply USD directly.  Accept either representation
  // but always budget in USD/hour.
  const spotRate = rawSpotRate > 10 ? rawSpotRate / 100_000 : rawSpotRate;
  if (!Number.isFinite(spotRate) || spotRate <= 0) throw new Error("Novita did not provide a usable RTX 4090 spot rate");
  const remainingSeconds = Math.floor(((TOTAL_MAX_USD - STAGE_MAX_USD) / spotRate) * 3_600) - PROBE_MAX_SECONDS;
  const phaseMaxSeconds = Math.min(DEFAULT_PHASE_MAX_SECONDS, Math.floor(remainingSeconds / 2));
  if (phaseMaxSeconds < 1_800) throw new Error("the $3 aggregate cap cannot fund the minimum bounded LTX benchmark window at the current spot rate");

  const zProbe = await probeZImageVolume();
  if (zProbe.contract !== "zimage-volume-probe/v1" || zProbe.sourcePath !== "models/z-image" || !/^[a-f0-9]{64}$/.test(zProbe.manifestSha256 || "")) {
    throw new Error("Z-Image volume did not provide a valid provenance receipt");
  }
  const zModels = [{
    id: "z-image-turbo", kind: "tree", repository: ZIMAGE_MODEL, revision: ZIMAGE_REVISION,
    manifestSha256: zProbe.manifestSha256, sourcePath: zProbe.sourcePath, localPath: "z-image",
  }];
  const imageJobs = testScenes.map((scene, index) => ({ id: scene.id, prompt: scene.still, seed: 903_000 + index * 31, width: 1280, height: 736, steps: 9, guidanceScale: 0 }));
  const image = await buildPhaseManifest({ phase: "image", profile: imageProfile(), models: zModels, jobs: imageJobs, maxRuntimeSeconds: phaseMaxSeconds });
  await executePhase({ phase: "image", ...image, maxRuntimeSeconds: phaseMaxSeconds });
  await assertArtifacts(image.manifest);

  const videoJobs = await Promise.all(image.manifest.jobs.map(async (imageJob, index) => ({
    id: testScenes[index].id,
    prompt: testScenes[index].motion,
    seed: 907_000 + index * 37,
    width: 1280, height: 704, steps: 8, frames: 97, fps: 25, timeoutSeconds: Math.min(5_400, phaseMaxSeconds - 120),
    input: { getUrl: await signedGet(imageJob.artifact.key), sha256: await outputSha256(imageJob.artifact.key) },
  })));
  const video = await buildPhaseManifest({ phase: "video", profile: videoProfile(), models: ltxModels, jobs: videoJobs, maxRuntimeSeconds: phaseMaxSeconds });
  const completion = await executePhase({ phase: "video", ...video, maxRuntimeSeconds: phaseMaxSeconds });
  await assertArtifacts(video.manifest);
  const videoOutputs = completion.videoOutputs || {};
  const outputRows = await Promise.all(video.manifest.jobs.map(async (job) => {
    const proof = videoOutputs[job.id];
    if (proof?.outputWidth !== 1280 || proof?.outputHeight !== 704 || proof?.stageOneWidth !== 640 || proof?.stageOneHeight !== 352 || proof?.spatialUpscaleFactor !== 2 || proof?.hasAudio !== true) {
      throw new Error(`LTX output proof is incomplete for ${job.id}`);
    }
    return { id: job.id, key: job.artifact.key, url: await signedGet(job.artifact.key, 604_800), proof };
  }));
  const report = {
    contract: "ltx-2.5-rtx4090-benchmark/v1", ok: true, nonce, ltxModelManifestKey,
    stageMaxUsd: STAGE_MAX_USD, spotRateUsdPerHour: spotRate, phaseMaxSeconds,
    zImage: { model: ZIMAGE_MODEL, revision: ZIMAGE_REVISION, volumeReceipt: zProbe },
    ltx: { model: LTX_MODEL, revision: LTX_REVISION, pipeline: "distilled", stageOne: "640x352", output: "1280x704@25", quantization: "fp8-cast", offload: "cpu" },
    outputs: outputRows.map(({ id, key, proof }) => ({ id, key, proof })),
  };
  await putJson(`${root}/report.json`, report);
  console.log(JSON.stringify({ event: "benchmark_complete", reportKey: `${root}/report.json`, outputs: outputRows }));
}

try {
  await main();
} finally {
  await Promise.all([...activeWorkers].map(async (instanceId) => {
    try { await deleteAndVerify(instanceId); } catch { /* a surfaced failure remains fail-closed */ }
  }));
}
