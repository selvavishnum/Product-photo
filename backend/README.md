# Product Photo AI — Backend

FastAPI service with two endpoints:
- Background removal via [`rembg`](https://github.com/danielgatis/rembg)
  (open-source, ONNX-based, runs locally).
- Upscale via classical Lanczos resampling + an unsharp mask (Pillow only —
  no model, no download).

There is no third-party AI API key anywhere in this service — the Android
app calls this backend, and this backend calls no one.

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
