# Product Photo AI — Backend

FastAPI service with two endpoints:
- Background removal via [`rembg`](https://github.com/danielgatis/rembg)
  (open-source, ONNX-based, runs locally).
- Upscale via classical Lanczos resampling + an unsharp mask (Pillow only —
  no model, no download).

There is no third-party AI API key anywhere in this service — the Android
app calls this backend, and this backend calls no one.

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
(`app/build.gradle.kts`) — defaults to `http://10.0.2.2:8000/`, which reaches
your machine's `localhost:8000` from the Android emulator.

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

Any host that can run a Python ASGI app works (Fly.io, Railway, a VPS, a
Docker container). Put a real domain behind HTTPS in front of it and update
`BACKEND_BASE_URL` in the Android build config before shipping — the app's
release manifest does not allow cleartext HTTP.

### Free option, no computer required: Hugging Face Spaces

`Dockerfile` in this folder is set up for HF Spaces' Docker SDK (listens on
port 7860, which Spaces expects). This can be done entirely from a phone
browser — no local machine, no `git push` needed:

1. Go to huggingface.co → sign up (free) → **New Space**.
2. SDK: **Docker**. Hardware: the free **CPU basic** tier. Give it a name.
3. In the new Space's **Files** tab, use **Add file → Create new file** (or
   **Upload files**) to add three files, copying content straight from this
   folder: `Dockerfile`, `main.py`, `requirements.txt`.
4. The Space builds automatically (watch the **Logs** tab). Once it says
   "Running", the backend is live at
   `https://<your-username>-<space-name>.hf.space`.
5. Point the app at it — this URL is already HTTPS, so it works with the
   release build too, not just debug:
   ```bash
   ./gradlew assembleDebug -PbackendUrl=https://<your-username>-<space-name>.hf.space/
   ```
   or via the CI workflow's `backend_url` input (see root `README.md`).

Free-tier caveats: the Space may sleep after a period of inactivity and take
a bit to wake up on the next request (cold start), and CPU-only inference is
slower than a dedicated server. Fine for testing and low-traffic use; revisit
a paid tier if it becomes a bottleneck.
