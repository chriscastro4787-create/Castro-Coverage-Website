import puppeteer from './node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const chromePath = 'C:/Users/nateh/.cache/puppeteer/chrome/win64-133.0.6943.98/chrome-win64/chrome.exe';
const browser = await puppeteer.launch({executablePath:chromePath,args:['--no-sandbox']});
const page = await browser.newPage();
await page.setViewport({width:1280,height:900});
await page.goto('http://localhost:3000',{waitUntil:'networkidle0'});
const box = await page.evaluate(() => {
  const el = document.querySelector('.licensed-sec');
  if(!el) return null;
  const r = el.getBoundingClientRect();
  return {y: window.scrollY + r.top, height: r.height};
});
if(box) {
  await page.screenshot({
    path:'./temporary screenshots/screenshot-12-section.png',
    clip:{x:0,y:box.y-10,width:1280,height:box.height+10},
    fullPage:false
  });
  // We need fullPage clip - use a different approach
  await page.evaluate((y) => window.scrollTo(0,y-100), box.y);
  await new Promise(r=>setTimeout(r,300));
  await page.screenshot({path:'./temporary screenshots/screenshot-12-section.png'});
}
await browser.close();
