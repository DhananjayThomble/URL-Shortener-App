/*
 * Capture SnapURL extension store screenshots from the REAL built UI.
 * Serves dist/ over http (file:// blocks ES-module script loads via CORS),
 * injects a chrome.* stub + mock fetch BEFORE the bundle runs, lets the
 * extension render, drives each state, screenshots a 1280x800 store canvas.
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright node apps/extension/store/scripts/capture-screenshots.mjs
 */
import { chromium } from "/home/dj/workspace/snapurl/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "..", "dist");
const outDir = join(here, "..", "screenshots");
const W = 1280, H = 800;
const SETTINGS = { apiBaseUrl: "https://api.snapurl.in", apiKey: "snap_live_demo_key_1234567890", defaultDomain: "snap.url" };
const SEED = { links: [{"id":"lnk_1","domain":"snap.url","slug":"launch","destination":"https://example.com/blog/product-launch-2026","title":"Product Launch 2026","tags":[],"status":"active","clicks":1284,"uniqueClicks":1027,"redirectType":"302","rules":[],"passwordProtected":false,"forwardQuery":true,"deepLink":false,"hideReferrer":false,"publicPreview":true,"cloaked":false,"safeBrowsing":{"status":"clean","checkedAt":"2026-09-14T10:00:00.000Z"},"sparkline":[3,5,4,8,12,9,14,11,18,22,15,20,24,19,26,30,22,28,33,27,31,29,35,40,32,38,44,36,42,48],"createdAt":"2026-09-10T09:00:00.000Z"},{"id":"lnk_2","domain":"snap.url","slug":"docs","destination":"https://example.com/docs/getting-started","title":null,"tags":[],"status":"active","clicks":342,"uniqueClicks":274,"redirectType":"302","rules":[],"passwordProtected":false,"forwardQuery":true,"deepLink":false,"hideReferrer":false,"publicPreview":true,"cloaked":false,"safeBrowsing":{"status":"clean","checkedAt":"2026-09-14T10:00:00.000Z"},"sparkline":[1,2,2,4,3,5,6,5,7,8,6,9,7,10,8,11,9,12,10,13,11,14,12,15,13,16,14,17,15,18],"createdAt":"2026-09-10T09:00:00.000Z"},{"id":"lnk_3","domain":"snap.url","slug":"sale","destination":"https://shop.example.com/spring-sale","title":null,"tags":[],"status":"active","clicks":5610,"uniqueClicks":4488,"redirectType":"302","rules":[],"passwordProtected":false,"forwardQuery":true,"deepLink":false,"hideReferrer":false,"publicPreview":true,"cloaked":false,"safeBrowsing":{"status":"clean","checkedAt":"2026-09-14T10:00:00.000Z"},"sparkline":[20,25,30,28,40,55,60,48,70,90,65,80,95,72,88,110,84,100,120,96,112,130,104,124,140,116,132,150,128,144],"createdAt":"2026-09-10T09:00:00.000Z"}], domains: [{"id":"dom_1","domain":"snap.url","status":"live","ssl":"active","links":128,"rootRedirect":null,"notFoundRedirect":null},{"id":"dom_2","domain":"go.example.com","status":"live","ssl":"active","links":42,"rootRedirect":null,"notFoundRedirect":null}], newLink: {"id":"lnk_new","domain":"snap.url","slug":"launch","destination":"https://example.com/blog/product-launch-2026","title":"Product Launch 2026","tags":[],"status":"active","clicks":0,"uniqueClicks":0,"redirectType":"302","rules":[],"passwordProtected":false,"forwardQuery":true,"deepLink":false,"hideReferrer":false,"publicPreview":true,"cloaked":false,"safeBrowsing":{"status":"clean","checkedAt":"2026-09-14T10:00:00.000Z"},"sparkline":[],"createdAt":"2026-09-10T09:00:00.000Z"} };
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".png":"image/png", ".svg":"image/svg+xml" };

