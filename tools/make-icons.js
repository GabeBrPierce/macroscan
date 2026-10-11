/* Render MacroScan icons (56, 112, 256 PNG) from tools/icon-source.svg.
   Uses the puppeteer install from the sibling News project.
   Run: node tools/make-icons.js */
const fs = require('fs');
const path = require('path');
const puppeteer = require(path.join('D:', 'source', 'repos', 'vibe-code', 'News', 'node_modules', 'puppeteer'));

const TOOLS = __dirname;
const ICONS = path.join(__dirname, '..', 'icons');

(async () => {
  fs.mkdirSync(ICONS, { recursive: true });
  const svg = fs.readFileSync(path.join(TOOLS, 'icon-source.svg'), 'utf8');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  for (const size of [56, 112, 256]) {
    const sized = svg.replace('width="256"', 'width="' + size + '"').replace('height="256"', 'height="' + size + '"');
    const html = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent">' + sized + '</body>';
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    const el = await page.$('svg');
    await el.screenshot({ path: path.join(ICONS, 'icon-' + size + '.png'), omitBackground: true });
    console.log('wrote icon-' + size + '.png');
  }
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
