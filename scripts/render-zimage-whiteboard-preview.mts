/**
 * Private, bounded Z-Image Turbo Whiteboard comparison board.
 *
 * It is deliberately outside the channel/release path: no output may enter a
 * master, certificate, or upload. The official serverless Z-Image endpoint is
 * no longer live for this account, so this uses one ephemeral Novita RTX 4090
 * spot worker, the exact pinned open-weight Z-Image Turbo revision, six fixed
 * one-candidate prompts, R2 object-scoped delivery URLs, and verified worker
 * deletion. It has no fallback model, no retry loop, and no hidden upscaler.
 *
 * Run only with explicit vault-injected credentials:
 *   ZIMAGE_DIRECT_BENCHMARK_EXECUTE=1 \
 *   ai-vault cloudflare R2_ACCESS_KEY_ID=R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY=R2_SECRET_ACCESS_KEY R2_ENDPOINT=R2_ENDPOINT -- \
 *   ai-vault huggingface HF_API_KEY=HF_TOKEN -- \
 *   ai-vault novita NOVITA_API_KEY=NOVITA_API_KEY -- \
 *   npm exec tsx scripts/render-zimage-whiteboard-preview.mts
 */
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const execute = process.env.ZIMAGE_DIRECT_BENCHMARK_EXECUTE === "1";
if (!execute) throw new Error("Refusing to launch a direct Z-Image benchmark without ZIMAGE_DIRECT_BENCHMARK_EXECUTE=1");
for (const key of ["NOVITA_API_KEY", "HF_TOKEN", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"]) {
  if (!process.env[key]?.trim()) throw new Error(`${key} must be injected by the sealed vault`);
}

const MODEL = "Tongyi-MAI/Z-Image-Turbo";
const REVISION = "f332072aa78be7aecdf3ee76d5c247082da564a6";
const DIFFUSERS_REVISION = "e6d46123091afd58281dc7487c0f6b67055683b9";
const TRANSFORMERS_VERSION = "4.57.1";
const PRODUCT_ID = "4090.16c62g.os";
const BASE_IMAGE = "pytorch/pytorch@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385";
const SIZE = { width: 1536, height: 864 } as const;
const STEPS = 9;
const GUIDANCE_SCALE = 0;
const MAX_WORKER_SECONDS = 45 * 60;
const MAX_SPOT_RATE_USD_PER_HOUR = 0.17;
const MAX_ESTIMATED_WORKER_USD = 0.13;
const API = "https://api.novita.ai/gpu-instance/openapi/v1";
const BUCKET = process.env.R2_BUCKET || "youtube-studio-ai";
const OUTPUT_DIR = join(process.cwd(), "output", "whiteboard", "zimage-banana-republic-v1");

if (MAX_WORKER_SECONDS / 3_600 * MAX_SPOT_RATE_USD_PER_HOUR > MAX_ESTIMATED_WORKER_USD) {
  throw new Error("benchmark worker lifetime exceeds its declared cost ceiling");
}

const common = [
  "A single highly legible editorial black-marker line-art whiteboard illustration on a pure #ffffff background, composed to use the full 16:9 canvas.",
  "Thick confident black marker outlines, sparse restrained red accents only where they clarify a power relationship, clear foreground/background hierarchy, and intentional negative space.",
  "Every object must visually explain the narration beat without text. No letters, numbers, labels, logos, watermarks, photorealism, paint texture, grey border, frame, decorative symbols, or generic growth metaphors.",
  "No crowded collage: one dominant idea and two or three large supporting objects, all readable in a YouTube Whiteboard video.",
].join(" ");

const scenes = [
  {
    id: "01-octopus-control", seed: 1904001,
    narration: "One company controlled land, railroads, ports, and political access.",
    direction: "A large central octopus is a literal symbol of concentrated corporate control. One thick tentacle touches a simple rail line with two worker figures; two separate tentacles touch a neat banana plantation with six large banana plants; another reaches a small cargo port with one ship. Keep all three targets large, distinct, and visibly connected to the octopus.",
  },
  {
    id: "02-land-rail-port-map", seed: 1904002,
    narration: "The company controlled the route from land to port.",
    direction: "A clean simplified Central American coastal map fills the board. At left is a banana plantation; through the center one obvious railroad; at right a port and cargo ship. Use three bold connected zones, plus one small red route line, so plantation to rail to port is instantly clear.",
  },
  {
    id: "03-unequal-bargain", seed: 1904003,
    narration: "A government with limited leverage faced a company that owned infrastructure and jobs.",
    direction: "A small simple government building at left faces a much larger company office at right. Between them is one visibly tilted balance scale: the government side is light while the company side is heavy because it holds a rail track, banana plants, and a cargo dock. It must read as unequal bargaining power, not a generic business scene.",
  },
  {
    id: "04-workers-carry-risk", seed: 1904004,
    narration: "Workers carried the risk while logistics moved value outward.",
    direction: "Two large worker figures stand beside a banana loading platform and rail wagon. Their posture shows effort but no caricature or violence. A simple cargo rail car heads toward a distant port; a separate large crate with one small red outward arrow clarifies value movement. Keep people unobstructed and do not overlap faces, hands, rail, or crates.",
  },
  {
    id: "05-ports-and-money-flow", seed: 1904005,
    narration: "Infrastructure was built around export flows rather than the country as a whole.",
    direction: "A large port and cargo ship dominate the right two thirds. A rail line enters from a banana plantation on the left. One bold red directional line runs plantation to rail to ship, while a small town school and clinic sit off the route without a connection. Make the infrastructure priority unmistakable without words.",
  },
  {
    id: "06-power-warning", seed: 1904006,
    narration: "The warning is about private control becoming public destiny.",
    direction: "A country map outline contains four separated, large icons: plantation, railway, port, and government building. Above them, one oversized corporate hand holds four puppet strings that reach each icon. Include one small thoughtful drawn person at the lower edge looking up with concern, but leave the icons unobstructed. It is a warning about concentrated power, not a cartoon villain.",
  },
] as const;

interface WorkerReceipt {
  readonly ok?: boolean;
  readonly errorType?: string;
  readonly message?: string;
  readonly images?: readonly {
    readonly id: string;
    readonly contentSha256: string;
    readonly byteLength: number;
    readonly elapsedMs: number;
  }[];
  readonly startedAt?: number;
  readonly completedAt?: number;
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(value)) throw new Error("unsafe benchmark output id");
  return value;
}

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const nonce = crypto.randomBytes(12).toString("hex");
const rootKey = `private-benchmarks/zimage-whiteboard/${new Date().toISOString().slice(0, 10)}/${nonce}`;
const receiptKey = `${rootKey}/receipt.json`;
const jobManifestKey = `${rootKey}/jobs.json`;
const scriptKey = `${rootKey}/worker.py`;

