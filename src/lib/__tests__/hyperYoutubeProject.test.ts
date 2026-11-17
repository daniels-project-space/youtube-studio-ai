import assert from "node:assert/strict";
import { resolveHyperYoutubeProject } from "@/lib/hyperYoutubeProject";

async function main() {
  const project={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",output:{bucket:"youtube",prefix:"projects/youtube/"}};
  let calls=0;
  const fetcher=(async (url:RequestInfo|URL,init?:RequestInit)=>{
    calls++;assert.equal(String(url),"https://hrs.example/api/v1/projects/self");
    assert.equal((init?.headers as Record<string,string>).authorization,"Bearer fixture");
    return Response.json({project,applicationGuidance:{application:"youtube-studio"}});
  }) as typeof fetch;
  const binding=await resolveHyperYoutubeProject({baseUrl:"https://hrs.example",projectToken:"fixture",fetch:fetcher});
  assert.equal(binding.projectId,project.id);assert.equal(binding.outputBucket,"youtube");assert.equal(binding.outputPrefix,"projects/youtube/");
  assert.equal(calls,1);
  const foreign=(async()=>Response.json({project,applicationGuidance:{application:"lito"}})) as typeof fetch;
  await assert.rejects(resolveHyperYoutubeProject({baseUrl:"https://hrs.example",projectToken:"fixture",fetch:foreign}),/YouTube project/);
  const escaped=(async()=>Response.json({project:{...project,output:{...project.output,prefix:"projects/../foreign/"}},applicationGuidance:{application:"youtube-studio"}})) as typeof fetch;
  await assert.rejects(resolveHyperYoutubeProject({baseUrl:"https://hrs.example",projectToken:"fixture",fetch:escaped}),/YouTube project/);
  process.env.YOUTUBE_STUDIO_WORKSHOP_PRIVATE="1";
  process.env.HRS_WORKSHOP_PROJECT_ID=project.id;
  process.env.HRS_WORKSHOP_OUTPUT_PREFIX="projects/youtube-studio-workshop/";
  const own={...project,output:{bucket:"youtube-studio-ai-private",prefix:"projects/youtube-studio-workshop/"}};
  const ownFetch=(async()=>Response.json({project:own})) as typeof fetch;
  assert.equal((await resolveHyperYoutubeProject({baseUrl:"https://hrs.example",projectToken:"fixture",fetch:ownFetch})).outputBucket,"youtube-studio-ai-private");
  await assert.rejects(resolveHyperYoutubeProject({baseUrl:"https://hrs.example",projectToken:"fixture",fetch:fetcher}),/YouTube project/);
  process.env.HRS_WORKSHOP_PROJECT_ID="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await assert.rejects(resolveHyperYoutubeProject({baseUrl:"https://hrs.example",projectToken:"fixture",fetch:ownFetch}),/YouTube project/);
  console.log("HRS YouTube project discovery: ok");
}
void main();
