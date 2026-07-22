"""
RAYVER Local Studio
Genera música con ACE-Step y YuE en tu GPU local y súbela a rayvermusic.com.

Arranque:
  python studio.py          # inicia todo (modelos + UI)
  python studio.py --no-servers  # solo UI (si los servidores ya corren)
"""

import os
import sys
import json
import time
import uuid
import shutil
import signal
import socket
import argparse
import tempfile
import threading
import subprocess
from pathlib import Path

import requests
import gradio as gr

# ── Rutas ─────────────────────────────────────────────────────────────────────
STUDIO_DIR  = Path(__file__).parent.resolve()
REPO_DIR    = STUDIO_DIR.parent
ACE_API     = REPO_DIR / "gpu-server" / "ace-step" / "api.py"
YUE_API     = REPO_DIR / "gpu-server" / "yue" / "api.py"
OUTPUT_DIR  = STUDIO_DIR / "output"
ACE_OUT     = OUTPUT_DIR / "ace"
YUE_OUT     = OUTPUT_DIR / "yue"
CONFIG_FILE = STUDIO_DIR / "config.json"

for d in (ACE_OUT, YUE_OUT):
    d.mkdir(parents=True, exist_ok=True)

# ── Config ────────────────────────────────────────────────────────────────────
DEFAULT_CFG = {
    "rayvermusic_url":      "https://rayvermusic.com",
    "rayvermusic_password": "",
    "anthropic_api_key":    "",
    "ace_checkpoint":       "ACE-Step/ACE-Step-v1-3.5B",
    "yue_dir":              str(Path.home() / "YuE"),
    "yue_s1_model":         "m-a-p/YuE-s1-7B-anneal-en-cot",
    "yue_s2_model":         "m-a-p/YuE-s2-1B-general",
    "ace_port":             7860,
    "yue_port":             7861,
    "studio_port":          7870,
}

def _load_cfg():
    if CONFIG_FILE.exists():
        try:
            return {**DEFAULT_CFG, **json.loads(CONFIG_FILE.read_text())}
        except Exception:
            pass
    return DEFAULT_CFG.copy()

def _save_cfg(c):
    CONFIG_FILE.write_text(json.dumps(c, indent=2, ensure_ascii=False))

cfg = _load_cfg()

# ── Gestión de procesos de los servidores ────────────────────────────────────
_procs: dict[str, subprocess.Popen] = {}

def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) != 0

