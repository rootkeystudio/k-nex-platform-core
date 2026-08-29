import { describe, expect, it } from "vitest";

import { resolveHotApplicationNavigation, resolveHotApplicationRoute, resolveHotApplicationSlot } from "../src/hot-application-surfaces.js";

const registration = {
  appId: "app.sales-assistant", generationId: "sales-generation-1", active: true,
  routes: ["/apps/sales-assistant", "/apps/sales-assistant/tasks"],
  navigation: [{ id: "sales.assistant", title: "Sales assistant", route: "/apps/sales-assistant" }],
  slots: [{ slotId: "sales.task-detail", contributionId: "sales.assistant-summary" }]
};

describe("fixed Hot Application surfaces", () => {
  it("resolves active routes, navigation, and extension slots without runtime route injection", () => {
    expect(resolveHotApplicationRoute("/apps/sales-assistant", [registration])).toEqual({ appId: registration.appId, generationId: registration.generationId, route: "/apps/sales-assistant" });
    expect(resolveHotApplicationNavigation([registration])).toEqual([{ appId: registration.appId, ...registration.navigation[0] }]);
    expect(resolveHotApplicationSlot("sales.task-detail", [registration])).toEqual([{ appId: registration.appId, generationId: registration.generationId, contributionId: "sales.assistant-summary" }]);
  });

  it("rejects traversal, inactive routes, and ambiguous ownership", () => {
    expect(() => resolveHotApplicationRoute("/apps/sales-assistant/../admin", [registration])).toThrow();
    expect(() => resolveHotApplicationRoute("/apps/sales-assistant", [{ ...registration, active: false }])).toThrow();
    expect(() => resolveHotApplicationRoute("/apps/sales-assistant", [registration, { ...registration, appId: "app.other" }])).toThrow();
  });
});
