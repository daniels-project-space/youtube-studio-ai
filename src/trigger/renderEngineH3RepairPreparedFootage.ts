/** Explicit manual repair staging. This task cannot release a GPU or resume a schedule. */
import { task } from '@trigger.dev/sdk';
import { bootstrapSecrets } from '@/lib/bootstrap';
import { getObjectBytes } from '@/lib/storage';
import { PREPARED_METADATA_READ, decodePreparedMetadata } from '@/lib/preparedMediaStorage';
import { planWeekPreparationKey } from '@/lib/planWeekPreparation';
import { sha256BytesHex, sha256Hex } from '@/lib/sha256';
import { canonicalJson } from '@/lib/canonicalJson';
import { getH3SceneBatchStatusInRenderEngine, stageH3SceneBatchInRenderEngine, type H3SharedScene } from '@/lib/renderEngineH3SceneBatchClient';
import { renderEngineH3SharedStagedFootageKey, type RenderEngineH3StagedFootage } from './planWeekPreparedImages';
export type H3PreparedRepairArgs = {
    ownerId: string;
    channelSlug: string;
    batchId: string;
    itemId: string;
    repairOfJobId: string;
    sceneIds: string[];
    maxCostUsd: number;
};
export async function stageH3PreparedRepair(args: H3PreparedRepairArgs) {
    if (![args.ownerId, args.channelSlug, args.batchId, args.itemId, args.repairOfJobId].every(v => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(v)) || !Array.isArray(args.sceneIds) || !args.sceneIds.length || new Set(args.sceneIds).size !== args.sceneIds.length || !Number.isFinite(args.maxCostUsd) || args.maxCostUsd < 1.22 || args.maxCostUsd > 10)
        throw new Error('Exact H3 manual repair identity and cap required');
    const stage = decodePreparedMetadata(await getObjectBytes(renderEngineH3SharedStagedFootageKey(args), undefined, PREPARED_METADATA_READ)) as RenderEngineH3StagedFootage;
    if (stage.version !== 'render-engine-h3-staged-footage/v2' || stage.ownerId !== args.ownerId || stage.batchId !== args.batchId || stage.itemId !== args.itemId || stage.channelSlug !== args.channelSlug || stage.engine.site !== 'https://jovial-camel-68.convex.site' || stage.engine.projectName !== 'youtube-studio-ai' || !stage.sharedBatchJobId || !stage.sceneManifestSha256)
        throw new Error('H3 original shared receipt differs');
    const engine = { baseUrl: stage.engine.site, projectName: stage.engine.projectName, projectCapability: process.env.RENDER_ENGINE_PROJECT_TOKEN?.trim() ?? '' };
    const status = await getH3SceneBatchStatusInRenderEngine(engine, args.repairOfJobId);
    if (status.sceneManifestSha256 !== stage.sceneManifestSha256 || !['failed', 'completed', 'cancelled'].includes(status.status))
        throw new Error('H3 repair parent is not the same terminal family');
    const sourceBytes = await getObjectBytes(planWeekPreparationKey(args).replace(/\/inputs\.json$/, '/h3-scenes.json'), undefined, PREPARED_METADATA_READ);
    if (sha256BytesHex(sourceBytes) !== stage.sceneManifestSha256)
        throw new Error('H3 repair frozen scene manifest changed');
    const source = decodePreparedMetadata(sourceBytes) as {
        scenes: H3SharedScene[];
    };
    if (!Array.isArray(source.scenes) || source.scenes.length !== status.scenes.length)
        throw new Error('H3 repair source order missing');
    const scenes = source.scenes.filter(scene => args.sceneIds.includes(scene.sceneId)).map(scene => { const state = status.scenes.find(s => s.sceneId === scene.sceneId && s.ordinal === scene.ordinal); if (!state || !['failed', 'rejected'].includes(state.state))
        throw new Error('H3 repair cannot replace successful or pending scenes'); return { ordinal: scene.ordinal, sceneId: scene.sceneId, request: scene.request, requestManifestSha256: state.requestManifestSha256 }; });
    if (scenes.length !== args.sceneIds.length)
        throw new Error('H3 repair contains unknown scene IDs');
    return stageH3SceneBatchInRenderEngine(engine, { workflowId: stage.engine.workflowId, ownerId: args.ownerId, batchId: args.batchId, itemId: args.itemId, repairOfJobId: args.repairOfJobId, request: { version: 1, idempotencyKey: `studio-h3-repair-${sha256Hex(canonicalJson([stage.sceneManifestSha256, args.repairOfJobId, scenes.map(s => s.sceneId), args.maxCostUsd])).slice(0, 48)}`, sceneManifestSha256: stage.sceneManifestSha256, maxCostUsd: args.maxCostUsd, familyMaxCostUsd: status.maxCostUsd, scenes } });
}
export const renderEngineH3RepairPreparedFootageTask = task({ id: 'render-engine-h3-repair-prepared-footage', maxDuration: 1800, retry: { maxAttempts: 1 }, run: async (args: H3PreparedRepairArgs) => { await bootstrapSecrets(); return stageH3PreparedRepair(args); } });
