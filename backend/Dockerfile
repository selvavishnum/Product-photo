# Deploys to Render.com, Hugging Face Spaces, or any Docker host that
# injects a PORT env var (Render) or expects a fixed one (HF Spaces: 7860).
# ENV PORT here is just the image's default -- the host's own -e PORT=...
# at container start overrides it, so the same image works on both.
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-fetch the u2net model (~176MB) at build time, baked into this image
# layer. Without this, the free tier's first request after every cold
# start/restart (disk is wiped each time) would need to download it before
# answering, which blows past both the app's and the host's request
# timeouts -- that's what caused the real-device "timeout" errors.
RUN python -c "from rembg import new_session; new_session('u2net')"

COPY main.py .

ENV PORT=7860
EXPOSE 7860

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
