import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { chromium } from "playwright";
import { resolveMinimalThemeProfile } from "../packages/theme-minimal/dist/index.js";
import { resolveNeobrutalismThemeProfile } from "../packages/theme-neobrutalism/dist/index.js";

const profile = (themeId, palette, revisionId) => ({
  schemaVersion: 1, id: `theme-profile.${themeId.split(".")[1]}`, surface: "public", themeId, themeVersion: "1.0.0", palette, mode: "light", values: {},
  revision: { id: revisionId, number: 1, state: "published", createdAt: "2026-08-27T00:00:00.000Z", publishedAt: "2026-08-27T00:01:00.000Z" }
});
const cases = [
  { name: "minimal", presentation: resolveMinimalThemeProfile(profile("theme.minimal", "light", "theme-revision.minimal-1")), override: "" },
  { name: "neobrutalism", presentation: resolveNeobrutalismThemeProfile(profile("theme.neobrutalism", "primary", "theme-revision.neobrutalism-1")), override: "" },
  { name: "customer-override", presentation: resolveMinimalThemeProfile(profile("theme.minimal", "light", "theme-revision.customer-1")), override: '.customer [data-k-nex-primitive="card"]{border-width:5px;background:#eefbf2}' }
];
const markup = (testCase) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui}main{min-height:100vh;padding:32px}.journey{max-width:720px;margin:auto}.controls{display:flex;gap:12px;flex-wrap:wrap}button:focus{position:relative;z-index:1}${testCase.presentation.cssText}${testCase.override}
</style></head><body><main class="customer" data-k-nex-theme-profile="${testCase.presentation.profileRevisionId}"><section class="journey" data-k-nex-primitive="stack" aria-labelledby="title"><h1 id="title">Workspace cards</h1><p>Keyboard-accessible layout controls.</p><div class="controls"><button data-k-nex-primitive="button" id="move">Move Beta earlier</button><button data-k-nex-primitive="button" id="hide">Hide Beta</button></div><div id="cards" data-k-nex-primitive="stack"><article data-card="alpha" data-k-nex-primitive="card"><h2>Alpha</h2><p>First operational card.</p></article><article data-card="beta" data-k-nex-primitive="card"><h2>Beta</h2><p>Second operational card.</p></article></div><p role="status" aria-live="polite" id="status">Ready</p></section></main><script>
for(const button of document.querySelectorAll('button')){button.addEventListener('focus',()=>button.setAttribute('data-focus-visible',''));button.addEventListener('blur',()=>button.removeAttribute('data-focus-visible'))}
move.addEventListener('click',()=>{const beta=document.querySelector('[data-card="beta"]');if(beta){cards.prepend(beta);status.textContent='Beta moved earlier'}});hide.addEventListener('click',()=>{document.querySelector('[data-card="beta"]')?.remove();status.textContent='Beta hidden'});
</script></body></html>`;

const browser = await chromium.launch();
try {
  const visualHashes = new Map();
  for (const testCase of cases) {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();
    await page.setContent(markup(testCase));
    const move = page.getByRole("button", { name: "Move Beta earlier" });
    await page.keyboard.press("Tab");
    assert.equal(await move.evaluate((element) => element === document.activeElement), true, `${testCase.name}: first control must receive keyboard focus`);
    const focus = await move.evaluate((element) => ({ outline: getComputedStyle(element).outlineStyle, rect: element.getBoundingClientRect().toJSON(), top: document.elementFromPoint(element.getBoundingClientRect().x + 2, element.getBoundingClientRect().y + 2) === element }));
    assert.notEqual(focus.outline, "none", `${testCase.name}: focus indicator must be visible`);
    assert(focus.rect.y >= 0 && focus.rect.y + focus.rect.height <= 768 && focus.top, `${testCase.name}: focus must not be obscured`);
    assert(focus.rect.width >= 44 && focus.rect.height >= 44, `${testCase.name}: control target must be at least 44px`);
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("[data-card]").first().getAttribute("data-card"), "beta", `${testCase.name}: non-drag move alternative failed`);
    assert.match(await page.locator("main").ariaSnapshot(), /heading "Workspace cards" \[level=1\]/);
    assert.match(await page.locator("main").ariaSnapshot(), /status/);
    const screenshot = await page.screenshot({ animations: "disabled" });
    visualHashes.set(testCase.name, createHash("sha256").update(screenshot).digest("hex"));
    if (testCase.name === "customer-override") assert.equal(await page.locator('[data-k-nex-primitive="card"]').first().evaluate((element) => getComputedStyle(element).borderTopWidth), "5px");
    await context.close();

    const reduced = await browser.newContext({ reducedMotion: "reduce" });
    const reducedPage = await reduced.newPage();
    await reducedPage.setContent(markup(testCase));
    assert.equal(await reducedPage.getByRole("button", { name: "Move Beta earlier" }).evaluate((element) => getComputedStyle(element).transitionDuration), "0s", `${testCase.name}: reduced motion must disable transitions`);
    await reduced.close();

    const forced = await browser.newContext({ forcedColors: "active" });
    const forcedPage = await forced.newPage();
    await forcedPage.setContent(markup(testCase));
    assert.equal(await forcedPage.evaluate(() => matchMedia("(forced-colors: active)").matches), true, `${testCase.name}: forced colors emulation failed`);
    assert.notEqual(await forcedPage.getByRole("button", { name: "Move Beta earlier" }).evaluate((element) => getComputedStyle(element).borderTopStyle), "none");
    await forced.close();
  }
  assert.equal(new Set(visualHashes.values()).size, cases.length, "both themes and the customer override must be materially distinct");
  process.stdout.write(`P5_8_ACCESSIBILITY_PASS ${JSON.stringify(Object.fromEntries(visualHashes))}\n`);
} finally {
  await browser.close();
}
