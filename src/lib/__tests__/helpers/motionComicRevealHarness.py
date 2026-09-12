"""Production opening/schedule/render-loop regression with synthetic page data.

The actual top-level opening code (including its missing-art guard), schedule,
frame functions and complete frame loop execute unchanged. Only page inputs,
review-file persistence and encoder stdin are replaced. Tiny page/output sizes
keep this in the ordinary CI gate; native real-art qualification is separate.
"""
import ast
import copy
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[4]
LEGACY = ROOT / "test-fixtures/comic-opening-reveal/legacy-renderer.py.txt"
LEGACY_SHA = "b537b219400b638b288171cd48afdd23f5c8746fb98ad4e0282c875cf4e43e31"
FUNCTIONS = {"smoothstep", "lerp", "frame_top", "frame_box", "viewport_f",
             "render_page_frame", "page_turn", "reveal_panel", "draw_tail"}


def assigns(node, name):
    return isinstance(node, ast.Assign) and any(
        isinstance(target, ast.Name) and target.id == name for target in node.targets
    )


def extract(source, filename):
    tree = ast.parse(source, filename=filename)
    page_index = next(i for i, node in enumerate(tree.body) if assigns(node, "PAGES"))
    camera_index = next(i for i, node in enumerate(tree.body)
                        if isinstance(node, ast.FunctionDef) and node.name == "frame_top")
    assert page_index < camera_index, "opening guard/prepaint/reveal code must be located explicitly"
    # Never emulate the opening by renderer filename: this executes the real
    # missing-art check and any prepaint assignment introduced by a regression.
    opening = tree.body[page_index + 1:camera_index]
    assert opening, "actual top-level opening code was not selected"
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and node.name in FUNCTIONS]
    constants = [node for node in tree.body if any(assigns(node, key)
                 for key in ("MOVE", "HOLD", "TAIL", "DRAW_FRAC", "PAPER", "INK"))]
    schedule_index = next(i for i, node in enumerate(tree.body) if assigns(node, "segments"))
    loop_index = next(i for i, node in enumerate(tree.body)
                      if isinstance(node, ast.For) and isinstance(node.target, ast.Name)
                      and node.target.id == "f")
    schedule = tree.body[schedule_index:loop_index]
    omitted_writes = [node for node in schedule if isinstance(node, ast.With)]
    assert len(omitted_writes) == 1 and "motion_comic_review_timeline.json" in ast.unparse(omitted_writes[0])
    encoders = [node for node in schedule if assigns(node, "ff")]
    assert len(encoders) == 1 and "subprocess.Popen" in ast.unparse(encoders[0])
    schedule = [node for node in schedule if node not in omitted_writes + encoders]
    loop = copy.deepcopy(tree.body[loop_index])
    assert ast.unparse(loop.body[-1]) == "ff.stdin.write(frame.tobytes())", "capture must replace only encoder stdin"
    loop.body[-1] = ast.parse("capture(frame, f, t, kind, pi, li, st, en)").body[0]
    module = ast.fix_missing_locations(ast.Module(body=functions + opening + schedule + [loop], type_ignores=[]))
    return compile(ast.Module(body=constants, type_ignores=[]), filename, "exec"), compile(module, filename, "exec")


def pages_for(durations, paper):
    pages = []
    base = math.ceil(len(durations) / max(1, math.ceil(len(durations) / 6)))
    for offset in range(0, len(durations), base):
        selected = durations[offset:offset + base]
        boxes = [(6, 6, 153, 53), (6, 66, 73, 50),
                 (86, 66, 73, 50), (6, 123, 153, 56)][:len(selected)]
        world = np.empty((216, 200, 3), np.uint8)
        world[:] = paper
        panes, raw = [], []
        for index, (x, y, w, h) in enumerate(boxes):
            art = np.empty((h, w, 3), np.uint8)
            art[:] = ((31 + (offset + index) * 23) % 220, 111, 151)
            order = np.repeat(np.linspace(0, 1, h)[:, None], w, axis=1).astype(np.float32)
            trajectory = np.column_stack([np.full(h, w / 2), np.arange(h)]).astype(np.float32)
            panes.append({"box": (x, y, w, h), "art": art, "order2d": order, "traj": trajectory,
                          "hand": Image.new("RGBA", (6, 14), (12, 12, 12, 255)), "tipx": 1, "tipy": 1})
            raw.append({"local_index": index, "id": f"p{offset + index}-b0", "panelIndex": offset + index,
                        "body": Image.new("RGBA", (8, 5), (255, 255, 255, 255)),
                        "bx": 16 + x + 6, "by": 16 + y + 6, "mouth": (0, 0), "has": False,
                        "at": 0.05 * (index % 2), "rect": [.1, .1, .1, .1], "keepClear": []})
        pages.append({"panels": [{"dur": duration} for duration in selected], "PW": 166, "PH": 183,
                      "PX": 16, "PY": 16, "WDW": 200, "WDH": 216, "BOXES": boxes,
                      "world": world, "panes": panes, "bubraw": raw, "bubbles": []})
    return pages


def coverage(page, pane):
    x, y, w, h = pane["box"]
    pixels = page["world"][page["PY"] + y:page["PY"] + y + h, page["PX"] + x:page["PX"] + x + w]
    return float(np.all(pixels == pane["art"], axis=2).mean())


