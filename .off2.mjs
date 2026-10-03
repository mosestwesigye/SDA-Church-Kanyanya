import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
const OUT = process.env.OUT, BASE = "http://localhost:3001";
const ID = "cmurdnfj2008ia07d5uumxbln";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, storageState: `${OUT}/clerk@example.org-state.json` });
const page = await ctx.newPage();
await page.goto(BASE + "/dashboard");
await page.evaluate(() => navigator.serviceWorker.ready);
for (const u of ["/dashboard", "/members", `/members/${ID}`]) { await page.goto(BASE + u); await page.waitForSelector("main h1"); }
console.log("cached:", await page.evaluate(async () => (await (await caches.open("sdak-pages")).keys()).map((r) => new URL(r.url).pathname)));
execSync("pkill -f 'next start' || pkill -f 'next-server' || true");
await page.waitForTimeout(1500);
await page.goto(BASE + `/members/${ID}`); await page.waitForSelector("main h1");
console.log("server down, profile:", await page.textContent("main h1"));
await page.screenshot({ path: `${OUT}/p8-offline-read.png` });
await page.goto(BASE + "/families"); await page.waitForSelector("h1");
console.log("server down, uncached:", await page.textContent("h1"));
await page.screenshot({ path: `${OUT}/p8-offline-fallback.png` });
// Sign-out clears the page cache.
await page.evaluate(async () => { await caches.delete("sdak-pages"); });
await b.close();
