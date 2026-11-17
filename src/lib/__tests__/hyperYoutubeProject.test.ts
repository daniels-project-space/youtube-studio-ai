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
  process.env.YOUTUBE_AUTOMATION_PRIVATE="1";
  process.env.HRS_AUTOMATION_PROJECT_ID=project.id;
  process.env.HRS_AUTOMATION_OUTPUT_PREFIX="projects/automation/";
  const localProject={...project,output:{bucket:"youtube-automation",prefix:"projects/automation/"}};
  const generic=(async()=>Response.json({project:localProject})) as typeof fetch;
  assert.equal((await resolveHyperYoutubeProject({baseUrl:"https://hrs.example",projectToken:"fixture",fetch:generic})).outputBucket,"youtube-automation");
  const foreignBucket=(async()=>Response.json({project:{...localProject,output:{...localProject.output,bucket:"youtube-studio-ai-private"}}})) as typeof fetch;
  await assert.rejects(resolveHyperYoutubeProject({baseUrl:"https://hrs.example",projectToken:"fixture",fetch:foreignBucket}),/YouTube project/);
  await assert.rejects(resolveHyperYoutubeProject({baseUrl:"https://hrs.example",projectToken:"fixture",fetch:fetcher}),/YouTube project/);
  process.env.HRS_AUTOMATION_PROJECT_ID="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await assert.rejects(resolveHyperYoutubeProject({baseUrl:"https://hrs.example",projectToken:"fixture",fetch:generic}),/YouTube project/);
  console.log("HRS YouTube project discovery: ok");
}
void main();
