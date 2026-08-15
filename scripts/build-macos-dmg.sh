#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
APP_PATH="release/mac-arm64/AI Character Platform.app"
DMG_PATH="release/AI Character Platform-${VERSION}-arm64.dmg"

npm run dist

if [[ ! -d "$APP_PATH" ]]; then
  echo "App bundle not found: $APP_PATH" >&2
  exit 1
fi

rm -f "$DMG_PATH"
hdiutil create \
  -srcfolder "$APP_PATH" \
  -volname "AI Character Platform ${VERSION}" \
  -format UDZO \
  -ov \
  "$DMG_PATH"

ls -lh "$DMG_PATH"
