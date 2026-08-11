const fs = require('fs');
const path = require('path');

function generateGallery() {
    const screenshotsDir = path.join(process.cwd(), 'test-results', 'screenshots');
    const playlistsDir = path.join(screenshotsDir, 'real_playlists');

    if (!fs.existsSync(playlistsDir)) {
        console.log('No screenshots found to generate gallery.');
        return;
    }

    const playlists = fs.readdirSync(playlistsDir).filter(p => fs.statSync(path.join(playlistsDir, p)).isDirectory());

    let mdContent = `# Visual Screenshots Gallery\n\n`;
    let htmlContent = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>Visual Tests Gallery</title>
    <style>
        body { font-family: sans-serif; background: #1a1a1a; color: #fff; padding: 20px; }
        h1, h2, h3 { color: #00ffcc; }
        .device-section { margin-bottom: 40px; }
        .screenshots { display: flex; flex-wrap: wrap; gap: 20px; }
        .screenshot-card { background: #2a2a2a; padding: 10px; border-radius: 8px; text-align: center; }
        .screenshot-card img { max-width: 300px; max-height: 600px; border: 1px solid #555; }
        .screenshot-card p { margin-top: 10px; font-size: 0.9em; }
    </style>
</head>
<body>
    <h1>Visual Tests Gallery</h1>
`;

    for (const playlist of playlists) {
        mdContent += `## Playlist: ${playlist}\n\n`;
        htmlContent += `    <h2>Playlist: ${playlist}</h2>\n`;

        const devicesDir = path.join(playlistsDir, playlist);
        const devices = fs.readdirSync(devicesDir).filter(d => fs.statSync(path.join(devicesDir, d)).isDirectory());

        for (const device of devices) {
            mdContent += `### Device: ${device}\n\n`;
            htmlContent += `    <div class="device-section">\n        <h3>Device: ${device}</h3>\n        <div class="screenshots">\n`;

            const imagesDir = path.join(devicesDir, device);
            const images = fs.readdirSync(imagesDir).filter(i => i.endsWith('.png')).sort();

            for (const img of images) {
                const relPath = `real_playlists/${playlist}/${device}/${img}`;
                mdContent += `- ![${img}](${relPath})\n`;
                htmlContent += `            <div class="screenshot-card">
                <img src="${relPath}" loading="lazy" alt="${img}">
                <p>${img}</p>
            </div>\n`;
            }

            mdContent += `\n`;
            htmlContent += `        </div>\n    </div>\n`;
        }
    }

    htmlContent += `</body>\n</html>`;

    fs.writeFileSync(path.join(screenshotsDir, 'README.md'), mdContent);
    fs.writeFileSync(path.join(screenshotsDir, 'index.html'), htmlContent);
    console.log('Generated index.html and README.md in test-results/screenshots');
}

if (require.main === module) {
    generateGallery();
}

module.exports = generateGallery;
