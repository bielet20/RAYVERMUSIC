FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/models/huggingface
ENV YUE_DIR=/yue

RUN apt-get update && apt-get install -y \
    python3.11 python3.11-dev python3-pip git ffmpeg libsndfile1 \
    build-essential cmake \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3.11 /usr/bin/python3 && \
    ln -sf /usr/bin/python3.11 /usr/bin/python

# PyTorch con CUDA
RUN pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Clonar YuE e instalar dependencias
RUN git clone https://github.com/multimodal-art-projection/YuE.git /yue
RUN pip install -r /yue/requirements.txt

# xcodec2 (vocoder de YuE)
RUN pip install git+https://github.com/zhenye234/xcodec2.git || \
    pip install xcodec2

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api.py .

RUN mkdir -p /outputs /models

EXPOSE 7861

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:7861/health')"

CMD ["python3", "-m", "uvicorn", "api:app", "--host", "0.0.0.0", "--port", "7861"]
