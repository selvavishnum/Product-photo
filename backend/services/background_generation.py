"""AI studio background generation via FLUX.1 [dev] inpainting on fal.ai.

Same caveat as background_removal.py: FLUX_INPAINT_MODEL_ID is not
independently verified from this environment (no network access to fal.ai).
Check it against your fal.ai dashboard before relying on it.
"""

from __future__ import annotations

from .fal_client import FalAPIError, image_bytes_to_data_uri, run_queued

FLUX_INPAINT_MODEL_ID = "fal-ai/flux/dev/image-to-image"  # VERIFY against fal.ai/models

# Preset studio themes shown in the app's theme picker. "custom" is handled
# by using the user's own typed prompt instead of one of these.
STUDIO_THEMES: dict[str, str] = {
    "marble_table": (
        "product photo resting on a white marble table, soft studio "
        "lighting, shallow depth of field, e-commerce product photography"
    ),
    "luxury_podium": (
        "product on a minimalist beige podium, professional studio "
        "backdrop, soft shadows, e-commerce product photography"
    ),
    "nature_sunlight": (
        "product on a wooden surface near a sunlit window, warm natural "
        "light, soft bokeh background, e-commerce product photography"
    ),
}


def generate_background(
    cutout_image_bytes: bytes,
    mask_image_bytes: bytes,
    prompt: str,
    content_type: str = "image/png",
) -> str:
    """Returns the fal.ai-hosted URL of the generated studio product photo.

    `mask_image_bytes` marks the region to regenerate (the background) --
    the cutout's own alpha channel inverted works as this mask.
    """
    image_data_uri = image_bytes_to_data_uri(cutout_image_bytes, content_type)
    mask_data_uri = image_bytes_to_data_uri(mask_image_bytes, content_type)

    payload = {
        "image_url": image_data_uri,
        "mask_url": mask_data_uri,
        "prompt": prompt,
        "strength": 0.85,
    }
    result = run_queued(FLUX_INPAINT_MODEL_ID, payload)
    try:
        return result["images"][0]["url"]
    except (KeyError, IndexError, TypeError) as exc:
        raise FalAPIError(f"Unexpected FLUX response shape: {result}") from exc


def resolve_prompt(theme_key: str | None, custom_prompt: str | None) -> str:
    """Theme selection takes a key from STUDIO_THEMES; a custom prompt overrides it."""
    if custom_prompt:
        return custom_prompt
    if theme_key and theme_key in STUDIO_THEMES:
        return STUDIO_THEMES[theme_key]
    raise ValueError("Provide either a known theme_key or a custom_prompt")
