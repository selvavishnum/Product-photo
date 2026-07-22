"""Derives an inpainting mask from a cutout's alpha channel."""

from __future__ import annotations

import io

from PIL import Image


def alpha_to_mask(cutout_png_bytes: bytes) -> bytes:
    """White = regenerate (background), black = keep (product) -- fal.ai's
    inpainting mask convention. This is the inverse of the cutout's own
    alpha channel: opaque product pixels (high alpha) become black (keep),
    transparent background pixels (low alpha) become white (regenerate).
    """
    with Image.open(io.BytesIO(cutout_png_bytes)) as img:
        alpha = img.convert("RGBA").getchannel("A")
        mask = alpha.point(lambda a: 255 - a)
        buf = io.BytesIO()
        mask.convert("L").save(buf, format="PNG")
        return buf.getvalue()