async function novita(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.NOVITA_API_KEY}`,
      "content-type": "application/json",
      "user-agent": "youtube-studio-ai/zimage-private-benchmark",
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Novita ${path.split("?")[0]} failed with HTTP ${response.status}`);
  const body = await response.text();
  return body ? JSON.parse(body) as Record<string, unknown> : {};
}

async function readReceipt(): Promise<WorkerReceipt | undefined> {
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: receiptKey }));
    return JSON.parse(await object.Body!.transformToString()) as WorkerReceipt;
  } catch (error) {
    if (error && typeof error === "object" && "$metadata" in error && (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return undefined;
    throw error;
  }
}

async function deleteAndVerify(instanceId: string): Promise<void> {
  for (const path of ["/gpu/instance/stop", "/gpu/instance/delete"]) {
    try { await novita(path, { method: "POST", body: JSON.stringify({ instanceId }) }); } catch { /* deletion poll is authoritative */ }
  }
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const state = await novita(`/gpu/instance?instanceId=${encodeURIComponent(instanceId)}`);
      const row = state.data && typeof state.data === "object" ? state.data as Record<string, unknown> : state;
      const status = String(row.status ?? "").toLowerCase();
      if (["", "removed", "deleted", "terminated"].includes(status)) return;
    } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("benchmark worker deletion could not be verified");
}

const products = await novita(`/products?${new URLSearchParams({ productName: "4090", billingMethod: "spot", gpuNum: "1" })}`);
const product = (Array.isArray(products.data) ? products.data : [])
  .map((row) => row && typeof row === "object" ? row as Record<string, unknown> : undefined)
  .find((row) => row?.id === PRODUCT_ID);
if (!product || product.availableDeploy !== true || !["high", "normal", "low"].includes(String(product.inventoryState))) {
  throw new Error(`exact benchmark RTX 4090 spot SKU ${PRODUCT_ID} is not currently deployable`);
}
const spotRate = Number(product.spotPrice) / 100_000;
if (!Number.isFinite(spotRate) || spotRate <= 0 || spotRate > MAX_SPOT_RATE_USD_PER_HOUR) {
  throw new Error("live 4090 spot price exceeds this private benchmark's approved ceiling");
}

