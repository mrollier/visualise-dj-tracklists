#!/usr/bin/env python3
"""Offline audio analyser — the producer for the v33 analysis sidecar (v34, WS2).

Reads a Rekordbox collection export, opens each track by its own file path, and
writes an `AnalysisSidecar` JSON that the app imports through its ordinary
Import button. The app fills only the metadata Rekordbox left null and marks
every filled value with a provenance badge; nothing here can overwrite a
Rekordbox value, because the merge happens in a derived layer the raw library
never sees. See docs/designs/design-v34-offline-analyser.md.

Deliberately does NOT emit `energy`. `energyOf` in src/core/analysis.ts prefers
a direct `energy` over deriving one from `arousal`, so writing a number here
would freeze today's uncalibrated curve into a file that costs hours to
regenerate. Raw `arousal`/`valence` go in instead and the app derives — which
is the whole reason the sidecar format has both routes.

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
import multiprocessing as mp
import sys
import tempfile
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


def self_test() -> int:
    """One runnable check: synthesised signals with known answers."""
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
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    missing = [n for n in MODEL_FILES.values() if not (args.models / n).exists()]
    if missing:
        print(f"missing model files in {args.models}: {', '.join(missing)}", file=sys.stderr)
        print("run scripts/fetch-models.sh first", file=sys.stderr)
        return 2
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
    for path in locations:
        if any(token in path for token in excludes):
            skipped["excluded"] += 1
        elif args.only is not None and args.only not in path:
            skipped["filtered"] += 1
        elif path in existing:
            skipped["done"] += 1
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
    if not jobs:
        return 0

    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    results = dict(existing)
    errors: list[str] = []
    done = 0
    t0 = time.time()

    with mp.Pool(args.jobs, initializer=_init_worker, initargs=(str(args.models),)) as pool:
        for path, entry, error in pool.imap_unordered(analyse, jobs, chunksize=1):
            done += 1
            if entry is None:
                errors.append(f"{path}: {error}")
            else:
                results[path] = entry
            if done % args.flush_every == 0 or done == len(jobs):
                write_sidecar(args.out, results, started)
                rate = done / max(time.time() - t0, 1e-6)
                remaining = (len(jobs) - done) / max(rate, 1e-6)
                print(
                    f"  {done}/{len(jobs)}  {rate:.2f}/s  ~{remaining / 60:.0f} min left",
                    flush=True,
                )

    gated_bpm = sum(1 for e in results.values() if e["bpmConf"] < 0.5)
    gated_key = sum(1 for e in results.values() if e["keyConf"] < 0.5)
    print(f"\nwrote {len(results)} entries to {args.out} in {(time.time() - t0) / 60:.1f} min")
    print(f"  {gated_bpm} tempos and {gated_key} keys fall below the app's confidence gate")
    if errors:
        print(f"  {len(errors)} failed:", file=sys.stderr)
        for line in errors[:20]:
            print(f"    {line}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
