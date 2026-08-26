import * as z from "zod";
import { describe, expect, it } from "vitest";

import {
  UI_DOCUMENT_MAX_CANONICAL_BYTES,
  UiDocumentSchema,
  uiDocumentPlatformCeilings
} from "../src/index.js";

const sourceBinding = {
  source: { id: "sales.tasks", version: 1 },
  input: { status: "open" },
  structuralCompatibilityHash: `sha256:${"a".repeat(64)}`,
  selectedFields: ["title", "status"]
};

const validDocument = {
  id: "cms.home",
  version: 1,
  schemaVersion: 1,
  profile: "cms",
  regions: {
    main: [
      {
        id: "hero-1",
        type: "content.hero",
        version: 1,
        props: {
          heading: "Track every delivery",
          body: "A static CMS block with safe serializable content.",
          featureFlags: { compact: true, rank: 1 }
        },
        layout: {
          constraints: { canDelete: true, canMove: true },
          tokens: { spacing: "space.large", radius: "shape.rounded" }
        },
        engineMetadata: {
          "builder.visual": { zone: "main", revision: 2 }
        }
      },
      {
        id: "task-table-1",
        type: "sales.task-table",
        version: 2,
        props: { title: "Open tasks" },
        bindings: {
          source: sourceBinding,
          context: { id: "context.current-user", version: 1 }
        },
        children: [{
          id: "task-table-caption-1",
          type: "content.text",
          version: 1,
          props: { text: "Visible tasks respect the current actor." },
          bindings: { state: { id: "page.filters", version: 1 } }
        }]
      }
    ]
  }
} as const;

const parse = (value: unknown) => UiDocumentSchema.safeParse(value);