def _start_server(name: str, api_py: Path, port: int, extra_env: dict = None):
    if not _port_free(port):
        print(f"[Studio] {name} ya escucha en :{port}, no se lanza de nuevo.")
        return
    if not api_py.exists():
        print(f"[Studio] AVISO: {api_py} no encontrado. Servidor {name} no arrancado.")
        return

    env = {**os.environ, "OUTPUT_DIR": str(OUTPUT_DIR / name.lower()), **(extra_env or {})}
    proc = subprocess.Popen(
        [sys.executable, str(api_py)],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    _procs[name] = proc
    print(f"[Studio] {name} arrancado (PID {proc.pid}) en :{port}")

    def _log():
        for line in proc.stdout:
            print(f"[{name}] {line.decode(errors='replace').rstrip()}")
    threading.Thread(target=_log, daemon=True).start()

def start_servers():
    ace_env = {"CHECKPOINT_DIR": cfg["ace_checkpoint"]}
    yue_env = {
        "YUE_DIR":       cfg["yue_dir"],
        "YUE_S1_MODEL":  cfg["yue_s1_model"],
        "YUE_S2_MODEL":  cfg["yue_s2_model"],
    }
    _start_server("ace-step", ACE_API, cfg["ace_port"], ace_env)
    _start_server("yue",      YUE_API, cfg["yue_port"], yue_env)

def stop_servers():
    for name, proc in list(_procs.items()):
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        print(f"[Studio] {name} detenido.")

def _server_url(model: str) -> str:
    port = cfg["ace_port"] if model == "ace-step" else cfg["yue_port"]
    return f"http://127.0.0.1:{port}"

def _health(model: str) -> dict:
    try:
        r = requests.get(f"{_server_url(model)}/health", timeout=3)
        return r.json() if r.ok else {}
    except Exception:
        return {}

# ── Autenticación en Rayvermusic ──────────────────────────────────────────────
_token: str | None = None

def _get_token(force=False) -> str | None:
    global _token
    if _token and not force:
        return _token
    url = cfg["rayvermusic_url"].rstrip("/")
    pwd = cfg["rayvermusic_password"]
    if not url or not pwd:
        return None
    try:
        r = requests.post(f"{url}/api/auth/login", json={"password": pwd}, timeout=10)
        if r.ok:
            _token = r.json().get("token")
    except Exception:
        pass
    return _token

# ── Generación de música ──────────────────────────────────────────────────────
def generate_music(model: str, style: str, lyrics: str,
                   language: str, duration: float, segments: int, seed: int):
    """Genera música via servidor local y devuelve la ruta local del WAV."""
    url = _server_url(model)
    h = _health(model)
    if not h:
        yield None, f"❌ Servidor {model} no responde. ¿Ya arrancó? (puede tardar 1-2 min la primera vez)"
        return

    if model == "ace-step":
        if not h.get("model_loaded"):
            yield None, "⏳ ACE-Step todavía está cargando el modelo… espera unos segundos."
            return
        payload = {
            "prompt":   style,
            "lyrics":   lyrics,
            "duration": float(duration),
            "seed":     int(seed),
        }
    else:  # yue
        payload = {
            "genre":    style,
            "lyrics":   lyrics,
            "language": language,
            "segments": int(segments),
        }

    try:
        r = requests.post(f"{url}/generate", json=payload, timeout=15)
        if not r.ok:
            yield None, f"❌ Error al iniciar generación: {r.status_code} {r.text[:200]}"
            return
        job_id = r.json()["job_id"]
    except Exception as e:
        yield None, f"❌ No se pudo conectar al servidor {model}: {e}"
        return

    yield None, f"⏳ Generando con {model}… (job {job_id[:8]})"

    max_polls = 120 if model == "yue" else 40
    for i in range(max_polls):
        time.sleep(5)
        try:
            s = requests.get(f"{url}/status/{job_id}", timeout=5).json()
        except Exception:
            continue

        status = s.get("status")
        if status == "complete":
            fname   = s.get("filename")
            src_dir = YUE_OUT if model == "yue" else ACE_OUT
            wav     = src_dir / fname
            if wav.exists():
                seed_val = s.get("seed", "?")
                yield str(wav), f"✅ {model.upper()} completado · seed: {seed_val} · {wav.name}"
            else:
                yield None, f"❌ WAV no encontrado en {wav}"
            return
        elif status == "error":
            yield None, f"❌ Error de generación: {s.get('error', 'desconocido')}"
            return
        else:
            elapsed = (i + 1) * 5
            yield None, f"⏳ {model} generando… ({elapsed}s transcurridos, estado: {status})"

    yield None, "❌ Timeout: la generación tardó demasiado. Revisa la GPU."

# ── Letras con Claude ─────────────────────────────────────────────────────────
def generate_lyrics(topic: str, genre: str, mood: str, language: str,
                    include_chorus: bool, include_bridge: bool) -> str:
    key = cfg.get("anthropic_api_key", "").strip()
    if not key:
        return "❌ Configura tu Anthropic API Key en la pestaña ⚙️ Configuración"

    lang_name = {"es": "español", "en": "English", "zh": "中文 (chino)"}
    parts = ["[verse 1]"]
    if include_chorus: parts.append("[chorus]")
    parts.append("[verse 2]")
    if include_bridge: parts.append("[bridge]")
    if include_chorus: parts.append("[chorus]")
    parts.append("[outro]")
    structure = " → ".join(parts)

    prompt = f"""Escribe la letra completa en {lang_name.get(language, language)} sobre el tema: "{topic}"
Género musical: {genre}
Mood / ambiente: {mood}
Estructura requerida: {structure}

Usa EXACTAMENTE estos marcadores de sección (entre corchetes) y NO escribas nada más fuera de la letra."""

    try:
        r = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key":         key,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            json={
                "model":      "claude-sonnet-4-6",
                "max_tokens": 1200,
                "system":     "Eres un letrista profesional. Solo escribe la letra, sin explicaciones ni comentarios.",
                "messages":   [{"role": "user", "content": prompt}],
            },
            timeout=30,
        )
        data = r.json()
        if r.ok:
            return data.get("content", [{}])[0].get("text", "").strip()
        return f"❌ Error Claude: {data.get('error', {}).get('message', r.text[:200])}"
    except Exception as e:
        return f"❌ Error de red: {e}"

