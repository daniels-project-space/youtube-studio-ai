/** Discover the YouTube project's identity from its scoped HRS credential. */
export async function resolveHyperYoutubeProject(options?:{baseUrl?:string;projectToken?:string;fetch?:typeof fetch}) {
  const raw=options?.baseUrl ?? process.env.HRS_YOUTUBE_BASE_URL ?? "";
  const token=options?.projectToken ?? process.env.HRS_YOUTUBE_PROJECT_TOKEN ?? "";
  const base=new URL(raw);
  if (base.protocol!=="https:" || base.username || base.password || base.search || base.hash || !token)
    throw new Error("Invalid HRS YouTube connection");
  const response=await (options?.fetch ?? fetch)(new URL("/api/v1/projects/self",base),{method:"GET",redirect:"error",
    signal:AbortSignal.timeout(30_000),headers:{authorization:`Bearer ${token}`,accept:"application/json"}});
  if (!response.ok) throw new Error(`HRS YouTube project lookup failed (${response.status})`);
  const body=await response.json() as {project?:{id?:unknown;output?:{bucket?:unknown;prefix?:unknown}};
    applicationGuidance?:{application?:unknown}};
  const p=body?.project, output=p?.output;
  if (body?.applicationGuidance?.application!=="youtube-studio" || typeof p?.id!=="string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p.id) ||
      typeof output?.bucket!=="string" || !output.bucket || typeof output.prefix!=="string" ||
      !output.prefix.startsWith("projects/") || !output.prefix.endsWith("/") || output.prefix.includes("\\") ||
      output.prefix.split("/").some(part=>part==="."||part===".."))
    throw new Error("HRS credential does not identify a valid YouTube project");
  return {baseUrl:base.toString().replace(/\/$/,""),projectToken:token,projectId:p.id,
    outputBucket:output.bucket,outputPrefix:output.prefix};
}
