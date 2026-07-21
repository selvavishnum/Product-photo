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
pip install -r requirements.txt
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
  `scale` (1-4, default 2); returns a resized + sharpened PNG. This is
  classical upscaling (Lanczos resample + unsharp mask), not a generative
  super-resolution model — `realesrgan`'s PyPI package pulls in `basicsr`,
  which fails to install here due to an unrelated CUDA package version
  conflict in its `setup.py`, and third-party pre-converted ONNX mirrors
  found online aren't from an authoritative source worth trusting for a
  shipped feature. Revisit if a real model becomes practical to self-host.

## Deploying

Any host that can run a Python ASGI app works (Fly.io, Railway, a VPS, a
Docker container). Put a real domain behind HTTPS in front of it and update
`BACKEND_BASE_URL` in the Android build config before shipping — the app's
release manifest does not allow cleartext HTTP.
