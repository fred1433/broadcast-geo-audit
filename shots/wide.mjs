import { chromium } from "playwright";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto(process.argv[2], { waitUntil: "networkidle" });
const r = await p.evaluate(() => { const out = []; for (const el of document.querySelectorAll("body *")) { if (el.closest("svg")) continue; const rc = el.getBoundingClientRect(); if (rc.right > 392) out.push(el.tagName + "." + el.className + " " + Math.round(rc.right)); } return [document.documentElement.scrollWidth, out.slice(0, 12)]; });
console.log(JSON.stringify(r, null, 1)); await b.close();
