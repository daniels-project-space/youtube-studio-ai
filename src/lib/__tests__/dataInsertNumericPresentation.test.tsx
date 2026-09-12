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
  frame = 32;
  const entering = renderToStaticMarkup(<DataInsert kind="big_stat" value="$1.2 million" />);
  assert.ok(entering.includes(' million</div>'), 'Animation must not swallow the space before the magnitude');
  console.log('DATA INSERT NUMERIC PRESENTATION PASS — actual component, exact settled text, preserved spacing and signed/zero geometry');
}
main().finally(() => { loader._load = original; }).catch((error) => { console.error(error); process.exitCode = 1; });
