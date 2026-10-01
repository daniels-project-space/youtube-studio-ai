import type { RenderEngineH3StageRequest, RenderEngineH3OutputReadback } from './renderEngineH3StageClient';
type Engine = {
    baseUrl: string;
    projectName: string;
    projectCapability: string;
    fetchImpl?: typeof fetch;
};
export type H3SharedScene = {
    ordinal: number;
    sceneId: string;
    requestManifestSha256: string;
    request: RenderEngineH3StageRequest;
};
export type H3SharedStatus = {
    jobId: string;
    status: string;
    manifestSha256: string;
    sceneManifestSha256: string;
    maxCostUsd: number;
    committedUsd: number;
    scenes: Array<{
        ordinal: number;
        sceneId: string;
        requestManifestSha256: string;
        state: string;
        output: {
            jobId: string;
            key: string;
            bytes: number;
            sha256: string;
            verifiedAt: number;
        } | null;
    }>;
};
async function call(engine: Engine, path: string, body?: unknown): Promise<unknown> { if (new URL(engine.baseUrl).protocol !== 'https:' || !/^[a-f0-9]{64}$/.test(engine.projectCapability))
    throw new Error('H3 shared Engine capability missing'); const response = await (engine.fetchImpl ?? fetch)(new URL(path, engine.baseUrl), { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${engine.projectCapability}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(300000) }); if (!response.ok)
    throw new Error(`Shared H3 Engine response ${response.status}`); return response.json(); }
export async function stageH3SceneBatchInRenderEngine(engine: Engine, args: {
    workflowId: string;
    ownerId: string;
    batchId: string;
    itemId: string;
    request: {
        version: 1;
        idempotencyKey: string;
        sceneManifestSha256: string;
        maxCostUsd: number;
        familyMaxCostUsd: number;
        scenes: H3SharedScene[];
    };
    repairOfJobId?: string;
}): Promise<{
    jobId: string;
    state: string;
    manifestSha256: string;
}> { const result = await call(engine, '/client/h3-scene-batches', { projectName: engine.projectName, ...args }) as { jobId: string; state: string; manifestSha256: string }; if (!/^[a-z0-9]{8,64}$/.test(result.jobId) || !/^[a-f0-9]{64}$/.test(result.manifestSha256) || typeof result.state !== 'string')
    throw new Error('Shared H3 stage receipt invalid'); return result; }
export async function getH3SceneBatchStatusInRenderEngine(engine: Engine, jobId: string): Promise<H3SharedStatus> { const result = await call(engine, `/client/h3-scene-batches?projectName=${encodeURIComponent(engine.projectName)}&jobId=${encodeURIComponent(jobId)}`) as H3SharedStatus; if (result.jobId !== jobId || !Array.isArray(result.scenes) || !result.scenes.length || new Set(result.scenes.map(s => s.sceneId)).size !== result.scenes.length)
    throw new Error('Shared H3 status identity invalid'); return result; }
export async function getH3SceneOutputInRenderEngine(engine: Engine, jobId: string, sceneId: string): Promise<RenderEngineH3OutputReadback> { const result = await call(engine, `/client/h3-scene-batches/output?projectName=${encodeURIComponent(engine.projectName)}&jobId=${encodeURIComponent(jobId)}&sceneId=${encodeURIComponent(sceneId)}`) as RenderEngineH3OutputReadback; if (result.contentType !== 'video/mp4' || !Number.isSafeInteger(result.bytes) || result.bytes < 1 || !/^[a-f0-9]{64}$/.test(result.sha256) || typeof result.url !== 'string' || new URL(result.url).protocol !== 'https:')
    throw new Error('Shared H3 output receipt invalid'); return result; }
