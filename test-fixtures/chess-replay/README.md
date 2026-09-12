# Legal chess replay — visual-only development proof

Four actual native 1920×1080/30fps outputs from the repaired core; no generated artwork or narration. AAC is native silence. Fixtures use synthetic two-second move intervals and are not automated channel, TTS alignment, module registration or publishing proof.

- [Opening, White view](opening-white.mp4): 360 frames / 12 video seconds.
- [Both castles, Black view](castling-black.mp4): 120 frames / 4 seconds.
- [En passant](en-passant.mp4): 120 frames / 4 seconds.
- [Underpromotion, Black view](promotion.mp4): 120 frames / 4 seconds.

Matching JSON records retain complete manifests, source-code hashes, video hashes and measured local render time. All hashes were rechecked against the final source and files. [Frame parity](final-frame-parity.json) proves all 720 decoded frames/timestamps equal the initial visual candidates reviewed across 48 samples, including before/mid/settled/final state of every move. This is video identity, not an audible-content or complete assembly qualification. Native containers include a small AAC padding tail.

Reproduce with `pnpm exec tsx scripts/render-chess-replay-proof.ts <new-output-directory>`. The optional third argument filters a clip by name prefix. Never substitute these fixed fixture scripts/IDs for real source selection, narration or Story Spine timing in the automatic-channel benchmark.

See [scope, defects and remaining work](../../docs/CHESS_REPLAY_FOUNDATION_2026-09.md).
