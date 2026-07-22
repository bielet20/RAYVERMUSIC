FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/models/huggingface

RUN apt-get update && apt-get install -y \
    python3.11 python3.11-dev python3-pip git ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3.11 /usr/bin/python3 && \
    ln -sf /usr/bin/python3.11 /usr/bin/python

WORKDIR /app

# Clonar ACE-Step e instalar
RUN git clone https://github.com/ace-step/ACE-Step.git /ace-step
RUN pip install -e /ace-step

# Dependencias de la API
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# PyTorch con CUDA (ajusta la versión si es necesario)
RUN pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

COPY api.py .

RUN mkdir -p /outputs /models

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:7860/health')"

CMD ["python3", "-m", "uvicorn", "api:app", "--host", "0.0.0.0", "--port", "7860"]
