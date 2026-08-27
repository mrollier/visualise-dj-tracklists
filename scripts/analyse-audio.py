#!/usr/bin/env python3
"""Offline audio analyser — the producer for the v33 analysis sidecar (v34, WS2).

Reads a Rekordbox collection export, opens each track by its own file path, and
writes an `AnalysisSidecar` JSON that the app imports through its ordinary
Import button. The app fills only the metadata Rekordbox left null and marks
every filled value with a provenance badge; nothing here can overwrite a
Rekordbox value, because the merge happens in a derived layer the raw library
never sees. See docs/designs/design-v34-offline-analyser.md.

Deliberately does NOT emit `energy`, and since v36 the app would ignore one
anyway: energy's only source is the "Energy N" comment token (Mixed In Key),
never analysis. Raw `arousal`/`valence` go in as descriptors, display-only.

Usage:
    scripts/.venv/bin/python scripts/analyse-audio.py \\
        --collection docs/rekordbox/collection.xml --out scripts/out/library.analysis.json

    caffeinate -i scripts/.venv/bin/python scripts/analyse-audio.py ...   # full run

Setup:
    /opt/homebrew/bin/python3 -m venv scripts/.venv       # 3.14: the only wheel
    scripts/.venv/bin/pip install -r scripts/requirements.txt
    scripts/fetch-models.sh
"""

from __future__ import annotations

# Must precede the essentia import: essentia's TensorflowPredict reads these
# when it builds its session. One thread per process, N processes — with
# per-process TF threading the workers fight each other for the same cores.
import os

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("TF_NUM_INTRAOP_THREADS", "1")
os.environ.setdefault("TF_NUM_INTEROP_THREADS", "1")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import argparse
import json
import math
import multiprocessing as mp
import re
import sys
import tempfile
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 44100
MODEL_SAMPLE_RATE = 16000

# Rekordbox's own sampler content: one-shots, FX stabs and breaks kits. They
# have no key and no tempo by nature, and the app does NOT confidence-gate
# energy — so without this default NOISE.wav acquires an arousal-derived
# energy and joins the combo graph. Verified: NOISE.wav scores BPM confidence
# 0.00 and key strength 0.25, but arousal 5.37 and danceability 0.898.
DEFAULT_EXCLUDES = ("/Sampler/",)

# RhythmExtractor2013's confidence is on a 0-5.32 scale, not 0-1. Essentia's
# own bands: below 1.5 low, 1.5-3.5 moderate, above 3.5 high. Dividing by 3.0
# puts "moderate" exactly at the app's MIN_CONFIDENCE of 0.5, so a low-
# confidence tempo is refused rather than guessed.
BPM_CONFIDENCE_SCALE = 3.0

MODEL_FILES = {
    "embeddings": "msd-musicnn-1.pb",
    "emomusic": "emomusic-msd-musicnn-2.pb",
    "danceability": "danceability-msd-musicnn-1.pb",
    "happy": "mood_happy-msd-musicnn-1.pb",
}


@dataclass(frozen=True)
class Job:
    path: str


# One set of loaded graphs per worker process, built on first use. Loading the
# MusiCNN graph costs ~0.4 s; doing it per track would dominate the run.
_models: dict | None = None
_models_dir: str = ""


def _load_models() -> dict:
    global _models
    if _models is None:
        import essentia.standard as es

        base = Path(_models_dir)
        _models = {
            "es": es,
            "embeddings": es.TensorflowPredictMusiCNN(
                graphFilename=str(base / MODEL_FILES["embeddings"]),
                output="model/dense/BiasAdd",
            ),
            # classes are ["valence", "arousal"] — arousal is index 1, despite
            # the model being named arousal_valence. Straight from the model's
            # own JSON metadata, not from the prose.
            "emomusic": es.TensorflowPredict2D(
                graphFilename=str(base / MODEL_FILES["emomusic"]), output="model/Identity"
            ),
            # both heads: classes[0] is the positive class ("danceable", "happy")
            "danceability": es.TensorflowPredict2D(
                graphFilename=str(base / MODEL_FILES["danceability"]), output="model/Softmax"
            ),
            "happy": es.TensorflowPredict2D(
                graphFilename=str(base / MODEL_FILES["happy"]), output="model/Softmax"
            ),
        }
    return _models