def run(program, est, durations, fps, missing_opening=False):
    namespace = {"np": np, "Image": Image, "ImageDraw": ImageDraw, "math": math,
                 "OW": 96, "OH": 54, "FPS": fps, "EST": est, "PT": 1.3}
    exec(program[0], namespace)
    namespace["PAGES"] = pages_for(durations, namespace["PAPER"])
    if missing_opening:
        namespace["PAGES"][0]["panes"][0] = None
    frames, ends, first = [], {}, {}

    def capture(frame, index, t, kind, pi, li, start, end):
        page = namespace["PAGES"][pi]
        opening = namespace["PAGES"][0]["panes"][0]
        if index == 0:
            first["coverage"] = coverage(namespace["PAGES"][0], opening)
            first["activeHand"] = namespace.get("active") is opening and namespace.get("hand_pt") is not None
            without_hand = namespace["render_page_frame"](
                page, list(namespace["BR"](namespace["cam"], t)), None, None, t,
            )
            first["visibleHand"] = frame.tobytes() != without_hand.tobytes()
        # Match the actual loop's next timestamp exactly. t + 1/fps plus an
        # epsilon can incorrectly select two final frames at fractional ends.
        if kind == "panel" and (index + 1) / fps >= end:
            assert start <= t < end, "completion must be observed inside the panel interval"
            key = (pi, li)
            assert key not in ends, "each panel has one last sampled frame"
            ends[key] = {"frame": index, "time": t, "end": end, "coverage": coverage(page, page["panes"][li])}
        frames.append({"kind": kind, "pi": pi, "li": li, "sha256": hashlib.sha256(frame.tobytes()).hexdigest()})

    namespace["capture"] = capture
    exec(program[1], namespace)
    assert len(ends) == len(durations), "must observe the actual final frame of every panel"
    return {"frames": frames, "ends": ends, "first": first,
            "segments": namespace["segments"], "bubbles": namespace["review_bubbles"]}


def main():
    legacy_bytes = LEGACY.read_bytes()
    assert hashlib.sha256(legacy_bytes).hexdigest() == LEGACY_SHA, "legacy comparison fixture changed"
    source_path = Path(sys.argv[1])
    source_bytes = source_path.read_bytes()
    program = extract(source_bytes.decode(), str(source_path))
    legacy = extract(legacy_bytes.decode(), str(LEGACY))
    # Existing missing-opening safety must remain a real executed guard.
    try:
        run(program, 1.7, [2.3] * 7, 30, missing_opening=True)
    except RuntimeError as error:
        assert "refusing empty template opening" in str(error)
    else:
        raise AssertionError("missing opening art did not fail closed")
    cases = [(est, [duration] + [2.3] * 6, 30)
             for est in (0, .01, 1 / 30, .04, .1, 1.7) for duration in (2.3, 1.0)]
    cases += [(est, [1.0] * 7, 30) for est in (0, .01, .1, 1.7)]
    cases += [(est, [duration] * 7, fps) for est in (.017, .073)
              for duration in (1.0, 1.01, 1.1) for fps in (24, 30)]
    cases += [(est, [1.0] * 7, 24) for est in (0, 1.7)]
    compared, legacy_bad_opening, legacy_bad_panel = 0, False, False
    proof_cases = []
    for est, durations, fps in cases:
        actual = run(program, est, durations, fps)
        baseline = run(legacy, est, durations, fps)
        label = (est, durations, fps)
        assert 0 < actual["first"]["coverage"] < 1, (label, "frame zero must show partially drawn approved art", actual["first"])
        assert actual["first"]["activeHand"] and actual["first"]["visibleHand"], (label, "frame-zero hand must affect rendered pixels")
        assert all(end["coverage"] == 1 for end in actual["ends"].values()), (label, "panel not complete by its last displayed frame", actual["ends"])
        assert actual["segments"] == baseline["segments"], (label, "narration/page-turn schedule changed")
        assert actual["bubbles"] == baseline["bubbles"], (label, "bubble timing/geometry receipt changed")
        assert len(actual["frames"]) == len(baseline["frames"]), (label, "output frame count changed")
        assert sum(segment[0] == "turn" for segment in actual["segments"]) == 1
        ordinary = all(duration >= 1.1 for duration in durations[1:])
        unchanged = 0
        if ordinary:
            for frame, old_frame in zip(actual["frames"], baseline["frames"]):
                is_opening = frame["kind"] == "est" or (frame["kind"] == "panel" and frame["pi"] == 0 and frame["li"] == 0)
                if not is_opening:
                    assert frame == old_frame, (label, "ordinary non-opening raw pixels changed")
                    compared += 1
                    unchanged += 1
        legacy_bad_opening |= baseline["first"]["coverage"] == 1 and not baseline["first"]["activeHand"]
        legacy_bad_panel |= any(end["coverage"] < 1 for end in baseline["ends"].values())
        proof_cases.append({"est": est, "fps": fps, "durations": durations,
                            "frames": len(actual["frames"]), "completePanels": len(actual["ends"]),
                            "ordinaryNonOpeningFramesUnchanged": unchanged})
    assert legacy_bad_opening and legacy_bad_panel, "frozen before must still demonstrate both original defects"
    print(json.dumps({"scope": __doc__, "rendererSha256": hashlib.sha256(source_bytes).hexdigest(),
                      "legacyRendererSha256": LEGACY_SHA, "casesPassed": len(cases),
                      "panelsCompleteAtSegmentEnd": len(cases) * 7,
                      "firstFramePartialArtAndVisibleHand": len(cases), "missingOpeningRejected": True,
                      "legacyOpeningViolationDemonstrated": legacy_bad_opening,
                      "legacyShortPanelViolationDemonstrated": legacy_bad_panel,
                      "ordinaryNonOpeningFramesCompared": compared, "ordinaryNonOpeningFramesChanged": 0,
                      "cases": proof_cases}))


if __name__ == "__main__":
    main()
