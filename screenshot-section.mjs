import puppeteer from 'puppeteer';

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setViewport({width:1280,height:900});
await page.goto('http://localhost:8791/index.html',{waitUntil:'networkidle0'});
const box = await page.evaluate(() => {
  const el = document.querySelector('.licensed-sec');
  if(!el) return null;
  const r = el.getBoundingClientRect();
  return {y: window.scrollY + r.top, height: r.height};
});
if(box) {
  await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 400)), box.y);
  await new Promise(r=>setTimeout(r,400));
  await page.evaluate((y) => window.scrollTo(0, y - 20), box.y);
  await new Promise(r=>setTimeout(r,1000));
  await page.screenshot({path:'./temporary screenshots/screenshot-section.png'});
}
await browser.close();
