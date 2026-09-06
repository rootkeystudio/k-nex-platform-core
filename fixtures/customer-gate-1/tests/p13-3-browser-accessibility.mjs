import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

export async function seriousAccessibilityViolations(page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const results = await globalThis.axe.run(document, { resultTypes: ["violations"] });
    return results.violations.filter(({ impact }) => impact === "serious" || impact === "critical").map(({ id, impact, nodes }) => ({
      id, impact, targets: nodes.map(({ target }) => target)
    }));
  });
}
