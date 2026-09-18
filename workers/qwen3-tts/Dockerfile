# FlashAttention is compiled against the exact PyTorch/CUDA ABI below, so this
# stage needs nvcc.  The final worker deliberately uses the matching runtime
# base: an OpenRelay 30 GB persistent VM cannot afford to retain a 17 GB
# development image beside its model cache.
FROM docker.io/pytorch/pytorch:2.8.0-cuda12.8-cudnn9-devel AS build

# Link this secret-free worker image to the public source repository so the
# registry can inherit its public pull visibility; model bytes are never baked
# into the image and provider credentials are never included.
LABEL org.opencontainers.image.source="https://github.com/daniels-project-space/youtube-studio-ai"

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    MAX_JOBS=4

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install \
      --prefix=/opt/qwen-deps \
      "qwen-tts==0.1.1" \
      "transformers==4.57.3" \
      "fastapi==0.116.1" \
      "uvicorn==0.35.0" \
      "soundfile==0.13.1" \
    && python -m pip install --prefix=/opt/qwen-deps "flash-attn==2.8.3" --no-build-isolation

FROM docker.io/pytorch/pytorch@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385

LABEL org.opencontainers.image.source="https://github.com/daniels-project-space/youtube-studio-ai"

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    MAX_JOBS=4 \
    PATH=/opt/qwen-deps/bin:$PATH \
    PYTHONPATH=/opt/qwen-deps/lib/python3.11/site-packages

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg sox \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /opt/qwen-deps /opt/qwen-deps

WORKDIR /app
COPY contract.py worker.py entrypoint.py ./

EXPOSE 8790
ENTRYPOINT ["python", "/app/entrypoint.py"]
