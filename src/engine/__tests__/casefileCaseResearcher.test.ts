import assert from "node:assert/strict";

import {
  CASEFILE_CASE_RESEARCHER_MIN_CONFIDENCE,
  evaluateCasefileCaseResearchContent,
  researchCase,
} from "@/engine/casefileCaseResearcher";
import { __setSearchWebImplementationForTests, type WebSearchResult } from "@/lib/webSearch";

const NOW = new Date("2026-08-18T12:00:00.000Z");
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

/**
 * Realistic, classifiable, unambiguous results. Every snippet plainly
 * states a fact with no hedge words, so every derived claim state should
 * come out "established" and the whole packet should pass the reused
 * structural gate on the first iteration.
 */
const GOOD_RESULTS: WebSearchResult[] = [
  {
    title: "The Harrow Vault Closure",
    url: "https://www.harrowvaultnews.example.com/story",
    snippet: "A regional case involving the closure of the Harrow Vault Company after a court-ordered ruling.",
  },
  {
    title: "State v. Harrow Vault Company",
    url: "https://www.courtlistener.com/opinion/123456/state-v-harrow-vault/",
    snippet: "The court found that Harrow Vault Company was ordered to close its facility after the regional court ruling in 2014.",
  },
  {
    title: "Harrow Vault Closure Order",
    url: "https://www.records.example.gov/vault-closure-order",
    snippet: "The official government record documents the closure order issued against Harrow Vault Company in 2014.",
  },
  {
    title: "Economic Impact of the Harrow Vault Closure",
    url: "https://doi.org/10.1234/harrow-vault-study",
    snippet: "An academic research study documents the economic impact of the Harrow Vault Company closure on the regional community.",
  },
  {
    title: "Harrow Vault Company SEC EDGAR Filing",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=harrow+vault",
    snippet: "The SEC EDGAR filing records Harrow Vault Company's annual report disclosures related to the facility closure.",
  },
];

/** Results that never fall into any allowed primary-source provenance
 * category, however many times or ways they are searched for. */
const VAGUE_RESULTS: WebSearchResult[] = [
  {
    title: "Some blog post about a case",
    url: "https://randomblog.example.com/post-1",
    snippet: "This blog talks vaguely about some unnamed dispute without specifics.",
  },
  {
    title: "Another vague forum thread",
    url: "https://forum.example.net/thread-2",
    snippet: "A forum thread speculates about a case with no citations at all.",
  },
];

function extractPairs(promptText: string): { claimId: string; sourceId: string }[] {
  const pairs: { claimId: string; sourceId: string }[] = [];
  for (const block of promptText.split(/\n---\n/)) {
    const claimMatch = block.match(/claimId:\s*(\S+)/);
    const sourceMatch = block.match(/sourceId:\s*(\S+)/);
    if (claimMatch && sourceMatch) pairs.push({ claimId: claimMatch[1]!, sourceId: sourceMatch[1]! });
  }
  return pairs;
}