# ── Subida a Rayvermusic ──────────────────────────────────────────────────────
def upload_to_rayvermusic(audio_path: str, title: str, tags: str, pack_id: str = "") -> str:
    global _token
    if not audio_path or not Path(audio_path).exists():
        return "❌ Primero genera un audio"
    if not title.strip():
        title = Path(audio_path).stem

    token = _get_token()
    if not token:
        return "❌ No se pudo autenticar. Revisa URL y contraseña en ⚙️ Configuración."

    base = cfg["rayvermusic_url"].rstrip("/")
    hdrs = {"Authorization": f"Bearer {token}"}

    # 1. Subir el archivo
    try:
        with open(audio_path, "rb") as f:
            r = requests.post(
                f"{base}/api/admin/ambient/upload/track",
                files={"audio": (Path(audio_path).name, f, "audio/wav")},
                headers=hdrs,
                timeout=120,
            )
        if r.status_code == 401:
            token = _get_token(force=True)
            if not token:
                return "❌ Sesión expirada y no se pudo renovar"
            hdrs["Authorization"] = f"Bearer {token}"
            with open(audio_path, "rb") as f:
                r = requests.post(
                    f"{base}/api/admin/ambient/upload/track",
                    files={"audio": (Path(audio_path).name, f, "audio/wav")},
                    headers=hdrs,
                    timeout=120,
                )
        if not r.ok:
            return f"❌ Error subiendo archivo: {r.status_code} {r.text[:300]}"
        file_url = r.json().get("url")
        if not file_url:
            return f"❌ El servidor no devolvió URL: {r.text[:200]}"
    except Exception as e:
        return f"❌ Error de conexión subiendo archivo: {e}"

    # 2. Crear track en la biblioteca
    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    try:
        r2 = requests.post(
            f"{base}/api/admin/ambient/tracks",
            json={
                "title":    title.strip(),
                "tags":     tag_list,
                "packId":   pack_id.strip() or None,
                "source":   {"type": "file", "file": file_url},
                "active":   True,
                "zones":    [],
                "generatedBy": "local-studio",
            },
            headers={**hdrs, "Content-Type": "application/json"},
            timeout=30,
        )
        if not r2.ok:
            return f"⚠️ Audio subido ({file_url}), pero error creando track: {r2.status_code} {r2.text[:200]}"
        track = r2.json().get("track", {})
        return f"✅ Track «{track.get('title', title)}» añadido a Rayvermusic · ID: {track.get('id', '?')}"
    except Exception as e:
        return f"⚠️ Audio subido ({file_url}), pero error al registrar track: {e}"

# ── Estado de los modelos ─────────────────────────────────────────────────────
def get_model_status() -> str:
    lines = []
    for model, label in [("ace-step", "ACE-Step"), ("yue", "YuE")]:
        h = _health(model)
        if not h:
            lines.append(f"🔴 {label}: servidor no disponible")
        elif h.get("model_loaded") is False:
            lines.append(f"🟡 {label}: cargando modelo…")
        else:
            gpu = h.get("gpu", "CPU")
            cuda = "CUDA ✓" if h.get("cuda") else "sin GPU"
            lines.append(f"🟢 {label}: listo · {gpu} · {cuda}")
    return "\n".join(lines)

