// UX check helper (SPEC.md section 7): screenshots pages at 1440px and 390px wide
// and reports anything that overflows the viewport sideways.
//
//   node scripts/screenshot.mjs http://localhost:3000 / /search?q=phone
//
// Images go to .screenshots/, which is not committed.
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const [base, ...paths] = process.argv.slice(2);
if (!base || paths.length === 0) {
  console.error("usage: node scripts/screenshot.mjs <base-url> <path> [<path> ...]");
  process.exit(1);
}

const WIDTHS = [1440, 390];
await mkdir(".screenshots", { recursive: true });
const browser = await chromium.launch();
let overflowing = 0;

for (const path of paths) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(base + path, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll("body *")].filter((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.right <= limit + 1) return false;
        // Content inside a sideways-scrolling row is allowed to extend past the edge.
        for (let p = el.parentElement; p; p = p.parentElement) {
          const style = getComputedStyle(p);
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) return false;
        }
        return true;
      });
      return {
        pageScrolls: document.documentElement.scrollWidth > limit,
        elements: wide.slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80)),
      };
    });
    const name = (path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home") + `-${width}.png`;
    await page.screenshot({ path: `.screenshots/${name}`, fullPage: true });
    const problem = overflow.pageScrolls || overflow.elements.length > 0;
    if (problem) overflowing += 1;
    console.log(`${problem ? "OVERFLOW" : "ok      "} ${width}px ${path} -> .screenshots/${name}`, problem ? overflow : "");
    await page.close();
  }
}

await browser.close();
process.exit(overflowing ? 1 : 0);
