export const RUN_FILTERS = [
  "all",
  "running",
  "queued",
  "ok",
  "failed",
  "canceled",
  "legacy",
] as const;

export type RunFilter = (typeof RUN_FILTERS)[number];

export const RUN_FILTER_LABEL: Record<RunFilter, string> = {
  all: "Current runs",
  running: "Live now",
  queued: "In queue",
  ok: "Completed",
  failed: "Needs attention",
  canceled: "Canceled",
  legacy: "Legacy archive",
};

export const INITIAL_VISIBLE_RUNS = 12;

export type AutomaticResumeState = "queued" | "running" | "complete" | "failed" | "blocked";

/** Compact operator-facing state for the bounded automatic recovery path. */
export function automaticResumeLabel(
  state: AutomaticResumeState | undefined,
  attempts = 0,
): string | null {
  if (state === "queued") return `Auto-retry queued · attempt ${Math.max(1, attempts)}/2`;
  if (state === "running") return `Auto-retry running · attempt ${Math.max(1, attempts)}/2`;
  if (state === "failed") return "Auto-retry dispatch delayed";
  if (state === "blocked") return "Automatic retry stopped · review needed";
  return null;
}

export type RunFailureDiagnostic = {
  faultDomain: string;
  cause: string;
  nextAction: string;
};

/** Turn a retained provider/pipeline error into a stable operator diagnosis. */
export function diagnoseRunFailure(error: string): RunFailureDiagnostic {
  const normalized = error.replace(/\s+/gu, " ").trim();
  if (/budget ceiling|budget[^.\n]{0,32}(?:exceeded|over)|spent \$[^.\n]{0,24}> budget/iu.test(normalized)) {
    return {
      faultDomain: "Spend boundary",
      cause: "Recorded stage spend reached the channel ceiling before completion.",
      nextAction: "Inspect per-stage spend; repair repeated upstream calls or explicitly revise the channel budget.",
    };
  }
  if (/qa[._ -]?visual|validation[-_ ]spec|spatial|occlusion|safe[-_ ]area|overlay[^.\n]{0,24}(?:failed|hidden|cut)/iu.test(normalized)) {
    return {
      faultDomain: "Visual QA",
      cause: "The retained media failed a deterministic framing, geometry, or overlay check.",
      nextAction: "Open the visual receipt, repair the producing block, then resume from that checkpoint.",
    };
  }
  if (/banana|thumbnail[^.\n]{0,36}(?:failed|gate)|punch[-_ ]?\d|face[^.\n]{0,24}(?:fix|gate)/iu.test(normalized)) {
    return {
      faultDomain: "Packaging QA",
      cause: "The thumbnail candidate failed the channel packaging gate after regeneration.",
      nextAction: "Review the retained candidates and fix the thumbnail prompt or template at its source.",
    };
  }
  if (/hookcraft|opening[^.\n]{0,48}(?:words|failed|gate)|banned filler|filler opener/iu.test(normalized)) {
    return {
      faultDomain: "Opening QA",
      cause: "The opening did not satisfy the hook, length, or banned-language contract.",
      nextAction: "Correct the script-opening constraint and rerun from the hook checkpoint.",
    };
  }
  if (/topiccraft|off[-_ ]niche|demand\/freshness\/fit|originality[^.\n]{0,32}(?:failed|gate)/iu.test(normalized)) {
    return {
      faultDomain: "Editorial fit",
      cause: "Topic qualification rejected channel fit, demand, freshness, or originality.",
      nextAction: "Inspect the topic evidence and repair selection criteria before any generation spend.",
    };
  }
  if (/unexpected non-whitespace|json[^.\n]{0,32}(?:parse|position|invalid)|schema[^.\n]{0,32}(?:failed|invalid)|malformed response/iu.test(normalized)) {
    return {
      faultDomain: "Provider payload",
      cause: "A provider response did not satisfy the persisted parser or schema contract.",
      nextAction: "Inspect the retained payload and fix the producer boundary before retrying.",
    };
  }
  if (/comfy|novita|gpu|worker|out of memory|\boom\b|timed? out|\b50[234]\b|fetch failed/iu.test(normalized)) {
    return {
      faultDomain: "Render runtime",
      cause: "The render worker or provider transport ended before returning a qualified artifact.",
      nextAction: "Check the worker receipt and checkpoint; retry only when runtime readiness is restored.",
    };
  }
  return {
    faultDomain: "Pipeline stop",
    cause: "The run terminated and retained its original failure evidence.",
    nextAction: "Open the record, identify the first failed stage, and repair that producer before resuming.",
  };
}

type RunHistoryItem = {
  channelSlug: string;
  status: string;
  /** Older records without a frozen pipeline are historic evidence, not a live recovery candidate. */
  pipelineSource?: "frozen" | "legacy_inferred";
};

export function isLegacyInferredRun(run: Pick<RunHistoryItem, "pipelineSource">): boolean {
  return run.pipelineSource === "legacy_inferred";
}

/**
 * One truthful projection powers counts, filtering, and progressive history.
 * Legacy inferred runs stay inspectable, but must not inflate an operator's
 * current failure queue or imply that the pipeline doctor can resume them.
 */
export function projectRunHistory<T extends RunHistoryItem>(
  runs: readonly T[],
  selectedSlug: string | null,
  filter: RunFilter,
  visibleLimit: number,
) {
  const scope = runs.filter((run) =>
    selectedSlug ? run.channelSlug === selectedSlug : true,
  );
  const current = scope.filter((run) => !isLegacyInferredRun(run));
  const legacy = scope.filter(isLegacyInferredRun);
  const matching = filter === "legacy"
    ? legacy
    : filter === "all"
      ? current
      : current.filter((run) => run.status === filter);
  const statusCounts = Object.fromEntries(
    RUN_FILTERS.map((status) => [
      status,
      status === "all"
        ? current.length
        : status === "legacy"
          ? legacy.length
          : current.filter((run) => run.status === status).length,
    ]),
  ) as Record<RunFilter, number>;
  const safeLimit = Math.max(0, Math.trunc(visibleLimit));
  const visible = matching.slice(0, safeLimit);

  return {
    current,
    legacy,
    matching,
    visible,
    statusCounts,
    remaining: Math.max(0, matching.length - visible.length),
  };
}
