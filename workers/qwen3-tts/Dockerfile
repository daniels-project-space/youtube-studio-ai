FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime

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
COPY contract.py worker.py ./

EXPOSE 8790
CMD ["uvicorn", "worker:app", "--host", "0.0.0.0", "--port", "8790", "--workers", "1"]