# ── UI Gradio ─────────────────────────────────────────────────────────────────
def build_ui() -> gr.Blocks:
    with gr.Blocks(
        title="RAYVER Local Studio",
        theme=gr.themes.Base(
            primary_hue=gr.themes.colors.purple,
            neutral_hue=gr.themes.colors.slate,
        ),
        css="""
        .gradio-container { max-width: 980px !important; margin: 0 auto }
        footer { display: none !important }
        #status-box textarea { font-size: 0.85em; line-height: 1.6 }
        """,
    ) as demo:
        gr.Markdown("# 🎵 RAYVER Local Studio\n*Genera música con tu GPU y súbela a rayvermusic.com*")

        with gr.Tabs():
            # ── Pestaña Generar ───────────────────────────────────────────────
            with gr.TabItem("🎸 Generar"):
                with gr.Row():
                    model_rd = gr.Radio(
                        choices=["ace-step", "yue"],
                        value="ace-step",
                        label="Motor",
                        info="ACE-Step ≈ 30s · YuE ≈ 2-5 min",
                    )
                    status_box = gr.Textbox(
                        value=get_model_status,
                        every=10,
                        label="Estado de modelos",
                        interactive=False,
                        lines=2,
                        elem_id="status-box",
                    )

                style_in = gr.Textbox(
                    label="Estilo / Género *",
                    placeholder="lofi hip hop, piano, chill, female vocals, 80bpm",
                    info="Describe el género, instrumentos, mood, BPM…",
                )

                with gr.Row():
                    lang_dd  = gr.Dropdown(["es", "en", "zh"], value="es", label="Idioma de la letra")
                    dur_sl   = gr.Slider(15, 240, value=60, step=15, label="Duración en segundos (ACE-Step)", visible=True)
                    seg_sl   = gr.Slider(1, 4,   value=2,  step=1,  label="Segmentos × 30s (YuE)",          visible=False)
                    seed_in  = gr.Number(value=-1, label="Seed (-1 = aleatorio)", precision=0)

                # Asistente de letra
                gr.Markdown("### ✍️ Asistente de letra (Claude)")
                with gr.Row():
                    topic_in = gr.Textbox(label="¿De qué trata la canción?", placeholder="un verano perdido, la libertad, amor…")
                    mood_dd  = gr.Dropdown(
                        ["emotivo y nostálgico", "alegre y festivo", "romántico", "melancólico",
                         "motivador y enérgico", "tranquilo y meditativo", "misterioso"],
                        value="emotivo y nostálgico", label="Mood",
                    )
                with gr.Row():
                    chorus_cb = gr.Checkbox(True,  label="Coro")
                    bridge_cb = gr.Checkbox(False, label="Bridge")
                    gen_lyrics_btn = gr.Button("✨ Generar letra con Claude", variant="secondary")

                lyrics_ta = gr.Textbox(
                    label="Letra (puedes editarla)",
                    lines=10,
                    placeholder="[verse 1]\n...\n\n[chorus]\n...\n\n[verse 2]\n...\n\n[outro]\n...",
                )

                gen_btn = gr.Button("🎵 GENERAR MÚSICA", variant="primary", size="lg")

                with gr.Row():
                    gen_status = gr.Textbox(label="Estado", interactive=False)
                audio_out = gr.Audio(label="Audio generado", type="filepath", interactive=False)

                # Subir a Rayvermusic
                gr.Markdown("### 🚀 Subir a Rayvermusic.com")
                with gr.Row():
                    up_title = gr.Textbox(label="Título del track")
                    up_tags  = gr.Textbox(label="Tags (separados por coma)", placeholder="lofi, piano, chill")
                up_btn    = gr.Button("☁️ Subir a Rayvermusic", variant="primary")
                up_status = gr.Textbox(label="Estado de subida", interactive=False)

            # ── Pestaña Config ────────────────────────────────────────────────
            with gr.TabItem("⚙️ Configuración"):
                gr.Markdown("### Rayvermusic.com")
                cf_url  = gr.Textbox(value=cfg["rayvermusic_url"],      label="URL del sitio")
                cf_pass = gr.Textbox(value=cfg["rayvermusic_password"],  label="Contraseña admin", type="password")

                gr.Markdown("### IA para letras")
                cf_ant  = gr.Textbox(value=cfg["anthropic_api_key"],    label="Anthropic API Key", type="password")

                gr.Markdown("### Modelos")
                cf_ace  = gr.Textbox(value=cfg["ace_checkpoint"],       label="Checkpoint ACE-Step (HF id o ruta local)")
                cf_ydir = gr.Textbox(value=cfg["yue_dir"],              label="Directorio de YuE (donde clonaste el repo)")
                cf_ys1  = gr.Textbox(value=cfg["yue_s1_model"],         label="Modelo YuE Stage 1 (HF id)")
                cf_ys2  = gr.Textbox(value=cfg["yue_s2_model"],         label="Modelo YuE Stage 2 (HF id)")

                gr.Markdown("### Puertos")
                with gr.Row():
                    cf_ap  = gr.Number(value=cfg["ace_port"],  label="Puerto ACE-Step", precision=0)
                    cf_yp  = gr.Number(value=cfg["yue_port"],  label="Puerto YuE",      precision=0)

                save_btn    = gr.Button("💾 Guardar", variant="primary")
                save_status = gr.Textbox(label="", interactive=False)

            # ── Pestaña Ayuda ─────────────────────────────────────────────────
            with gr.TabItem("📖 Instalación"):
                gr.Markdown("""
## Instalación rápida

### 1. Instalar dependencias del studio
```bash
cd local-studio
bash install.sh        # Linux / Mac
install.bat            # Windows
```

### 2. Instalar ACE-Step
```bash
pip install git+https://github.com/ace-step/ACE-Step.git
pip install soundfile
```

### 3. Instalar YuE
```bash
git clone https://github.com/multimodal-art-project/YuE.git ~/YuE
pip install -r ~/YuE/requirements.txt
pip install git+https://github.com/zhenye234/xcodec2.git
```
Actualiza la ruta de YuE en ⚙️ Configuración.

### 4. Arrancar
```bash
python studio.py
```
Abre automáticamente `http://localhost:7870` en el navegador.

---
## Flujo de generación

1. Escribe el **estilo/género** (o deja que Claude escriba la letra)
2. Selecciona **ACE-Step** (rápido) o **YuE** (mayor calidad)
3. Pulsa **GENERAR MÚSICA**
4. Cuando el audio aparezca, pulsa **Subir a Rayvermusic**

Los modelos se cargan **una sola vez** al arrancar y se quedan en memoria
para que las generaciones siguientes sean inmediatas.

---
## Rendimiento esperado (RTX 3090 / 4090)

| Modelo   | Primera carga | Generación |
|----------|--------------|------------|
| ACE-Step | 2-3 min      | ~30s       |
| YuE 60s  | 3-4 min      | ~3-5 min   |
""")

        # ── Handlers ──────────────────────────────────────────────────────────
        def on_model_change(m):
            is_ace = m == "ace-step"
            return gr.update(visible=is_ace), gr.update(visible=not is_ace)

        model_rd.change(on_model_change, model_rd, [dur_sl, seg_sl])

        def on_gen_lyrics(topic, genre_txt, mood, lang, chorus, bridge):
            genre = (genre_txt or "").split(",")[0].strip() or "pop"
            return generate_lyrics(topic, genre, mood, lang, chorus, bridge)

        gen_lyrics_btn.click(
            on_gen_lyrics,
            [topic_in, style_in, mood_dd, lang_dd, chorus_cb, bridge_cb],
            lyrics_ta,
        )

        def on_generate(model, style, lyrics, lang, dur, segs, seed, progress=gr.Progress()):
            if not style.strip():
                yield None, "❌ El campo Estilo/Género es obligatorio"
                return
            if not lyrics.strip():
                yield None, "❌ Escribe la letra (o usa el asistente Claude)"
                return
            progress(0, desc="Iniciando generación…")
            for wav_path, msg in generate_music(model, style, lyrics, lang, dur, segs, seed):
                yield wav_path, msg

        gen_btn.click(
            on_generate,
            [model_rd, style_in, lyrics_ta, lang_dd, dur_sl, seg_sl, seed_in],
            [audio_out, gen_status],
        )

        def on_upload(audio_path, title, tags):
            return upload_to_rayvermusic(audio_path, title, tags)

        up_btn.click(on_upload, [audio_out, up_title, up_tags], up_status)

        def on_save_cfg(url, pwd, ant, ace, ydir, ys1, ys2, ap, yp):
            global cfg, _token
            cfg.update({
                "rayvermusic_url":      url.strip(),
                "rayvermusic_password": pwd,
                "anthropic_api_key":    ant,
                "ace_checkpoint":       ace.strip() or DEFAULT_CFG["ace_checkpoint"],
                "yue_dir":              ydir.strip() or DEFAULT_CFG["yue_dir"],
                "yue_s1_model":         ys1.strip() or DEFAULT_CFG["yue_s1_model"],
                "yue_s2_model":         ys2.strip() or DEFAULT_CFG["yue_s2_model"],
                "ace_port":             int(ap),
                "yue_port":             int(yp),
            })
            _save_cfg(cfg)
            _token = None
            return "✅ Configuración guardada · Reinicia el studio para aplicar cambios de puerto/modelo."

        save_btn.click(
            on_save_cfg,
            [cf_url, cf_pass, cf_ant, cf_ace, cf_ydir, cf_ys1, cf_ys2, cf_ap, cf_yp],
            save_status,
        )

    return demo


# ── Entrypoint ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-servers", action="store_true", help="No arrancar los servidores de modelos")
    parser.add_argument("--port", type=int, default=cfg["studio_port"])
    args = parser.parse_args()

    if not args.no_servers:
        start_servers()
        # Señal de parada limpia
        def _cleanup(sig, frame):
            print("\n[Studio] Deteniendo servidores…")
            stop_servers()
            sys.exit(0)
        signal.signal(signal.SIGINT,  _cleanup)
        signal.signal(signal.SIGTERM, _cleanup)

    demo = build_ui()
    demo.launch(
        server_name="0.0.0.0",
        server_port=args.port,
        share=False,
        inbrowser=True,
        prevent_thread_lock=False,
    )
