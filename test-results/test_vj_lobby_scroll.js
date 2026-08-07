const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('=== VJ Lobby Scroll & Accordion Verification Test ===');

const results = [];

// 1. vj.html 内の <details open> & <summary> の検証
const vjHtmlPath = path.join(__dirname, '..', 'vj.html');
const vjHtmlContent = fs.readFileSync(vjHtmlPath, 'utf8');

const hasDetailsOpen = vjHtmlContent.includes('<details open class="lobby-guide-details"');
const hasSummary = vjHtmlContent.includes('<summary class="lobby-guide-summary"');
const hasGuideContent = vjHtmlContent.includes('class="lobby-guide-content"');

if (hasDetailsOpen && hasSummary && hasGuideContent) {
  console.log('[PASS] vj.html: <details open> and <summary> elements exist.');
  results.push({ test: 'vj.html accordion elements', status: 'PASS' });
} else {
  console.error('[FAIL] vj.html: accordion elements missing.');
  results.push({ test: 'vj.html accordion elements', status: 'FAIL' });
}

// 2. style.css 内の .login-screen overflow-y: auto の検証
const styleCssPath = path.join(__dirname, '..', 'assets', 'css', 'style.css');
const styleCssContent = fs.readFileSync(styleCssPath, 'utf8');

const hasOverflowY = styleCssContent.includes('overflow-y: auto;') && styleCssContent.includes('.login-screen');
const hasSummaryStyle = styleCssContent.includes('.lobby-guide-summary');

if (hasOverflowY && hasSummaryStyle) {
  console.log('[PASS] style.css: .login-screen has overflow-y: auto and .lobby-guide-summary style.');
  results.push({ test: 'style.css overflow-y and guide summary styles', status: 'PASS' });
} else {
  console.error('[FAIL] style.css: overflow-y or summary styles missing.');
  results.push({ test: 'style.css overflow-y and guide summary styles', status: 'FAIL' });
}

// 3. ローカルPHPサーバー (localhost:8787/vj.html) からのHTTP応答検証
http.get('http://localhost:8787/vj.html', (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    if (res.statusCode === 200 && body.includes('lobby-guide-details')) {
      console.log('[PASS] HTTP GET http://localhost:8787/vj.html returned 200 and updated accordion HTML.');
      results.push({ test: 'HTTP Server response', status: 'PASS' });
    } else {
      console.error(`[FAIL] HTTP GET returned status ${res.statusCode}`);
      results.push({ test: 'HTTP Server response', status: 'FAIL' });
    }

    const testSummary = {
      timestamp: new Date().toISOString(),
      allPassed: results.every(r => r.status === 'PASS'),
      results: results
    };

    fs.writeFileSync(
      path.join(__dirname, 'test_summary_lobby_scroll.json'),
      JSON.stringify(testSummary, null, 2)
    );
    console.log('=== Test Summary Saved to test-results/test_summary_lobby_scroll.json ===');
  });
}).on('error', (err) => {
  console.error('[FAIL] HTTP Server Connection Error:', err.message);
  results.push({ test: 'HTTP Server response', status: 'FAIL', error: err.message });
});
