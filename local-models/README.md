# Local models (D-044)

ASR and MT for the voice listing pipeline, run on your own machine instead of
a hosted API. This exists mainly for **Kusaal** — it has no Khaya AI code
(`packages/core/src/providers/khaya.ts`'s `LOCALE_TO_KHAYA`) and translates
poorly through a generic LLM. A dedicated fine-tuned model, run locally, is
the real option for it. Twi, Ewe, Dagbani, and Hausa ride along on the same
service.

Models used (all verified against Hugging Face's own API — see the table):

| Task | Locale(s) | Model | License | Gated? |
|---|---|---|---|---|
| ASR | Kusaal | `KhayaAI/w2v-bert-kus` | Apache-2.0 | No |
| ASR | Hausa | `KhayaAI/w2v-bert-hau` | Apache-2.0 | No |
| ASR | Twi, Ewe | `KhayaAI/w2v-bert-ada_ewe_fat_fra_gaa_nzi_twi_en` | Apache-2.0 | No |
| ASR | Dagbani | `KhayaAI/w2v-bert-gjn_maw_gur_dag_dga_kus_lxn_wlx_xon_xsm_en` | Apache-2.0 | No |
| MT | all five | `PrinceAlhassanNasamu/tekyerema-nllb600m-v1` | CC-BY-NC-4.0 | **Yes** — needs `HF_TOKEN` from an account with access |

The MT model's CC-BY-NC-4.0 license means non-commercial use only — fine for
this demo/testing phase, worth revisiting before any paid production use.

Twi/Ewe/Dagbani ASR quality depends on the DONDO multilingual checkpoints'
documented language-prefix trick (see `server.py`'s `ASR_CONFIG`); Hausa uses
a dedicated checkpoint even though its language ID also exists in the shared
prefix table, since the multilingual model was never named as Hausa-trained
— safer to trust the dedicated one.

## One-time setup

```bash
cd local-models
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Needs Python 3.10+ and `ffmpeg` on your PATH (`brew install ffmpeg`) for
anything other than WAV audio — F2M's recordings are typically MP3.

The MT model is gated. If `HF_TOKEN` in the repo-root `.env` belongs to an
account without access, request it at the model page and wait for approval
(or use `PrinceAlhassanNasamu/kusaal-nllb-600M` instead for Kusaal-only MT —
that one's fully public).

## Running it

```bash
npm run local-models        # from the repo root
```

First request for each language downloads that model (a few hundred MB to
~2GB each) and caches it under `~/.cache/huggingface` — expect the first
call per language to be slow, later ones fast. Check `http://localhost:8008/health`
to see what's loaded.

Then in the repo-root `.env`:

```
ASR_PROVIDER=local
MT_PROVIDER=local
```

Restart `npm run dev` and the voice listing pipeline (D-038) — real IVR
calls and the `/phone` simulator alike — routes through these models instead
of mock/Khaya/HF.

## Why a separate process at all

F2M's server is Node/TypeScript; these models only run in Python (PyTorch).
`LocalAsrProvider` / `LocalMtProvider` in `packages/core/src/providers/{asr,mt}/index.ts`
call this service over plain HTTP — the same shape as the Khaya and HF
providers already do, just pointed at `localhost:8008` instead of a third
party's server.
