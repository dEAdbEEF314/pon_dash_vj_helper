const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const baseUrl = process.env.PDVH_AUDIT_URL || 'http://pdvh-app';
const manuals = [
    {
        id: 'dj',
        file: 'docs/dj-manual.html',
        expectedImages: 7,
        requiredText: ['SEND TO VJ', 'VIBES!', '[VJ READY]', 'Google', 'YouTube', 'ニコニコ動画', 'GIPHY', '8時間']
    },
    {
        id: 'vj',
        file: 'docs/vj-manual.html',
        expectedImages: 9,
        requiredText: ['VJロビー', '10文字', 'VJモードを開始する', 'READY', 'Google', 'YouTube', 'ニコニコ動画', 'GIPHY', '8時間']
    }
];
const viewports = [
    { id: 'desktop', width: 1280, height: 900 },
    { id: 'mobile', width: 390, height: 844 },
    { id: 'compact', width: 360, height: 740 }
];

async function auditManual(page, manual, viewport) {
    const response = await page.goto(`${baseUrl}/${manual.file}`, { waitUntil: 'networkidle' });
    const text = await page.locator('body').innerText();
    const imageState = await page.evaluate(() => [...document.images].map(image => ({
        src: image.getAttribute('src'),
        loaded: image.complete && image.naturalWidth > 0,
        width: image.naturalWidth,
        height: image.naturalHeight
    })));
    const layout = await page.evaluate(() => ({
        documentWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        headings: document.querySelectorAll('h2').length,
        tocLinks: [...document.querySelectorAll('.toc a')].map(link => link.getAttribute('href'))
    }));
    const missingText = manual.requiredText.filter(value => !text.includes(value));
    const result = {
        manual: manual.id,
        viewport: viewport.id,
        httpStatus: response ? response.status() : null,
        httpOk: Boolean(response && response.ok()),
        imageCount: imageState.length,
        expectedImageCount: manual.expectedImages,
        imagesLoaded: imageState.every(image => image.loaded),
        images: imageState,
        missingText,
        headings: layout.headings,
        tocLinks: layout.tocLinks,
        horizontalOverflow: layout.horizontalOverflow,
        documentWidth: layout.documentWidth,
        scrollWidth: layout.scrollWidth,
        passed: Boolean(response && response.ok()) && imageState.length === manual.expectedImages && imageState.every(image => image.loaded) && missingText.length === 0 && !layout.horizontalOverflow
    };
    return result;
}

(async () => {
    fs.mkdirSync('test-results', { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const results = [];
    for (const manual of manuals) {
        for (const viewport of viewports) {
            const page = await browser.newPage({ viewport });
            results.push(await auditManual(page, manual, viewport));
            await page.close();
        }
    }
    await browser.close();
    const report = {
        generatedAt: new Date().toISOString(),
        baseUrl,
        source: 'tests/manual_audit.js',
        summary: {
            total: results.length,
            passed: results.filter(result => result.passed).length,
            failed: results.filter(result => !result.passed).length
        },
        results
    };
    fs.writeFileSync('test-results/manual_audit_report.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.summary));
    if (report.summary.failed > 0) process.exitCode = 1;
})();
