import { chromium } from "playwright";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("https://oakland-radio.theaipipe.com/", { waitUntil: "networkidle" });
for (const c of ["KEXC", "KLVS"]) { await p.locator(".row button", { hasText: c }).first().click(); console.log((await p.locator(".row.sel").innerText()).replace(/\n+/g, " | ")); }
await p.getByRole("button", { name: "K229DD" }).click(); console.log((await p.locator(".chipdetail").innerText()).replace(/\n+/g, " | ").slice(0, 400));
await b.close();
