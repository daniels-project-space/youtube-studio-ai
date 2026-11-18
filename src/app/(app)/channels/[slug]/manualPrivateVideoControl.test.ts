import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const page = readFileSync("src/app/(app)/channels/[slug]/page.tsx", "utf8");
assert.match(page, /<div key=\{channel\._id\} className=\{styles\.view\}/, "channel-local forms must reset when the selected channel changes");
assert.match(page, /<ChannelDurationDraft key=\{channel\._id\}/, "same-channel refreshes must not remount the duration draft");
const start = page.indexOf("function ManualPrivateVideoCard");
const end = page.indexOf("function RouteQualificationBenchmarkCard", start);
assert.ok(start >= 0 && end > start);
const control = page.slice(start, end);
assert.match(control, /window\.confirm[\s\S]*No upload or schedule will start[\s\S]*thumbnail is deferred/);
assert.match(control, /readPendingPrivateBenchmark[\s\S]*if \(!existing\)[\s\S]*fetch\(`\/api\/manual-private-video\?/, "only new requests run the no-write preflight");
assert.ok(control.indexOf("if (!existing)") < control.indexOf("preparePrivateBenchmark"), "a rejected preflight must not reserve a retry key");
assert.match(control, /restartAllowed === true[\s\S]*clearAcceptedPrivateBenchmark/, "only a safely canceled request permits a new identity");
const overview = page.slice(page.indexOf("function OverviewTab"), page.indexOf("function Row"));
assert.match(overview, /NEXT_PUBLIC_YOUTUBE_AUTOMATION_PRIVATE === "1" && <ManualPrivateVideoCard channel=\{channel\} \/>/, "the existing private-only control is available on the overview");
assert.match(control, /No upload or schedule will start/);
assert.match(control, /Thumbnail generation is deferred/);

async function exerciseControl(retry: boolean, confirm: boolean, failure?: "preflight" | "post") {
  const events: string[] = [];
  const confirmations: string[] = [];
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
  let pending: { requestKey: string; maximumCostUsd: number } | null = retry
    ? { requestKey: "original-request", maximumCostUsd: 25 } : null;
  const states: unknown[] = [];
  let stateIndex = 0;
  const context = {
    React: { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value: unknown) => { states[index] = value; }];
    },
    styles: { privateVideoCard: "card", privateVideoControls: "controls" },
    Link: "a", fmtUsd: (value: number) => `$${value}`,
    window: {
      confirm: (value: string) => { events.push("confirm"); confirmations.push(value); return confirm; },
      localStorage: {}, crypto: { randomUUID: () => "new-request" },
    },
    readPendingPrivateBenchmark: () => pending,
    preparePrivateBenchmark: (_store: unknown, _id: string, maximumCostUsd: number, create: () => string) => {
      events.push("prepare");
      return pending ??= { requestKey: create(), maximumCostUsd };
    },
    clearAcceptedPrivateBenchmark: () => { events.push("clear"); pending = null; },
    fetch: async (url: string, options?: { body?: string }) => {
      events.push(options?.body ? "post" : "preflight");
      requests.push({ url, ...(options?.body ? { body: JSON.parse(options.body) } : {}) });
      if ((!options?.body && failure === "preflight") || (options?.body && failure === "post")) {
        return { ok: false, json: async () => ({ ok: false, error: "synthetic refusal" }) };
      }
      return { ok: true, json: async () => options?.body
        ? { ok: true, runId: "synthetic-run", state: "queued" }
        : { ok: true, workerCapabilityChecked: false, warning: "unverified" } };
    },
    encodeURIComponent,
  };
  const compiled = ts.transpileModule(`${control}\nglobalThis.testControl = ManualPrivateVideoCard;`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = vm.createContext(context);
  vm.runInContext(compiled, sandbox);
  const render = (sandbox as typeof sandbox & { testControl: (props: unknown) => unknown }).testControl;
  const tree = render({ channel: { _id: "channel-a", name: "Test channel" } });
  assert.match(JSON.stringify(tree), /Worker support for this channel's selected duration has not been verified/);
  const findButton = (node: any): any => node?.type === "button" ? node : node?.children?.map(findButton).find(Boolean);
  await findButton(tree).props.onClick();
  assert.match(confirmations[0]!, /Worker support for this channel's selected duration has not been verified/);
  assert.equal(events[0], "confirm");
  if (!confirm) {
    assert.deepEqual(events, ["confirm"]);
    assert.equal(requests.length, 0);
    return;
  }
  if (failure === "preflight") {
    assert.deepEqual(events, ["confirm", "preflight"]);
    assert.equal(pending, null);
    stateIndex = 0;
    assert.match(JSON.stringify(render({ channel: { _id: "channel-a", name: "Test channel" } })), /synthetic refusal/);
    return;
  }
  if (failure === "post") {
    assert.deepEqual(events, retry ? ["confirm", "prepare", "post"] : ["confirm", "preflight", "prepare", "post"]);
    assert.equal((pending as { requestKey: string } | null)?.requestKey, retry ? "original-request" : "new-request");
    return;
  }
  assert.deepEqual(events, retry ? ["confirm", "prepare", "post", "clear"] : ["confirm", "preflight", "prepare", "post", "clear"]);
  assert.equal(requests.at(-1)?.body?.requestKey, retry ? "original-request" : "new-request");
  stateIndex = 0;
  assert.match(JSON.stringify(render({ channel: { _id: "channel-a", name: "Test channel" } })), /Private video queued/);
}

async function main() {
  await exerciseControl(false, true);
  await exerciseControl(true, true);
  await exerciseControl(false, false);
  await exerciseControl(false, true, "preflight");
  await exerciseControl(true, true, "post");
  console.log("Manual private video warning, confirmation, synthetic dispatch and retry identity passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
