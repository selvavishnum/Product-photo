# Product Photo AI — Backend

FastAPI service with two groups of endpoints:
- **Free, no API key**: `/remove-background` (`rembg`, open-source,
  ONNX-based, runs locally) and `/upscale` (classical Lanczos resampling +
  unsharp mask, Pillow only). Used by the existing native Android app
  (`../app`).
- **Paid, needs a fal.ai account**: `/ai/remove-background` and
  `/ai/generate-background`, used by the new Flutter studio app
  (`../mobile`). See "fal.ai AI features" below before using these — every
  call costs money.

**Already hosted** for this app at `https://product-photo-backend.onrender.com/`
(Render.com free tier) — that's the default `BACKEND_BASE_URL` baked into the
app, so you don't need to deploy anything yourself unless you want your own
copy.

## Run locally

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

First request downloads the `u2net` model (~176MB, one-time, cached in
`~/.u2net`). Requires normal internet access to `github.com` — this doesn't
work in network-restricted sandboxes, only on a real dev machine, server, or
CI runner.

Point the Android app at this server via `BACKEND_BASE_URL`
(`app/build.gradle.kts`) -- override with `-PbackendUrl=http://10.0.2.2:8000/`
to reach a locally-run server from the Android emulator (the app's baked-in
default is the hosted Render URL above, not this).

## Test

```bash
pip install -r requirements-dev.txt
pytest
```

Background-removal tests stub out `rembg.remove()` so they run without
downloading the model or needing network access. Upscale tests run for real —
no model to stub, it's plain Pillow — and check actual output dimensions.

## Endpoints

- `GET /health` — liveness check.
- `POST /remove-background` — multipart form field `image`; returns a
  transparent-background PNG. Rejects non-image uploads (400) and files over
  15MB (413).
- `POST /upscale` — multipart form field `image`, optional query param
  `scale` (1-4, default 2); returns a resized + sharpened PNG. Classical
  upscaling, not a generative super-resolution model — see `main.py`'s
  `upscale_image()` docstring for why.
- `GET /ai/themes` — lists the studio backdrop preset keys (`marble_table`,
  `luxury_podium`, `nature_sunlight`).
- `POST /ai/remove-background` — multipart form field `image`; calls
  BiRefNet on fal.ai, returns `{"cutout_url": "https://..."}` (a fal.ai-hosted
  URL, not raw bytes). **Costs money per call** — see below.
- `POST /ai/generate-background` — multipart form field `image` (a cutout
  PNG with transparency, e.g. from `/ai/remove-background`), plus either
  form field `theme_key` (one of the presets above) or `prompt` (a custom
  description — overrides `theme_key` if both are given). Calls FLUX.1 dev
  inpainting on fal.ai, returns `{"generated_url": "https://..."}`. **Costs
  money per call.**

## fal.ai AI features (`/ai/*` endpoints)

These power the new Flutter studio app (`../mobile`), not the existing
native Android app. They need:

1. A fal.ai account with billing set up: fal.ai → sign up → add a payment
   method (no meaningful free tier for these models).
2. An API key from your fal.ai dashboard, set as the `FAL_KEY` environment
   variable on whatever host runs this backend (Render: **Environment** tab
   → add `FAL_KEY`).
3. **Verify the model IDs** in `services/background_removal.py`
   (`BIREFNET_MODEL_ID`) and `services/background_generation.py`
   (`FLUX_INPAINT_MODEL_ID`) against fal.ai's own model catalog
   (fal.ai/models) before relying on them. This repo's sandbox has no
   network access to fal.ai, so these are unverified placeholders, not
   confirmed-correct values — the same mistake cost real CI cycles earlier
   in this project with a wrong Maven dependency, so don't assume these are
   right without checking.

Uses BiRefNet (MIT licensed) rather than Bria RMBG 2.0 (CC BY-NC 4.0,
**non-commercial only**) for removal — this app has a paid credit system
planned, so a non-commercial-only model isn't legally usable here.

## Deploying

Any host that can run a Python ASGI app works (Render, Fly.io, Railway, a
VPS, a Docker container). Put a real domain behind HTTPS in front of it and
update `BACKEND_BASE_URL` in the Android build config before shipping — the
app's release manifest does not allow cleartext HTTP.

### Free option, no computer required: Render.com

This is what's already deployed for this app (see the URL above). Entirely
from a phone browser, no `git push` needed:

1. Go to render.com → sign up (free, via GitHub) → authorize Render for
   this repo (or all repos).
2. **New +** → **Web Service** → select this repo.
3. **Root Directory**: `backend` (so Render only builds this folder's
   `Dockerfile`, not the whole monorepo). Render auto-detects Docker once
   this is set.
4. **Instance Type**: **Free**. Create the service.
5. Watch the **Logs** tab until it says **"Live"** — the backend is now at
   `https://<your-service-name>.onrender.com`.
6. Point the app at it (already the default if you're using this app's own
   deployment above; for your own):
   ```bash
   ./gradlew assembleDebug -PbackendUrl=https://<your-service-name>.onrender.com/
   ```
   or via the CI workflow's `backend_url` input (see root `README.md`).

Free-tier caveat: the service sleeps after ~15 minutes of no traffic and
takes about 50s to wake up on the next request (cold start). Fine for
testing and low-traffic use; upgrade to a paid tier if it becomes a
bottleneck.

### Alternative: Hugging Face Spaces

Also free, no computer required, same idea (Docker SDK, phone-browser file
upload instead of a repo connection):

1. Go to huggingface.co → sign up (free) → **New Space**.
2. SDK: **Docker**. Hardware: the free **CPU basic** tier. Give it a name.
3. In the new Space's **Files** tab, use **Add file → Create new file** (or
   **Upload files**) to add three files, copying content straight from this
   folder: `Dockerfile`, `main.py`, `requirements.txt`.
4. The Space builds automatically (watch the **Logs** tab). Once it says
   "Running", the backend is live at
   `https://<your-username>-<space-name>.hf.space`.

Same free-tier cold-start caveat as Render.
