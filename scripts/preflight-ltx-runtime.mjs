#!/usr/bin/env node
/** Verify the mounted LTX 2.5 runtime imports before spending on inference. */
import crypto from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

for (const key of ["NOVITA_API_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"]) {
  if (!process.env[key]) throw new Error(`${key} is required`);
}
const runtimeSha = process.argv[2] || "ff616214c4a8901f003a1ef0815220d596f709eeb5027fb575b643a97e11c579";
if (!/^[a-f0-9]{64}$/.test(runtimeSha)) throw new Error("usage: node scripts/preflight-ltx-runtime.mjs [runtime-sha256]");
const nonce = crypto.randomBytes(12).toString("hex");
const bucket = process.env.R2_BUCKET || "youtube-studio-ai";
const receiptKey = `novita/preflight/ltx-runtime-${runtimeSha.slice(0, 12)}-${nonce}.json`;
const scriptKey = `novita/preflight/scripts/ltx-runtime-${nonce}.py`;
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const script = String.raw`import json,os,pathlib,subprocess,urllib.request
root=pathlib.Path('/network/runtime/ltx-2.5-${runtimeSha}')
python=root/'opt/LTX-2/.venv/bin/python'
paths=[root/'opt/LTX-2',root/'opt/LTX-2/packages/ltx-core/src',root/'opt/LTX-2/packages/ltx-pipelines/src']
payload={'contract':'ltx-runtime-import-preflight/v1','ok':False,'runtimeSha256':'${runtimeSha}'}
try:
  if not python.is_file() or not all(path.is_dir() for path in paths): raise RuntimeError('pinned LTX runtime package paths are unavailable')
  environment=dict(os.environ,PYTHONPATH=os.pathsep.join(str(path) for path in paths))
  check="import torch,torch.sparse,ltx_core,ltx_pipelines.distilled;print('LTX_IMPORT_OK|'+str(torch.cuda.is_available()))"
  result=subprocess.run([str(python),'-c',check],env=environment,text=True,capture_output=True,timeout=180)
  payload.update({'ok':result.returncode==0,'stdout':result.stdout[-2000:],'stderr':result.stderr[-6000:],'returnCode':result.returncode})
except Exception as error:
  payload['error']=f'{type(error).__name__}: {error}'[:2000]
body=json.dumps(payload,separators=(',',':')).encode()
request=urllib.request.Request(os.environ['PREFLIGHT_RECEIPT_URL'],data=body,method='PUT',headers={'Content-Type':'application/json','Content-Length':str(len(body))})
urllib.request.urlopen(request,timeout=120).read()`;

await s3.send(new PutObjectCommand({ Bucket: bucket, Key: scriptKey, Body: script, ContentType: "text/x-python" }));
const [scriptUrl, receiptUrl] = await Promise.all([
  getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: scriptKey }), { expiresIn: 1_800 }),
  getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: receiptKey, ContentType: "application/json" }), { expiresIn: 1_800 }),
]);
const base = "https://api.novita.ai/gpu-instance/openapi/v1";
const headers = { authorization: `Bearer ${process.env.NOVITA_API_KEY}`, "content-type": "application/json", "user-agent": "youtube-studio-ai/ltx-preflight" };
const request = async (path, init = {}) => {
  const response = await fetch(base + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`Novita ${path} ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
};
const created = await request("/gpu/instance/create", {
  method: "POST",
  body: JSON.stringify({
    name: `yt-render-4090-preflight-ltx-${nonce.slice(0, 12)}`,
    productId: "4090.16c96g.v2",
    clusterId: "us-ca-nas-2",
    gpuNum: 1,
    kind: "gpu",
    billingMode: "spot",
    imageUrl: "pytorch/pytorch@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385",
    rootfsSize: 120,
    networkStorages: [{ Id: "384d629d-839f-4224-abef-64dfc2d751bf", mountPoint: "/network" }],
    command: "python -c \"import os,urllib.request;exec(urllib.request.urlopen(os.environ['PREFLIGHT_SCRIPT_URL']).read())\"",
    envs: [{ key: "PREFLIGHT_SCRIPT_URL", value: scriptUrl }, { key: "PREFLIGHT_RECEIPT_URL", value: receiptUrl }],
  }),
});
const createdData = created?.data && typeof created.data === "object" ? created.data : created;
const instanceId = String(createdData?.id || "");
if (!instanceId) throw new Error("Novita did not return an LTX preflight worker identity");
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
  if (!receipt) throw new Error("LTX preflight receipt did not arrive");
  console.log(JSON.stringify(receipt));
  if (!receipt.ok) process.exitCode = 1;
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
  if (!deleted) throw new Error("LTX preflight worker deletion could not be verified");
  console.log(JSON.stringify({ event: "ltx_preflight_worker_deleted" }));
}
