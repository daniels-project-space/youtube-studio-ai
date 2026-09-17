# Chess replay native-render qualification (17 September 2026)

Status: **native visual proof passed; production module remains unqualified**.

The existing chess replay foundation was exercised through the actual Scene
Compiler renderer, not a mock or a still-image montage. The local proof command
was:

```bash
npx tsx scripts/render-chess-replay-proof.ts /tmp/chess-replay-proof-current.hEsCGt
npm run proof:chess-replay -- /tmp/chess-replay-proof-current.hEsCGt
```

The four retained diagnostic outputs cover ordinary opening play, both-side
castling, en-passant capture, and underpromotion. The validator examined the
full decoded video streams and required:

- 1920×1080 geometry, 30 fps, and frame-count parity with the scene manifest;
- manifest coverage from `t=0` through the declared duration with no gaps;
- at least 4 decoded visual samples per second and more than one unique visual
  sample, preventing a silent frozen output;
- no unexpected near-black interval longer than 350 ms.

All four local outputs passed those checks. Independent frame/contact-sheet
review also found readable board geometry, orientation/theme changes, legal
piece movement, castling king-and-rook movement, en-passant removal, and the
promotion-to-knight state without clipping or black frames.

This evidence does **not** qualify a shippable chess channel. The remaining
gates are real paid narration timing, final visual QA, recovery of a partially
completed episode without replaying accepted work, automatic legal-source
selection, owner locks, and architect/catalog discovery. No provider, R2,
Convex, YouTube, or publication call was made by this proof.

