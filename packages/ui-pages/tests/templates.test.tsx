import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BuilderPage, CreatePage, DashboardPage, DetailPage, EditPage, IndexPage, SettingsPage, WizardPage } from "../src/index.js";

describe("product page templates", () => {
  it("renders every template as a labelled compositional main region", () => {
    const templates = [DashboardPage, IndexPage, DetailPage, CreatePage, EditPage, SettingsPage, WizardPage, BuilderPage];
    for (const [index, Template] of templates.entries()) {
      const extra = Template === WizardPage ? { step: 1, stepCount: 3 } : {};
      const markup = renderToStaticMarkup(<Template templateId={`platform.page-${index}`} title="Page" {...extra}>Content</Template>);
      expect(markup).toContain("<main");
      expect(markup).toContain("<h1");
      expect(markup).toContain(`data-page-template-id="platform.page-${index}"`);
      expect(markup).toContain("Content");
    }
  });
});
