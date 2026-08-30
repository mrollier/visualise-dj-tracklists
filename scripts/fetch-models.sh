#!/bin/sh
# Fetch the MTG Essentia model weights the offline analyser needs (v34, WS2).
#
# These are CC BY-NC-SA 4.0. They are gitignored and never enter the app
# bundle — the analyser is a separate program that hands the app a JSON file,
# which is what keeps the app's own licensing free of them. Non-commercial use
# only; see legal/README.md.
set -eu

DIR="${1:-scripts/models}"
mkdir -p "$DIR"

BASE="https://essentia.upf.edu/models"
fetch() {
	name=$(basename "$1")
	if [ -f "$DIR/$name" ]; then
		echo "  have $name"
	else
		echo "  fetching $name"
		curl -sSL --fail -o "$DIR/$name" "$1"
	fi
}

# The shared embedding model: one MusiCNN pass feeds every head below.
fetch "$BASE/feature-extractors/musicnn/msd-musicnn-1.pb"
# arousal/valence — the route to energy. Output classes are (valence, arousal).
fetch "$BASE/classification-heads/emomusic/emomusic-msd-musicnn-2.pb"
fetch "$BASE/classification-heads/danceability/danceability-msd-musicnn-1.pb"
fetch "$BASE/classification-heads/mood_happy/mood_happy-msd-musicnn-1.pb"

# v39 genre: the Discogs-EffNet embedder and the 400-style head. Different
# embedding family from the MusiCNN block above — the genre pass is its own
# run, and its .json carries the 400 class names the head's outputs index.
fetch "$BASE/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.pb"
fetch "$BASE/classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1.pb"
fetch "$BASE/classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1.json"

echo "models in $DIR:"
ls -la "$DIR"
