# syntax=docker/dockerfile:1.7
# Runtime base and every inference dependency are immutable. Model weights are
# deliberately not downloaded here: the one-shot worker verifies the staged
# network-volume manifest before hydrating /workspace/model-cache.
FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385

ARG LTX_RUNTIME_REVISION=fd4ded7f2d88d3da713abcdd4ad41ecc4a9314ca
ARG DIFFUSERS_REVISION=e6d46123091afd58281dc7487c0f6b67055683b9

LABEL org.opencontainers.image.source="https://github.com/daniels-project-space/youtube-studio-ai" \
      ai.youtube.render.contract="2.0.0" \
      ai.youtube.render.ltx-runtime-revision="${LTX_RUNTIME_REVISION}" \
      ai.youtube.render.diffusers-revision="${DIFFUSERS_REVISION}"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HOME=/workspace/model-cache/huggingface \
    NOVITA_MODEL_VOLUME=/network \
    NOVITA_LOCAL_MODEL_CACHE=/workspace/model-cache \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1 \
    UV_PYTHON=3.12.12 \
    UV_PYTHON_INSTALL_DIR=/opt/uv/python

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates ffmpeg git libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && python -m pip install --no-cache-dir uv==0.10.6

RUN git clone --filter=blob:none https://github.com/Lightricks/LTX-2.git /opt/LTX-2 \
    && git -C /opt/LTX-2 checkout --detach "${LTX_RUNTIME_REVISION}" \
    && test "$(git -C /opt/LTX-2 rev-parse HEAD)" = "${LTX_RUNTIME_REVISION}" \
    && cd /opt/LTX-2 \
    # LTX's pinned runtime commit does not publish a repository uv.lock. Generate
    # one inside this immutable image, then retain it in the image layer; the
    # resolved dependency graph is therefore sealed by the pushed image digest.
    && uv lock \
    && uv sync --frozen --no-dev --package ltx-pipelines --python "${UV_PYTHON}" \
    && uv pip install --python /opt/LTX-2/.venv/bin/python \
       "git+https://github.com/huggingface/diffusers.git@${DIFFUSERS_REVISION}" \
    && /opt/LTX-2/.venv/bin/python -c \
       "from diffusers import ZImagePipeline; import ltx_pipelines.distilled" \
    && rm -rf /opt/LTX-2/.git

COPY infra/novita/worker.py /opt/novita-worker/worker.py
RUN /opt/LTX-2/.venv/bin/python -m py_compile /opt/novita-worker/worker.py \
    && mkdir -p /workspace/model-cache /workspace/render \
    && chmod 0755 /opt/novita-worker/worker.py

WORKDIR /workspace/render
ENTRYPOINT ["/opt/LTX-2/.venv/bin/python", "/opt/novita-worker/worker.py"]
