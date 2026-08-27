import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  KNeXDesignSystemProvider,
  createSemanticPrimitives,
  reactAriaPrimitives,
  semanticPrimitiveNames,
  useDesignSystem,
  type CardProps
} from "../src/index.js";

describe("semantic primitive ABI", () => {
  it("exports exactly the accepted small V1 primitive set", () => {
    expect(semanticPrimitiveNames).toEqual([
      "Box", "Stack", "Inline", "Grid", "Container",
      "Text", "Heading", "Link",
      "Button", "IconButton",
      "Card", "Badge", "Status",
      "Input", "Textarea", "Select", "Checkbox", "FormField",
      "Dialog", "Popover", "Tooltip",
      "Toast", "Skeleton", "EmptyState", "ErrorState",
      "Table", "Pagination"
    ]);
    expect(Object.keys(reactAriaPrimitives).sort()).toEqual([...semanticPrimitiveNames].sort());
    expect(Object.isFrozen(reactAriaPrimitives)).toBe(true);
    expect("DataGrid" in reactAriaPrimitives).toBe(false);
    expect("DatePicker" in reactAriaPrimitives).toBe(false);
    expect("Chart" in reactAriaPrimitives).toBe(false);
  });

  it("supports one typed theme override without changing the base behavior map", () => {
    function ThemeCard({ children }: CardProps) {
      return <article data-theme-card="minimal">{children}</article>;
    }
    const themed = createSemanticPrimitives({ Card: ThemeCard });
    function Fixture() {
      const { Card, Heading } = useDesignSystem();
      return <Card><Heading level={2}>Summary</Heading></Card>;
    }
    const markup = renderToStaticMarkup(<KNeXDesignSystemProvider primitives={themed}><Fixture /></KNeXDesignSystemProvider>);
    expect(markup).toContain('data-theme-card="minimal"');
    expect(markup).toContain("<h2");
    expect(themed.Card).toBe(ThemeCard);
    expect(reactAriaPrimitives.Card).not.toBe(ThemeCard);
    expect(Object.isFrozen(themed)).toBe(true);
  });

  it("renders semantic names, field state, table structure, and feedback roles", () => {
    const P = reactAriaPrimitives;
    const markup = renderToStaticMarkup(<P.Stack>
      <P.Box><P.Container><P.Inline><P.Text>Account</P.Text><P.Badge>New</P.Badge></P.Inline></P.Container></P.Box>
      <P.Grid columns={2}><P.Card><P.Heading level={1}>Account</P.Heading></P.Card></P.Grid>
      <P.Link href="/account">Account link</P.Link>
      <P.Button>Save</P.Button>
      <P.IconButton label="Open settings" icon={<span aria-hidden="true">⚙</span>} />
      <P.Input label="Email" type="email" description="Work address" error="Required" />
      <P.Textarea label="Notes" />
      <P.Select label="Priority" options={[{ id: "normal", label: "Normal" }]} />
      <P.Checkbox>Subscribe</P.Checkbox>
      <P.FormField legend="Preferences"><P.Checkbox>Digest</P.Checkbox></P.FormField>
      <P.Dialog title="Confirm" triggerLabel="Open confirmation">Proceed?</P.Dialog>
      <P.Popover label="Details" triggerLabel="Show details">Details</P.Popover>
      <P.Tooltip triggerLabel="Help">Helpful text</P.Tooltip>
      <P.Table
        label="People"
        columns={[{ id: "name", label: "Name", isRowHeader: true }, { id: "role", label: "Role" }]}
        rows={[{ id: "one", cells: { name: "Ada", role: "Admin" } }]}
      />
      <P.Pagination label="People pages" currentPage={1} totalPages={2} onChange={() => undefined} />
      <P.Status>Saved</P.Status>
      <P.Toast>Updated</P.Toast>
      <P.Skeleton label="Loading account" />
      <P.EmptyState title="No records" />
      <P.ErrorState title="Unavailable" code="UI_001" />
    </P.Stack>);
    expect(markup).toContain("<h1");
    expect(markup).toContain('aria-label="Open settings"');
    expect(markup).toContain(">Email</label>");
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-label="People"');
    expect(markup).toContain('scope="row"');
    expect(markup).toContain('aria-label="People pages"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('role="alert"');
  });
});
