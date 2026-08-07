"""Reliable comic-font resolution shared by the page renderer and letterer."""

import os
from pathlib import Path
from PIL import ImageFont


_REPO_ROOT = Path(__file__).resolve().parent.parent
_CANDIDATES = (
    _REPO_ROOT / "src" / "assets" / "fonts" / "ComicNeue-Bold.otf",
    Path("/usr/share/fonts/opentype/comic-neue/ComicNeue-Bold.otf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
)


def resolve_font():
    """Return the first readable font; an invalid MC_FONT never masks fallbacks."""
    configured = os.environ.get("MC_FONT")
    candidates = ([Path(configured)] if configured else []) + list(_CANDIDATES)
    return next((str(path) for path in candidates if path.is_file()), None)


FONT_PATH = resolve_font()


def load_font(size):
    """Load scalable type when available, with a no-crash Pillow fallback."""
    if FONT_PATH:
        try:
            return ImageFont.truetype(FONT_PATH, size)
        except OSError:
            pass
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1 has no size argument.
        return ImageFont.load_default()
