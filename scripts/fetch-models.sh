#!/bin/sh
# Download the MediaPipe pose tracker so phones can load it from the app itself
# instead of the internet. Everything lands in assets/mediapipe/, which the
# packaged build ships; without it the phone page falls back to the CDN.
set -eu
cd "$(dirname "$0")/.."
V=0.10.21
CDN="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@$V"
MODELS="https://storage.googleapis.com/mediapipe-models/pose_landmarker"
DST=assets/mediapipe
mkdir -p "$DST/wasm"

get() { # url dest
  if [ -s "$2" ]; then echo "have  $2"; return; fi
  echo "fetch $1"
  curl -fL --retry 3 -o "$2.part" "$1" && mv "$2.part" "$2"
}

get "$CDN/vision_bundle.mjs"                     "$DST/vision_bundle.mjs"
get "$CDN/wasm/vision_wasm_internal.js"          "$DST/wasm/vision_wasm_internal.js"
get "$CDN/wasm/vision_wasm_internal.wasm"        "$DST/wasm/vision_wasm_internal.wasm"
get "$CDN/wasm/vision_wasm_nosimd_internal.js"   "$DST/wasm/vision_wasm_nosimd_internal.js"
get "$CDN/wasm/vision_wasm_nosimd_internal.wasm" "$DST/wasm/vision_wasm_nosimd_internal.wasm"
get "$MODELS/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"   "$DST/pose_landmarker_lite.task"
get "$MODELS/pose_landmarker_full/float16/latest/pose_landmarker_full.task"   "$DST/pose_landmarker_full.task"
get "$MODELS/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task" "$DST/pose_landmarker_heavy.task"
echo "done: $(du -sh "$DST" | cut -f1) in $DST"