function chromeStub(settings) {
  return "(() => { const store = { 'snapurl:settings': " + JSON.stringify(settings) + ", 'snapurl:onboarding': { complete: true } };" +
    "window.chrome = { runtime:{id:'snapurl-demo-extension',openOptionsPage(){}}," +
    "tabs:{query:async()=>[{id:1,active:true,url:'https://example.com/blog/product-launch-2026',title:'Product Launch 2026 - Example'}],create(){}}," +
    "storage:{local:{get:async(k)=>{if(!k)return{...store};const ks=Array.isArray(k)?k:[k];const o={};for(const kk of ks)if(kk in store)o[kk]=store[kk];return o;},set:async(i)=>{Object.assign(store,i);},remove:async()=>{}}}," +
    "i18n:{getMessage:()=>''} }; })();";
}
function fetchStub() {
  return "(() => { const seed = " + JSON.stringify(SEED) + ";" +
    "window.fetch = async (input, init) => { const url = typeof input==='string'?input:input.url; const method=(init&&init.method)||'GET';" +
    "const json=(o)=>new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}});" +
    "if(url.includes('/domains'))return json(seed.domains);" +
    "if(url.includes('/links')&&method==='POST')return json(seed.newLink);" +
    "if(url.includes('/links'))return json({items:seed.links,total:seed.links.length});" +
    "return json({ok:true}); }; })();";
}
const POPUP_CSS = "html,body{width:"+W+"px;height:"+H+"px;margin:0;background:linear-gradient(135deg,#0b1f4d,#1d59c7);display:flex;align-items:center;justify-content:center;overflow:hidden}[data-app='popup']{width:400px;min-height:520px;max-height:720px;background:#fff;border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.35);overflow:auto}";
const OPT_LIGHT = "html,body{width:"+W+"px;min-height:"+H+"px;margin:0;background:#f4f6fb}[data-app='options']{max-width:820px;margin:32px auto;padding:0 24px}";
const OPT_DARK = "html,body{width:"+W+"px;min-height:"+H+"px;margin:0;background:#0b1220}[data-app='options']{max-width:820px;margin:32px auto;padding:0 24px}";

async function shot(page, name){ await page.screenshot({ path: join(outDir,name), clip:{x:0,y:0,width:W,height:H} }); console.log("captured",name); }

async function run() {
  const server = createServer(async (req,res) => {
    try { const p = join(distDir, decodeURIComponent(req.url.split("?")[0])); const data = await readFile(p);
      res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" }); res.end(data);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise(r => server.listen(0, r));
  const base = "http://localhost:" + server.address().port;

  const browser = await chromium.launch();
  const cap = async (path, css, name, drive) => {
    const ctx = await browser.newContext({ viewport:{width:W,height:H}, deviceScaleFactor:1, colorScheme: name.includes("dark")?"dark":"light" });
    const page = await ctx.newPage();
    page.on("pageerror", e => console.log("PAGEERROR", String(e).slice(0,200)));
    await page.addInitScript(chromeStub(SETTINGS));
    await page.addInitScript(fetchStub());
    await page.goto(base + path);
    await page.waitForTimeout(1000);
    await page.addStyleTag({ content: css });
    await page.waitForTimeout(300);
    if (drive) await drive(page);
    await shot(page, name);
    await ctx.close();
  };

  // popup: shorten form
  await cap("/popup.html", POPUP_CSS, "01-popup-shorten.png");
  // popup: result + QR
  await cap("/popup.html", POPUP_CSS, "02-popup-result-qr.png", async (page) => {
    const btn = page.locator("[data-app='popup'] button[type='submit'], [data-app='popup'] [data-action='shorten'], [data-app='popup'] button:has-text('Shorten')").first();
    if (await btn.count()) { await btn.click().catch(()=>{}); await page.waitForTimeout(1100); }
  });
  // popup: recent search
  await cap("/popup.html", POPUP_CSS, "03-popup-recent.png", async (page) => {
    const s = page.locator("[data-app='popup'] input[type='search'], [data-app='popup'] input[placeholder*='ecent'], [data-app='popup'] input[placeholder*='earch']").first();
    if (await s.count()) { await s.fill("s").catch(()=>{}); await page.waitForTimeout(800); }
  });
  // options light + dark
  await cap("/options.html", OPT_LIGHT, "04-options-connection.png");
  await cap("/options.html", OPT_DARK, "05-options-dark.png");

  await browser.close();
  server.close();
}
run().then(()=>{console.log("done");process.exit(0);}).catch(e=>{console.error(e);process.exit(1);});
