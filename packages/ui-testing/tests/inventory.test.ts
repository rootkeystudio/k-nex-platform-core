import { describe, expect, it } from "vitest";

import * as components from "@k-nex/ui-components";
import * as data from "@k-nex/ui-data";
import * as forms from "@k-nex/ui-forms";
import { componentInventory } from "@k-nex/ui-components";
import * as pages from "@k-nex/ui-pages";

describe("executable component inventory", () => {
  it("exports every Gallery and K-Nex inventory family from its declared package", () => {
    const packages: Readonly<Record<string, Record<string, unknown>>> = {
      "@k-nex/ui-components": components,
      "@k-nex/ui-data": data,
      "@k-nex/ui-forms": forms,
      "@k-nex/ui-pages": pages
    };
    expect(componentInventory.filter((entry) => packages[entry.packageTarget]?.[entry.name] === undefined).map(({ name }) => name)).toEqual([]);
    expect(componentInventory.filter(({ origin }) => origin === "component-gallery")).toHaveLength(60);
  });
});
