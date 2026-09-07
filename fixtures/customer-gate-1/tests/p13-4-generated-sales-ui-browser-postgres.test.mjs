import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

import { seriousAccessibilityViolations } from "./p13-3-browser-accessibility.mjs";
import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

async function login(browser, origin, persona) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const response = await page.goto(`${origin}/login`);
  assert.equal(response?.status(), 200);
  await page.getByLabel("Email").fill(persona.email);
  await page.getByLabel("Password").fill(persona.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.origin === origin && url.pathname !== "/login");
  return { context, page };
}

async function visit(page, path, heading) {
  const response = await page.goto(new URL(path, page.url()).toString());
  assert.equal(response?.status(), 200, `${path} returned ${response?.status()}`);
  await page.locator("#workspace-main").waitFor();
  await page.getByRole("heading", { name: heading, exact: true }).waitFor();
  assert.deepEqual(await seriousAccessibilityViolations(page), [], `serious/critical accessibility violations at ${path}`);
}

test("P13.4 generated Chromium renders the native sales configuration surfaces with accessible controls", { timeout: 360_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ origin, personas }) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const owner = await login(browser, origin, personas.owner);
      try {
        await visit(owner.page, "/sales/opportunities", "Opportunities");
        await owner.page.getByRole("button", { name: "Kanban", exact: true }).click();
        await owner.page.waitForURL((url) => url.searchParams.get("mode") === "kanban");
        await owner.page.locator('[data-k-nex-component="sales-opportunity-kanban"]').waitFor();
        assert.equal(await owner.page.locator('[data-slot="kanban-columns"] > section').count(), 6, "Kanban retains all six pipeline rows");

        await visit(owner.page, "/sales/settings/pipeline", "Pipeline settings");
        await owner.page.getByLabel("Stage name", { exact: true }).first().waitFor();
        assert.equal(await owner.page.getByLabel("Stage name", { exact: true }).count(), 6);
        await owner.page.getByRole("button", { name: "Update pipeline", exact: true }).waitFor();

        await visit(owner.page, "/sales/views", "Saved views");
        const createSavedView = owner.page.getByRole("button", { name: "Create saved view", exact: true }).locator("xpath=ancestor::form");
        const updateSavedView = owner.page.getByRole("button", { name: "Update saved view", exact: true }).locator("xpath=ancestor::form");
        await createSavedView.getByLabel("Name", { exact: true }).waitFor();
        await createSavedView.getByLabel("Visibility", { exact: true }).waitFor();
        await createSavedView.getByLabel("Definition JSON", { exact: true }).waitFor();
        await updateSavedView.getByLabel("Name", { exact: true }).waitFor();
        await updateSavedView.getByLabel("Visibility", { exact: true }).waitFor();
        await owner.page.getByRole("button", { name: "Archive saved view", exact: true }).waitFor();

        await visit(owner.page, "/sales/calendar", "Sales calendar");
        await owner.page.locator('[data-k-nex-component="sales-calendar"][data-calendar-mode="agenda"]').waitFor();
      } finally {
        await owner.context.close();
      }
    } finally {
      await browser.close();
    }
  });
});
