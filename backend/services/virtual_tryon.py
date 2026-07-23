"""AI virtual try-on via IDM-VTON on fal.ai.

Places a clothing/jewelry product image onto an AI-generated (or supplied)
human model. Unlike AI Shadows, there's no classical alternative for this --
it genuinely needs a generative model.

IMPORTANT: this environment has no network access to fal.ai, so
IDM_VTON_MODEL_ID below is not independently verified -- same caveat as
this codebase's other fal.ai model IDs (BIREFNET_MODEL_ID,
FLUX_INPAINT_MODEL_ID, REALESRGAN_MODEL_ID). Check it against fal.ai's own
model catalog (fal.ai/models) before relying on it.
"""

from __future__ import annotations

from typing import Optional

from .fal_client import FalAPIError, image_bytes_to_data_uri, run_queued

IDM_VTON_MODEL_ID = "fal-ai/idm-vton"  # VERIFY against fal.ai/models


def try_on(
    garment_image_bytes: bytes,
    garment_description: str,
    model_image_bytes: Optional[bytes] = None,
    content_type: str = "image/png",
) -> str:
    """Returns the fal.ai-hosted URL of the try-on result.

    If `model_image_bytes` is omitted, this assumes the model endpoint can
    generate its own default human model -- verify this against the actual
    model's documented parameters on fal.ai before relying on it; some
    IDM-VTON-style endpoints require a human image instead.
    """
    payload = {
        "garment_image_url": image_bytes_to_data_uri(garment_image_bytes, content_type),
        "garment_description": garment_description,
    }
    if model_image_bytes is not None:
        payload["human_image_url"] = image_bytes_to_data_uri(model_image_bytes, content_type)

    result = run_queued(IDM_VTON_MODEL_ID, payload)
    try:
        return result["image"]["url"]
    except (KeyError, TypeError) as exc:
        raise FalAPIError(f"Unexpected IDM-VTON response shape: {result}") from exc