const outputKeys = scenes.map((scene) => `${rootKey}/images/${safeId(scene.id)}.png`);
const uploadUrls = await Promise.all(outputKeys.map((Key) => getSignedUrl(
  s3,
  new PutObjectCommand({ Bucket: BUCKET, Key, ContentType: "image/png" }),
  { expiresIn: MAX_WORKER_SECONDS + 900 },
)));
const receiptUrl = await getSignedUrl(
  s3,
  new PutObjectCommand({ Bucket: BUCKET, Key: receiptKey, ContentType: "application/json" }),
  { expiresIn: MAX_WORKER_SECONDS + 900 },
);
const jobs = scenes.map((scene, index) => ({
  id: scene.id,
  seed: scene.seed,
  prompt: `${common} Specific visual: ${scene.direction}`,
  uploadUrl: uploadUrls[index],
}));
await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: jobManifestKey, Body: JSON.stringify({
  version: "zimage-private-whiteboard-benchmark/v1",
  model: MODEL,
  revision: REVISION,
  transformersVersion: TRANSFORMERS_VERSION,
  size: SIZE,
  steps: STEPS,
  guidanceScale: GUIDANCE_SCALE,
  deadlineAt: Date.now() + MAX_WORKER_SECONDS * 1_000,
  jobs,
}), ContentType: "application/json" }));
const jobsUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: jobManifestKey }), { expiresIn: MAX_WORKER_SECONDS + 900 });

const worker = String.raw`import hashlib,json,os,pathlib,shutil,subprocess,sys,time,traceback,urllib.request
MODEL=${JSON.stringify(MODEL)}
REVISION=${JSON.stringify(REVISION)}
DIFFUSERS_REVISION=${JSON.stringify(DIFFUSERS_REVISION)}
TRANSFORMERS_VERSION=${JSON.stringify(TRANSFORMERS_VERSION)}
def get_json(url):
  with urllib.request.urlopen(url,timeout=120) as r: return json.loads(r.read())
def put_json(url,value):
  body=json.dumps(value,separators=(',',':'),sort_keys=True).encode()
  req=urllib.request.Request(url,data=body,method='PUT',headers={'Content-Type':'application/json','Content-Length':str(len(body))})
  urllib.request.urlopen(req,timeout=120).read()
def put_file(url,path):
  body=path.read_bytes()
  req=urllib.request.Request(url,data=body,method='PUT',headers={'Content-Type':'image/png','Content-Length':str(len(body))})
  urllib.request.urlopen(req,timeout=300).read()
def digest(path):
  h=hashlib.sha256()
  with path.open('rb') as f:
    for chunk in iter(lambda:f.read(8*1024*1024),b''): h.update(chunk)
  return h.hexdigest()
receipt_url=os.environ['ZIMAGE_BENCHMARK_RECEIPT_URL']
started=int(time.time()*1000)
try:
  manifest=get_json(os.environ['ZIMAGE_BENCHMARK_JOBS_URL'])
  if manifest.get('model')!=MODEL or manifest.get('revision')!=REVISION: raise RuntimeError('pinned model identity mismatch')
  if int(manifest.get('deadlineAt',0))<=int(time.time()*1000): raise RuntimeError('sealed benchmark deadline elapsed before boot')
  if shutil.which('git') is None:
    subprocess.check_call(['bash','-lc','apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*'])
  subprocess.check_call([sys.executable,'-m','pip','install','--no-cache-dir','--disable-pip-version-check','huggingface_hub[hf_xet]==0.36.0','transformers=='+TRANSFORMERS_VERSION,'git+https://github.com/huggingface/diffusers.git@'+DIFFUSERS_REVISION])
  os.environ['HF_XET_HIGH_PERFORMANCE']='1'
  from huggingface_hub import snapshot_download
  root=pathlib.Path('/workspace/zimage-benchmark')
  model=root/'model'
  root.mkdir(parents=True,exist_ok=True)
  snapshot_download(repo_id=MODEL,revision=REVISION,token=os.environ['HF_TOKEN'],local_dir=str(model))
  import torch
  from diffusers import ZImagePipeline
  pipe=ZImagePipeline.from_pretrained(str(model),torch_dtype=torch.bfloat16,local_files_only=True)
  pipe.enable_model_cpu_offload()
  out=[]
  for job in manifest['jobs']:
    if int(time.time()*1000)>=int(manifest['deadlineAt']): raise RuntimeError('sealed benchmark deadline elapsed')
    t0=int(time.time()*1000)
    image=pipe(prompt=job['prompt'],width=int(manifest['size']['width']),height=int(manifest['size']['height']),num_inference_steps=int(manifest['steps']),guidance_scale=float(manifest['guidanceScale']),generator=torch.Generator(device='cuda').manual_seed(int(job['seed']))).images[0]
    path=root/(job['id']+'.png')
    image.save(path,format='PNG')
    put_file(job['uploadUrl'],path)
    out.append({'id':job['id'],'contentSha256':digest(path),'byteLength':path.stat().st_size,'elapsedMs':int(time.time()*1000)-t0})
  put_json(receipt_url,{'contract':'zimage-private-whiteboard-benchmark/v1','ok':True,'model':MODEL,'revision':REVISION,'images':out,'startedAt':started,'completedAt':int(time.time()*1000)})
except Exception as error:
  try: put_json(receipt_url,{'contract':'zimage-private-whiteboard-benchmark/v1','ok':False,'errorType':type(error).__name__,'message':str(error)[:300],'startedAt':started,'completedAt':int(time.time()*1000)})
  finally: raise
`;
await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: scriptKey, Body: worker, ContentType: "text/x-python" }));
const scriptUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: scriptKey }), { expiresIn: MAX_WORKER_SECONDS + 900 });

