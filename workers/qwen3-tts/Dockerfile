# The production worker uses the compact CUDA runtime. FlashAttention is
# compiled once against its exact PyTorch/CUDA ABI and released as a pinned,
# public, secret-free wheel; this keeps the provider's persistent 30 GB disk
# free of the 17 GB CUDA compiler image.
FROM docker.io/pytorch/pytorch@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385

# Link this secret-free worker image to the public source repository so the
# registry can inherit its public pull visibility; model bytes are never baked
# into the image and provider credentials are never included.
LABEL org.opencontainers.image.source="https://github.com/daniels-project-space/youtube-studio-ai"

ARG FLASH_ATTN_WHEEL_URL="https://github.com/daniels-project-space/youtube-studio-ai/releases/download/qwen3-tts-runtime-deps-20260918/flash_attn-2.8.3-cp311-cp311-linux_x86_64.whl"
ARG FLASH_ATTN_WHEEL_SHA256="ca96aa07ad9c5334cbf30f9c6999ab5fe2b656fdbca7992cde7b3a99c7d7cf44"

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    MAX_JOBS=4

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg sox \
    && rm -rf /var/lib/apt/lists/*

RUN curl --fail --location --retry 3 --output /tmp/flash_attn-2.8.3-cp311-cp311-linux_x86_64.whl "$FLASH_ATTN_WHEEL_URL" \
    && echo "$FLASH_ATTN_WHEEL_SHA256  /tmp/flash_attn-2.8.3-cp311-cp311-linux_x86_64.whl" | sha256sum --check --status \
    && python -m pip install \
      "qwen-tts==0.1.1" \
      "transformers==4.57.3" \
      "fastapi==0.116.1" \
      "uvicorn==0.35.0" \
      "soundfile==0.13.1" \
    && python -m pip install /tmp/flash_attn-2.8.3-cp311-cp311-linux_x86_64.whl \
    && rm -f /tmp/flash_attn-2.8.3-cp311-cp311-linux_x86_64.whl

WORKDIR /app
COPY contract.py worker.py entrypoint.py ./

EXPOSE 8790
ENTRYPOINT ["python", "/app/entrypoint.py"]
