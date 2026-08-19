import assert from "node:assert/strict";

import { parseBingResults } from "@/lib/webSearch";

// Fixtures below mirror the real, live Bing HTML structure captured while
// building this parser (www.bing.com/search?q=..., fetched with a desktop
// Chrome UA): results live in <ol id="b_results">, each organic result is a
// <li class="b_algo"> containing an <h2><a href="...ck/a?...&u=a1<base64>...">
// title</a></h2> and a <div class="b_caption"><p>snippet</p></div>. Bing
// wraps every result href in a base64("a1" + url) click-tracking redirect —
// these fixtures use the exact real encoding so decodeBingRedirectUrl is
// exercised against the true wire format, not an invented shortcut.

const NORMAL_RESULTS_HTML = `
<!DOCTYPE html><html><head><title>test query - Bing</title></head><body>
<div id="b_content">
<ol id="b_results" class="">
<li class="b_algo" data-id iid=SERP.5130><h2 class=""><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=1ef12c39&amp;u=a1aHR0cHM6Ly93d3cudGVzdC5kZS8&amp;ntb=1" h="ID=SERP,5130.2">Startseite | Stiftung Warentest &amp; Ratgeber</a></h2><div class="b_caption"><p class="b_lineclamp2"><span class="news_dt">Vor einem Tag</span>&nbsp;&#0183;&#32;Stiftung Warentest: Testberichte zu Elektronik und Finanzen</p></div></li>
<li class="b_algo" data-id iid=SERP.5140><h2 class=""><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=b4268f8a&amp;u=a1aHR0cHM6Ly93d3cuc3BlZWR0ZXN0Lm5ldC8&amp;ntb=1" h="ID=SERP,5140.2">Speedtest by Ookla - The Global Broadband Speed Test</a></h2><div class="b_caption"><p class="b_lineclamp2">Test your internet speed on any device with Speedtest by Ookla, available for free.</p></div></li>
<li class="b_algo" data-id iid=SERP.5150><h2 class=""><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=4e021d91&amp;u=a1aHR0cHM6Ly9leGFtcGxlLm9yZy9wYWdl&amp;ntb=1" h="ID=SERP,5150.2">Example Domain Page</a></h2><div class="b_caption"><p class="b_lineclamp2">This domain is for use in illustrative examples.</p></div></li>
</ol>
</div>
</body></html>
`;

// A genuine Bing "zero organic results" page: #b_results renders (the SERP
// shell executed a normal search) but contains no <li class="b_algo"> items.
const NO_RESULTS_HTML = `
<!DOCTYPE html><html><head><title>no results - Bing</title></head><body>
<div id="b_content">
<ol id="b_results" class="">
</ol>
</div>
</body></html>
`;

// A page where the results container is entirely absent — e.g. a consent
// wall, CAPTCHA interstitial, or a markup change so large the shell itself
// is unrecognizable. Must throw, never silently return [].
const MISSING_CONTAINER_HTML = `
<!DOCTYPE html><html><head><title>Bing</title></head><body>
<div id="b_content"><div class="consent-wall">Please accept cookies to continue.</div></div>
</body></html>
`;

// A page where #b_results renders but every item's markup has drifted (no
// recognizable <h2><a href=...>...</a></h2> title/link). Must throw — a
// present-but-unparseable item list is a structure change, not zero results.
const MALFORMED_ITEMS_HTML = `
<!DOCTYPE html><html><head><title>test query - Bing</title></head><body>
<div id="b_content">
<ol id="b_results" class="">
<li class="b_algo" data-id iid=SERP.5130><div class="totally-different-layout">Bing changed its markup</div></li>
<li class="b_algo" data-id iid=SERP.5140><div class="totally-different-layout">Another drifted item</div></li>
</ol>
</div>
</body></html>
`;

function testParsesNormalResults(): void {
  const results = parseBingResults(NORMAL_RESULTS_HTML);
  assert.equal(results.length, 3);
  assert.deepEqual(results[0], {
    title: "Startseite | Stiftung Warentest & Ratgeber",
    url: "https://www.test.de/",
    snippet: "Vor einem Tag · Stiftung Warentest: Testberichte zu Elektronik und Finanzen",
  });
  assert.deepEqual(results[1], {
    title: "Speedtest by Ookla - The Global Broadband Speed Test",
    url: "https://www.speedtest.net/",
    snippet: "Test your internet speed on any device with Speedtest by Ookla, available for free.",
  });
  assert.deepEqual(results[2], {
    title: "Example Domain Page",
    url: "https://example.org/page",
    snippet: "This domain is for use in illustrative examples.",
  });
  console.log("webSearch: parses normal Bing results + decodes ck/a redirects — passed");
}

function testRespectsLimit(): void {
  const results = parseBingResults(NORMAL_RESULTS_HTML, 2);
  assert.equal(results.length, 2, "must respect the limit parameter");
  assert.equal(results[0].url, "https://www.test.de/");
  assert.equal(results[1].url, "https://www.speedtest.net/");
  console.log("webSearch: respects limit parameter — passed");
}

function testGenuineNoResultsReturnsEmptyArray(): void {
  const results = parseBingResults(NO_RESULTS_HTML);
  assert.deepEqual(results, [], "an empty, present #b_results must mean zero results");
  console.log("webSearch: genuine no-results page returns [] — passed");
}

function testMissingContainerThrows(): void {
  assert.throws(
    () => parseBingResults(MISSING_CONTAINER_HTML),
    /results container.*not found/,
    "a missing #b_results (consent wall / CAPTCHA / unrecognized page) must throw, not return []",
  );
  console.log("webSearch: missing results container throws (never silently []) — passed");
}

function testMalformedItemsThrow(): void {
  assert.throws(
    () => parseBingResults(MALFORMED_ITEMS_HTML),
    /none matched the expected title\/link shape/,
    "present-but-unparseable result items must throw, not return []",
  );
  console.log("webSearch: malformed result items throw (never silently []) — passed");
}

function main(): void {
  testParsesNormalResults();
  testRespectsLimit();
  testGenuineNoResultsReturnsEmptyArray();
  testMissingContainerThrows();
  testMalformedItemsThrow();
  console.log("webSearch tests passed");
}

main();
