import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonicalJson";
import { configuredHyperYoutubeStageClient, type HyperYoutubeJob, type HyperYoutubeStage } from "@/lib/hyperYoutubeStageClient";

/** A stable identity lets a Trigger retry reattach to the same HRS job. */
export function hyperYoutubeStillKey(scope:{ownerId:string;channelId:string;runId:string;attempt:number;prompt:string}) {
  if (!scope.ownerId || !scope.channelId || !scope.runId || !scope.prompt || !Number.isSafeInteger(scope.attempt) || scope.attempt < 1)
    throw new Error("Invalid YouTube still identity");
  const {ownerId,channelId,runId,attempt}=scope;
  return `youtube-still:${createHash("sha256").update(canonicalJson({ownerId,channelId,runId,attempt})).digest("hex")}`;
}

export async function renderHyperYoutubeStill(args:{scope:{ownerId:string;channelId:string;runId:string;attempt:number;prompt:string};
  wait:(jobId:string,check:number)=>Promise<void>;
  client?:ReturnType<typeof configuredHyperYoutubeStageClient>;maxChecks?:number}) {
  const key=hyperYoutubeStillKey(args.scope), client=args.client ?? configuredHyperYoutubeStageClient();
  const stage:HyperYoutubeStage={modelId:"ernie-image-turbo",inputs:{prompt:args.scope.prompt}};
  let job:HyperYoutubeJob=await client.submit(stage,key);
  for(let check=0;job.state!=="completed";check++) {
    if (["failed","cancelled"].includes(job.state)) throw new Error(`HRS still job ${job.id} ended ${job.state}`);
    if (check >= (args.maxChecks ?? 720)) throw new Error(`HRS still job ${job.id} is still ${job.state}; resume the same job`);
    await args.wait(job.id,check);
    job=await client.get(job.id,stage,key);
  }
  const bytes=await client.download(job,stage,key);
  if (!job.output) throw new Error("HRS still has no verified output receipt");
  return {bytes,jobId:job.id,projectId:job.projectId,generation:job.generation,idempotencyKey:key,
    output:{bucket:job.output.bucket,key:job.output.key,sha256:job.output.sha256,bytes:job.output.bytes,contentType:job.output.contentType}};
}
