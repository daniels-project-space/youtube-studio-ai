/**
 * Two TRIVIAL dummy blocks for the Phase-1 smoke test (build-plan P1 "done
 * when: a dummy 2-block pipeline runs end-to-end").
 *
 *   echo_seed  — produces "topic"          (no consumes)
 *   echo_sink  — consumes "topic"          (produces "marker")
 *
 * They exercise REAL engine behavior: echo_seed writes a value into the store,
 * the runner carries it forward, echo_sink reads it back and proves the wiring.
 * No mocks-of-itself — echo_sink genuinely reads what echo_seed produced.
 */
import type { Block } from "@/engine/types";

export const echoSeed: Block = {
  id: "echo_seed",
  consumes: [],
  produces: ["topic"],
  run: async (ctx) => {
    const topic =
      (ctx.params.topic as string | undefined) ?? "lofi beats to relax/study to";
    ctx.log(`echo_seed producing topic`, { topic });
    return { topic };
  },
};

export const echoSink: Block = {
  id: "echo_sink",
  consumes: ["topic"],
  produces: ["marker"],
  run: async (ctx) => {
    const topic = ctx.store["topic"];
    if (typeof topic !== "string" || topic.length === 0) {
      throw new Error(
        `echo_sink expected a non-empty "topic" in the store but got: ${JSON.stringify(topic)}`,
      );
    }
    const marker = `seen:${topic}@${ctx.runId}`;
    ctx.log(`echo_sink consumed topic, writing marker`, { marker });
    return { marker };
  },
};
