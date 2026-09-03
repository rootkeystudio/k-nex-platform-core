export interface RunnableApplicationFilesOptions {
  readonly applicationId: string;
  readonly applicationName: string;
  readonly database: "docker-postgres" | "external";
  readonly theme: "minimal" | "neobrutalism";
}

function workspaceLayoutSource(applicationName: string): string {
  return `import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./styles.css";

export const metadata: Metadata = {
  title: ${JSON.stringify(applicationName)},
  description: "K-Nex customer workspace"
};

export default function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
`;
}

function workspacePageSource(applicationName: string): string {
  return `export default function WorkspaceHome() {
  return <main className="workspace-home"><p className="eyebrow">K-Nex workspace</p><h1>${applicationName.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</h1><p>The application is ready for owner bootstrap.</p></main>;
}
`;
}

export function runnableApplicationFiles(options: RunnableApplicationFilesOptions): Readonly<Record<string, string>> {
  return {
    ".gitignore": ".env\n.k-nex-bootstrap-token\n.next\ndist\nnode_modules\n",
    "next-env.d.ts": "/// <reference types=\"next\" />\n/// <reference types=\"next/image-types/global\" />\n",
    "next.config.ts": `import { withPayload } from "@payloadcms/next/withPayload";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@k-nex/theme-${options.theme}"],
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  }
};

export default withPayload(nextConfig, { devBundleServerPackages: false });
`,
    "README.md": `# ${options.applicationName}

## Local development

Copy \`.env.example\` to \`.env\`, set every value, then run:

\`\`\`bash
pnpm install --frozen-lockfile
pnpm knex:doctor
${options.database === "docker-postgres" ? "pnpm knex:db:up\n" : ""}pnpm knex:migrate
pnpm knex:issue-bootstrap-token -- --output .k-nex-bootstrap-token
pnpm knex:bootstrap-owner -- --token-file .k-nex-bootstrap-token
pnpm dev
\`\`\`

Production-mode check:

\`\`\`bash
pnpm build
pnpm start
\`\`\`
`,
    "src/app/(payload)/api/[...slug]/route.ts": `import config from "@payload-config";
import { REST_DELETE, REST_GET, REST_OPTIONS, REST_PATCH, REST_POST, REST_PUT } from "@payloadcms/next/routes";

export const GET = REST_GET(config);
export const POST = REST_POST(config);
export const DELETE = REST_DELETE(config);
export const PATCH = REST_PATCH(config);
export const PUT = REST_PUT(config);
export const OPTIONS = REST_OPTIONS(config);
`,
    "src/app/(payload)/api/graphql/route.ts": `import config from "@payload-config";
import { GRAPHQL_POST, REST_OPTIONS } from "@payloadcms/next/routes";

export const POST = GRAPHQL_POST(config);
export const OPTIONS = REST_OPTIONS(config);
`,
    "src/app/(payload)/api/graphql-playground/route.ts": `import config from "@payload-config";
import { GRAPHQL_PLAYGROUND_GET } from "@payloadcms/next/routes";

export const GET = GRAPHQL_PLAYGROUND_GET(config);
`,
    "src/app/(workspace)/page.tsx": workspacePageSource(options.applicationName),
    "src/app/layout.tsx": workspaceLayoutSource(options.applicationName),
    "src/app/styles.css": `:root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: Canvas; color: CanvasText; }
.workspace-home { margin: 0 auto; max-width: 64rem; padding: 5rem 2rem; }
.eyebrow { color: LinkText; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
h1 { font-size: clamp(2rem, 7vw, 4.5rem); margin: .25rem 0 1rem; }
.workspace-shell { display: grid; grid-template-columns: 17rem minmax(0, 1fr); grid-template-rows: auto 1fr; min-height: 100vh; }
.workspace-shell[data-sidebar="collapsed"] { grid-template-columns: 4rem minmax(0, 1fr); }
.workspace-sidebar { border-inline-end: 1px solid GrayText; grid-row: 1 / -1; min-width: 0; padding: 1rem; }
.workspace-shell[data-sidebar="collapsed"] .workspace-brand, .workspace-shell[data-sidebar="collapsed"] .workspace-desktop-navigation { display: none; }
.workspace-brand { display: grid; gap: .25rem; margin-block-end: 1rem; overflow-wrap: anywhere; }
.workspace-header { align-items: center; border-block-end: 1px solid GrayText; display: flex; gap: 1rem; justify-content: space-between; min-width: 0; padding: .75rem 1rem; }
.workspace-header ol { display: flex; flex-wrap: wrap; gap: .5rem; list-style: none; margin: 0; padding: 0; }
.workspace-header li + li::before { content: "/"; margin-inline-end: .5rem; }
.workspace-environment { border: 1px solid currentColor; border-radius: 999px; padding: .2rem .6rem; }
.workspace-sidebar ul, .workspace-drawer ul { list-style: none; margin: 0; padding-inline-start: 1rem; }
.workspace-sidebar > .workspace-desktop-navigation > nav > ul, .workspace-drawer nav > ul { padding-inline-start: 0; }
.workspace-sidebar li, .workspace-drawer li { margin-block: .35rem; min-width: 0; overflow-wrap: anywhere; }
.workspace-sidebar [data-navigation-label], .workspace-drawer [data-navigation-label] { display: block; font-weight: 700; margin-block-start: 1rem; }
.workspace-skip-link { inset-block-start: .5rem; inset-inline-start: -100vw; position: fixed; z-index: 1000; }
.workspace-skip-link:focus { background: Canvas; inset-inline-start: .5rem; padding: .5rem; }
.workspace-mobile-trigger { display: none; }
.workspace-drawer-overlay { background: color-mix(in srgb, CanvasText 45%, transparent); inset: 0; position: fixed; z-index: 100; }
.workspace-drawer { background: Canvas; block-size: 100%; inline-size: min(22rem, 90vw); inset-block: 0; inset-inline-start: 0; overflow: auto; padding: 1rem; position: fixed; }
.workspace-drawer-heading { align-items: center; display: flex; justify-content: space-between; }
a:focus-visible, button:focus-visible { outline: 3px solid Highlight; outline-offset: 3px; }
@media (max-width: 48rem) { .workspace-shell, .workspace-shell[data-sidebar="collapsed"] { display: block; } .workspace-sidebar { display: none; } .workspace-mobile-trigger { display: inline-flex; } }
@media (prefers-reduced-motion: no-preference) { .workspace-shell { transition: grid-template-columns 160ms ease; } }
@media (forced-colors: active) { .workspace-sidebar, .workspace-header, .workspace-environment { border-color: CanvasText; } }
`,
    "src/app/api/health/route.ts": `export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ schemaVersion: 1, status: "alive" }, { headers: { "cache-control": "no-store" } });
}
`,
    "src/app/api/readiness/route.ts": `import { bootKnexApplication } from "../../../boot.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await bootKnexApplication("readiness");
    return Response.json({ schemaVersion: 1, status: "ready", applicationId: payload.config.custom.kNexApplicationId }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ schemaVersion: 1, status: "not-ready" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
`,
    "src/k-nex-doctor.ts": `import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";

const missing = ["DATABASE_URL", "PAYLOAD_SECRET", "K_NEX_ENVIRONMENT", "K_NEX_PUBLIC_ORIGIN"].filter((name) => !process.env[name]);
if (process.versions.node.split(".")[0] !== "24" || missing.length > 0 || kNexSalesRegistry.registration.pluginId !== "module.sales" || !kNexIdentity.applicationId) {
  throw new Error(\`K-Nex doctor failed: \${missing.length} required environment names are unset.\`);
}
console.log("K_NEX_DOCTOR_PASS");
`,
    "src/k-nex-worker.ts": `import { bootKnexApplication } from "./boot.js";

const payload = await bootKnexApplication("worker");
console.log("K_NEX_WORKER_READY");
await payload.destroy();
`,
    "src/k-nex-bootstrap-owner.ts": `if (!process.env.K_NEX_BOOTSTRAP_TOKEN) throw new Error("K_NEX_BOOTSTRAP_TOKEN is required.");
throw new Error("Run migrations before owner bootstrap; secure owner persistence is installed by the application authorization layer.");
`,
    "src/tests/generated-application.test.ts": `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generated application keeps its exact identity and fixed runtime", async () => {
  const application = JSON.parse(await readFile(new URL("../../k-nex.app.json", import.meta.url), "utf8"));
  assert.equal(application.application.id, ${JSON.stringify(options.applicationId)});
  assert.equal(application.runtime.node, "24.19.0");
});
`,
    "tsconfig.scripts.json": `{
  "extends": "./tsconfig.json",
  "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext", "noEmit": false, "outDir": "dist", "rootDir": "src" },
  "include": ["src/boot.ts", "src/k-nex-*.ts", "src/migrations/**/*.ts", "src/payload.config.ts", "src/tests/**/*.ts"]
}
`,
    "tsconfig.json": `{
  "compilerOptions": {
    "allowJs": true,
    "esModuleInterop": true,
    "incremental": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "paths": { "@/*": ["./src/*"], "@payload-config": ["./src/payload.config.ts"] },
    "plugins": [{ "name": "next" }],
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2022"
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`
  };
}
