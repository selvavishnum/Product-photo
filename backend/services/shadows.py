"""Realistic drop shadow generation via classical canvas blending.

Classical (Pillow blur + alpha-derived silhouette), not a generative model
(IC-Light) -- deterministic, free, and testable without any fal.ai account,
unlike this codebase's /ai/* features. Same free-vs-paid split rationale as
main.py's classical upscale_image() vs services/upscale_ai.py.
"""

from __future__ import annotations

import io

from PIL import Image, ImageFilter


def add_drop_shadow(
    cutout_png_bytes: bytes,
    offset: tuple[int, int] = (12, 24),
    blur_radius: int = 20,
    shadow_opacity: int = 110,
) -> bytes:
    """Takes a cutout PNG with transparency and returns a new, larger PNG
    with a soft drop shadow composited behind the subject.

    The shadow is a dark silhouette derived from the cutout's own alpha
    channel (capped at `shadow_opacity`), offset by `offset`, and blurred by
    `blur_radius` -- then the original sharp cutout is composited on top,
    unblurred, at its original (un-offset) position.
    """
    with Image.open(io.BytesIO(cutout_png_bytes)) as src:
        cutout = src.convert("RGBA")

    pad = blur_radius * 2
    canvas_size = (cutout.width + pad * 2, cutout.height + pad * 2)

    silhouette = Image.new("RGBA", cutout.size, (0, 0, 0, 0))
    silhouette.putalpha(cutout.getchannel("A").point(lambda a: min(a, shadow_opacity)))

    canvas = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    canvas.alpha_composite(silhouette, dest=(pad + offset[0], pad + offset[1]))
    canvas = canvas.filter(ImageFilter.GaussianBlur(blur_radius))

    canvas.alpha_composite(cutout, dest=(pad, pad))

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue()
