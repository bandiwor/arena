// Renders public/icons/icon.svg to PNG sizes via headless Chromium.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../public/icons/icon.svg'), 'utf8');
  const b = await chromium.launch();
  for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['maskable-512.png', 512, 0.12], ['apple-touch-icon.png', 180, 0]]) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    const inner = Math.round(size * (1 - pad * 2));
    await p.setContent(`<body style="margin:0;background:#06050b;display:grid;place-items:center;width:${size}px;height:${size}px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`);
    await p.screenshot({ path: path.join(__dirname, '../public/icons', name) });
    await p.close();
  }
  await b.close();
})();
