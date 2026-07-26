"""E-Com Studio -- self-hosted GPU inference server.

Every model here is open-weights and runs on your own hardware. There is no
third-party inference API and no API key: the only cost is the GPU itself.

READ THIS BEFORE DEPLOYING
--------------------------
"Self-hosted" is not "free". An RTX 4090 on RunPod is roughly $0.34-0.69/hr
and an A10G about $1/hr, billed whether or not anyone uploads a photo. That
is ~$250-700/month always-on, against roughly $0.001-0.01 per image on a
hosted inference API. Self-hosting only wins above a few thousand images a
month. Below that it is strictly more expensive -- see README.md for the
serverless setup that avoids paying for idle time.

The two features this app actually needs day to day -- background removal
and white/studio backgrounds -- already run on the phone for nothing. This
server is only worth starting for backdrop generation, upscaling and
virtual try-on.

MODEL IDS ARE UNVERIFIED
------------------------
The Hugging Face repo ids below could not be checked from the sandbox this
was written in (no network access to huggingface.co). Confirm each one on
huggingface.co before your first deploy, exactly as `backend/README.md` says
for the fal.ai ids. The diffusers *API* used here was verified against the
real diffusers 0.39.0 source.

LICENCES -- CHECK BEFORE SELLING ANYTHING
-----------------------------------------
  * BiRefNet          MIT                      commercial OK
  * Bria RMBG 2.0     CC BY-NC 4.0             NON-COMMERCIAL ONLY -- do not
                                               use in a paid product. This is
                                               why the default below is
                                               BiRefNet, not RMBG.
  * FLUX.1-schnell    Apache 2.0               commercial OK
  * FLUX.1-dev        non-commercial licence   NOT for a paid product
  * SDXL              CreativeML OpenRAIL++-M  commercial OK, use-restricted
  * Real-ESRGAN       BSD-3-Clause             commercial OK
  * IDM-VTON          check upstream           commonly CC BY-NC-SA; verify
"""

from __future__ import annotations

import io
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
DEVICE = os.getenv("DEVICE", "cuda")

# Set these to the repo ids you have verified.
MODEL_REMOVE_BG = os.getenv("MODEL_REMOVE_BG", "ZhengPeng7/BiRefNet")
MODEL_BACKDROP = os.getenv("MODEL_BACKDROP", "black-forest-labs/FLUX.1-schnell")
MODEL_UPSCALE = os.getenv("MODEL_UPSCALE", "ai-forever/Real-ESRGAN")
MODEL_TRYON = os.getenv("MODEL_TRYON", "yisol/IDM-VTON")

STUDIO_THEMES = {
    "marble_table": (
        "product photography on a polished white marble table, soft diffused "
        "studio lighting, shallow depth of field, clean and minimal"
    ),
    "wooden_shelf": (
        "product photography on a sunlit oak wooden shelf, warm natural light "
        "from a window, soft shadows, cosy interior"
    ),
    "minimalist_studio": (
        "product photography in a minimalist studio, seamless pale grey "
        "backdrop, soft key light and gentle falloff, professional lookbook"
    ),
}

# Loaded lazily and cached. Diffusion pipelines are many gigabytes of VRAM;
# loading them all at import would OOM most single-GPU boxes and would make
# the container take minutes to become healthy.
_models: dict[str, object] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("PRELOAD_BACKDROP") == "1":
        _get_backdrop_pipeline()
    yield
    _models.clear()


app = FastAPI(title="E-Com Studio GPU Backend", lifespan=lifespan)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

async def _read_image(upload: UploadFile) -> Image.Image:
    """Read an upload into a PIL image.

    Sniffs the bytes rather than trusting the declared Content-Type: mobile
    multipart clients frequently send application/octet-stream for a genuine
    photo, which is a real bug this project already hit in production.
    """
    data = await upload.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image too large (max 20MB)")
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as exc:
        raise HTTPException(400, "File must be an image") from exc
    return image.convert("RGB")


