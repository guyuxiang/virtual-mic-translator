#!/usr/bin/env bash
#
# Virtual Mic Translator — macOS uninstaller.
#
#   curl -fsSL https://github.com/guyuxiang/virtual-mic-translator/releases/latest/download/uninstall.sh | bash
set -euo pipefail

APP="/Applications/Virtual Mic Translator.app"

if [[ -d "$APP" ]]; then
  rm -rf "$APP"
  echo "✓ Removed $APP"
else
  echo "App not found at $APP (already removed?)."
fi

echo "BlackHole was left installed (other apps may use it)."
echo "To remove it too:  brew uninstall blackhole-2ch"
