#!/bin/bash
set -e

echo "========================================="
echo "  PDVH Comprehensive Test Suite Runner   "
echo "========================================="

# 1. 依存パッケージのチェック・確保
npm list @playwright/test > /dev/null 2>&1 || npm install @playwright/test

mkdir -p test-results/screenshots

# 2. テストのシリアル実行 (ワーカー数 1 で安定化)
PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/summary.json \
npx playwright test tests/01_parser_unit.spec.js \
                    tests/02_api_integration.spec.js \
                    tests/03_e2e_single_session.spec.js \
                    tests/04_e2e_vj_lobby.spec.js \
                    tests/spec_alignment.spec.js \
                    tests/visual_screenshots.spec.js \
                    --workers=1 \
                    --reporter=line,json

echo "========================================="
echo "  All Tests Passed Successfully!         "
echo "========================================="
