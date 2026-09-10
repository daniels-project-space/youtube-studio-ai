import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const pagePath = "src/app/(app)/channels/[slug]/page.tsx";
const source = readFileSync(pagePath, "utf8");
const css = readFileSync("src/app/(app)/channels/[slug]/channelHub.module.css", "utf8");
const ast = ts.createSourceFile(pagePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let hrefFactory = "", queryMap = "", tabsByQuery = "";
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    if (node.name.text === "tabHref") hrefFactory = node.initializer.getText(ast);
    if (node.name.text === "QUERY_BY_TAB") queryMap = node.initializer.getText(ast);
    if (node.name.text === "TAB_BY_QUERY") tabsByQuery = node.initializer.getText(ast);
  }
  ts.forEachChild(node, visit);
};
visit(ast);
assert.ok(hrefFactory && queryMap && tabsByQuery, "Exercise the actual page's route factory, not a copied implementation");
const js = ts.transpileModule(`const TAB_BY_QUERY = ${tabsByQuery}; const QUERY_BY_TAB = ${queryMap}; return (${hrefFactory});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const factory = new Function("searchParams", "slug", js) as (query: URLSearchParams, slug: string) => (tab: string, planId?: string) => string;
const build = factory(new URLSearchParams("tab=library&plan=stale&yt=connected&got=real-channel"), "channel & room");
let cases = 0;
for (const [tab, query] of [["Overview", "overview"], ["Week ahead", "week-ahead"], ["Analytics", "analytics"], ["Library", "library"], ["SEO", "seo"], ["Pipeline", "pipeline"], ["Identity", "identity"], ["Settings", "settings"]]) {
  const url = new URL(build(tab), "https://example.invalid");
  assert.equal(decodeURIComponent(url.pathname.split("/").at(-1)!), "channel & room");
  assert.equal(url.searchParams.get("tab"), query); assert.equal(url.searchParams.has("plan"), false);
  assert.equal(url.searchParams.get("yt"), "connected"); assert.equal(url.searchParams.get("got"), "real-channel"); cases++;
}
const next = new URL(build("Week ahead", "exact-plan&one"), "https://example.invalid");
assert.equal(next.searchParams.get("plan"), "exact-plan&one");
assert.equal(next.searchParams.get("tab"), "week-ahead"); cases++;

const operating = source.slice(source.indexOf('<section className={styles.operatingProfile}'), source.indexOf('{channel.inception &&'));
assert.equal((operating.match(/<Link\s/g) ?? []).length, 4);
for (const [signal, route] of [["status", "Settings"], ["setup", "Settings"], ["pipeline", "Pipeline"]]) {
  assert.match(operating, new RegExp(`<Link href=\\{tabHref\\("${route}"\\)\\}[^>]*data-signal="${signal}"`)); cases++;
}
assert.match(operating, /tabHref\("Week ahead", nextPlan \? String\(nextPlan\.item\._id\) : undefined\)/);
assert.match(source, /id=\{`plan-\$\{p\._id\}`\}/);
assert.match(source, /open=\{selectedPlanId === String\(p\._id\) \|\| undefined\}/); cases++;
// All five setup domains remain available in the genuine Settings view.
const settings = source.slice(source.indexOf("function SettingsTab("), source.indexOf("function RouteQualificationBenchmark"));
for (const domain of ["ChannelSettingsCard", "PipelineModulesCard", "AdvancedControls", "MultiLanguageCard"]) assert.ok(settings.includes(domain));
assert.match(source, /missingSetup\.length \? `Needs \$\{missingSetup\.join\(", "\)\}` : "All five configured"/); cases++;
assert.doesNotMatch(source, /heroKicker|heroDecision/);
assert.match(source, /channel\.language && channel\.language !== "primary"/);
assert.match(source, /className=\{styles\.channelBanner\}/); cases++;
assert.match(css, /\.heroTitle h1 \{[^}]*overflow-wrap: break-word/);
assert.doesNotMatch(css.match(/\.heroTitle h1 \{[^}]*\}/)?.[0] ?? "", /ellipsis|nowrap/);
assert.match(css, /\.tabDeck \{[^}]*display: flex;[^}]*flex-wrap: wrap;/);
assert.doesNotMatch(css, /\.tabDeck\s*\{[^}]*minmax\(126px/);
assert.match(css, /\.tabButton \{[^}]*min-width: max-content;[^}]*min-height: 44px;/); cases++;
assert.match(css, /\.artFreshnessLink \{[^}]*display: inline-flex;[^}]*min-height: 44px;[^}]*align-items: center;[^}]*font: 700 0\.68rem\/1\.2/); cases++;
const hub = source.slice(source.indexOf("export default function ChannelHubPage("), source.indexOf("function ChannelInceptionProgress("));
assert.match(hub, /channelId && needsRuns \? \{ channelId, limit: 500 \} : "skip"/);
assert.doesNotMatch(hub, /headerPlan === undefined \|\|\s*\(needsRuns/);
assert.match(hub, /aria-busy=\{needsRuns && runs === undefined\}/);
assert.match(hub, /\{needsRuns && runs === undefined \? <SkeletonList rows=\{4\} \/> : <>/); cases++;
console.log(`Channel header navigation: ${cases} actual route/source contracts passed; browser geometry and live control proof are separate.`);
