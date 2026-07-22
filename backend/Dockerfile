# Deploys to Render.com, Hugging Face Spaces, or any Docker host that
# injects a PORT env var (Render) or expects a fixed one (HF Spaces: 7860).
# ENV PORT here is just the image's default -- the host's own -e PORT=...
# at container start overrides it, so the same image works on both.
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

ENV PORT=7860
EXPOSE 7860

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
