# Exact comic stroke-order efficiency proof

This is **native CPU tracing evidence**, not a whole-video speedup, a finished-media quality pass, or new page-generation capability. No providers, paid renders, media encodes, downsampling, point removal, model changes, or resolution changes were used.

## Measured result

The same retained `public/golden/comic/comic3d.jpg` was processed using the actual renderer's cover geometry, RGB-to-ink threshold, skeletonization, component ordering, and final float32 trajectory. Only `walk` was substituted. Every accepted point and the complete resulting sequence remained identical.

| Actual panel size | Trajectory points | Original trace | Final hybrid trace | Tracing speedup |
| --- | ---: | ---: | ---: | ---: |
| 1396 × 576 | 27,675 | 81.682 s | 2.673 s | 30.6× |
| 446 × 360 | 8,557 | 7.470 s | 0.755 s | 9.9× |
| 495 × 450 | 10,391 | 11.004 s | 0.919 s | 12.0× |

The first panel's largest connected component contained 25,458 points. Its separately timed original traversal took 78.102 s; the initial KD-tree candidate took 2.251 s, with exactly the same tuple sequence.

The original large measurements were retained and reused for the final hybrid comparison, rather than rerunning the same slow original. The hybrid output was compared directly with the already-verified first candidate and against the original full-sequence hashes. Timing differences between subsequent candidate runs are ordinary local measurement variation; these are not cross-machine latency guarantees.

## Why this implementation

The original rebuilt a NumPy array from the shrinking Python list on every point and scanned that whole array. The replacement retains original point IDs and uses the already-installed `cKDTree` to find active nearby points. A radius query includes all equidistant candidates; exact integer squared distance and lowest original ID reproduce the original `argmin` tie behavior. Deleted tree points are filtered, and the tree is rebuilt after its active population falls below half. Working storage is linear in point count; no all-pairs matrix or unbounded cache is introduced. Adversarial query patterns are not claimed to have a universal subquadratic bound.

An initial candidate added overhead for small components: 250 synthetic cases totaled 2.493 s original versus 3.448 s candidate. The final hybrid preserves the original traversal for inputs of 512 points or fewer. Fresh comparisons of the same cases totaled 2.503 s original versus 2.510 s hybrid while retaining the large real-art gains. This threshold is a performance crossover, not a quality or point-count cap.

## Retained evidence and reproducible source

- `baseline-and-kdtree.json`: compact projection of the first observed 256-case report, including actual baseline/candidate timings, full sequence hashes, runtime/dependency/image hashes, and a SHA256 of the original detailed report. The baseline renderer SHA256 is `b537b219400b638b288171cd48afdd23f5c8746fb98ad4e0282c875cf4e43e31`.
- `hybrid.json`: final hybrid timings, original-sequence parity, and fresh small-input comparisons. Large original timings are explicitly reused, not reported as freshly measured.
- `runtime-binding.json`: AST identity between the independently measured hybrid function and the function actually applied to `scripts/mc_page_render.py`. The full renderer also contains separately reviewed opening/reveal changes; this proof binds only `walk`.
- `src/lib/__tests__/helpers/motionComicStrokeOrderHarness.py`: executable source with the frozen simple original reference and AST extraction of the actual runtime functions. It performs 250 deterministic random/pathological checks, including duplicates, equal-distance original-index ties, 512/513 boundaries, 2,048-point inputs, and repeated tree-rebuild opportunities. It also checks a 1,227-point connected native-art crop and the complete crop trajectory, without encoding media.
- `src/lib/__tests__/motionComicStrokeOrder.test.mjs`: normal CI entrypoint; no large original benchmark is added to the full suite.

Normal bounded regression:

```sh
node src/lib/__tests__/motionComicStrokeOrder.test.mjs
```

Compare the current real full-size trajectories against the retained original hashes without repeating the slow original:

```sh
python3 src/lib/__tests__/helpers/motionComicStrokeOrderHarness.py --large-evidence test-fixtures/comic-stroke-efficiency/baseline-and-kdtree.json
```

Add `--benchmark-large` only when fresh original-versus-current timing is needed. That deliberately reruns the slow frozen original and is not normal CI work.

Limits: one existing comic image at three actual layout sizes, not a diverse-channel visual study; integer pixel-coordinate behavior, not arbitrary float inputs or integer-overflow semantics; exact trajectory parity, not a claim that reveal timing, audio, page composition, provider conditioning, or the whole native master has passed QA. The initial process RSS includes the whole benchmark and imported imaging stack, not an isolated candidate memory measurement.
