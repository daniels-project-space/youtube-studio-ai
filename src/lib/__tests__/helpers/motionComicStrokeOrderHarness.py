"""Bounded exact-order oracle for the actual renderer's greedy pixel traversal.

Normal CI uses a small native-image crop and synthetic sets, not the expensive
25k-point original walk. Optional --large-evidence checks those full trajectories
against retained, independently measured original hashes without repeating it.
"""
import argparse
import ast
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import time

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
from skimage.measure import label
from skimage.morphology import skeletonize

ROOT = Path(__file__).resolve().parents[4]
RENDERER = ROOT / "scripts/mc_page_render.py"
ART = ROOT / "public/golden/comic/comic3d.jpg"


def original_walk(pts):
    # Frozen pre-optimization reference, including first original-list-index tie.
    pts = list(map(tuple, pts)); cur = min(pts, key=lambda p: (p[1], p[0])); pts.remove(cur); order = [cur]
    while pts:
        a = np.array(pts); i = int(((a[:, 0] - cur[0]) ** 2 + (a[:, 1] - cur[1]) ** 2).argmin())
        cur = tuple(a[i]); order.append(cur); pts.pop(i)
    return order


def extract(path, names, namespace):
    parsed = ast.parse(path.read_text())
    functions = [node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert {node.name for node in functions} == set(names), f"Expected real functions {names} in {path}"
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(path), "exec"), namespace)
    return namespace


