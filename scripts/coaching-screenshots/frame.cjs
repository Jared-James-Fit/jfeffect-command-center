// The app screenshot inside a whole iPhone screen (status bar above, home indicator below), as WebP.
const fs = require("fs");

const STATUS_BAR = `<div class="bar"><span>9:41</span><span class="icons">
  <svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="#fff"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="#fff"/><rect x="10" y="3" width="3" height="9" rx="1" fill="#fff"/><rect x="15" y="0" width="3" height="12" rx="1" fill="#fff"/></svg>
  <svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 2.6c2.2 0 4.2.9 5.7 2.3l1.1-1.1A9.6 9.6 0 0 0 8 1 9.6 9.6 0 0 0 1.2 3.8l1.1 1.1A8 8 0 0 1 8 2.6Zm0 3.2c1.3 0 2.5.5 3.4 1.4l1.1-1.1A6.4 6.4 0 0 0 8 4.2c-1.8 0-3.4.7-4.5 1.9l1.1 1.1c.9-.9 2.1-1.4 3.4-1.4Zm0 3.2c-.5 0-1 .2-1.3.6L8 11l1.3-1.4c-.3-.4-.8-.6-1.3-.6Z" fill="#fff"/></svg>
  <svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" stroke="#fff" stroke-opacity=".4" fill="none"/><rect x="2" y="2" width="20" height="9" rx="2" fill="#fff"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="#fff" fill-opacity=".45"/></svg>
</span></div>`;

/** The app screenshot inside a whole iPhone screen, encoded as WebP by the browser's canvas. */
async function composeWebp(browser, pngPath, outPath) {
  const data = "data:image/png;base64," + fs.readFileSync(pngPath).toString("base64");
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;background:#0d0d0f}
    .s{width:390px;height:844px;background:#0d0d0f;display:flex;flex-direction:column;overflow:hidden}
    .bar{height:47px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:6px 30px 0 50px;color:#fff;font-family:Inter,sans-serif;font-weight:600;font-size:17px;letter-spacing:-0.2px;box-sizing:border-box}
    .icons{display:flex;gap:6px;align-items:center}
    img{display:block;width:390px;height:763px;flex:none}
    .home{height:34px;flex:none;display:flex;align-items:flex-end;justify-content:center;padding-bottom:8px;box-sizing:border-box}
    .home i{display:block;width:134px;height:5px;border-radius:3px;background:#fff}
  </style></head><body><div class="s">${STATUS_BAR}<img src="${data}"><div class="home"><i></i></div></div></body></html>`);
  await page.waitForTimeout(300);
  const png = await page.screenshot();
  const webp = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/webp", 0.82).split(",")[1];
  }, png.toString("base64"));
  fs.writeFileSync(outPath, Buffer.from(webp, "base64"));
  await page.close();
}

module.exports = { composeWebp };
