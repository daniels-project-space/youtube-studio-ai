import assert from 'node:assert/strict';
import Module from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let frame = 120;
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const original = loader._load;
loader._load = function(request, ...rest) {
  const resolved = original.call(this, request, ...rest) as Record<string, unknown>;
  if (request !== 'remotion') return resolved;
  return { ...resolved, AbsoluteFill: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    useCurrentFrame: () => frame, useVideoConfig: () => ({ fps: 30, durationInFrames: 210, width: 1280, height: 720 }) };
};
async function main() {
  const { DataInsert } = await import('../../remotion/DataInsert');
  for (const value of ['10.2345%', '$1.2 million', '1,2 Mio', '-0.004%', '1,234.5000']) {
    const html = renderToStaticMarkup(<DataInsert kind="big_stat" value={value} />);
    assert.ok(html.includes(`>${value}</div>`), `Settled display changed the admitted value: ${value}`);
  }
  const mixed = renderToStaticMarkup(<DataInsert kind="bar_compare" bars={[{ label: 'Before', value: -2, display: '-2%' }, { label: 'After', value: 5, display: '5%' }]} />);
  assert.match(mixed, /left:0%;width:28\.5714/);
  assert.match(mixed, /left:28\.5714[^;]*%;width:71\.4285/);
  assert.ok(mixed.includes('>-2%</span>') && mixed.includes('>5%</span>'));
  const zeros = renderToStaticMarkup(<DataInsert kind="bar_compare" bars={[{ label: 'Before', value: 0 }, { label: 'After', value: 100 }]} />);
  assert.match(zeros, /left:0%;width:0%;height:100%/, 'Zero must not get a fabricated 1.5% bar');
  const attributed = renderToStaticMarkup(<DataInsert kind="line_chart" series={[2, 4]} seriesDisplays={['2.000%', '4.000%']} seriesUnit="percent" sourceAttribution="Example Statistics Office" />);
  for (const text of ['2.000%', '4.000%', 'percent', 'Example Statistics Office']) assert.ok(attributed.includes(`>${text}</`), `Reviewed chart context disappeared: ${text}`);
  const irregular = renderToStaticMarkup(<DataInsert kind="line_chart" series={[2, 3, 4]} seriesX={[2020, 2021, 2030]} />);
  assert.match(irregular, /L 79\.4 /, 'The middle observation belongs at 10%, not 50%, of the 794px plot');
  assert.doesNotMatch(irregular, /L 397\.0 /, 'Ordinal spacing would misrepresent the reviewed years');
  for (const kind of ['big_stat', 'bar_compare'] as const) {
    const html = renderToStaticMarkup(<DataInsert kind={kind} value="4%" bars={[{ label: 'Before', value: 2 }, { label: 'After', value: 4 }]} sourceAttribution="A reviewed source with a long name" />);
    assert.ok(html.includes('>A reviewed source with a long name</div>'), `${kind} lost its attribution`);
  }
  frame = 32;
  const entering = renderToStaticMarkup(<DataInsert kind="big_stat" value="$1.2 million" />);
  assert.ok(entering.includes(' million</div>'), 'Animation must not swallow the space before the magnitude');
  console.log('DATA INSERT NUMERIC PRESENTATION PASS — actual component, exact settled text, preserved spacing and signed/zero geometry');
}
main().finally(() => { loader._load = original; }).catch((error) => { console.error(error); process.exitCode = 1; });
