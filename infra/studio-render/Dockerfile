# syntax=docker/dockerfile:1.7
FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385
ARG SOURCE_REVISION
ARG STUDIO_REVISION
ARG COMFYUI_COMMIT=f938505952476e48a12687eac696cdc94d48a3fe
ARG H3_LATENT_UPSCALER_COMMIT=e98237773011523528353a8beb4863e65b099a38
LABEL org.opencontainers.image.source="https://github.com/daniels-project-space/youtube-studio-ai" \
      org.opencontainers.image.revision="${STUDIO_REVISION}" \
      ai.youtube.render.source-revision="${SOURCE_REVISION}" \
      ai.youtube.render.project="youtube-studio-ai" \
      ai.youtube.render.comfy-revision="${COMFYUI_COMMIT}"
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    COMFY_ROOT=/opt/youtube-studio/ComfyUI MODEL_CACHE_MODE=preseeded-only \
    MODEL_MANIFEST_PATH=/models/model-manifest.json \
    RENDER_INPUT_CACHE_ROOT=/workspace/youtube-studio/h3/input-cache \
    MINIMAX_H3_RECEIPT_ROOT=/workspace/youtube-studio/h3/receipts \
    HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
RUN apt-get update -qq && apt-get install -y --no-install-recommends ca-certificates ffmpeg git \
    && rm -rf /var/lib/apt/lists/* \
    && git init "$COMFY_ROOT" \
    && git -C "$COMFY_ROOT" remote add origin https://github.com/Comfy-Org/ComfyUI.git \
    && git -C "$COMFY_ROOT" fetch --depth 1 origin "$COMFYUI_COMMIT" \
    && git -C "$COMFY_ROOT" checkout --detach FETCH_HEAD \
    && test "$(git -C "$COMFY_ROOT" rev-parse HEAD)" = "$COMFYUI_COMMIT" \
    && python -m pip install -r "$COMFY_ROOT/requirements.txt" fastapi "uvicorn[standard]" requests \
    && git init "$COMFY_ROOT/custom_nodes/ComfyUI-H3-Latent-Upscaler-Mamad8" \
    && git -C "$COMFY_ROOT/custom_nodes/ComfyUI-H3-Latent-Upscaler-Mamad8" remote add origin https://github.com/mamad8c/ComfyUI-H3-Latent-Upscaler-Mamad8.git \
    && git -C "$COMFY_ROOT/custom_nodes/ComfyUI-H3-Latent-Upscaler-Mamad8" fetch --depth 1 origin "$H3_LATENT_UPSCALER_COMMIT" \
    && git -C "$COMFY_ROOT/custom_nodes/ComfyUI-H3-Latent-Upscaler-Mamad8" checkout --detach FETCH_HEAD \
    && test "$(git -C "$COMFY_ROOT/custom_nodes/ComfyUI-H3-Latent-Upscaler-Mamad8" rev-parse HEAD)" = "$H3_LATENT_UPSCALER_COMMIT" \
    && python -m pip freeze > /opt/youtube-studio/python-freeze.txt
COPY common /app/common
COPY routes/h3 /app/h3
COPY manifests/minimax-h3-turbo8-5090.source.json /app/route.json
COPY profiles/minimax-h3-5090.json /app/profile.json
RUN chmod 0555 /app/h3/entrypoint.sh \
    && python -m compileall -q /app \
    && mkdir -p /workspace/youtube-studio/h3/input-cache /workspace/youtube-studio/h3/receipts
WORKDIR /app/h3
EXPOSE 8080
ENTRYPOINT ["/app/h3/entrypoint.sh"]
