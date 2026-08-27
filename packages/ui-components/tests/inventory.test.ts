import { describe, expect, it } from "vitest";

import {
  componentContractSchemaVersion,
  componentDataAttributes,
  componentInventory,
  componentMaturityRules,
  componentPackageBoundaries,
  componentSlotPattern,
  componentVersionRules,
  validateComponentInventory
} from "../src/index.js";

describe("component inventory contract", () => {
  it("freezes all 60 Component Gallery families plus the K-Nex utility inventory", () => {
    const gallery = componentInventory.filter((item) => item.origin === "component-gallery");
    expect(gallery).toHaveLength(60);
    expect(componentInventory.length).toBeGreaterThan(60);
    expect(new Set(gallery.map((item) => item.name))).toHaveProperty("size", 60);
    expect(componentInventory.every((item) => item.owner === "k-nex-platform" && item.testClasses.length > 0)).toBe(true);
    expect(() => validateComponentInventory()).not.toThrow();
  });

  it("assigns every family to an ordered Phase 7 delivery task and package", () => {
    expect(componentInventory.every((item) => /^P7\.[2-7]$/.test(item.deliveryTask))).toBe(true);
    expect(componentInventory.find((item) => item.name === "DataTable")).toMatchObject({ packageTarget: "@k-nex/ui-data", behaviorSource: "tanstack-table-adapter", deliveryTask: "P7.6" });
    expect(componentInventory.find((item) => item.name === "FormField")).toMatchObject({ packageTarget: "@k-nex/ui-forms", deliveryTask: "P7.3" });
    expect(componentInventory.find((item) => item.name === "DashboardPage")).toMatchObject({ packageTarget: "@k-nex/ui-pages", deliveryTask: "P7.7" });
  });

  it("publishes stable owned slots and library-neutral data attributes", () => {
    expect(componentContractSchemaVersion).toBe(1);
    expect(componentDataAttributes).toEqual({ component: "data-k-nex-component", slot: "data-slot", state: "data-state" });
    expect(componentInventory.flatMap((item) => item.slots).every((slot) => componentSlotPattern.test(slot))).toBe(true);
    expect(componentInventory.find((item) => item.name === "DataTable")?.slots).toContain("component.data-table.sort-trigger");
  });

  it("keeps the theme ABI below compound behavior packages", () => {
    expect(componentPackageBoundaries["@k-nex/ui-design-system-contracts"].mayImport).toEqual(["@k-nex/contracts"]);
    expect(componentPackageBoundaries["@k-nex/ui-design-system-contracts"].mayImport).not.toContain("@k-nex/ui-components");
    expect(componentPackageBoundaries["@k-nex/ui-components"].mayImport).toEqual(["@k-nex/ui-design-system-contracts"]);
  });

  it("defines explicit pre-v1 maturity and version rules", () => {
    expect(Object.keys(componentMaturityRules)).toEqual(["experimental", "reference", "stable-pre-v1"]);
    expect(Object.keys(componentVersionRules)).toEqual(["patch", "minor", "major"]);
    expect(Object.isFrozen(componentInventory)).toBe(true);
    expect(Object.isFrozen(componentInventory[0])).toBe(true);
  });

  it("fails closed for incomplete, duplicate, or foreign-owned inventory", () => {
    expect(() => validateComponentInventory(componentInventory.slice(1))).toThrow(/exactly 60/);
    expect(() => validateComponentInventory([...componentInventory, componentInventory[0]!])).toThrow(/exactly 60|Duplicate/);
    expect(() => validateComponentInventory(componentInventory.map((item, index) => index === 0 ? { ...item, owner: "plugin" as never } : item))).toThrow(/platform-owned/);
  });
});
