# E-Com Studio — self-hosted GPU backend

Open-weights models on your own hardware. No inference API, no API key.

## Read this before you rent a GPU

**Self-hosted is not free.** The GPU is billed by the hour whether or not
anyone uploads a photo:

| Host | GPU | ~$/hr | Always-on /month |
|---|---|---|---|
| RunPod Community | RTX 4090 24GB | 0.34–0.44 | ~$250–320 |
| RunPod Secure | A40 48GB | 0.39–0.79 | ~$280–570 |
| Vast.ai | RTX 4090 | 0.25–0.50 | ~$180–360 |
| AWS EC2 | A10G (g5.xlarge) | ~1.00 | ~$730 |

Compare that with roughly **$0.001–0.01 per image** on a hosted inference
API. Self-hosting only wins somewhere north of a few thousand images a
month. Below that it is strictly more expensive — which matters here,
because the project moved to self-hosting after exhausting a *small* API
balance.

**Two things follow from that:**

1. **Don't run this always-on.** Use serverless (below) so you pay per
   second of actual GPU time.
2. **Don't run it at all for background removal or white/studio
   backgrounds.** Those already run on the phone for nothing — see
   `mobile/docs/on-device-architecture.md`. This server is only worth
   starting for generated backdrops, upscaling, and try-on.

## Before the first deploy

- **Verify every model id** in `main.py` (`MODEL_REMOVE_BG`,
  `MODEL_BACKDROP`, `MODEL_UPSCALE`, `MODEL_TRYON`) on huggingface.co. They
  could not be checked from the sandbox this was written in and are
  placeholders to confirm, not known-good values. The *diffusers API* used
  here was verified against real 0.39.0 source.
- **Check licences before selling anything.** In particular **Bria RMBG 2.0
  is CC BY-NC 4.0 — non-commercial only**, so it cannot be used in a paid
  product. That is why the default is BiRefNet (MIT). Likewise **FLUX.1-dev
  is non-commercial**; use **FLUX.1-schnell** (Apache 2.0). IDM-VTON is
  commonly CC BY-NC-SA — verify upstream.

## Endpoints

| Endpoint | Model | GPU | Notes |
|---|---|---|---|
| `POST /api/v1/remove-bg` | BiRefNet | yes | Duplicates the on-device path |
| `POST /api/v1/generate-backdrop` | FLUX.1-schnell inpaint | yes | Needs a transparent PNG |
| `POST /api/v1/upscale` | Real-ESRGAN | yes | Needs extra install, see below |
| `POST /api/v1/generate-shadow` | — | **no** | Classical, runs anywhere |
| `POST /api/v1/virtual-tryon` | IDM-VTON | yes | **Returns 501** — not wired up |
| `GET /api/v1/themes` | — | no | Preset theme keys |
| `GET /health` | — | no | Also lists loaded models |

`/generate-backdrop` derives its inpainting mask from the uploaded PNG's
alpha channel, so the product is preserved and only the background is
generated, then re-composites the original product on top — inpainting
re-encodes the whole canvas through the VAE, which subtly degrades the
product otherwise.

### Two endpoints that are deliberately not what was specified

**`/generate-shadow` is classical compositing, not IC-Light.** IC-Light needs
the full diffusion stack resident in VRAM to relight a product whose lighting
is usually already fine. The classical version needs no GPU, no model
download and about a millisecond. Use IC-Light only when you want genuine
relighting rather than a shadow.

**`/virtual-tryon` returns 501.** IDM-VTON is not a `from_pretrained`
one-liner: it needs its own repo checked out plus a human parser, pose
estimator and DensePose model, and it is the heaviest thing in this stack by
VRAM. Writing it blind against an API that could not be reached from here
would produce code that looks finished and fails on the first real call.
Wiring it up means cloning `yisol/IDM-VTON`, fetching its auxiliary
checkpoints, and adding them to the image — a day's work, not a config line.

## Run locally (needs an NVIDIA GPU)

```bash
docker build -t ecom-studio-gpu .
docker run --gpus all -p 8000:8000 -v $PWD/models:/models ecom-studio-gpu
curl http://localhost:8000/health
```

Without a GPU, set `DEVICE=cpu` — `/generate-shadow` will work; the
diffusion endpoints will be unusably slow (minutes per image).

## Deploy on RunPod

### Serverless — recommended

Pay per second of execution instead of per hour of idle:

1. Push the image: `docker push <registry>/ecom-studio-gpu:latest`
2. RunPod → **Serverless** → **New Endpoint** → your image.
3. GPU: **24GB** (4090/L4) for FLUX.1-schnell. **Min workers 0**, max 1–2.
4. Attach a **Network Volume** mounted at `/models` so weights survive
   between cold starts. Without it every cold start re-downloads ~24GB.
5. Set `HF_HOME=/models`.

Trade-off: a cold start is 30–90s while weights load into VRAM. Set the idle
timeout to a few minutes so a burst of edits shares one warm worker.

### Pod — only if you have steady traffic

RunPod → **Pods** → **Deploy** → RTX 4090 → your image → expose HTTP port
8000 → attach a volume at `/models`. Set `PRELOAD_BACKDROP=1` so the model
loads at boot rather than on the first unlucky request. **Remember to stop
the pod when you are done** — this is where surprise bills come from.

Then point the app at it:

```bash
flutter build apk --debug --dart-define=BACKEND_BASE_URL=https://<your-endpoint>
```

## Cost control

- **Min workers 0** on serverless. This is the single biggest lever.
- **Keep `/generate-shadow` off the GPU box.** It needs no GPU; run it on the
  existing free CPU backend.
- **Skip `/upscale` entirely** unless you actually shoot small images. A
  modern phone shoots 12–24MP and listings top out near 1600px, so you are
  downscaling anyway.
- **Set a spending cap** on your host. Every provider offers one; a
  misconfigured always-on pod is the standard way to lose a month's budget.

## Real-ESRGAN install

Not on PyPI under a maintained name. Either install from source:

```bash
pip install git+https://github.com/sberbank-ai/Real-ESRGAN.git
```

or drop `/api/v1/upscale`. The endpoint returns **501** with a pointer here
if the package is missing, rather than crashing at import.
