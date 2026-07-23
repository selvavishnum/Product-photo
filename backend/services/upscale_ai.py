"""AI photo upscaling via Real-ESRGAN on fal.ai.

Same verification caveat as this codebase's other fal.ai model IDs:
REALESRGAN_MODEL_ID is unverified from this sandbox (no network access to
fal.ai). Check it against fal.ai's own model catalog before relying on it.

This is a separate, paid alternative to main.py's free classical
`upscale_image()` (Lanczos + unsharp mask) -- not a replacement for it.
"""

from __future__ import annotations

from .fal_client import FalAPIError, image_bytes_to_data_uri, run_sync

REALESRGAN_MODEL_ID = "fal-ai/real-esrgan"  # VERIFY against fal.ai/models


def upscale_with_ai(image_bytes: bytes, scale: int = 2, content_type: str = "image/png") -> str:
    """Returns the fal.ai-hosted URL of the AI-upscaled image."""
    image_data_uri = image_bytes_to_data_uri(image_bytes, content_type)
    result = run_sync(REALESRGAN_MODEL_ID, {"image_url": image_data_uri, "scale": scale})
    try:
        return result["image"]["url"]
    except (KeyError, TypeError) as exc:
        raise FalAPIError(f"Unexpected Real-ESRGAN response shape: {result}") from exc
