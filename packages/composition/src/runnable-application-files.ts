import type { SalesPresetTheme } from "./application-factory.js";

export interface RunnableApplicationFilesOptions {
  readonly applicationId: string;
  readonly applicationName: string;
  readonly database: "docker-postgres" | "external";
  readonly theme: SalesPresetTheme;
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

## Administration operator

Before starting this application, deploy the K-Nex administration operator as a separate private service. This repository does not generate or run that deployment-owned authority. Provision a client certificate whose URI SAN is bound to this application and environment, then set the \`K_NEX_ADMINISTRATION_OPERATOR_HOST\`, \`K_NEX_ADMINISTRATION_OPERATOR_PORT\`, \`K_NEX_ADMINISTRATION_OPERATOR_CLIENT_CERT\`, \`K_NEX_ADMINISTRATION_OPERATOR_CLIENT_KEY\`, \`K_NEX_ADMINISTRATION_OPERATOR_CA_CERT\`, \`K_NEX_ADMINISTRATION_OPERATOR_URI_SAN\`, and \`K_NEX_ADMINISTRATION_OPERATOR_IDENTITY\` values in \`.env\`. The operator must be reachable over mutual TLS at \`/v1/commands\` before extension operations can run. \`pnpm knex:doctor\` proves the configured endpoint accepts a connection and fails when it does not; the web process validates the configuration at startup but does not require the operator to be up to serve CRM work.

## Local development

Copy \`.env.example\` to \`.env\`, set every value, then run the steps in this order. \`knex:doctor\` reports readiness, which requires the schema, the owner, and a reachable administration operator, so it runs after those exist rather than before them:

\`\`\`bash
pnpm install --frozen-lockfile
pnpm build
${options.database === "docker-postgres" ? "pnpm knex:db:up\n" : ""}pnpm knex:migrate
pnpm knex:register-generation
pnpm knex:issue-bootstrap-token -- --output .k-nex-bootstrap-token
pnpm knex:bootstrap-owner -- --token-file .k-nex-bootstrap-token
pnpm knex:doctor
pnpm dev
\`\`\`

\`knex:register-generation\` records which Platform Plugin generation this image carries. Nothing else writes that record, and the Platform Plugin runtime projection stays empty without it: System Settings cannot resolve its descriptors, and the worker holds no execution fence, so it processes no reminders, notifications, exports, workflows, or provider delivery at all. It reads \`K_NEX_SOURCE_COMMIT\` and \`K_NEX_APPLICATION_DIGEST\` — the exact commit and application digest this image was built from. A container deployment should also set \`K_NEX_IMAGE_REFERENCE\` to the registry identity it was pulled from.

Running it again for the same image changes nothing. It refuses to record a *different* image under the same generation identity, because that identity is what fences workers and binds Platform Plugin authority: a changed image is a new generation, promoted by a deployment supervisor. This release does not ship that supervisor, so a rebuilt image is registered against a fresh database, not an existing one.

Run \`pnpm knex:worker\` alongside \`pnpm dev\`: reminders, notifications, exports, and provider delivery are processed by that worker, not by the web process. The worker takes the execution fence its generation owns and renews it while it runs; it refuses to process anything for a generation the deployment no longer serves.

## Communication providers

This release ships one bounded reference provider for email and calendar. \`K_NEX_REFERENCE_PROVIDER_ENDPOINT\` accepts only \`http://127.0.0.1/k-nex/reference-provider\`, and that endpoint is something you run: no SMTP, calendar, or third-party integration is included. Until a provider configuration is activated, the email and calendar actions fail closed with \`PROVIDER_UNAVAILABLE\` rather than accepting messages that cannot be delivered.

The endpoint you run is held to the \`k-nex.reference-provider.v1\` contract, and it is the only provider family this release admits. Nothing here can unsend a message, so the endpoint must (1) treat the \`idempotency-key\` header as a durable exactly-once key whose store survives a provider restart, (2) answer \`{"providerReceiptId","idempotencyKey","duplicate"}\` as JSON on every accepted send, (3) answer the same receipt for a request carrying \`x-k-nex-reconcile: 1\` and \`404\` when the key is unknown, so a worker that lost a response reconciles instead of sending twice, and (4) answer \`409\` when a key it already holds arrives with different bytes. The worker verifies that declaration before every effect, records the opaque receipt, and never holds a database lock across your call.

Outbound provider credentials and inbound webhook signing keys are separate slots with separate rotation. \`K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE\` and \`K_NEX_PROVIDER_SECRET_CALENDAR_REFERENCE\` authorize outbound calls only; \`K_NEX_WEBHOOK_SECRET_EMAIL_REFERENCE\` and \`K_NEX_WEBHOOK_SECRET_CALENDAR_REFERENCE\` verify inbound webhook signatures only. A reference minted for one purpose never resolves under the other, so losing an API credential does not grant webhook-forgery authority.

## Attachment upload receipts

Attachment bytes are admitted by host storage before a Sales attachment reference is created. A deployment/operator process with this application's database authority records one immutable receipt; browsers and Sales actions cannot issue receipts. After storage has durably accepted the exact bytes, issue the bounded receipt with the same application environment:

\`\`\`bash
pnpm knex:issue-attachment-upload-receipt -- \\
  --storage-ref storage/object-123 --uploader-actor-id user:123 \\
  --filename document.pdf --media-type application/pdf --byte-size 1024
\`\`\`

Reissuing identical facts is safe. A storage reference already bound to different application, environment, uploader, filename, media type, byte size, or receipt revision fails closed.

Production-mode check:

\`\`\`bash
pnpm build
pnpm start
\`\`\`
`,
    "src/app/(payload)/api/[...slug]/route.ts": `import config from "@payload-config";
import { REST_DELETE, REST_GET, REST_OPTIONS, REST_PATCH, REST_POST, REST_PUT } from "@payloadcms/next/routes";

import { bootKnexApplication } from "../../../../boot.js";
import { credentialAuthorityRefusal, credentialSensitiveRestMediaType, credentialSensitiveRestOperation, readCredentialSensitiveRestRequest, refusedCredentialRestOperation, withCredentialSensitiveRestAuthority } from "../../../../k-nex-authority.js";

type PayloadRestContext = Readonly<{ params: Promise<{ slug?: string[] }> }>;

const restPost = REST_POST(config);

function credentialRefusal(status: number, message: string): Response {
  return Response.json({ errors: [{ message }] }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Payload resolves the collection a path names by indexing a plain object with
 * the first segment, so the names every plain object inherits resolve to a
 * member of Object.prototype rather than to no collection at all. The request
 * then reads .config off that member and throws, and the error handler called
 * to report that throws again reading .config.hooks off the same member, so an
 * unauthenticated request answers 500 and leaves a stack trace where every
 * other name it could have written answers 404. No collection in this product
 * can be registered under one of those names, so a request that writes one
 * names nothing, and nothing is what this answers.
 */
const namesInheritedByEveryObject: ReadonlySet<string> = new Set(Object.getOwnPropertyNames(Object.prototype));

function unroutableCollection(request: Request, slug: readonly string[] | undefined): Response | undefined {
  const named = slug?.[0];
  if (named === undefined || !namesInheritedByEveryObject.has(named)) return undefined;
  return Response.json({ message: \`Route not found "\${new URL(request.url).pathname}"\` },
    { status: 404, headers: { "cache-control": "no-store" } });
}

function routedByCollection(handler: (request: Request, context: PayloadRestContext) => Promise<Response>) {
  return async function route(request: Request, context: PayloadRestContext): Promise<Response> {
    return unroutableCollection(request, (await context.params).slug) ?? handler(request, context);
  };
}

export const GET = routedByCollection(REST_GET(config));
export const DELETE = routedByCollection(REST_DELETE(config));
export const PATCH = routedByCollection(REST_PATCH(config));
export const PUT = routedByCollection(REST_PUT(config));
export const OPTIONS = routedByCollection(REST_OPTIONS(config));

/**
 * Payload verifies a password before it opens the transaction that writes the
 * session, builds that write out of the user document it read beforehand, and
 * builds a logout's session write out of a snapshot it read the same way, so an
 * ordinary sign-in can commit a session, and stale user fields with it, against
 * a credential an operator recovery already replaced, and a logout can write
 * the sessions that recovery revoked back over it. This route is ours, so the
 * delegated call is held inside the credential authority for the principal it
 * is deciding about, for the whole of the call rather than for its write. Every
 * other method and every other path is delegated untouched.
 *
 * This is the only surface the Payload auth operations are reachable from. The
 * GraphQL routes this product emits stand in front of the catch-all and answer
 * every method with a refusal, and the users collection is declared out of the
 * GraphQL schema as well.
 *
 * Both classifiers read the slug under the rule Payload will route it by rather
 * than as it was spelled, because Payload selects an endpoint by matching one
 * rather than by comparing it, and that matcher ignores case and one trailing
 * delimiter. A request therefore lands where its canonical spelling lands,
 * held under the authority or refused, and the operation carried into the
 * authority is the canonical one rather than the caller's spelling of it.
 */
export async function POST(request: Request, context: PayloadRestContext): Promise<Response> {
  const params = await context.params;
  const unroutable = unroutableCollection(request, params.slug);
  if (unroutable !== undefined) return unroutable;
  const refused = refusedCredentialRestOperation(params.slug);
  if (refused !== undefined) return credentialRefusal(403, refused);
  const operation = credentialSensitiveRestOperation(params.slug);
  if (operation === undefined) return restPost(request, context);
  let admitted: Awaited<ReturnType<typeof readCredentialSensitiveRestRequest>>;
  // Read before the authority is taken, and handed on as the bytes the client
  // sent: a body that trickles must not be able to hold every sign-in and every
  // credential change for this account behind it.
  try { admitted = await readCredentialSensitiveRestRequest(request); }
  catch { return credentialRefusal(400, "Request body was refused."); }
  // Refused before anything is looked up. Payload also parses multipart and
  // takes an operation's arguments from a _payload field, so a second
  // encoding is a second parse, and the account the authority keys on is only
  // the account the delegated call authenticates while there is just one.
  if (!credentialSensitiveRestMediaType(admitted)) {
    return credentialRefusal(415, "A credential operation is accepted as application/json only.");
  }
  const payload = await bootKnexApplication("credential-authority");
  try {
    return await withCredentialSensitiveRestAuthority(payload, operation, admitted, async (signal) => restPost(admitted.delegate(signal), context), request.signal);
  } catch (error) {
    const refusal = credentialAuthorityRefusal(error);
    return credentialRefusal(refusal.status, refusal.message);
  }
}
`,
    "src/app/(payload)/api/graphql/route.ts": `/**
 * Payload publishes auth mutations for every auth collection, and its GraphQL
 * resolvers call the same operations the credential authority exists to order.
 * Recognising those mutations would mean parsing the document, and a parser
 * that must be right about aliases, variables, fragments, batching and
 * multiple operations to stay safe is not a boundary. This product has no
 * GraphQL contract, so the endpoint answers nothing at all.
 */
const refused = () => Response.json({ errors: [{ message: "This application does not serve GraphQL." }] },
  { status: 404, headers: { "cache-control": "no-store" } });

export const GET = refused;
export const POST = refused;
export const PUT = refused;
export const PATCH = refused;
export const DELETE = refused;
export const OPTIONS = refused;
`,
    "src/app/(payload)/api/graphql-playground/route.ts": `/** A playground for an endpoint this product does not serve. */
const refused = () => Response.json({ errors: [{ message: "This application does not serve GraphQL." }] },
  { status: 404, headers: { "cache-control": "no-store" } });

export const GET = refused;
export const POST = refused;
`,
    "src/app/(workspace)/page.tsx": workspacePageSource(options.applicationName),
    "src/app/layout.tsx": workspaceLayoutSource(options.applicationName),
    // The workspace is laid out by the installed theme, which owns every
    // surface under its own root. This file is what the theme cannot reach:
    // the document itself, and the two screens shown before a theme resolves —
    // sign-in and the unauthenticated landing page. It deliberately repeats no
    // workspace rule, so the theme stays the only thing that decides how the
    // application looks once a session exists.
    "src/app/styles.css": `:root {
  color-scheme: light dark;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --k-nex-entry-surface: light-dark(#ffffff, #1a1a1a);
  --k-nex-entry-background: light-dark(#efeae0, #121212);
  --k-nex-entry-foreground: light-dark(#1b1a17, #ededed);
  --k-nex-entry-muted: light-dark(#6b6557, #8f8f8f);
  --k-nex-entry-border: light-dark(#ddd5c6, #2a2a2a);
  --k-nex-entry-accent: light-dark(#d1502a, #ff6b35);
  --k-nex-entry-accent-contrast: light-dark(#ffffff, #0f0f0f);
  --k-nex-entry-critical: light-dark(#b3261e, #f87171);
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100dvh; background: var(--k-nex-entry-background); color: var(--k-nex-entry-foreground); line-height: 1.5; }
.workspace-home {
  display: grid;
  align-content: center;
  justify-items: stretch;
  gap: 1rem;
  width: min(26rem, 100%);
  margin: 0 auto;
  padding: clamp(2rem, 8vh, 6rem) 1.5rem;
  min-height: 100dvh;
}
.workspace-home > form,
.workspace-home > :is(h1, p, button, section) { width: 100%; }
.workspace-home h1 { margin: 0; font-size: 1.75rem; line-height: 1.2; letter-spacing: -0.01em; }
.workspace-home > p { margin: 0; color: var(--k-nex-entry-muted); }
.eyebrow { margin: 0; color: var(--k-nex-entry-accent); font-size: .75rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
.workspace-home form {
  display: grid;
  gap: .75rem;
  padding: 1.5rem;
  background: var(--k-nex-entry-surface);
  border: 1px solid var(--k-nex-entry-border);
  border-radius: 12px;
  box-shadow: 0 1px 2px light-dark(#0000001f, #00000066);
}
.workspace-home label { font-size: .8125rem; font-weight: 600; }
.workspace-home input {
  width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  font: inherit;
  color: inherit;
  background: var(--k-nex-entry-surface);
  border: 1px solid var(--k-nex-entry-border);
  border-radius: 8px;
}
.workspace-home input:hover { border-color: var(--k-nex-entry-muted); }
.workspace-home button {
  min-height: 40px;
  margin-block-start: .25rem;
  padding: 0 16px;
  font: inherit;
  font-weight: 600;
  color: var(--k-nex-entry-accent-contrast);
  background: var(--k-nex-entry-accent);
  border: 1px solid var(--k-nex-entry-accent);
  border-radius: 8px;
  cursor: pointer;
}
.workspace-home button:hover { filter: brightness(.94); }
.workspace-home [aria-live] { margin: 0; min-height: 1.25rem; color: var(--k-nex-entry-critical); font-size: .8125rem; font-weight: 600; }
.workspace-home [aria-live]:empty { min-height: 0; }
a:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid var(--k-nex-entry-accent); outline-offset: 2px; }
@media (forced-colors: active) {
  .workspace-home form, .workspace-home input, .workspace-home button { border-color: CanvasText; }
}
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
import { shutdownKnexApplication } from "./k-nex-authority.js";

const payload = await bootKnexApplication("worker");
console.log("K_NEX_WORKER_READY");
await shutdownKnexApplication(payload);
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
