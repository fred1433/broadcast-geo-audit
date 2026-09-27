import { chromium } from "playwright";
const url = process.argv[2], out = process.argv[3];
const b = await chromium.launch();
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.goto(url, { waitUntil: "networkidle" });
  await p.screenshot({ path: `${out}_${w}_top.png` });
  await p.screenshot({ path: `${out}_${w}_full.png`, fullPage: true });
  if (process.argv[4]) {
    await p.getByRole("button", { name: /Certified export/ }).click();
    await p.screenshot({ path: `${out}_${w}_cert.png` });
    await p.getByRole("button", { name: /Research shortlist/ }).click();
    await p.locator(".row button").first().click();
    await p.screenshot({ path: `${out}_${w}_sel.png`, fullPage: true });
  }
  await p.close();
}
await b.close();
