"""
ACE-Step Music Generation API
Docs: https://github.com/ace-step/ACE-Step
Puerto: 7860

Instala los modelos con: python download_models.py
Luego arranca: uvicorn api:app --host 0.0.0.0 --port 7860
"""

import os
import uuid
import asyncio
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import torch
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="ACE-Step API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "/outputs"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CHECKPOINT = os.getenv("CHECKPOINT_DIR", "ACE-Step/ACE-Step-v1-3.5B")

jobs: dict = {}
executor = ThreadPoolExecutor(max_workers=1)  # una generación a la vez
pipeline = None


@app.on_event("startup")
async def load_model():
    global pipeline
    try:
        from acestep.pipeline import ACEStepPipeline
        dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        print(f"[ACE-Step] Cargando modelo desde {CHECKPOINT} …")
        pipeline = ACEStepPipeline.from_pretrained(CHECKPOINT, torch_dtype=dtype)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        pipeline = pipeline.to(device)
        print(f"[ACE-Step] ✓ Modelo listo en {device}")
    except Exception as e:
        print(f"[ACE-Step] ✗ Error cargando modelo: {e}")


class GenRequest(BaseModel):
    prompt: str           # "lofi, piano, chill, relaxing, 80bpm"
    lyrics: str           # "[verse]\nLetra aquí\n[chorus]\nCoro aquí"
    duration: float = 60.0
    guidance_scale: float = 7.5
    num_steps: int = 50
    seed: int = -1


def _run_generation(job_id: str, req: GenRequest):
    try:
        jobs[job_id]["status"] = "processing"
        if pipeline is None:
            raise RuntimeError("Modelo no cargado. Revisa los logs del servidor.")

        seed = req.seed if req.seed >= 0 else int(torch.randint(0, 2**31, (1,)).item())
        torch.manual_seed(seed)

        result = pipeline(
            prompt=req.prompt,
            lyrics=req.lyrics,
            audio_duration=req.duration,
            guidance_scale=req.guidance_scale,
            num_inference_steps=req.num_steps,
        )

        # El pipeline devuelve un objeto con .audios y .sample_rate
        if hasattr(result, "audios"):
            audio = result.audios[0]
            sr = getattr(result, "sample_rate", 44100)
        elif isinstance(result, (list, tuple)):
            audio, sr = result[0], result[1] if len(result) > 1 else 44100
        else:
            audio, sr = result, 44100

        fname = f"{job_id}.wav"
        out_path = OUTPUT_DIR / fname

        import soundfile as sf
        # audio puede ser (samples,) o (channels, samples) — normalizar
        if hasattr(audio, "numpy"):
            audio = audio.numpy()
        import numpy as np
        if audio.ndim == 2:
            audio = audio.T  # soundfile espera (samples, channels)
        sf.write(str(out_path), audio, int(sr))

        jobs[job_id].update({
            "status": "complete",
            "audio_url": f"/audio/{fname}",
            "filename": fname,
            "seed": seed,
            "duration": req.duration,
        })
        print(f"[ACE-Step] ✓ Trabajo {job_id} completado → {fname}")

    except Exception as e:
        jobs[job_id].update({"status": "error", "error": str(e)})
        print(f"[ACE-Step] ✗ Error en {job_id}: {e}")


@app.post("/generate")
async def generate(req: GenRequest):
    if pipeline is None:
        return {"error": "Modelo no disponible. Revisa los logs."}, 503
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "queued", "id": job_id}
    loop = asyncio.get_event_loop()
    loop.run_in_executor(executor, _run_generation, job_id, req)
    return {"job_id": job_id, "status": "queued"}


@app.get("/status/{job_id}")
async def get_status(job_id: str):
    return jobs.get(job_id, {"status": "not_found"})


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": pipeline is not None,
        "cuda": torch.cuda.is_available(),
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "active_jobs": sum(1 for j in jobs.values() if j.get("status") in ("queued", "processing")),
    }


@app.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    if job_id in jobs:
        f = jobs[job_id].get("filename")
        if f and (OUTPUT_DIR / f).exists():
            (OUTPUT_DIR / f).unlink(missing_ok=True)
        del jobs[job_id]
    return {"ok": True}


app.mount("/audio", StaticFiles(directory=str(OUTPUT_DIR)), name="audio")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860, log_level="info")