def _init_worker(models_dir: str) -> None:
    global _models_dir
    _models_dir = models_dir


def analyse(path: str) -> tuple[str, dict | None, str | None]:
    """Analyse one file. Returns (path, entry, error) — never raises."""
    import numpy as np

    try:
        m = _load_models()
        es = m["es"]
        audio = es.MonoLoader(filename=path, sampleRate=SAMPLE_RATE)()
        if len(audio) < SAMPLE_RATE:
            return path, None, "shorter than one second"

        bpm, _, bpm_conf, _, _ = es.RhythmExtractor2013(method="multifeature")(audio)
        key, scale, strength = es.KeyExtractor(profileType="edma")(audio)

        # One load, resampled in memory. The files live on an external drive,
        # so a second MonoLoader would double the run's I/O for nothing.
        audio16 = es.Resample(
            inputSampleRate=SAMPLE_RATE, outputSampleRate=MODEL_SAMPLE_RATE
        )(audio)
        embeddings = m["embeddings"](audio16)

        valence, arousal = np.mean(m["emomusic"](embeddings), axis=0)[:2]
        danceability = float(np.mean(m["danceability"](embeddings), axis=0)[0])
        happiness = float(np.mean(m["happy"](embeddings), axis=0)[0])

        entry = {
            "bpm": round(float(bpm), 2),
            "bpmConf": round(min(1.0, float(bpm_conf) / BPM_CONFIDENCE_SCALE), 2),
            # The classical string, not Camelot: normalizeKey (src/core/keys.ts)
            # already converts it, and a second mapping in Python would be a
            # second thing to keep in sync.
            "key": f"{key} {scale}",
            "keyConf": round(float(strength), 2),
            # The emoMusic head is a linear regressor trained on unnormalised
            # [1, 9] targets, so it predicts outside that range. Clamp.
            "arousal": round(min(9.0, max(1.0, float(arousal))), 2),
            "valence": round(min(9.0, max(1.0, float(valence))), 2),
            "happiness": round(happiness, 3),
            "danceability": round(danceability, 3),
        }
        return path, entry, None
    except Exception as e:  # noqa: BLE001 — one bad file must not end the batch
        return path, None, f"{type(e).__name__}: {e}"


def decode_location(location: str) -> str:
    """Rekordbox writes a percent-encoded file://localhost/… URL."""
    path = urllib.parse.unquote(location)
    for prefix in ("file://localhost", "file://"):
        if path.startswith(prefix):
            return path[len(prefix) :]
    return path


def read_collection(xml_path: Path) -> list[str]:
    """Every track location in the collection, decoded, in document order."""
    root = ET.parse(xml_path).getroot()
    seen: dict[str, None] = {}
    for track in root.iterfind("./COLLECTION/TRACK"):
        location = track.get("Location")
        if location:
            seen.setdefault(decode_location(location), None)
    return list(seen)


