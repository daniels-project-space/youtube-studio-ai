import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = process.env.CHANNEL_RESEARCH_PROOF_DIR;
if (!temp || path.dirname(temp) !== "/tmp" || !path.basename(temp).startsWith("channel-research-proof-")) throw new Error("Use the bounded proof runner");
let source = await readFile(path.join(root, "scripts/test-channel-research-backend.mjs"), "utf8");
function replaceOnce(before, after) {
  assert.equal(source.split(before).length, 2, `Proof fixture anchor is not unique: ${before.slice(0, 60)}`);
  source = source.replace(before, after);
}
replaceOnce('const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");', `const root = ${JSON.stringify(root)};`);
replaceOnce('import { copyFile, mkdir, readFile, readlink, symlink, writeFile }', 'import { copyFile, cp, mkdir, readFile, readlink, symlink, writeFile }');
const setupStart = source.indexOf('  for (const file of ["package.json"');
const setupEnd = source.indexOf('  const loader = ', setupStart);
assert.ok(setupStart > 0 && setupEnd > setupStart);
source = source.slice(0, setupStart) + `
  await cp(path.join(root,"src/lib"),path.join(project,"src/lib"),{recursive:true});
  await cp(path.join(root,"src/engine"),path.join(project,"src/engine"),{recursive:true});
  for (const file of ["package.json","tsconfig.json","convex/auth.config.ts","convex/workshopDesignImports.ts","convex/studioFunctions.ts","convex/_generated/server.js","convex/_generated/server.d.ts","convex/_generated/dataModel.d.ts","convex/_generated/api.js","convex/_generated/api.d.ts"]) { const target=path.join(project,file);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(root,file),target); }
  await symlink(path.join(root,"node_modules"),path.join(project,"node_modules"),"dir");
  await writeFile(path.join(project,"convex/schema.ts"),'import {defineSchema,defineTable} from "convex/server";import {v} from "convex/values";export default defineSchema({channels:defineTable(v.any()).index("by_owner",["ownerId"]).index("by_owner_slug",["ownerId","slug"]),importedWorkshopDesigns:defineTable(v.any()).index("by_owner_imported",["ownerId","importedAt"]).index("by_owner_fingerprint",["ownerId","fingerprint"]),workshopReviewCandidates:defineTable(v.any()).index("by_owner_channel_design_created",["ownerId","channelId","designFingerprint","createdAt"]).index("by_owner_channel_fingerprint",["ownerId","channelId","fingerprint"])});');
  await writeFile(path.join(project,"convex/fixture.ts"),'import {mutation,query} from "./_generated/server";import {v} from "convex/values";export const seed=mutation({args:{design:v.any()},handler:async(c,a)=>({channel:await c.db.insert("channels",{ownerId:"test-owner",family:"narrated_stock",pipeline:[{block:"script_gen",params:{seconds:200}}],moduleConfig:{},identity:{niche:"History"}}),foreign:await c.db.insert("channels",{ownerId:"foreign",family:"narrated_stock",pipeline:[],moduleConfig:{}}),design:await c.db.insert("importedWorkshopDesigns",{ownerId:"test-owner",fingerprint:a.design.fingerprint,design:a.design,importedAt:1})})});export const change=mutation({args:{id:v.id("channels")},handler:(c,a)=>c.db.patch(a.id,{pipeline:[{block:"script_gen",params:{seconds:400}}]})});export const read=query({args:{},handler:async c=>({channels:await c.db.query("channels").collect(),designs:await c.db.query("importedWorkshopDesigns").collect(),reviews:await c.db.query("workshopReviewCandidates").collect()})});');
` + source.slice(setupEnd);
replaceOnce('new SignJWT({ role: "service", owner_id: "test-owner" })', 'new SignJWT({ role: "owner", owner_id: "test-owner" })');
replaceOnce('.setSubject("service:test-owner")', '.setSubject("test-owner")');
const testStart = source.indexOf('  const ids = await client.mutation(anyApi.fixture.seed, {});');
const testEnd = source.indexOf('\n} finally {', testStart);
assert.ok(testStart > 0 && testEnd > testStart);
source = source.slice(0, testStart) + `
  const canonical=value=>JSON.stringify((function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,sort(v[k])])):v})(value));
  const hash=value=>createHash("sha256").update(canonical(value)).digest("hex");
  const content={version:"workshop-design-snapshot/v2",name:"Draft",family:"narrated_stock",entries:[{block:"script_gen",params:{seconds:300}}],channelDesign:{revision:1,name:"Concept",niche:"History",persona:"Curious",palette:["#123456"]}};
  const design={...content,fingerprint:hash(content)};
  const ids=await client.mutation(anyApi.fixture.seed,{design});
  const before=await client.query(anyApi.fixture.read,{}), channel=before.channels.find(row=>row._id===ids.channel);
  const baseline={pipeline:channel.pipeline??[],moduleConfig:channel.moduleConfig??{},disabledBlocks:channel.disabledBlocks??[],identity:channel.identity??null,family:channel.family??null,contentLane:channel.contentLane??null,styleDNA:channel.styleDNA??null,modelRouting:channel.modelRouting??null,moduleLocks:channel.moduleLocks??{},locked:channel.locked??false,budget:channel.budget??null,template:channel.template??null,language:channel.language??null,qaRubric:channel.qaRubric??null,scriptPlaybook:channel.scriptPlaybook??null,thumbnailPlaybook:channel.thumbnailPlaybook??null,thumbnailer:channel.thumbnailer??null};
  const args={ownerId:"test-owner",channelId:ids.channel,designId:ids.design,expectedBaselineFingerprint:hash(baseline),expectedDesignFingerprint:design.fingerprint};
  const created=await client.mutation(anyApi.workshopDesignImports.createReviewCandidate,args);assert.equal(created.reused,false);
  assert.deepEqual(await client.mutation(anyApi.workshopDesignImports.createReviewCandidate,args),{...created,reused:true});
  const listArgs={ownerId:"test-owner",channelId:ids.channel,designFingerprint:design.fingerprint};
  const list=await client.query(anyApi.workshopDesignImports.listReviewCandidates,listArgs);
  assert.equal(list.length,1);assert.equal(list[0].candidate.status,"unqualified");assert.deepEqual(list[0].candidate.design,design);assert.deepEqual(list[0].candidate.baseline,baseline);
  const after=await client.query(anyApi.fixture.read,{});assert.deepEqual(after.channels,before.channels);assert.deepEqual(after.designs,before.designs);assert.equal(after.reviews.length,1);
  const freshClient=new ConvexHttpClient(url);freshClient.setAuth(token);assert.deepEqual(await freshClient.query(anyApi.workshopDesignImports.listReviewCandidates,listArgs),list);
  await assert.rejects(client.mutation(anyApi.workshopDesignImports.createReviewCandidate,{...args,channelId:ids.foreign}),/access denied|not found/);
  const foreignToken=await new SignJWT({role:"owner",owner_id:"foreign"}).setProtectedHeader({alg:"ES256",kid}).setIssuer(issuer).setAudience(audience).setSubject("foreign").setIssuedAt().setExpirationTime("10m").sign(privateKey);
  const foreignClient=new ConvexHttpClient(url);foreignClient.setAuth(foreignToken);
  await assert.rejects(foreignClient.query(anyApi.workshopDesignImports.listReviewCandidates,listArgs),/denied|not found/);
  const viewerToken=await new SignJWT({role:"viewer",owner_id:"test-owner"}).setProtectedHeader({alg:"ES256",kid}).setIssuer(issuer).setAudience(audience).setSubject("viewer:test-owner").setIssuedAt().setExpirationTime("10m").sign(privateKey);
  const viewer=new ConvexHttpClient(url);viewer.setAuth(viewerToken);await assert.rejects(viewer.query(anyApi.workshopDesignImports.listReviewCandidates,listArgs),/Owner verification/);
  assert.deepEqual(await client.query(anyApi.fixture.read,{}),after);
  await client.mutation(anyApi.fixture.change,{id:ids.channel});const changed=await client.query(anyApi.fixture.read,{});
  await assert.rejects(client.mutation(anyApi.workshopDesignImports.createReviewCandidate,args),/settings changed/);
  assert.deepEqual(await client.query(anyApi.fixture.read,{}),changed);
  assert.deepEqual((await client.query(anyApi.workshopDesignImports.listReviewCandidates,listArgs))[0].candidate.baseline,baseline);
  console.log("PASS: authenticated owner created and reloaded one immutable unqualified review; duplicate reused; original channels and design unchanged");
  console.log("PASS: foreign channel, foreign owner and viewer rejected; stale baseline rejected with all synthetic tables unchanged");
` + source.slice(testEnd);
await symlink(path.join(root, "node_modules"), path.join(temp, "node_modules"), "dir");
const generated = path.join(temp, "proof.mjs"); await writeFile(generated, source);
const child = spawn(process.execPath, [generated], { cwd: root, env: process.env, stdio: "inherit" });
const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
assert.deepEqual(result, { code: 0, signal: null });
