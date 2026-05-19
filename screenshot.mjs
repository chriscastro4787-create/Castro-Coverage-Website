import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(__dirname, 'temporary screenshots');

// Args: [url] [label]
const urlArg   = process.argv[2];
const label    = process.argv[3];

// Default to local index.html if no URL given
const url = urlArg
  ? urlArg
  : pathToFileURL(path.join(__dirname, 'index.html')).href;

// Auto-increment: find next unused screenshot-N number
fs.mkdirSync(screenshotDir, { recursive: true });
const existing = fs.readdirSync(screenshotDir)
  .map(f => parseInt(f.match(/^screenshot-(\d+)/)?.[1]))
  .filter(n => !isNaN(n));
const next = existing.length ? Math.max(...existing) + 1 : 1;

const filename = label ? `screenshot-${next}-${label}.png` : `screenshot-${next}.png`;
const outPath  = path.join(screenshotDir, filename);

const browser = await puppeteer.launch({ headless: true });
const page    = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle0' });

// Force all reveal elements visible (intersection observer won't fire for off-screen els)
await page.addStyleTag({ content: '.r { opacity: 1 !important; transform: none !important; transition: none !important; }' });
await new Promise(r => setTimeout(r, 500));

await page.screenshot({ path: outPath, fullPage: true });
await browser.close();

console.log(`Saved → ${outPath}`);
