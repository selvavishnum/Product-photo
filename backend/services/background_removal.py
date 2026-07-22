"""AI background removal via BiRefNet on fal.ai.

Uses BiRefNet (MIT licensed) rather than Bria RMBG 2.0 (CC BY-NC 4.0,
non-commercial only) -- this app has a paid credit system, so a
non-commercial-only model isn't legally usable here.

IMPORTANT: this environment has no network access to fal.ai, so
BIREFNET_MODEL_ID below is not independently verified. Check it against
your fal.ai dashboard (https://fal.ai/models) before relying on it, and
update it here if it's changed -- treat it as a placeholder to confirm,
not a guaranteed-correct value.
"""

from __future__ import annotations

from .fal_client import FalAPIError, image_bytes_to_data_uri, run_sync

BIREFNET_MODEL_ID = "fal-ai/birefnet"  # VERIFY against fal.ai/models


def remove_background(image_bytes: bytes, content_type: str = "image/png") -> str:
    """Returns the fal.ai-hosted URL of the cutout (transparent) PNG."""
    image_data_uri = image_bytes_to_data_uri(image_bytes, content_type)
    result = run_sync(BIREFNET_MODEL_ID, {"image_url": image_data_uri})
    try:
        return result["image"]["url"]
    except (KeyError, TypeError) as exc:
        raise FalAPIError(f"Unexpected BiRefNet response shape: {result}") from exc
