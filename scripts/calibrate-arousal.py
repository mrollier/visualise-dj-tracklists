#!/usr/bin/env python3
"""Check an analysis sidecar's arousal against a set of human labels (v34, WS2).

`energyFromArousal` in src/core/analysis.ts maps predicted arousal onto the
app's 1-10 energy scale with two constants. Those constants bracket a measured
range rather than fitting labelled data, because no usable label set existed
when they were chosen. This script is how you replace them when one does.

It answers three questions, and the third is the one that decides whether a
calibration transfers to a library the model was not trained on:

  1. Does predicted arousal rank the way humans do?   (Pearson, Spearman)
  2. What band would the labels imply?                (AROUSAL_MIN, AROUSAL_MAX)
  3. Is the transform stable across groups?           (per-group slopes)

Two label sources, both supported:

  # DEAM (1802 clips, CC BY-NC) — the attempt made in v34, which FAILED.
  # Download DEAM_Annotations.zip and metadata.zip from
  # https://cvml.unige.ch/databases/DEAM/ and unpack them into one directory,
  # analyse the audio with analyse-audio.py --paths-from, then:
  python scripts/calibrate-arousal.py --sidecar deam.analysis.json --deam ./deam

  # Your own tracks — the recommended route, because it is in-distribution.
  # A CSV of path,label[,group] where label is 1-10 energy as YOU hear it.
  # Ten tracks is enough to pin the two constants: five you would call 1-2 and
  # five you would call 9-10.
  python scripts/calibrate-arousal.py --sidecar library.analysis.json \\
      --labels anchors.csv --scale energy

What v34 measured with DEAM, recorded so it is not repeated blindly: held-out
r = +0.525 against r = +0.846 on the block that reproduces MTG's published
0.821 (so that block is their training set, and the published figure is
in-sample); per-genre slopes spanning 0.38 to 0.83; and both fitted bands
compressing the real library back towards a two-value energy field. The
conclusion was to keep the bracketed band. See
docs/designs/design-v34-offline-analyser.md.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import statistics
import sys
from collections import defaultdict
from pathlib import Path


def pearson(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    dx = sum((x - mx) ** 2 for x in xs) ** 0.5
    dy = sum((y - my) ** 2 for y in ys) ** 0.5
    if dx == 0 or dy == 0:
        return float("nan")
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (dx * dy)


def spearman(xs, ys):
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        out = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for k in range(i, j + 1):
                out[order[k]] = (i + j) / 2 + 1
            i = j + 1
        return out

    return pearson(ranks(xs), ranks(ys))


def read_deam(root: Path):
    """(label, group) per song_id from an unpacked DEAM annotation + metadata set."""
    ann = root / "annotations" / "annotations averaged per song" / "song_level"
    labels = {}
    for name in (
        "static_annotations_averaged_songs_1_2000.csv",
        "static_annotations_averaged_songs_2000_2058.csv",
    ):
        with open(ann / name, newline="") as fh:
            for row in csv.DictReader(fh):
                row = {(k or "").strip(): v for k, v in row.items()}
                labels[row["song_id"]] = float(row["arousal_mean"])
    groups = {}
    meta = root / "metadata"
    for year, idcol, gcol in (("2013", "song_id", "Genre"), ("2014", "Id", "Genre"), ("2015", "id", "genre")):
        path = meta / f"metadata_{year}.csv"
        if not path.exists():
            continue
        with open(path, newline="", encoding="utf-8", errors="replace") as fh:
            for row in csv.DictReader(fh):
                row = {(k or "").strip(): v for k, v in row.items()}
                if idcol in row:
                    groups[str(row[idcol]).strip()] = (row.get(gcol) or "?").strip()
    return labels, groups


def read_labels(path: Path):
    """path,label[,group] — label on whatever --scale says."""
    labels, groups = {}, {}
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            row = {(k or "").strip().lower(): v for k, v in row.items()}
            key = (row.get("path") or "").strip()
            if key == "":
                continue
            labels[key] = float(row["label"])
            groups[key] = (row.get("group") or "?").strip()
    return labels, groups


def report(name, rows, scale_lo, scale_hi, minimum=15):
    """rows: [(predicted_arousal, human_label)]"""
    if len(rows) < minimum:
        print(f"{name:<28} n={len(rows):<5} (too few to fit)")
        return
    pred = [r[0] for r in rows]
    hum = [r[1] for r in rows]
    mp, mh = statistics.mean(pred), statistics.mean(hum)
    sp, sh = statistics.pstdev(pred), statistics.pstdev(hum)
    sxx = sum((p - mp) ** 2 for p in pred)
    ols = sum((p - mp) * (h - mh) for p, h in zip(pred, hum)) / sxx if sxx else float("nan")
    # Variance matching, NOT the OLS slope, is the right transform for rescaling
    # a distribution: OLS deliberately shrinks towards the mean because the
    # predictor is noisy, which is a virtue for prediction and a bug here.
    lo = mp + (scale_lo - mh) * sp / sh if sh else float("nan")
    hi = mp + (scale_hi - mh) * sp / sh if sh else float("nan")
    print(
        f"{name:<28} n={len(rows):<5} r={pearson(pred, hum):+.3f} rho={spearman(pred, hum):+.3f} "
        f"ols_slope={ols:5.2f}  band=[{lo:.2f}, {hi:.2f}]  pred sd={sp:.2f} label sd={sh:.2f}"
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sidecar", type=Path, required=True, help="analysis sidecar to check")
    ap.add_argument("--deam", type=Path, default=None, help="unpacked DEAM annotations+metadata directory")
    ap.add_argument("--labels", type=Path, default=None, help="CSV of path,label[,group]")
    ap.add_argument(
        "--scale",
        choices=("arousal", "energy"),
        default="arousal",
        help="arousal = labels on 1-9 (DEAM); energy = labels on 1-10 (yours, or Mixed In Key)",
    )
    args = ap.parse_args()

    if (args.deam is None) == (args.labels is None):
        print("give exactly one of --deam or --labels", file=sys.stderr)
        return 2

    entries = json.loads(args.sidecar.read_text(encoding="utf-8"))["tracks"]
    if args.deam is not None:
        labels, groups = read_deam(args.deam)
        # DEAM audio is named <song_id>.mp3
        keyof = lambda p: os.path.splitext(os.path.basename(p))[0]  # noqa: E731
    else:
        labels, groups = read_labels(args.labels)
        keyof = lambda p: p  # noqa: E731

    lo, hi = (1.0, 9.0) if args.scale == "arousal" else (1.0, 10.0)
    rows = []
    for path, entry in entries.items():
        key = keyof(path)
        if key in labels and isinstance(entry.get("arousal"), (int, float)):
            rows.append((float(entry["arousal"]), labels[key], groups.get(key, "?"), key))
    if not rows:
        print("no sidecar entry matched a label — check the paths or the id scheme", file=sys.stderr)
        return 1
    print(f"matched {len(rows)} of {len(entries)} sidecar entries against {len(labels)} labels\n")

    print("=== overall ===")
    report("all labelled", [(r[0], r[1]) for r in rows], lo, hi)

    if args.deam is not None:
        # v34's finding: reproducing MTG's published figure on exactly one
        # block identifies it as their training data, so report the blocks apart.
        held = [(r[0], r[1]) for r in rows if int(r[3]) <= 1000 or int(r[3]) > 2000]
        train = [(r[0], r[1]) for r in rows if 1000 < int(r[3]) <= 2000]
        print()
        print("=== DEAM blocks (1001-2000 is MTG's training set) ===")
        report("held out", held, lo, hi)
        report("presumed training", train, lo, hi)

    print()
    print("=== per group — an unstable slope means the fit will not transfer ===")
    by = defaultdict(list)
    for pred, hum, group, _ in rows:
        by[group].append((pred, hum))
    for group, group_rows in sorted(by.items(), key=lambda kv: -len(kv[1]))[:15]:
        report(f"  {group}", group_rows, lo, hi)
    return 0


if __name__ == "__main__":
    sys.exit(main())