function approvingAnthropicResponse(promptText: string): Response {
  const pairs = extractPairs(promptText);
  const verdict = {
    pass: true,
    confidence: 0.92,
    issues: [] as string[],
    findings: pairs.map((pair) => ({
      claimId: pair.claimId,
      sourceId: pair.sourceId,
      supported: true,
      reason: "Claim text is a verbatim excerpt of the cited source's snippet.",
    })),
  };
  return new Response(
    JSON.stringify({
      id: "msg-case-researcher-test",
      content: [{ type: "text", text: JSON.stringify(verdict) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function withStubbedEnv(fn: () => Promise<void>): Promise<void> {
  const savedOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const savedModel = process.env.ANTHROPIC_CREATIVE_PRO_MODEL;
  const originalFetch = global.fetch;
  try {
    delete process.env.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.ANTHROPIC_CREATIVE_PRO_MODEL = "claude-case-researcher-test";
    await fn();
  } finally {
    global.fetch = originalFetch;
    __setSearchWebImplementationForTests(null);
    if (savedOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedOpenRouterKey;
    if (savedAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
    if (savedModel === undefined) delete process.env.ANTHROPIC_CREATIVE_PRO_MODEL;
    else process.env.ANTHROPIC_CREATIVE_PRO_MODEL = savedModel;
  }
}

async function testConvergesToValidPacket(): Promise<void> {
  await withStubbedEnv(async () => {
    let searchCalls = 0;
    let anthropicCalls = 0;
    __setSearchWebImplementationForTests(async () => {
      searchCalls += 1;
      return GOOD_RESULTS;
    });
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === ANTHROPIC_MESSAGES_URL) {
        anthropicCalls += 1;
        const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
        return approvingAnthropicResponse(body.messages[0]!.content);
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch;

    const packet = await researchCase({ niche: "corporate closure case" }, { now: NOW });

    // Structural shape: every claim has a linked primary source, every
    // source has a usage declaration.
    assert.ok(packet.casePacket.claims.length >= 1);
    assert.equal(packet.claimPrimarySources.length, packet.casePacket.claims.length);
    assert.equal(packet.sourceUsage.length, packet.casePacket.sourceLedger.length);
    for (const usage of packet.sourceUsage) assert.equal(usage.usage, "citation_only");

    // Real integration proof: the produced content passes the reused
    // sourceFirstAdmission.ts structural/safety gate (via the shim review),
    // not a bespoke or weaker check.
    const report = evaluateCasefileCaseResearchContent(packet, { now: NOW });
    assert.equal(report.safe, true, JSON.stringify(report.issues));

    // Anti-fabrication proof: every source and every claim traces back to
    // one of the actual stubbed search results, verbatim.
    for (const source of packet.casePacket.sourceLedger) {
      const match = GOOD_RESULTS.find((r) => r.url === source.locator);
      assert.ok(match, `source ${source.id} locator must be a real search result URL`);
      const haystack = `${match!.title}\n${match!.snippet}`.toLowerCase();
      assert.ok(haystack.includes(source.excerpt.toLowerCase()), `source ${source.id} excerpt must be verbatim`);
      // Only allowed primary-source provenance categories are used.
      assert.ok(["official_record", "court_record", "company_filing", "academic_research"].includes(source.kind));
    }
    for (const claim of packet.casePacket.claims) {
      const primary = packet.claimPrimarySources.find((p) => p.claimId === claim.id);
      assert.ok(primary, `claim ${claim.id} must have a primary source`);
      const source = packet.casePacket.sourceLedger.find((s) => s.id === primary!.sourceId);
      assert.ok(source);
      assert.equal(primary!.provenance, source!.kind);
      assert.equal(primary!.primarySourceUrl, source!.locator);
    }

    assert.ok(searchCalls >= 1);
    assert.ok(anthropicCalls >= 1);
  });
  console.log("casefileCaseResearcher: converges to a valid, well-sourced packet on good results — passed");
}

async function testVagueResultsFailClosed(): Promise<void> {
  await withStubbedEnv(async () => {
    __setSearchWebImplementationForTests(async () => VAGUE_RESULTS);
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      throw new Error(`unexpected fetch in test: ${url} (LLM should never be reached without a classifiable source)`);
    }) as typeof fetch;

    await assert.rejects(
      () => researchCase({ niche: "vague unsourceable topic" }, { now: NOW, maxIters: 1 }),
      /researchCase failed to converge|none had any source in an allowed primary-source provenance category/,
    );
  });
  console.log("casefileCaseResearcher: only vague/unsourceable results fail closed without fabricating — passed");
}

async function testSearchBackendFailurePropagates(): Promise<void> {
  await withStubbedEnv(async () => {
    let called = false;
    __setSearchWebImplementationForTests(async () => {
      called = true;
      throw new Error("Browserbase backend unreachable");
    });
    global.fetch = (async (input: RequestInfo | URL) => {
      throw new Error(`unexpected fetch in test: ${String(input)}`);
    }) as typeof fetch;

    await assert.rejects(
      () => researchCase({ niche: "any topic" }, { now: NOW }),
      /Browserbase backend unreachable/,
    );
    assert.equal(called, true);
  });
  console.log("casefileCaseResearcher: searchWeb backend failure propagates, never treated as zero results — passed");
}

async function testMinConfidenceExported(): Promise<void> {
  assert.ok(CASEFILE_CASE_RESEARCHER_MIN_CONFIDENCE > 0 && CASEFILE_CASE_RESEARCHER_MIN_CONFIDENCE <= 1);
  console.log("casefileCaseResearcher: exports a valid min-confidence threshold — passed");
}

async function main(): Promise<void> {
  await testConvergesToValidPacket();
  await testVagueResultsFailClosed();
  await testSearchBackendFailurePropagates();
  await testMinConfidenceExported();
  console.log("casefileCaseResearcher tests passed");
}

void main();
