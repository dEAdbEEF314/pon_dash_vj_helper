#!/bin/bash
set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESULT_DIR="$ROOT_DIR/test-results"
mkdir -p "$RESULT_DIR/screenshots"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required" >&2
  exit 1
fi

cd "$ROOT_DIR"

PLAYWRIGHT_JSON_OUTPUT_NAME="$RESULT_DIR/playwright.json" \
npx playwright test \
  tests/01_parser_unit.spec.js \
  tests/02_api_integration.spec.js \
  tests/03_e2e_single_session.spec.js \
  tests/04_e2e_vj_lobby.spec.js \
  tests/05_e2e_multi_dj.spec.js \
  tests/spec_alignment.spec.js \
  tests/visual_screenshots.spec.js \
  --workers=1 \
  --reporter=line,json