const created = await novita("/gpu/instance/create", {
  method: "POST",
  body: JSON.stringify({
    name: `yt-zimage-benchmark-${nonce.slice(0, 12)}`,
    productId: PRODUCT_ID,
    gpuNum: 1,
    kind: "gpu",
    billingMode: "spot",
    rootfsSize: 100,
    imageUrl: BASE_IMAGE,
    command: "python -c \"import os,urllib.request;exec(urllib.request.urlopen(os.environ['ZIMAGE_BENCHMARK_SCRIPT_URL']).read())\"",
    envs: [
      { key: "ZIMAGE_BENCHMARK_SCRIPT_URL", value: scriptUrl },
      { key: "ZIMAGE_BENCHMARK_JOBS_URL", value: jobsUrl },
      { key: "ZIMAGE_BENCHMARK_RECEIPT_URL", value: receiptUrl },
      { key: "HF_TOKEN", value: process.env.HF_TOKEN },
    ],
  }),
});
const createdData = created.data && typeof created.data === "object" ? created.data as Record<string, unknown> : created;
const instanceId = String(createdData.id ?? "");
if (!instanceId) throw new Error("Novita did not return a benchmark worker identity");
console.log(JSON.stringify({ event: "created", instanceId, productId: PRODUCT_ID, maxEstimatedUsd: MAX_ESTIMATED_WORKER_USD }));

try {
  const deadline = Date.now() + MAX_WORKER_SECONDS * 1_000;
  let receipt: WorkerReceipt | undefined;
  while (Date.now() < deadline) {
    receipt = await readReceipt();
    if (receipt) break;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (!receipt?.ok) throw new Error(`Z-Image benchmark failed: ${receipt?.message ?? "receipt missing at bounded deadline"}`);
  if (receipt.images?.length !== scenes.length) throw new Error("Z-Image benchmark receipt does not cover every requested image");
  await mkdir(OUTPUT_DIR, { recursive: true });
  const localImages = [];
  for (const [index, scene] of scenes.entries()) {
    const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKeys[index] }));
    const bytes = Buffer.from(await object.Body!.transformToByteArray());
    const expected = receipt.images.find((item) => item.id === scene.id);
    if (!expected || sha256(bytes) !== expected.contentSha256 || bytes.length !== expected.byteLength) {
      throw new Error(`downloaded Z-Image preview ${scene.id} does not match its worker receipt`);
    }
    const localPath = join(OUTPUT_DIR, `${scene.id}.png`);
    await writeFile(localPath, bytes);
    localImages.push({ ...expected, narration: scene.narration, localPath });
  }
  await writeFile(join(OUTPUT_DIR, "manifest.json"), JSON.stringify({
    version: "zimage-private-whiteboard-benchmark/v1",
    scope: "operator_visual_comparison_only",
    noProductionOrPublishAuthority: true,
    model: MODEL,
    revision: REVISION,
    productId: PRODUCT_ID,
    spotRateUsdPerHour: spotRate,
    maxEstimatedWorkerUsd: MAX_ESTIMATED_WORKER_USD,
    receipt,
    images: localImages,
  }, null, 2));
  console.log(JSON.stringify({ event: "complete", outputDir: OUTPUT_DIR, count: localImages.length }));
} finally {
  await deleteAndVerify(instanceId);
  console.log(JSON.stringify({ event: "deletedVerified", instanceId }));
}
