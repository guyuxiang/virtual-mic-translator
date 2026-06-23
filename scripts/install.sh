#!/usr/bin/env bash
#
# Virtual Mic Translator — one-line macOS installer.
#
#   curl -fsSL https://github.com/guyuxiang/virtual-mic-translator/releases/latest/download/install.sh | bash
#
# Downloads the latest app from GitHub Releases, installs the BlackHole virtual
# microphone, copies the app to /Applications, and strips the Gatekeeper
# quarantine flag so the (unsigned/ad-hoc) app launches normally.
set -euo pipefail

REPO="guyuxiang/virtual-mic-translator"
APP_NAME="Virtual Mic Translator.app"
BASE="https://github.com/$REPO/releases/latest/download"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This installer is for macOS only." >&2
  exit 1
fi

echo "▸ Virtual Mic Translator — macOS installer"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "▸ Downloading app…"
curl -fsSL "$BASE/VirtualMicTranslator-mac.zip" -o "$TMP/app.zip"

echo "▸ Unpacking…"
ditto -x -k "$TMP/app.zip" "$TMP/unpacked"
APP_PATH="$(/usr/bin/find "$TMP/unpacked" -maxdepth 2 -name '*.app' -type d | head -1)"
[[ -n "$APP_PATH" ]] || { echo "App bundle not found in archive." >&2; exit 1; }

# ── BlackHole virtual audio driver ───────────────────────────────
if system_profiler SPAudioDataType 2>/dev/null | grep -qi "BlackHole"; then
  echo "▸ BlackHole already installed."
elif command -v brew >/dev/null 2>&1; then
  echo "▸ Installing BlackHole via Homebrew…"
  brew install blackhole-2ch
else
  echo "▸ Installing BlackHole (requires your admin password)…"
  curl -fsSL "$BASE/BlackHole.pkg" -o "$TMP/BlackHole.pkg"
  sudo installer -pkg "$TMP/BlackHole.pkg" -target /
fi

# ── Install the app ──────────────────────────────────────────────
echo "▸ Installing app to /Applications…"
DEST="/Applications/$APP_NAME"
rm -rf "$DEST"
cp -R "$APP_PATH" "/Applications/"

echo "▸ Removing quarantine flag (Gatekeeper)…"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo ""
echo "✓ Installed."
echo "  Open it:  open \"$DEST\""
echo "  In Zoom/Teams/Meet, choose 'BlackHole 2ch' as your microphone."
