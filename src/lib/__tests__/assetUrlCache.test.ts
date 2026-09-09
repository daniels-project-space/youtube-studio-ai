import assert from "node:assert/strict";
import { invalidateAssetUrl, resolveAssetUrl } from "../asset-url";

async function run() {
const originalFetch=globalThis.fetch, originalNow=Date.now;
let now=1_800_000_000_000;
const requests:{key:string; signal:AbortSignal|null|undefined; reply:(response:Response)=>void}[]=[];
Date.now=()=>now;
globalThis.fetch=async (input,options)=>{
  const key=new URL(String(input),"https://fixture.invalid").searchParams.get("key")!;
  if (key === "timeout") return new Promise<Response>((_resolve,reject)=>
    options?.signal?.addEventListener("abort",()=>reject(options.signal?.reason),{once:true}));
  return new Promise<Response>(reply=>requests.push({key,signal:options?.signal,reply}));
};
const answer=(index:number,data:unknown,status=200)=>requests[index].reply(new Response(JSON.stringify(data),{status}));
try {
  const all=Array.from({length:10},()=>resolveAssetUrl("shared"));
  assert.equal(requests.length,1);
  assert.ok(all.every(promise=>promise===all[0]),"one in-flight operation, not ten identical requests");
  answer(0,{url:"/shared?v=1"});
  assert.deepEqual(await Promise.all(all),Array(10).fill("/shared?v=1"));
  assert.equal(await resolveAssetUrl("shared"),"/shared?v=1");assert.equal(requests.length,1);
  now+=9*60_000;
  const fresh=resolveAssetUrl("shared");assert.equal(requests.length,2);
  answer(1,{url:"/shared?v=2"});assert.equal(await fresh,"/shared?v=2");

  for (const [key,data,status] of [["denied",{},403],["empty",{},200],["wrong-type",{url:22},200],["whitespace",{url:" "},200]] as const) {
    const count: number = requests.length;
    const failed = resolveAssetUrl(key);
    const rejection=assert.rejects(failed);
    answer(count,data,status);await rejection;
    const retry=resolveAssetUrl(key);assert.equal(requests.length,count+2,"failed requests do not poison retries");
    answer(count+1,{url:`/${key}`});assert.equal(await retry,`/${key}`);
  }

  const count=requests.length;
  const obsolete=resolveAssetUrl("invalidate-race");
  const rejection=assert.rejects(obsolete,/invalidated/);
  invalidateAssetUrl("invalidate-race");
  assert.equal(requests[count].signal?.aborted,true);
  const replacement=resolveAssetUrl("invalidate-race");
  // Even a transport ignoring abort cannot populate the cache with late data.
  answer(count,{url:"/obsolete"});await rejection;
  assert.equal(resolveAssetUrl("invalidate-race"),replacement,"old cleanup cannot erase the replacement request");
  answer(count+1,{url:"/replacement"});await replacement;
  assert.equal(await resolveAssetUrl("invalidate-race"),"/replacement");

  const start=requests.length;
  const population=Array.from({length:260},(_,index)=>resolveAssetUrl(`bounded-${index}`));
  for (let index=0;index<260;index++) answer(start+index,{url:`/bounded-${index}`});
  await Promise.all(population);
  const before=requests.length;
  const evicted=resolveAssetUrl("bounded-0");assert.equal(requests.length,before+1,"inactive cache is bounded");
  answer(before,{url:"/bounded-0-fresh"});await evicted;
  assert.equal(await resolveAssetUrl("bounded-259"),"/bounded-259");

  // Real production timeout, no shortened test setting or fake successful URL.
  const started=performance.now();
  await assert.rejects(resolveAssetUrl("timeout"),error=>error instanceof DOMException && error.name === "AbortError");
  assert.ok(performance.now()-started>=14_000,"the declared 15s timeout was exercised");
  console.log("Asset URL cache passed: shared request, TTL, invalidation race, aborted transport, bounded cache and failed retry");
} finally {globalThis.fetch=originalFetch;Date.now=originalNow;}
}
void run().catch(error=>{console.error(error);process.exitCode=1;});