def synthetic_cases():
    rng = np.random.default_rng(20260912)
    grid = [(x, y) for y in range(32) for x in range(32)]
    cases = [
        ("singleton", [(4, 9)]),
        ("duplicate-small", [(3, 7)] * 200),
        ("duplicate-large", [(3, 7)] * 600),
        ("tie-oracle", [(0, 0), (1, 0), (-1, 0), (0, 1)]),
        ("row-repeated-rebuild", [(x, 0) for x in range(2048)]),
        ("reversed-row-repeated-rebuild", [(x, 0) for x in range(2047, -1, -1)]),
        ("column", [(0, y) for y in range(1024)]),
        ("grid-equal-ties", grid),
        ("shuffled-grid-equal-ties", rng.permutation(grid)),
        ("snake", [(x if y % 2 == 0 else 29 - x, y) for y in range(25) for x in range(30)]),
        ("integer-circle-ties", [(3, 4), (-3, 4), (3, -4), (-3, -4), (4, 3), (-4, 3), (4, -3), (-4, -3), (0, 0)] * 80),
        ("distant-clusters", np.concatenate([rng.integers(-20, 20, (300, 2)), rng.integers(99980, 100020, (300, 2))])),
        ("many-clusters", np.concatenate([rng.integers(index * 10000, index * 10000 + 20, (80, 2)) for index in range(8)])),
        ("large-integer-coordinates", rng.integers(-(2**25), 2**25, (768, 2))),
        ("threshold-512", rng.integers(-1000, 1000, (512, 2))),
        ("threshold-513", rng.integers(-1000, 1000, (513, 2))),
    ]
    for index in range(234):
        spread, count = int(rng.integers(1, 2000)), int(rng.integers(1, 220))
        cases.append((f"random-{index}", rng.integers(-spread, spread + 1, (count, 2))))
    return cases


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--walk-source", type=Path, default=RENDERER, help="Explicit isolated-candidate check; default is the actual runtime")
    parser.add_argument("--large-evidence", type=Path, help="Optional retained original comic-walk benchmark JSON; not normal CI")
    parser.add_argument("--benchmark-large", action="store_true", help="Also remeasure the slow frozen original; requires --large-evidence and is not normal CI")
    args = parser.parse_args()
    if args.benchmark_large and not args.large_evidence:
        parser.error("--benchmark-large requires --large-evidence")
    scope = {"np": np, "math": math, "cKDTree": cKDTree, "skeletonize": skeletonize, "label": label, "Image": Image}
    actual = extract(args.walk_source, ["walk"], dict(scope))["walk"]
    actual_skeleton = extract(RENDERER, ["skeleton_traj"], {**scope, "walk": actual})["skeleton_traj"]
    expected_skeleton = extract(RENDERER, ["skeleton_traj"], {**scope, "walk": original_walk})["skeleton_traj"]
    cases = synthetic_cases()
    assert original_walk(cases[3][1]) == [(-1, 0), (0, 0), (1, 0), (0, 1)], "independent stable tie oracle"
    for name, points in cases:
        before = [tuple(point) for point in points]
        result = actual(points)
        assert result == original_walk(points), f"Exact tuple sequence changed: {name}"
        assert Counter(result) == Counter(before), f"Points lost or duplicated: {name}"
        assert [tuple(point) for point in points] == before, f"Input mutated: {name}"
    for walk in [original_walk, actual]:
        try:
            walk([])
            raise AssertionError("Empty walk unexpectedly accepted")
        except ValueError:
            pass

    image = Image.open(ART).convert("RGB")
    left, top = image.width // 3, image.height // 3
    # Native pixels only. This bounded crop is a test input, not downsampled
    # production art or evidence that a full video has passed visual QA.
    crop = np.asarray(image.crop((left, top, left + 160, top + 120)))
    ink = (0.299 * crop[..., 0] + 0.587 * crop[..., 1] + 0.114 * crop[..., 2]) < 145
    skel = skeletonize(ink)
    labs = label(skel, connectivity=2)
    values, sizes = np.unique(labs[skel], return_counts=True)
    largest = int(values[sizes.argmax()])
    ys, xs = np.where(labs == largest)
    connected = list(zip(xs.tolist(), ys.tolist()))
    assert len(connected) > 3
    assert actual(connected) == original_walk(connected), "Real connected-art stroke order changed"
    trajectory = actual_skeleton(ink)
    expected = expected_skeleton(ink)
    assert np.array_equal(trajectory, expected), "Whole real-art crop trajectory changed"
    proof = {
        "scope": "Exact native CPU traversal parity; no providers, encode, or finished-video QA",
        "walkSource": str(args.walk_source), "walkSourceSha256": hashlib.sha256(args.walk_source.read_bytes()).hexdigest(),
        "syntheticCases": len(cases), "exactCasesPassed": len(cases) + 2,
        "maxSyntheticPoints": max(len(points) for _, points in cases), "emptyInputBehavior": "ValueError preserved",
        "realCrop": {"size": [160, 120], "largestConnectedPoints": len(connected), "trajectoryPoints": len(trajectory), "sequenceSha256": hashlib.sha256(trajectory.tobytes()).hexdigest()},
    }
    if args.large_evidence:
        retained = json.loads(args.large_evidence.read_text())
        assert hashlib.sha256(ART.read_bytes()).hexdigest() == retained["imageSha256"], "Retained large proof image changed"
        geometry = extract(ROOT / "scripts/mc_textplace.py", ["cover_geometry"], {})["cover_geometry"]
        cover = extract(RENDERER, ["cover_into"], {"Image": Image, "cover_geometry": geometry})["cover_into"]
        proof["retainedLargeBaselineEvidence"] = str(args.large_evidence)
        proof["largeCases"] = []
        for row in retained["realArt"]:
            art = np.asarray(cover(image, *row["size"]))
            ink = (0.299 * art[..., 0] + 0.587 * art[..., 1] + 0.114 * art[..., 2]) < 145
            started = time.perf_counter()
            result = actual_skeleton(ink)
            elapsed = time.perf_counter() - started
            digest = hashlib.sha256(result.tobytes()).hexdigest()
            assert digest == row["baselineSequenceSha256"], f"Retained original full-image trajectory differs: {row['size']}"
            record = {"size": row["size"], "points": len(result), "sequenceSha256": digest, "currentSeconds": elapsed, "retainedOriginalSeconds": row["baselineSeconds"]}
            if args.benchmark_large:
                started = time.perf_counter()
                expected = expected_skeleton(ink)
                record["freshOriginalSeconds"] = time.perf_counter() - started
                assert np.array_equal(result, expected), "Fresh full original sequence differs"
            proof["largeCases"].append(record)
    print(json.dumps(proof))


if __name__ == "__main__":
    main()
