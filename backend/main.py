"""Backend for Product Photo AI.

Runs `rembg` (open-source, ONNX-based) for background removal and a
classical Lanczos-resample + unsharp-mask upscaler -- no third-party AI API
key anywhere in this service. The Android app never sees or needs a key; it
just POSTs an image here and gets a processed image back.
"""

import io

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageFilter
from rembg import remove

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