def load_existing(out_path: Path) -> dict:
    if not out_path.exists():
        return {}
    try:
        data = json.loads(out_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    tracks = data.get("tracks")
    return tracks if isinstance(tracks, dict) else {}


def write_sidecar(out_path: Path, tracks: dict, started: str) -> None:
    """Atomic, compact. Compact because the app's autosave copy is compact too
    and the project sits at ~3.9 MB against a 5 MB localStorage cap."""
    sidecar = {
        "zodiacAnalysis": 1,
        "run": {
            "analysedAt": started,
            "tool": "essentia-tensorflow 2.1b6.dev1438",
            "models": sorted(MODEL_FILES.values()),
        },
        "tracks": tracks,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=out_path.parent, delete=False
    ) as tmp:
        json.dump(sidecar, tmp, separators=(",", ":"), ensure_ascii=False)
        temp_name = tmp.name
    os.replace(temp_name, out_path)


# ---------------------------------------------------------------------------
# Descriptor comment token (v38): `[A55V35D90H55]` — arousal, valence,
# danceability, happiness as 0-100 whole percents, on the app's own Track
# scales. The app parses it back on XML import (parseDescriptorToken,
# src/core/model.ts), so descriptors survive with the files themselves.
# The percent formulas MUST stay identical to percentFromAffect /
# percentFromUnit (src/core/analysis.ts) — pinned by self_test() here and
# tests/analysis-contract.test.ts there against one shared vector.

TOKEN_RE = re.compile(r"\s*(?:-\s*)?\[A\d{1,3}V\d{1,3}D\d{1,3}H\d{1,3}\]")


def _pct(value: float) -> int:
    """JS Math.round semantics — floor(x + 0.5), NOT Python's banker's round."""
    return min(100, max(0, math.floor(value + 0.5)))


def descriptor_token(entry: dict) -> str | None:
    """The token for one sidecar entry, or None when any descriptor is absent."""
    values = {}
    for field in ("arousal", "valence", "danceability", "happiness"):
        v = entry.get(field)
        if not isinstance(v, (int, float)):
            return None
        values[field] = v
    a = _pct((values["arousal"] - 1) / 8 * 100)
    v = _pct((values["valence"] - 1) / 8 * 100)
    d = _pct(values["danceability"] * 100)
    h = _pct(values["happiness"] * 100)
    return f"[A{a}V{v}D{d}H{h}]"


def splice_token(comment: str, token: str) -> str:
    """Replace our own token in a comment, else append it as its own ` - `
    segment — MIK's delimiter, so the app's segment split stays intact.
    Everything else in the comment (MIK's key/tempo/energy tokens, prose)
    is preserved verbatim. Idempotent by strip-then-append."""
    base = TOKEN_RE.sub("", comment or "").strip()
    return f"{base} - {token}" if base else token


def mutagen_available() -> bool:
    try:
        import mutagen  # noqa: F401

        return True
    except ImportError:
        return False


def write_token(path: str, entry: dict) -> str | None:
    """Write the descriptor token into the file's comment tag, preserving the
    rest of the comment. Returns an error string, or None on success."""
    token = descriptor_token(entry)
    if token is None:
        return "entry has no complete descriptor set"
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext in (".mp3", ".aiff", ".aif", ".wav"):
            # All three carry ID3; MIK writes the COMM frame with an empty
            # description, so that is the frame read and replaced.
            from mutagen.id3 import COMM

            if ext == ".mp3":
                from mutagen.mp3 import MP3 as Container
            elif ext == ".wav":
                from mutagen.wave import WAVE as Container
            else:
                from mutagen.aiff import AIFF as Container
            audio = Container(path)
            if audio.tags is None:
                audio.add_tags()
            comms = [f for f in audio.tags.getall("COMM") if f.desc == ""]
            old = str(comms[0].text[0]) if comms and comms[0].text else ""
            lang = comms[0].lang if comms else "eng"
            audio.tags.setall(
                "COMM", [COMM(encoding=3, lang=lang, desc="", text=[splice_token(old, token)])]
            )
            audio.save()
        elif ext == ".flac":
            from mutagen.flac import FLAC

            audio = FLAC(path)
            old = audio["comment"][0] if audio.get("comment") else ""
            audio["comment"] = [splice_token(old, token)]
            audio.save()
        elif ext in (".m4a", ".mp4"):
            from mutagen.mp4 import MP4

            audio = MP4(path)
            old = audio.get("\xa9cmt", [""])[0]
            audio["\xa9cmt"] = [splice_token(old, token)]
            audio.save()
        else:
            return f"unsupported format {ext or '(none)'}"
    except Exception as e:  # noqa: BLE001 — one bad file must not end the batch
        return f"{type(e).__name__}: {e}"
    return None


def self_test() -> int:
    """One runnable check: synthesised signals with known answers."""
    # The descriptor-token contract (v38). The SAME vector is pinned from the
    # TS side in tests/analysis-contract.test.ts — change one, change both.
    contract = {"arousal": 5.37, "valence": 3.8, "danceability": 0.898, "happiness": 0.55}
    token = descriptor_token(contract)
    print(f"descriptor token: {token} (expect [A55V35D90H55])")
    if token != "[A55V35D90H55]":
        print("FAIL: token does not match the pinned cross-language vector", file=sys.stderr)
        return 1
    if descriptor_token({"arousal": 5.37}) is not None:
        print("FAIL: a partial entry must produce no token", file=sys.stderr)
        return 1

    spliced = splice_token("8A - Energy 7", token)
    respliced = splice_token(spliced, "[A1V2D3H4]")
    if spliced != f"8A - Energy 7 - {token}" or respliced != "8A - Energy 7 - [A1V2D3H4]":
        print(f"FAIL: splice_token: '{spliced}' → '{respliced}'", file=sys.stderr)
        return 1
    if splice_token("", token) != token or splice_token(token, token) != token:
        print("FAIL: splice_token on empty/token-only comments", file=sys.stderr)
        return 1
    print(f"splice: '8A - Energy 7' → '{respliced}' — MIK segments preserved, replace idempotent")

    if mutagen_available():
        import wave as wave_mod

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            wav_path = tmp.name
        try:
            with wave_mod.open(wav_path, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(SAMPLE_RATE)
                w.writeframes(b"\x00\x00" * SAMPLE_RATE)
            error = write_token(wav_path, contract)
            if error is not None:
                print(f"FAIL: write_token on a fresh WAV: {error}", file=sys.stderr)
                return 1
            error = write_token(wav_path, contract)  # idempotent second write
            if error is not None:
                print(f"FAIL: write_token rewrite: {error}", file=sys.stderr)
                return 1
            from mutagen.wave import WAVE

            comment = str(WAVE(wav_path).tags.getall("COMM")[0].text[0])
            print(f"WAV round-trip: comment '{comment}'")
            if comment != token:
                print(f"FAIL: expected '{token}' in the WAV comment", file=sys.stderr)
                return 1
        finally:
            os.unlink(wav_path)
    else:
        print("mutagen not installed — skipping the tag round-trip check")

    import numpy as np
    import essentia.standard as es

    sr = SAMPLE_RATE
    # A 120 BPM click train: one 2 ms burst every half second for 20 s.
    audio = np.zeros(sr * 20, dtype=np.float32)
    for beat in range(40):
        start = int(beat * sr * 0.5)
        audio[start : start + int(sr * 0.002)] = 1.0
    bpm, _, conf, _, _ = es.RhythmExtractor2013(method="multifeature")(audio)
    print(f"click train: BPM {bpm:.2f} (expect 120), confidence {conf:.2f}")
    if abs(bpm - 120.0) > 1.0:
        print("FAIL: tempo detection is off by more than 1 BPM", file=sys.stderr)
        return 1

    # An A-minor triad held for 10 s: A3, C4, E4.
    t = np.arange(sr * 10, dtype=np.float32) / sr
    triad = sum(np.sin(2 * np.pi * f * t) for f in (220.0, 261.63, 329.63)) / 3
    key, scale, strength = es.KeyExtractor(profileType="edma")(triad.astype(np.float32))
    print(f"A-minor triad: key '{key} {scale}', strength {strength:.2f}")
    if key != "A" or scale != "minor":
        print(f"FAIL: expected A minor, got {key} {scale}", file=sys.stderr)
        return 1

    print("self-test OK")
    return 0


def run_batch(
    paths: list[str],
    *,
    out: Path,
    models_dir: Path,
    jobs: int,
    force: bool = False,
    flush_every: int = 25,
    write_tags: bool = False,
    progress=None,
) -> dict:
    """Analyse `paths` into the sidecar at `out` — the one pool loop both the
    CLI and the serve mode run. Resumable: a path already in the out-file is
    skipped (though still tagged, when write_tags — "analyse first, tag later"
    costs only the tag). `progress(done, total, rate, eta_sec)` fires on every
    flush."""
    existing = {} if force else load_existing(out)
    errors: list[str] = []
    skipped_done: list[str] = []
    absent = 0
    todo: list[str] = []
    for path in paths:
        if path in existing:
            skipped_done.append(path)
        elif not os.path.exists(path):
            absent += 1
        else:
            todo.append(path)

    if write_tags:
        for path in skipped_done:
            error = write_token(path, existing[path])
            if error is not None:
                errors.append(f"{path}: {error}")

    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    results = dict(existing)
    done = 0
    t0 = time.time()
    if todo:
        with mp.Pool(jobs, initializer=_init_worker, initargs=(str(models_dir),)) as pool:
            for path, entry, error in pool.imap_unordered(analyse, todo, chunksize=1):
                done += 1
                if entry is None:
                    errors.append(f"{path}: {error}")
                else:
                    results[path] = entry
                    if write_tags:
                        tag_error = write_token(path, entry)
                        if tag_error is not None:
                            errors.append(f"{path}: {tag_error}")
                if done % flush_every == 0 or done == len(todo):
                    write_sidecar(out, results, started)
                    rate = done / max(time.time() - t0, 1e-6)
                    eta = (len(todo) - done) / max(rate, 1e-6)
                    if progress is not None:
                        progress(done, len(todo), rate, eta)
    return {
        "done": done,
        "total": len(todo),
        "errors": errors,
        "skippedDone": len(skipped_done),
        "absent": absent,
        "results": results,
    }


def serve(args) -> int:
    """The localhost helper (v38): the app POSTs a playlist's paths, polls the
    progress, and fetches the finished sidecar — the CLI workflow without the
    terminal. 127.0.0.1 only; browser requests additionally need a localhost
    Origin, so a random website the user has open cannot start a run (or,
    with writeTags, rewrite their files).

    ponytail: one job at a time behind one lock; queueing when someone needs it.
    """
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    origin_re = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d{1,5})?$")
    lock = threading.Lock()
    state: dict = {"job": None}

    def run_job(paths: list[str], write_tags: bool, force: bool) -> None:
        job = state["job"]

        def progress(done: int, total: int, rate: float, eta_sec: float) -> None:
            with lock:
                job.update(done=done, total=total, rate=round(rate, 2), etaSec=round(eta_sec))

        try:
            batch = run_batch(
                paths,
                out=args.out,
                models_dir=args.models,
                jobs=args.jobs,
                force=force,
                flush_every=args.flush_every,
                write_tags=write_tags,
                progress=progress,
            )
            with lock:
                job.update(state="done", done=batch["done"], errors=len(batch["errors"]), etaSec=0)
            print(f"job done: {batch['done']}/{batch['total']} analysed, {len(batch['errors'])} errors")
            for line in batch["errors"][:20]:
                print(f"  {line}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001 — the job dies, the server survives
            with lock:
                job.update(state="failed", error=f"{type(e).__name__}: {e}")
            print(f"job failed: {e}", file=sys.stderr)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_: object) -> None:
            pass  # 2 s status polls would drown the terminal

        def _origin(self) -> tuple[bool, str | None]:
            """(allowed, echo). No Origin header (curl) is allowed, no echo."""
            origin = self.headers.get("Origin")
            if origin is None:
                return True, None
            return origin_re.match(origin) is not None, origin

        def _json(self, status: int, origin: str | None, payload: dict) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            if origin is not None:
                self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:  # noqa: N802 — http.server's spelling
            allowed, origin = self._origin()
            if not allowed:
                self._json(403, None, {"error": "origin not allowed"})
                return
            self.send_response(204)
            if origin is not None:
                self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "content-type")
            # Chrome's Private Network Access preflight for https → localhost.
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            allowed, origin = self._origin()
            if not allowed:
                self._json(403, None, {"error": "origin not allowed"})
                return
            if self.path == "/status":
                with lock:
                    job = dict(state["job"]) if state["job"] is not None else None
                self._json(200, origin, {"helper": 1, "job": job})
            elif self.path == "/result":
                try:
                    body = args.out.read_bytes()
                except OSError:
                    self._json(404, origin, {"error": "no sidecar yet"})
                    return
                self.send_response(200)
                if origin is not None:
                    self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self._json(404, origin, {"error": "unknown path"})

        def do_POST(self) -> None:  # noqa: N802
            allowed, origin = self._origin()
            if not allowed:
                self._json(403, None, {"error": "origin not allowed"})
                return
            if self.path != "/analyse":
                self._json(404, origin, {"error": "unknown path"})
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 10_000_000:
                self._json(400, origin, {"error": "bad request body"})
                return
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._json(400, origin, {"error": "bad JSON"})
                return
            paths = payload.get("paths") if isinstance(payload, dict) else None
            if (
                not isinstance(paths, list)
                or len(paths) == 0
                or not all(isinstance(p, str) and p != "" for p in paths)
            ):
                self._json(400, origin, {"error": "paths must be a non-empty list of strings"})
                return
            write_tags = payload.get("writeTags") is True
            force = payload.get("force") is True
            if write_tags and not mutagen_available():
                self._json(
                    400,
                    origin,
                    {"error": "mutagen missing — pip install -r scripts/requirements.txt"},
                )
                return
            with lock:
                job = state["job"]
                if job is not None and job["state"] == "running":
                    self._json(409, origin, {"error": "a job is already running"})
                    return
                existing = {} if force else load_existing(args.out)
                skipped_done = sum(1 for p in paths if p in existing)
                absent = sum(1 for p in paths if p not in existing and not os.path.exists(p))
                accepted = len(paths) - skipped_done - absent
                state["job"] = {
                    "state": "running",
                    "done": 0,
                    "total": accepted,
                    "rate": 0.0,
                    "etaSec": None,
                    "errors": 0,
                    "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
            threading.Thread(target=run_job, args=(paths, write_tags, force), daemon=True).start()
            print(f"job accepted: {accepted} to analyse, {skipped_done} already done, {absent} absent")
            self._json(202, origin, {"accepted": accepted, "skippedDone": skipped_done, "absent": absent})

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"analysis helper listening on http://127.0.0.1:{args.port} — Ctrl-C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--collection", type=Path, default=Path("docs/rekordbox/collection.xml"))
    parser.add_argument(
        "--paths-from",
        type=Path,
        default=None,
        help="analyse a newline-separated list of audio paths instead of a collection "
        "(used to run the same pipeline over a labelled corpus for calibration)",
    )
    parser.add_argument("--out", type=Path, default=Path("scripts/out/library.analysis.json"))
    parser.add_argument("--models", type=Path, default=Path("scripts/models"))
    parser.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    parser.add_argument(
        "--exclude",
        action="append",
        default=None,
        help=f"substring to skip; repeatable. Default: {' '.join(DEFAULT_EXCLUDES)}",
    )
    parser.add_argument("--only", default=None, help="substring a path must contain")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--force", action="store_true", help="re-analyse paths already present")
    parser.add_argument("--flush-every", type=int, default=25)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument(
        "--serve",
        action="store_true",
        help="run as the app's localhost helper instead of a one-shot batch",
    )
    parser.add_argument("--port", type=int, default=8765, help="helper port (default 8765)")
    parser.add_argument(
        "--write-tags",
        action="store_true",
        help="write the [AxxVxxDxxHxx] descriptor token into each analysed "
        "file's comment tag (requires mutagen; MODIFIES audio files)",
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    missing = [n for n in MODEL_FILES.values() if not (args.models / n).exists()]
    if missing:
        print(f"missing model files in {args.models}: {', '.join(missing)}", file=sys.stderr)
        print("run scripts/fetch-models.sh first", file=sys.stderr)
        return 2
    if args.write_tags and not mutagen_available():
        print("mutagen missing — pip install -r scripts/requirements.txt", file=sys.stderr)
        return 2
    if args.serve:
        return serve(args)
    if args.paths_from is not None and not args.paths_from.exists():
        print(f"no path list at {args.paths_from}", file=sys.stderr)
        return 2
    if args.paths_from is None and not args.collection.exists():
        print(f"no collection at {args.collection}", file=sys.stderr)
        return 2

    # A path list is already an explicit choice of files, so the sampler
    # exclude — which exists to keep Rekordbox's own one-shots out of a
    # library run — would only surprise.
    excludes = (
        ()
        if args.paths_from is not None and args.exclude is None
        else DEFAULT_EXCLUDES
        if args.exclude is None
        else tuple(args.exclude)
    )
    locations = (
        [
            line.strip()
            for line in args.paths_from.read_text(encoding="utf-8").splitlines()
            if line.strip() != ""
        ]
        if args.paths_from is not None
        else read_collection(args.collection)
    )
    existing = {} if args.force else load_existing(args.out)

    skipped = {"excluded": 0, "filtered": 0, "done": 0, "absent": 0}
    jobs: list[str] = []
    done_paths: list[str] = []
    for path in locations:
        if any(token in path for token in excludes):
            skipped["excluded"] += 1
        elif args.only is not None and args.only not in path:
            skipped["filtered"] += 1
        elif path in existing:
            skipped["done"] += 1
            done_paths.append(path)
        elif not os.path.exists(path):
            skipped["absent"] += 1
        else:
            jobs.append(path)
    if args.limit is not None:
        jobs = jobs[: args.limit]

    print(
        f"{len(locations)} in collection · {len(jobs)} to analyse · "
        f"skipped {skipped['excluded']} excluded, {skipped['filtered']} filtered, "
        f"{skipped['done']} already done, {skipped['absent']} not on disk"
    )
    if not jobs and not (args.write_tags and done_paths):
        return 0

    t0 = time.time()

    def progress(done: int, total: int, rate: float, eta_sec: float) -> None:
        print(f"  {done}/{total}  {rate:.2f}/s  ~{eta_sec / 60:.0f} min left", flush=True)

    # main() already filtered done/absent for its summary line; run_batch's own
    # pass over them is a no-op re-check, not a second analysis. Already-done
    # paths ride along only for --write-tags, so "analyse first, tag later"
    # works without --force.
    batch = run_batch(
        jobs + (done_paths if args.write_tags else []),
        out=args.out,
        models_dir=args.models,
        jobs=args.jobs,
        force=args.force,
        flush_every=args.flush_every,
        write_tags=args.write_tags,
        progress=progress,
    )
    results = batch["results"]

    gated_bpm = sum(1 for e in results.values() if e["bpmConf"] < 0.5)
    gated_key = sum(1 for e in results.values() if e["keyConf"] < 0.5)
    print(f"\nwrote {len(results)} entries to {args.out} in {(time.time() - t0) / 60:.1f} min")
    print(f"  {gated_bpm} tempos and {gated_key} keys fall below the app's confidence gate")
    if batch["errors"]:
        print(f"  {len(batch['errors'])} failed:", file=sys.stderr)
        for line in batch["errors"][:20]:
            print(f"    {line}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
