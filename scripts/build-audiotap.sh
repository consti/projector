#!/bin/sh
# Build the audio tap helper (native/audiotap) into bin/audiotap. Needs the
# Swift toolchain from Xcode or the Command Line Tools. Run by `npm run build`
# and, if the binary is missing, by the app itself the first time it is needed.
set -e
cd "$(dirname "$0")/.."
mkdir -p bin
xcrun swiftc -O -o bin/audiotap native/audiotap/main.swift -framework CoreAudio -framework AudioToolbox -target arm64-apple-macos14.2 2>&1
codesign --force --sign - bin/audiotap 2>/dev/null || true
echo "built bin/audiotap"
