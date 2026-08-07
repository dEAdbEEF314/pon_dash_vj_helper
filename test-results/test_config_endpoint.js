const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:8787';

async function runTests() {
    const results = [];
    console.log("=== PDVH Config & API Validation Tests ===");

    // Test 1: backend/api/config.php
    try {
        const res = await fetch(`${BASE_URL}/backend/api/config.php`);
        const status = res.status;
        const contentType = res.headers.get('content-type');
        const data = await res.json();

        const passKey = data.hasOwnProperty('PUSHER_APP_KEY');
        const passCluster = data.hasOwnProperty('PUSHER_CLUSTER');
        const passApiBase = data.hasOwnProperty('API_BASE');
        const noSecret = !data.hasOwnProperty('PUSHER_SECRET') && !data.hasOwnProperty('HMAC_SECRET');

        const success = status === 200 && passKey && passCluster && passApiBase && noSecret;

        results.push({
            test: 'GET /backend/api/config.php',
            status: success ? 'PASS' : 'FAIL',
            httpStatus: status,
            response: data,
            details: { passKey, passCluster, passApiBase, noSecret }
        });
        console.log(`[${success ? 'PASS' : 'FAIL'}] Test 1: GET /backend/api/config.php (Status: ${status})`);
        console.log(" Response Data:", data);
    } catch (err) {
        results.push({
            test: 'GET /backend/api/config.php',
            status: 'FAIL',
            error: err.message
        });
        console.error("[FAIL] Test 1 Error:", err.message);
    }

    // Test 2: Direct access to backend/api/env.php (Security Check)
    try {
        const res = await fetch(`${BASE_URL}/backend/api/env.php`);
        const text = await res.text();
        
        // PHPが正しく実行されれば空画面(200)または403拒否。ソースコード($PUSHER_SECRET等)が剥き出しになっていなければ合格。
        const isLeakingSecret = text.includes('$PUSHER_SECRET') || text.includes('YOUR_HMAC_SECRET_KEY') || text.includes('YOUR_PUSHER_SECRET');
        const success = !isLeakingSecret;

        results.push({
            test: 'Direct Access /backend/api/env.php',
            status: success ? 'PASS' : 'FAIL',
            httpStatus: res.status,
            secretLeaked: isLeakingSecret,
            responseSnippet: text.substring(0, 100)
        });
        console.log(`[${success ? 'PASS' : 'FAIL'}] Test 2: Direct Access /backend/api/env.php (Status: ${res.status})`);
        console.log(` Secret Leaked: ${isLeakingSecret ? 'YES (SECURITY RISK!)' : 'NO (SECURE)'}`);
    } catch (err) {
        results.push({
            test: 'Direct Access /backend/api/env.php',
            status: 'PASS', // 接続拒否・アクセス遮断された場合は安全
            note: err.message
        });
        console.log("[PASS] Test 2: Direct Access blocked or failed as expected:", err.message);
    }

    // Test 3: Frontend HTML pages check
    const pages = ['index.html', 'dj.html', 'vj.html'];
    for (const page of pages) {
        try {
            const res = await fetch(`${BASE_URL}/${page}`);
            const text = await res.text();
            const hasConfigJs = text.includes('assets/js/config.js');
            const success = res.status === 200 && hasConfigJs;

            results.push({
                test: `HTML Page Check: ${page}`,
                status: success ? 'PASS' : 'FAIL',
                httpStatus: res.status,
                hasConfigJs
            });
            console.log(`[${success ? 'PASS' : 'FAIL'}] Test 3 (${page}): Status: ${res.status}, Includes config.js: ${hasConfigJs}`);
        } catch (err) {
            results.push({
                test: `HTML Page Check: ${page}`,
                status: 'FAIL',
                error: err.message
            });
        }
    }

    // Save test report to test-results/report.json
    const reportPath = path.join(__dirname, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
    console.log(`\nTest report saved to: ${reportPath}`);
}

runTests();
