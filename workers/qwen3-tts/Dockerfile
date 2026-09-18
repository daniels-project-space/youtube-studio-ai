# FlashAttention is compiled against the exact PyTorch/CUDA ABI below, so this
# must be the matching development base (the runtime tag has no nvcc).
FROM docker.io/pytorch/pytorch:2.8.0-cuda12.8-cudnn9-devel

# Link this secret-free worker image to the public source repository so the
# registry can inherit its public pull visibility; model bytes are never baked
# into the image and provider credentials are never included.
LABEL org.opencontainers.image.source="https://github.com/daniels-project-space/youtube-studio-ai"

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    MAX_JOBS=4

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install \
      "qwen-tts==0.1.1" \
      "transformers==4.57.3" \
      "fastapi==0.116.1" \
      "uvicorn==0.35.0" \
      "soundfile==0.13.1" \
    && python -m pip install "flash-attn==2.8.3" --no-build-isolation

WORKDIR /app
COPY contract.py worker.py entrypoint.py ./

EXPOSE 8790
ENTRYPOINT ["python", "/app/entrypoint.py"]
