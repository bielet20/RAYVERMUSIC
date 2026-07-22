"""
YuE Music Generation API
Docs: https://github.com/multimodal-art-projection/YuE
Puerto: 7861

Usa el infer.py oficial de YuE mediante subprocess para máxima compatibilidad.
El modelo se recarga por cada generación (~2-3 min en A100).
"""

import os
import uuid
import asyncio
import subprocess
import tempfile
import shutil
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import torch
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="YuE API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "/outputs"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

YUE_DIR       = os.getenv("YUE_DIR", "/yue")
YUE_INFER     = os.path.join(YUE_DIR, "inference", "infer.py")
MODEL_S1      = os.getenv("YUE_S1_MODEL", "m-a-p/YuE-s1-7B-anneal-en-cot")
MODEL_S2      = os.getenv("YUE_S2_MODEL", "m-a-p/YuE-s2-1B-general")
CUDA_IDX      = os.getenv("CUDA_IDX", "0")

jobs: dict = {}
executor = ThreadPoolExecutor(max_workers=1)


class GenRequest(BaseModel):
    genre: str              # "pop, uplifting, female vocals, piano"
    lyrics: str             # "[verse]\nLetra...\n[chorus]\nCoro..."
    language: str = "en"   # "en" | "zh"
    segments: int = 2       # nº de segmentos de ~30s (1=~30s, 2=~60s, 4=~120s)


def _run_yue(job_id: str, req: GenRequest):
    tmp_dir = Path(tempfile.mkdtemp(prefix=f"yue_{job_id}_"))
    try:
        jobs[job_id]["status"] = "processing"

        # Escribir genre y lyrics a archivos temporales (YuE los espera como ficheros)
        genre_file  = tmp_dir / "genre.txt"
        lyrics_file = tmp_dir / "lyrics.txt"
        out_dir     = tmp_dir / "output"
        out_dir.mkdir()

        genre_file.write_text(req.genre.strip(), encoding="utf-8")
        lyrics_file.write_text(req.lyrics.strip(), encoding="utf-8")

        # Seleccionar modelo s1 según idioma
        s1_model = MODEL_S1
        if req.language == "zh":
            s1_model = s1_model.replace("-en-", "-zh-")

        cmd = [
            "python3", YUE_INFER,
            "--stage1_model",    s1_model,
            "--stage2_model",    MODEL_S2,
            "--genre_txt",       str(genre_file),
            "--lyrics_txt",      str(lyrics_file),
            "--output_dir",      str(out_dir),
            "--cuda_idx",        CUDA_IDX,
            "--run_n_segments",  str(req.segments),
            "--stage2_batch_size", "4",
        ]

        print(f"[YuE] Iniciando generación {job_id} …")
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=900,  # 15 min max
            env={**os.environ, "CUDA_VISIBLE_DEVICES": CUDA_IDX},
        )

        if result.returncode != 0:
            raise RuntimeError(f"YuE falló (código {result.returncode}):\n{result.stderr[-2000:]}")

        # Buscar el WAV generado
        wav_files = sorted(out_dir.rglob("*.wav"))
        if not wav_files:
            raise RuntimeError("YuE no generó ningún archivo WAV. Revisa los logs.")

        fname = f"{job_id}.wav"
        final_path = OUTPUT_DIR / fname
        shutil.copy2(str(wav_files[0]), str(final_path))

        jobs[job_id].update({
            "status": "complete",
            "audio_url": f"/audio/{fname}",
            "filename": fname,
        })
        print(f"[YuE] ✓ Trabajo {job_id} completado → {fname}")

    except subprocess.TimeoutExpired:
        jobs[job_id].update({"status": "error", "error": "Timeout: la generación tardó más de 15 minutos"})
    except Exception as e:
        jobs[job_id].update({"status": "error", "error": str(e)})
        print(f"[YuE] ✗ Error en {job_id}: {e}")
    finally:
        shutil.rmtree(str(tmp_dir), ignore_errors=True)


@app.post("/generate")
async def generate(req: GenRequest):
    if not Path(YUE_INFER).exists():
        return {"error": f"YuE no encontrado en {YUE_INFER}. Clona el repositorio."}, 503
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "queued", "id": job_id}
    loop = asyncio.get_event_loop()
    loop.run_in_executor(executor, _run_yue, job_id, req)
    return {"job_id": job_id, "status": "queued"}


@app.get("/status/{job_id}")
async def get_status(job_id: str):
    return jobs.get(job_id, {"status": "not_found"})


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "yue_infer_found": Path(YUE_INFER).exists(),
        "cuda": torch.cuda.is_available(),
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "active_jobs": sum(1 for j in jobs.values() if j.get("status") in ("queued", "processing")),
    }


app.mount("/audio", StaticFiles(directory=str(OUTPUT_DIR)), name="audio")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7861, log_level="info")
