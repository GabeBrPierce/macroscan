/* Render PWA icons (192, 512) from tools/icon-source.svg. Run: node tools/make-pwa-icons.js */
const fs = require('fs');
const path = require('path');
const puppeteer = require(path.join('D:', 'source', 'repos', 'vibe-code', 'News', 'node_modules', 'puppeteer'));
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icon-source.svg'), 'utf8');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  for (const size of [192, 512]) {
    const sized = svg.replace('width="256"', 'width="' + size + '"').replace('height="256"', 'height="' + size + '"');
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent">' + sized + '</body>', { waitUntil: 'load' });
    await page.screenshot({ path: path.join(__dirname, '..', 'icons', 'icon-' + size + '.png'), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await browser.close();
})();
