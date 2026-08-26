"""
The local model service (D-044) — ASR and MT for F2M's voice listing pipeline
run in-process, on open-weight models, instead of a hosted API. It exists for
one language above all: Kusaal has no Khaya code (see packages/core/src/
providers/khaya.ts's LOCALE_TO_KHAYA) and translates poorly through a generic
LLM. A dedicated fine-tuned model is the only real option for it.

This is a second, separate process from the Node server — Node can't run
PyTorch in-process, so packages/core/src/providers/{asr,mt}/index.ts's
LocalAsrProvider / LocalMtProvider talk to this over plain HTTP, the exact
same shape as the Khaya and HF providers, just pointed at localhost instead
of a third party. Nothing here is F2M-specific business logic — it is purely
"receive audio or text, run the model, return the result."

Models load lazily (first request pays the load cost) and stay cached for
the life of the process; there is no LRU eviction, which is fine for a demo
box running two or three of these at once.
"""

import io
import os
import subprocess
from pathlib import Path
from typing import Optional

import torch
import torchaudio
from dotenv import load_dotenv
from fastapi import FastAPI, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from transformers import AutoModelForCTC, AutoModelForSeq2SeqLM, AutoProcessor, AutoTokenizer

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")
HF_TOKEN = os.environ.get("HF_TOKEN")

app = FastAPI(title="F2M local models", docs_url="/docs")

# ── ASR: one entry per F2M locale (packages/core/src/providers/khaya.ts's
#    locale codes). Kusaal and Hausa get their own dedicated checkpoint —
#    higher confidence than a shared multilingual model that was never named
#    for that language. Twi/Ewe/Dagbani ride the two DONDO multilingual
#    models, steered by the language-prefix trick their model card documents.
#    lang_id is None for a monolingual checkpoint (no prefix needed). ──
ASR_CONFIG: dict[str, dict] = {
    "kus": {"model": "KhayaAI/w2v-bert-kus", "lang_id": None},
    "ha": {"model": "KhayaAI/w2v-bert-hau", "lang_id": None},
    "tw": {"model": "KhayaAI/w2v-bert-ada_ewe_fat_fra_gaa_nzi_twi_en", "lang_id": 2},  # "Asante Twi"
    "ee": {"model": "KhayaAI/w2v-bert-ada_ewe_fat_fra_gaa_nzi_twi_en", "lang_id": 5},  # "Ewe"
    "dag": {"model": "KhayaAI/w2v-bert-gjn_maw_gur_dag_dga_kus_lxn_wlx_xon_xsm_en", "lang_id": 3},  # "Dagbani"
}

# ── MT: one model, all five locales — Tékyerémá Pa (gated; the token above
#    must belong to an account with access, which the model's own owner has
#    by construction). NLLB-style codes, per the model card. ──
MT_MODEL_ID = "PrinceAlhassanNasamu/tekyerema-nllb600m-v1"
MT_LANGS: dict[str, str] = {
    "en": "eng_Latn",
    "tw": "twi_Latn",
    "ee": "ewe_Latn",
    "ha": "hau_Latn",
    "dag": "dag_Latn",
    "kus": "kus_Latn",
}

_asr_cache: dict[str, tuple] = {}  # model_id -> (processor, model)
_mt_cache: Optional[tuple] = None  # (tokenizer, model)


def _load_asr(model_id: str):
    if model_id not in _asr_cache:
        processor = AutoProcessor.from_pretrained(model_id, token=HF_TOKEN)
        model = AutoModelForCTC.from_pretrained(model_id, token=HF_TOKEN).eval()
        _asr_cache[model_id] = (processor, model)
    return _asr_cache[model_id]


def _load_mt():
    global _mt_cache
    if _mt_cache is None:
        if not HF_TOKEN:
            raise HTTPException(500, "HF_TOKEN is not set — the MT model is gated")
        tokenizer = AutoTokenizer.from_pretrained(MT_MODEL_ID, token=HF_TOKEN)
        model = AutoModelForSeq2SeqLM.from_pretrained(MT_MODEL_ID, token=HF_TOKEN).eval()
        _mt_cache = (tokenizer, model)
    return _mt_cache


