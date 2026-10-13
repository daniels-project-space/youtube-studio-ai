import { validateStageRequest, type RenderEngineH3StageRequest, type RenderEngineH3OutputReadback } from './renderEngineH3StageClient';
import { studioH3Json } from './studioEngineH3Http';
import { STUDIO_ENGINE_BUCKET, STUDIO_ENGINE_PROJECT, STUDIO_ENGINE_H3_WORKFLOW } from './studioRenderEngineWorkflows';
import { sha256Hex } from './sha256';
type Engine = {
    baseUrl: string;
    projectName: string;
    apiKey: string;
    fetchImpl?: typeof fetch;
};
export type H3SharedScene = {
    ordinal: number;
    sceneId: string;
    requestManifestSha256: string;
    request: RenderEngineH3StageRequest;
};
export type H3ModuleSceneIdentity = Readonly<{
    ordinal: number;
    sceneId: string;
    requestManifestSha256: string;
}>;
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
async function call(engine: Engine, path: string, body?: unknown): Promise<unknown> {
    const response = await studioH3Json(engine, path, body);
    if (response.status < 200 || response.status >= 300) throw new Error(`Shared H3 Engine response ${response.status}`);
    return response.body;
}
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
    sourceKind?: "module-run";
    repairOfJobId?: string;
}): Promise<{
    jobId: string;
    state: string;
    manifestSha256: string;
}> {
    if (args.workflowId !== STUDIO_ENGINE_H3_WORKFLOW.workflowId || !args.request.scenes.length || args.request.scenes.length > 60) throw new Error('H3 batch must use the registered Studio workflow');
    for (const scene of args.request.scenes) {
        validateStageRequest(scene.request, STUDIO_ENGINE_PROJECT);
        if (scene.request.profileRevisionSha256 !== STUDIO_ENGINE_H3_WORKFLOW.profileRevisionSha256 || scene.requestManifestSha256 !== sha256Hex(JSON.stringify(scene.request))) throw new Error('H3 scene model/request identity changed');
    }
    const result = await call(engine, '/client/h3-scene-batches', { projectName: engine.projectName, ...args }) as { jobId: string; state: string; manifestSha256: string }; if (!/^[a-z0-9]{8,64}$/.test(result.jobId) || !/^[a-f0-9]{64}$/.test(result.manifestSha256) || typeof result.state !== 'string')
    throw new Error('Shared H3 stage receipt invalid'); return result; }
export async function admitModuleH3RunInRenderEngine(engine: Engine, source: {
    ownerId: string;
    channelId: string;
    channelSlug: string;
    batchId: string;
    requestKey: string;
    moduleId: string;
    runId: string;
    itemKey: string;
    sceneSourceSha256: string;
    sceneManifestSha256: string;
    expectedScenes: H3ModuleSceneIdentity[];
}): Promise<{ batchId: string; handoffSha256: string; reused: boolean }> {
    const validId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
    if (![source.ownerId, source.channelId, source.channelSlug, source.batchId, source.moduleId, source.runId, source.itemKey].every(validId) ||
        !/^[A-Za-z0-9:_-]{16,200}$/.test(source.requestKey) ||
        !/^[a-f0-9]{64}$/.test(source.sceneSourceSha256) || !/^[a-f0-9]{64}$/.test(source.sceneManifestSha256) ||
        !source.expectedScenes.length || source.expectedScenes.length > 60 ||
        source.expectedScenes.some((scene, index) => scene.ordinal !== index || !validId(scene.sceneId) || !/^[a-f0-9]{64}$/.test(scene.requestManifestSha256)) ||
        new Set(source.expectedScenes.map(scene => scene.sceneId)).size !== source.expectedScenes.length) {
        throw new Error("Immutable module H3 source is invalid");
    }
    const manifestSha256 = sha256Hex(JSON.stringify({
        ownerId: source.ownerId,
        channelId: source.channelId,
        channelSlug: source.channelSlug,
        batchId: source.batchId,
        requestKey: source.requestKey,
        moduleId: source.moduleId,
        runId: source.runId,
        itemKey: source.itemKey,
        sceneSourceSha256: source.sceneSourceSha256,
        sceneManifestSha256: source.sceneManifestSha256,
        expectedScenes: source.expectedScenes.map(({ ordinal, sceneId, requestManifestSha256 }) => ({ ordinal, sceneId, requestManifestSha256 })),
    }));
    const result = await call(engine, "/client/module-h3-batches/admit", { projectName: engine.projectName, ...source, manifestSha256 }) as {
        batchId: string; handoffSha256: string; reused: boolean;
    };
    if (result.batchId !== source.batchId || result.handoffSha256 !== manifestSha256 || typeof result.reused !== "boolean") {
        throw new Error("Render Engine returned a mismatched module H3 admission receipt");
    }
    return result;
}
export async function getH3SceneBatchStatusInRenderEngine(engine: Engine, jobId: string): Promise<H3SharedStatus> { const result = await call(engine, `/client/h3-scene-batches?projectName=${encodeURIComponent(engine.projectName)}&jobId=${encodeURIComponent(jobId)}`) as H3SharedStatus; if (result.jobId !== jobId || !Array.isArray(result.scenes) || !result.scenes.length || new Set(result.scenes.map(s => s.sceneId)).size !== result.scenes.length)
    throw new Error('Shared H3 status identity invalid'); return result; }
export async function getH3SceneOutputInRenderEngine(engine: Engine, jobId: string, sceneId: string): Promise<RenderEngineH3OutputReadback> { const result = await call(engine, `/client/h3-scene-batches/output?jobId=${encodeURIComponent(jobId)}&sceneId=${encodeURIComponent(sceneId)}`) as RenderEngineH3OutputReadback; if (result.bucket !== STUDIO_ENGINE_BUCKET || !result.key?.startsWith(`projects/${STUDIO_ENGINE_PROJECT}/`) || result.key.split('/').some(part => !part || part === '.' || part === '..') || result.contentType !== 'video/mp4' || !Number.isSafeInteger(result.bytes) || result.bytes < 1 || !/^[a-f0-9]{64}$/.test(result.sha256) || typeof result.url !== 'string' || new URL(result.url).protocol !== 'https:' || !new URL(result.url).hostname.endsWith('.r2.cloudflarestorage.com') || new URL(result.url).username || new URL(result.url).password || new URL(result.url).hash)
    throw new Error('Shared H3 output receipt invalid'); return result; }
