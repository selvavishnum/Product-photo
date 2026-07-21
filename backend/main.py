"""Backend for Product Photo AI's background removal feature.

Runs `rembg` (open-source, ONNX-based) locally — no third-party AI API key
anywhere in this service. The Android app never sees or needs a key; it just
POSTs an image here and gets a transparent-background PNG back.
"""

import io

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from rembg import remove

app = FastAPI(title="Product Photo AI Backend")

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/remove-background")
async def remove_background(image: UploadFile = File(...)) -> Response:
    if image.content_type is None or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    input_bytes = await image.read()
    if len(input_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 15MB)")
    if not input_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        output_bytes = remove(input_bytes)
    except Exception as exc:  # noqa: BLE001 - surface a clean 500 to the client
        raise HTTPException(status_code=500, detail=f"Background removal failed: {exc}") from exc

    return Response(content=output_bytes, media_type="image/png")