describe("P4.1 canonical UI documents", () => {
  it("accepts a CMS document with recursive nodes, bindings, layout, and namespaced engine metadata", () => {
    const result = parse(validDocument);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(validDocument);
  });

  it("accepts the workspace profile and rejects invalid document/profile versions", () => {
    expect(parse({ ...validDocument, profile: "workspace" }).success).toBe(true);
    for (const patch of [
      { profile: "public" },
      { version: 0 },
      { version: 1.5 },
      { schemaVersion: 2 }
    ]) expect(parse({ ...validDocument, ...patch }).success).toBe(false);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...validDocument.regions.main[0], id: "Hero-1" }] }
    }).success).toBe(false);
  });

  it("rejects unknown keys at closed contract boundaries", () => {
    expect(parse({ ...validDocument, unknown: true }).success).toBe(false);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...validDocument.regions.main[0], unknown: true }] }
    }).success).toBe(false);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...validDocument.regions.main[0], layout: { constraints: { style: "raw" } } }] }
    }).success).toBe(false);
  });

  it("requires globally unique node IDs, including across regions and descendants", () => {
    const duplicateRoot = {
      ...validDocument,
      regions: {
        main: validDocument.regions.main,
        sidebar: [{ ...validDocument.regions.main[0], id: "hero-1" }]
      }
    };
    expect(parse(duplicateRoot).success).toBe(false);
    expect(parse({
      ...validDocument,
      regions: {
        main: [{
          ...validDocument.regions.main[0],
          children: [{ ...validDocument.regions.main[0], id: "hero-1" }]
        }]
      }
    }).success).toBe(false);
  });

  it("rejects invalid bindings and duplicate or unsafe selected fields", () => {
    const node = validDocument.regions.main[1];
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...node, bindings: { source: { ...sourceBinding, source: { id: "not valid", version: 1 } } } }] }
    }).success).toBe(false);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...node, bindings: { source: { ...sourceBinding, selectedFields: ["title", "title"] } } }] }
    }).success).toBe(false);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...node, bindings: { source: sourceBinding, extra: true } }] }
    }).success).toBe(false);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...node, bindings: { source: { ...sourceBinding, input: { status: Number.NaN } } } }] }
    }).success).toBe(false);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...node, bindings: { source: { source: { id: "sales.total-potential-revenue", version: 1 }, input: {}, structuralCompatibilityHash: `sha256:${"a".repeat(64)}` } } }] }
    }).success).toBe(true);
  });

  it("requires a lowercase SHA-256 source compatibility hash", () => {
    const node = validDocument.regions.main[1];
    const missingHash = { ...sourceBinding };
    delete missingHash.structuralCompatibilityHash;
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...node, bindings: { source: missingHash } }] }
    }).success).toBe(false);

    for (const structuralCompatibilityHash of [
      "sha1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    ]) {
      expect(parse({
        ...validDocument,
        regions: { main: [{ ...node, bindings: { source: { ...sourceBinding, structuralCompatibilityHash } } }] }
      }).success).toBe(false);
    }
  });

  it("rejects non-JSON values and unsafe nested persisted keys", () => {
    const nonJsonValues = [
      { heading: Number.NaN },
      { heading: Number.POSITIVE_INFINITY },
      { heading: new Date() },
      { heading: 1n }
    ];
    for (const props of nonJsonValues) {
      expect(parse({
        ...validDocument,
        regions: { main: [{ ...validDocument.regions.main[0], props }] }
      }).success).toBe(false);
    }
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...validDocument.regions.main[0], props: { circular } }] }
    }).success).toBe(false);

    for (const unsafeKey of [
      "authorization",
      "secret",
      "auth",
      "cookie",
      "password",
      "token",
      "api-key",
      "credential",
      "private-note",
      "javascript",
      "js",
      "script",
      "function",
      "expression",
      "sql",
      "import",
      "package",
      "package-path",
      "module-path",
      "file-path",
      "url",
      "href",
      "src",
      "style",
      "styles",
      "className",
      "html",
      "css"
    ]) {
      expect(parse({
        ...validDocument,
        regions: { main: [{ ...validDocument.regions.main[0], props: { nested: { [unsafeKey]: "blocked" } } }] }
      }).success).toBe(false);
    }

    const safeProps = Object.fromEntries([
      "author",
      "authorizationStatus",
      "postalCode",
      "codeLabel",
      "dispatchPath"
    ].map((key) => [key, "allowed"]));
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...validDocument.regions.main[0], props: safeProps }] }
    }).success).toBe(true);
  });

  it("rejects unrestricted URL/style/SQL/package/JS fields and non-namespaced engine metadata", () => {
    for (const key of ["url", "style", "sql", "packagePath", "javascript"]) {
      expect(parse({
        ...validDocument,
        regions: { main: [{ ...validDocument.regions.main[0], props: { [key]: "unsafe" } }] }
      }).success).toBe(false);
    }
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...validDocument.regions.main[0], engineMetadata: { editor: { selected: true } } }] }
    }).success).toBe(false);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...validDocument.regions.main[0], props: { endpoint: "http://169.254.169.254/latest/meta-data" } }] }
    }).success).toBe(false);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...validDocument.regions.main[0], props: { apiSecretValue: "hidden" } }] }
    }).success).toBe(false);
    for (const unsafeProps of [
      { accessToken: "hidden" },
      { accessTokens: "hidden" },
      { refreshToken: "hidden" },
      { authHeader: "hidden" },
      { authenticationTokenValue: "hidden" },
      { cookies: "hidden" },
      { authorizations: "hidden" },
      { sessionIds: "hidden" },
      { oauthGrant: "hidden" },
      { endpoint: "wss://example.test/socket" },
      { endpoint: "custom+transport://example.test/resource" },
      { endpoint: "\u0000https://example.test/private" },
      { endpoint: "\u200bhttps://example.test/private" },
      { endpoint: "\u00adhttps://example.test/private" },
      { endpoint: "\u061chttps://example.test/private" },
      { endpoint: "\u180ehttps://example.test/private" },
      { endpoint: "\\https://example.test/private" },
      { endpoint: "/\\\\evil.example/x" }
    ]) {
      expect(parse({
        ...validDocument,
        regions: { main: [{ ...validDocument.regions.main[0], props: unsafeProps }] }
      }).success).toBe(false);
    }
    expect(parse({
      ...validDocument,
      regions: { props: [{ ...validDocument.regions.main[0], layout: { tokens: { spacing: "space.large" } } }] }
    }).success).toBe(true);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...validDocument.regions.main[0], props: { children: [{ layout: { tokens: "hidden" } }] } }] }
    }).success).toBe(false);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...validDocument.regions.main[0], engineMetadata: { "builder.visual": { url: "unsafe" } } }] }
    }).success).toBe(false);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...validDocument.regions.main[0], bindings: { action: { id: "sales.task.complete", version: 1 } } }] }
    }).success).toBe(false);
  });

  it("bounds depth, arrays, strings, and canonical document bytes", () => {
    let deepNode: Record<string, unknown> = { id: "deep-0", type: "content.text", version: 1, props: {} };
    for (let depth = 1; depth <= uiDocumentPlatformCeilings.nodeDepth + 1; depth += 1) {
      deepNode = {
        id: `deep-${depth}`,
        type: "layout.section",
        version: 1,
        props: {},
        children: [deepNode]
      };
    }
    expect(parse({ ...validDocument, regions: { main: [deepNode] } }).success).toBe(false);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...validDocument.regions.main[0], props: { values: Array(uiDocumentPlatformCeilings.jsonArrayItems + 1).fill(1) } }] }
    }).success).toBe(false);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...validDocument.regions.main[0], props: { value: "x".repeat(uiDocumentPlatformCeilings.stringLength + 1) } }] }
    }).success).toBe(false);

    const oversizedProps = Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`field-${index}`, "x".repeat(4_000)]));
    expect(UI_DOCUMENT_MAX_CANONICAL_BYTES).toBe(uiDocumentPlatformCeilings.canonicalBytes);
    expect(parse({
      ...validDocument,
      regions: { main: [{ ...validDocument.regions.main[0], props: oversizedProps }] }
    }).success).toBe(false);
  });

  it("clones parsed snapshots without mutating caller-owned nested JSON", () => {
    const input = structuredClone(validDocument);
    const result = parse(input);
    expect(result.success).toBe(true);
    if (!result.success) return;

    input.regions.main[0].props.featureFlags.compact = false;
    expect(result.data.regions.main[0].props.featureFlags).toEqual({ compact: true, rank: 1 });
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(result.data)).toBe(false);
  });

  it("emits a JSON Schema for the canonical document without editor-specific text", () => {
    const schema = z.toJSONSchema(UiDocumentSchema, {
      io: "input",
      reused: "ref",
      target: "draft-2020-12",
      unrepresentable: "throw"
    });
    expect(schema).toBeDefined();
    expect(JSON.stringify(schema)).not.toContain("Puck");
  });
});
