# Product Photo AI — Backend

FastAPI service that removes product photo backgrounds using
[`rembg`](https://github.com/danielgatis/rembg) (open-source, ONNX-based,
runs locally). There is no third-party AI API key anywhere in this service —
the Android app calls this backend, and this backend calls no one.

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

Tests stub out the `rembg.remove()` call so they run without downloading the
model or needing network access — they verify the FastAPI route logic
(multipart handling, content-type validation, PNG response) directly.

## Endpoints

- `GET /health` — liveness check.
- `POST /remove-background` — multipart form field `image`; returns a
  transparent-background PNG. Rejects non-image uploads (400) and files over
  15MB (413).

## Deploying

Any host that can run a Python ASGI app works (Fly.io, Railway, a VPS, a
Docker container). Put a real domain behind HTTPS in front of it and update
`BACKEND_BASE_URL` in the Android build config before shipping — the app's
release manifest does not allow cleartext HTTP.