def _add_language_prefix(features: torch.Tensor, lang_id: int) -> torch.Tensor:
    """Steers the DONDO multilingual checkpoints — see the model card."""
    _, dim = features.shape
    lang_vec = torch.zeros(dim)
    lang_vec[lang_id % dim] = 1.0
    return torch.cat([lang_vec.unsqueeze(0), features], dim=0)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "asr_loaded": list(_asr_cache.keys()),
        "mt_loaded": _mt_cache is not None,
        "hf_token_configured": bool(HF_TOKEN),
    }


class MtRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    text: str
    from_: str = Field(alias="from")  # "from" is a Python keyword, so the field is from_ with an alias
    to: str


@app.post("/mt")
def mt(body: MtRequest):
    source = body.from_
    if source not in MT_LANGS:
        raise HTTPException(400, f"No MT language code for locale '{source}'")
    if body.to not in MT_LANGS:
        raise HTTPException(400, f"No MT language code for locale '{body.to}'")
    if source == body.to:
        return {"text": body.text}

    tokenizer, model = _load_mt()
    tokenizer.src_lang = MT_LANGS[source]
    tgt_id = tokenizer.convert_tokens_to_ids(MT_LANGS[body.to])
    inputs = tokenizer(body.text, return_tensors="pt", truncation=True, max_length=256)
    with torch.no_grad():
        # repetition_penalty + no_repeat_ngram_size: without them, generation
        # toward some target languages degenerates into one token repeated
        # until max_new_tokens (observed on en->kus specifically — kus->en
        # was fine without this). Standard fix for beam search stuck in a loop.
        out = model.generate(
            **inputs,
            forced_bos_token_id=tgt_id,
            num_beams=4,
            max_new_tokens=200,
            repetition_penalty=1.3,
            no_repeat_ngram_size=3,
        )
    text = tokenizer.decode(out[0], skip_special_tokens=True)
    return {"text": text}


def _decode_to_wav(raw: bytes) -> bytes:
    """The browser handset simulator records with MediaRecorder, which on
    every current browser means WebM/Opus — a container soundfile (torchaudio's
    only backend here, see requirements.txt) cannot open. ffmpeg is the
    universal front door: whatever codec comes in, this always hands
    torchaudio a plain 16kHz mono WAV it's guaranteed to read."""
    try:
        proc = subprocess.run(
            ["ffmpeg", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1"],
            input=raw,
            capture_output=True,
            timeout=30,
            check=True,
        )
    except FileNotFoundError as exc:
        raise HTTPException(500, "ffmpeg is not installed — required to decode recorded audio") from exc
    except subprocess.CalledProcessError as exc:
        raise HTTPException(400, f"Could not decode the recording: {exc.stderr.decode(errors='replace')[-500:]}") from exc
    return proc.stdout


@app.post("/asr")
async def asr(audio: UploadFile, locale: str = Form(...)):
    if locale not in ASR_CONFIG:
        raise HTTPException(400, f"No ASR model for locale '{locale}'")
    cfg = ASR_CONFIG[locale]
    processor, model = _load_asr(cfg["model"])

    raw = await audio.read()
    wav = _decode_to_wav(raw)
    speech, sr = torchaudio.load(io.BytesIO(wav))
    if speech.shape[0] > 1:
        speech = speech.mean(dim=0, keepdim=True)  # stereo -> mono
    if sr != 16000:
        speech = torchaudio.functional.resample(speech, sr, 16000)

    inputs = processor(speech.squeeze().numpy(), sampling_rate=16000, return_tensors="pt")
    # w2v-bert's processor emits log-mel input_features (a SeamlessM4T-style
    # front end), not classic Wav2Vec2's raw input_values — kept as a fallback
    # in case a future locale's checkpoint uses the older extractor.
    uses_features = hasattr(inputs, "input_features")
    features = (inputs.input_features if uses_features else inputs.input_values)[0]
    if cfg["lang_id"] is not None:
        features = _add_language_prefix(features, cfg["lang_id"])

    with torch.no_grad():
        kwargs = {"input_features": features.unsqueeze(0)} if uses_features else {"input_values": features.unsqueeze(0)}
        logits = model(**kwargs).logits
    text = processor.batch_decode(torch.argmax(logits, dim=-1))[0]
    return {"text": text}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("LOCAL_MODELS_PORT", 8008)))
