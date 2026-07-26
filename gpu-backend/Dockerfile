# CUDA 12.4 runtime + cuDNN. Must match the torch build installed below.
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3-pip git libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# torch first, from the CUDA index -- otherwise pip resolves the CPU wheel
# and every request falls back to CPU at ~100x the latency, with no error.
RUN pip3 install --no-cache-dir \
      torch==2.5.1 torchvision==0.20.1 \
      --index-url https://download.pytorch.org/whl/cu124

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY main.py .

# Weights live on a mounted volume, not in the image. FLUX.1-schnell alone is
# ~24GB; baking it in makes a 30GB image that must be pulled on every cold
# start.
VOLUME ["/models"]

EXPOSE 8000
# One worker: each would load its own copy of the model into VRAM.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
