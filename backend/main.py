"""Backend for Product Photo AI.

Runs `rembg` (open-source, ONNX-based) for background removal and a
classical Lanczos-resample + unsharp-mask upscaler -- no third-party AI API
key anywhere in this path. The existing native Android app never sees or
needs a key; it just POSTs an image here and gets a processed image back.

The `/ai/*` endpoints below are a separate, additive path for the Flutter
studio app: they call paid fal.ai models (BiRefNet for removal, FLUX.1 dev
inpainting for AI studio backgrounds) and require a funded fal.ai account
(FAL_KEY env var). They cost money per call, unlike everything above.
"""

import io
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageFilter
from rembg import remove

from services import (
    background_generation,
    background_removal,
    mask_utils,
    shadows,
    upscale_ai,
    virtual_tryon,
)
from services.fal_client import FalAPIError

app = FastAPI(title="Product Photo AI Backend")

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB
MAX_UPSCALE_FACTOR = 4


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


async def _read_validated_image(image: UploadFile) -> bytes:
    if image.content_type is None or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    input_bytes = await image.read()
    if len(input_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 15MB)")
    if not input_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    return input_bytes


@app.post("/remove-background")
async def remove_background(image: UploadFile = File(...)) -> Response:
    input_bytes = await _read_validated_image(image)

    try:
        output_bytes = remove(input_bytes)
    except Exception as exc:  # noqa: BLE001 - surface a clean 500 to the client
        raise HTTPException(status_code=500, detail=f"Background removal failed: {exc}") from exc

    return Response(content=output_bytes, media_type="image/png")


def upscale_image(input_bytes: bytes, scale: int) -> bytes:
    """Lanczos resample + a mild unsharp mask to recover perceived detail.

    Not a generative super-resolution model: realesrgan's PyPI package pulls
    in basicsr, whose setup.py fails on an unrelated CUDA package version
    conflict, and third-party pre-converted ONNX mirrors found online aren't
    from an authoritative source worth shipping. This is honest classical
    upscaling: sharper and larger, not hallucinated new detail.
    """
    with Image.open(io.BytesIO(input_bytes)) as src:
        src = src.convert("RGBA")
        target_size = (src.width * scale, src.height * scale)
        upscaled = src.resize(target_size, Image.Resampling.LANCZOS)
        sharpened = upscaled.filter(
            ImageFilter.UnsharpMask(radius=2, percent=60, threshold=3)
        )

        buf = io.BytesIO()
        sharpened.save(buf, format="PNG")
        return buf.getvalue()


@app.post("/upscale")
async def upscale(image: UploadFile = File(...), scale: int = 2) -> Response:
    if scale < 1 or scale > MAX_UPSCALE_FACTOR:
        raise HTTPException(
            status_code=400, detail=f"scale must be between 1 and {MAX_UPSCALE_FACTOR}"
        )

    input_bytes = await _read_validated_image(image)

    try:
        output_bytes = upscale_image(input_bytes, scale)
    except Exception as exc:  # noqa: BLE001 - surface a clean 500 to the client
        raise HTTPException(status_code=500, detail=f"Upscale failed: {exc}") from exc

    return Response(content=output_bytes, media_type="image/png")


@app.post("/shadows")
async def add_shadow(image: UploadFile = File(...)) -> Response:
    """Free, classical drop-shadow compositing (Pillow blur) -- not IC-Light.
    See services/shadows.py docstring for why. `image` should be a cutout
    PNG with transparency, e.g. from /remove-background."""
    input_bytes = await _read_validated_image(image)

    try:
        output_bytes = shadows.add_drop_shadow(input_bytes)
    except Exception as exc:  # noqa: BLE001 - surface a clean 500 to the client
        raise HTTPException(status_code=500, detail=f"Shadow generation failed: {exc}") from exc

    return Response(content=output_bytes, media_type="image/png")


# ---------------------------------------------------------------------------
# Paid fal.ai-backed endpoints for the Flutter studio app. See module
# docstring: these require FAL_KEY and cost money per call.
# ---------------------------------------------------------------------------


@app.get("/ai/themes")
def list_studio_themes() -> dict:
    return {"themes": list(background_generation.STUDIO_THEMES.keys())}


@app.post("/ai/remove-background")
async def ai_remove_background(image: UploadFile = File(...)) -> dict:
    input_bytes = await _read_validated_image(image)

    try:
        cutout_url = background_removal.remove_background(input_bytes, image.content_type)
    except FalAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {"cutout_url": cutout_url}


@app.post("/ai/generate-background")
async def ai_generate_background(
    image: UploadFile = File(...),
    theme_key: Optional[str] = Form(default=None),
    prompt: Optional[str] = Form(default=None),
) -> dict:
    """`image` should be a cutout PNG with transparency (e.g. from
    /ai/remove-background) -- the regeneration mask is derived from its
    alpha channel, so no separate mask upload is required.
    """
    cutout_bytes = await _read_validated_image(image)

    try:
        final_prompt = background_generation.resolve_prompt(theme_key, prompt)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    mask_bytes = mask_utils.alpha_to_mask(cutout_bytes)

    try:
        generated_url = background_generation.generate_background(
            cutout_bytes, mask_bytes, final_prompt, image.content_type
        )
    except FalAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {"generated_url": generated_url}


@app.post("/ai/upscale")
async def ai_upscale(image: UploadFile = File(...), scale: int = 2) -> dict:
    """Paid alternative to the free /upscale above -- Real-ESRGAN via
    fal.ai instead of classical Lanczos resampling."""
    if scale < 1 or scale > MAX_UPSCALE_FACTOR:
        raise HTTPException(
            status_code=400, detail=f"scale must be between 1 and {MAX_UPSCALE_FACTOR}"
        )

    input_bytes = await _read_validated_image(image)

    try:
        upscaled_url = upscale_ai.upscale_with_ai(input_bytes, scale, image.content_type)
    except FalAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {"upscaled_url": upscaled_url}


@app.post("/ai/virtual-tryon")
async def ai_virtual_tryon(
    garment_image: UploadFile = File(...),
    garment_description: str = Form(...),
    model_image: Optional[UploadFile] = File(default=None),
) -> dict:
    """Places `garment_image` (a clothing/jewelry cutout) onto an AI-generated
    or, if provided, the supplied `model_image`. See services/virtual_tryon.py
    for the model-ID verification caveat."""
    garment_bytes = await _read_validated_image(garment_image)
    model_bytes = (
        await _read_validated_image(model_image) if model_image is not None else None
    )

    try:
        result_url = virtual_tryon.try_on(
            garment_bytes, garment_description, model_bytes, garment_image.content_type
        )
    except FalAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {"result_url": result_url}