def _png_response(image: Image.Image) -> Response:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


def _round_to_multiple(value: int, multiple: int = 16, cap: int = 1024) -> int:
    """Diffusion models need dimensions divisible by (typically) 16."""
    value = min(value, cap)
    return max(multiple, (value // multiple) * multiple)


# --------------------------------------------------------------------------
# model loaders
# --------------------------------------------------------------------------

def _get_removebg_model():
    if "removebg" not in _models:
        import torch
        from transformers import AutoModelForImageSegmentation

        model = AutoModelForImageSegmentation.from_pretrained(
            MODEL_REMOVE_BG, trust_remote_code=True
        )
        model.to(DEVICE).eval()
        if DEVICE == "cuda":
            model.half()
        _models["removebg"] = model
        _models["_torch"] = torch
    return _models["removebg"]


def _get_backdrop_pipeline():
    if "backdrop" not in _models:
        import torch
        from diffusers import AutoPipelineForInpainting

        pipe = AutoPipelineForInpainting.from_pretrained(
            MODEL_BACKDROP,
            torch_dtype=torch.bfloat16 if DEVICE == "cuda" else torch.float32,
        )
        pipe.to(DEVICE)
        # Trades a little speed for a large VRAM saving -- the difference
        # between fitting on a 24GB card and not.
        pipe.enable_attention_slicing()
        if hasattr(pipe, "enable_model_cpu_offload") and DEVICE == "cuda":
            pipe.enable_model_cpu_offload()
        _models["backdrop"] = pipe
    return _models["backdrop"]


# --------------------------------------------------------------------------
# endpoints
# --------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "loaded": sorted(k for k in _models if not k.startswith("_"))}


@app.get("/api/v1/themes")
def themes() -> dict:
    return {"themes": list(STUDIO_THEMES.keys())}


@app.post("/api/v1/remove-bg")
async def remove_bg(image: UploadFile = File(...)) -> Response:
    """BiRefNet cutout. Returns a transparent PNG.

    Note this duplicates what the app already does on-device for free. It
    exists for desktop/web clients and batch jobs, not because the phone
    needs it.
    """
    src = await _read_image(image)
    model = _get_removebg_model()
    torch = _models["_torch"]

    from torchvision import transforms

    tf = transforms.Compose([
        transforms.Resize((1024, 1024)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    tensor = tf(src).unsqueeze(0).to(DEVICE)
    if DEVICE == "cuda":
        tensor = tensor.half()

    with torch.no_grad():
        preds = model(tensor)[-1].sigmoid().cpu()

    mask = transforms.ToPILImage()(preds[0].squeeze()).resize(src.size)
    out = src.copy()
    out.putalpha(mask)
    return _png_response(out)


@app.post("/api/v1/generate-backdrop")
async def generate_backdrop(
    image: UploadFile = File(...),
    theme_key: Optional[str] = Form(None),
    prompt: Optional[str] = Form(None),
    steps: int = Form(4),
) -> Response:
    """Inpaint a background around a cut-out product.

    `image` must be a transparent PNG -- the mask is derived from its alpha,
    so the product is preserved exactly and only the background is generated.
    That is what stops the model repainting the item you are selling.
    """
    raw = await image.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    try:
        cutout = Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception as exc:
        raise HTTPException(400, "File must be an image") from exc

    final_prompt = (prompt or "").strip() or STUDIO_THEMES.get(theme_key or "")
    if not final_prompt:
        raise HTTPException(
            400,
            f"Provide `prompt`, or a `theme_key` from {list(STUDIO_THEMES)}",
        )

    alpha = cutout.getchannel("A")
    # Mask convention: white = regenerate. The product is opaque, so its
    # inverted alpha is black and it survives untouched.
    mask = Image.eval(alpha, lambda a: 255 - a)

    width = _round_to_multiple(cutout.width)
    height = _round_to_multiple(cutout.height)

    pipe = _get_backdrop_pipeline()
    try:
        result = pipe(
            prompt=final_prompt,
            image=cutout.convert("RGB").resize((width, height)),
            mask_image=mask.resize((width, height)),
            width=width,
            height=height,
            num_inference_steps=steps,
            guidance_scale=0.0 if "schnell" in MODEL_BACKDROP else 7.0,
        ).images[0]
    except Exception as exc:
        raise HTTPException(500, f"Backdrop generation failed: {exc}") from exc

    # Re-composite the original product over the generation: inpainting
    # models re-encode the whole canvas through the VAE, which subtly
    # degrades the product even inside the masked-off region.
    result = result.resize(cutout.size).convert("RGBA")
    result.alpha_composite(cutout)
    return _png_response(result.convert("RGB"))


@app.post("/api/v1/upscale")
async def upscale(image: UploadFile = File(...), scale: int = Form(2)) -> Response:
    """Real-ESRGAN super-resolution.

    Worth knowing before you rent a GPU for this: a modern phone camera
    already shoots 12-24MP, and marketplace listings top out around 1600px.
    If your source photos are large, you are downscaling anyway and this
    endpoint has nothing to do.
    """
    if scale not in (2, 4):
        raise HTTPException(400, "scale must be 2 or 4")

    src = await _read_image(image)

    if "upscale" not in _models:
        try:
            from RealESRGAN import RealESRGAN
            import torch
        except ImportError as exc:
            raise HTTPException(
                501,
                "Real-ESRGAN is not installed in this image. See "
                "gpu-backend/README.md.",
            ) from exc
        model = RealESRGAN(torch.device(DEVICE), scale=scale)
        model.load_weights(f"weights/RealESRGAN_x{scale}.pth", download=True)
        _models["upscale"] = model

    return _png_response(_models["upscale"].predict(src))


@app.post("/api/v1/generate-shadow")
async def generate_shadow(
    image: UploadFile = File(...),
    offset_x: int = Form(12),
    offset_y: int = Form(24),
    blur: int = Form(20),
    opacity: int = Form(110),
) -> Response:
    """Soft drop shadow behind a cut-out product.

    Classical compositing, not IC-Light, and deliberately so: this needs no
    GPU, no model download and about a millisecond, whereas IC-Light needs
    the whole diffusion stack resident in VRAM to relight a product whose
    lighting is usually already fine. Reach for IC-Light only when you
    actually want relighting rather than a shadow.
    """
    from PIL import ImageFilter

    raw = await image.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    try:
        cutout = Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception as exc:
        raise HTTPException(400, "File must be an image") from exc

    pad = blur * 2
    canvas = Image.new(
        "RGBA", (cutout.width + pad * 2, cutout.height + pad * 2), (0, 0, 0, 0)
    )

    silhouette = Image.new("RGBA", cutout.size, (0, 0, 0, 0))
    silhouette.putalpha(cutout.getchannel("A").point(lambda a: min(a, opacity)))

    canvas.alpha_composite(silhouette, dest=(pad + offset_x, pad + offset_y))
    canvas = canvas.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(cutout, dest=(pad, pad))
    return _png_response(canvas)


@app.post("/api/v1/virtual-tryon")
async def virtual_tryon(
    garment_image: UploadFile = File(...),
    garment_description: str = Form(...),
    model_image: Optional[UploadFile] = File(None),
) -> Response:
    """IDM-VTON virtual try-on.

    Not implemented here on purpose. IDM-VTON is not a `from_pretrained` one
    liner -- it needs its own repo checked out, plus a human parser, pose
    estimator and densepose model, and it is the heaviest thing in this
    stack by VRAM. Wiring it blind against an API this sandbox cannot reach
    would produce code that looks finished and fails on first call, which is
    worse than an honest 501.

    See gpu-backend/README.md for what setting it up actually involves.
    """
    await _read_image(garment_image)
    raise HTTPException(
        501,
        "Virtual try-on is not wired up yet -- it needs the IDM-VTON repo and "
        "its pose/parsing models installed. See gpu-backend/README.md.",
    )
