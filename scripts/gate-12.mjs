import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fixture = resolve(root, "fixtures/customer-gate-1");
const read = (path) => readFileSync(resolve(root, path), "utf8");

assert.equal(process.versions.node, "24.19.0", `Gate 12 requires Node 24.19.0; found ${process.versions.node}.`);
assert.deepEqual(
  readdirSync(resolve(root, "modules"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
  ["sales"],
  "Sales must remain the only first-party reference domain module through Gate 12."
);

function run(label, command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.error, undefined, `${label} could not start: ${result.error?.message}`);
  assert.equal(result.status, 0, `${label} failed:\n${result.stderr || result.stdout}`);
  return `${result.stdout}\n${result.stderr}`;
}

const builds = [
  "@k-nex/contracts", "@k-nex/runtime", "@k-nex/ui-runtime", "@k-nex/ui-components", "@k-nex/ui-data", "@k-nex/ui-forms",
  "@k-nex/builder-puck", "@k-nex/ui-builder-blocks", "@k-nex/payload-adapter", "@k-nex/ui-pages", "@k-nex/module-sales", "@k-nex/composition"
];
for (const workspace of builds) run(`${workspace} build`, "pnpm", ["--filter", workspace, "build"]);
run("customer fixture build", "pnpm", ["--filter", "@k-nex/customer-gate-1", "build"]);
run("packed v1 closure", process.execPath, ["scripts/check-phase-8-packed-packages.mjs"]);
run("factory lock generation check", process.execPath, ["scripts/generate-phase-12-factory-locks.mjs", "--check"]);

const passedProofs = new Set();
function vitest(id, workspace, files, selected) {
  const output = run(id, "pnpm", ["--filter", workspace, "exec", "vitest", "run", ...files, "--reporter=json"]);
  const report = JSON.parse(output.trim());
  assert.equal(report.success, true, `${id} reported failure.`);
  assert.equal(report.numFailedTests, 0, `${id} reported failed tests.`);
  const passed = report.testResults.flatMap((result) => result.assertionResults).filter((entry) => entry.status === "passed").map((entry) => entry.title);
  for (const name of selected) {
    assert.equal(passed.filter((actual) => actual === name).length, 1, `${id} omitted ${name}.`);
    passedProofs.add(`unit:${id}:${name}`);
  }
  return { id, passed: report.numPassedTests, selected: selected.length };
}

const unitProofs = [
  vitest("contracts", "@k-nex/contracts", ["tests/package-release-manifest.test.ts", "tests/workspace-page.test.ts", "tests/ui-document.test.ts"], [
    "binds exactly the two content-addressed Sales factory lock templates",
    "freezes the exact fixed route classes without browser-authored paths",
    "accepts one closed server-produced shell and rejects foreign navigation identity",
    "rejects duplicate, cyclic, missing-parent, cross-owner, and System-shadowing navigation",
    "separates page ACL from platform and block data authority",
    "binds mutable working copies and immutable publications to one page/document identity",
    "keeps browser autosave input free of application, environment, ACL, route, and executable authority",
    "keeps generated envelope semantics and all 22 attack IDs closed and unique",
    "rejects unrestricted URL/style/SQL/package/JS fields and non-namespaced engine metadata",
    "bounds depth, arrays, strings, and canonical document bytes"
  ]),
  vitest("navigation", "@k-nex/ui-runtime", ["tests/workspace-navigation.test.ts"], [
    "resolves only implemented System routes and keeps Sales as a customer-page parent",
    "keeps an empty customer-page parent without synthesizing a plugin route",
    "omits unauthorized links, routes, descendants, and shortcuts before serialization",
    "rejects invalid or duplicate implemented System IDs alongside invalid graphs"
  ]),
  vitest("shell", "@k-nex/ui-components", ["tests/workspace-shell.test.tsx"], [
    "server-renders only resolved navigation with shell, skip-link, breadcrumb, and collapse semantics"
  ]),
  vitest("administration", "@k-nex/ui-pages", ["tests/system-administration.test.tsx"], [
    "renders the sixteen fixed administration routes from server-produced view models",
    "renders server-projected native POST forms without client authority fields",
    "escapes workspace page titles and descriptions as text"
  ]),
  vitest("generic-blocks", "@k-nex/ui-builder-blocks", ["tests/library.test.ts"], [
    "escapes persisted text props in editor preview and production output"
  ]),
  vitest("rich-text", "@k-nex/ui-data", ["tests/rich-text.test.tsx"], [
    "renders validated structured content without an HTML injection surface",
    "rejects script URLs, arbitrary fields, duplicate marks, and unknown nodes"
  ]),
  vitest("builder", "@k-nex/builder-puck", ["tests/adapter.test.ts", "tests/profile.test.ts"], [
    "builds the palette only from current exact block, source, and action authority",
    "rejects protected insertion values and region or ancestor movement of immovable nodes",
    "preserves every region outside the configured Puck canvas exactly"
  ]),
  vitest("page-service", "@k-nex/payload-adapter", ["tests/workspace-page-service.test.ts", "tests/workspace-navigation-store.test.ts"], [
    "returns the same non-enumerating denial for missing and unauthorized direct pages",
    "derives page, placement, theme, actor, and document identity on the server",
    "denies non-owner ACL expansion beyond the editor's exact held capability",
    "cancels pending editor work after page-access invalidation",
    "re-reads impact after a lost invalidation and rejects stale generation resurrection",
    "requires current publish authority and fresh ready dependencies before storage",
    "fails closed before page or pointer mutation and store rollback for missing or dependency-unavailable target revisions",
    "derives publication and rollback identities, authority digest, and dependencies server-side",
    "rejects plugin-owned folders, links, invalid actors, and invalid scope before SQL"
  ]),
  vitest("generator", "@k-nex/composition", ["tests/application-factory.test.ts", "tests/workspace-page-application-files.test.ts"], [
    "plans deterministic exact Sales applications for local or external Postgres",
    "binds a generated application to every exact artifact in a packed release mirror",
    "rejects tampered mirrors and installs immutable bytes captured by the verified plan",
    "uses workspace only for side-effect-free planning and defaults to the verified bundled release",
    "rejects a coherently forged manifest, tarball, and lock before target write",
    "rejects nonofficial hosted workflow and source identities before target write",
    "applies idempotently and refuses to overwrite customer files",
    "writes byte-identical controlled source to different clean targets",
    "preflights every destination and never partially writes or follows symlinks",
    "routes every generated workspace Sales source through the current-authority gateway"
  ]),
  vitest("sales-builder", "@k-nex/module-sales", ["tests/puck-library.test.ts"], [
    "rejects missing blocks and unauthorized action replacement",
    "inserts the Kanban with its trusted existing source and action bindings"
  ])
];

const salesTap = run("Sales source/action/UI proofs", process.execPath, ["--test", "tests/server.test.mjs", "tests/ui.test.mjs"], resolve(root, "modules/sales"));
for (const name of [
  "the opportunities source returns bounded canonical rows",
  "Sales update actions use actor-scoped Payload updates exactly once",
  "Sales rejects a stale opportunity card without a blind update",
  "Sales Kanban exposes native pointer and keyboard stage controls only with exact action authority"
]) {
  assert.match(salesTap, new RegExp(`^✔ ${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "mu"), `Sales evidence omitted ${name}.`);
  passedProofs.add(`sales:${name}`);
}

const processTap = run("Phase 12 PostgreSQL/HTTP/Chromium proofs", process.execPath, [
  "--test", "--test-force-exit", "--test-concurrency=1", "--test-reporter=tap",
  "tests/workspace-page-storage-postgres.test.mjs", "tests/generated-runnable-application-postgres.test.mjs"
], fixture);
assert.equal(Number(/^# pass (\d+)$/mu.exec(processTap)?.[1]), 2, "Phase 12 process proofs must pass exactly two tests.");
const processMarkers = [
  "P12_5_WORKSPACE_STORAGE_POSTGRES_EVIDENCE=PASS",
  "P12_9_GENERATED_APP_POSTGRES_HTTP_CHROMIUM_EVIDENCE=PASS",
  "P12_ATK_02_CROSS_CUSTOMER_READ_POSTGRES_DENIED=PASS",
  "P12_ATK_05_UNAUTHORIZED_DIRECT_URL_AND_ENUMERATION_HTTP_DENIED=PASS",
  "P12_ATK_08_STALE_AUTOSAVE_CAS_POSTGRES_DENIED=PASS",
  "P12_ATK_09_CHANGED_IDEMPOTENCY_PAYLOAD_POSTGRES_DENIED=PASS",
  "P12_ATK_10_CSRF_REPLAY_AND_MALFORMED_AUTOSAVE_HTTP_DENIED=PASS",
  "P12_ATK_01_PROTECTED_SHELL_HTTP_POSTGRES_DENIED=PASS",
  "P12_ATK_11_UNSAFE_PROPS_HTTP_POSTGRES_DENIED=PASS",
  "P12_ATK_12_SOURCE_SUBSTITUTION_HTTP_POSTGRES_DENIED=PASS",
  "P12_ATK_12_PUBLISH_DOCUMENT_HTTP_POSTGRES_DENIED=PASS",
  "P12_ATK_12_PUBLISH_REVISION_HTTP_POSTGRES_DENIED=PASS",
  "P12_ATK_13_ACTION_SUBSTITUTION_HTTP_POSTGRES_DENIED=PASS",
  "P12_ATK_07_PAGE_ACL_ONLY_SALES_ACTION_HTTP_POSTGRES_DENIED=PASS",
  "P12_ATK_07_PAGE_ACL_ONLY_SALES_SOURCE_AND_RECORD_HTTP_POSTGRES_DENIED=PASS",
  "P12_ATK_07_PAGE_ACL_ONLY_SALES_FIELD_HTTP_POSTGRES_DENIED=PASS",
  "P12_ATK_13_UNBOUND_ACTION_HTTP_POSTGRES_DENIED=PASS",
  "P12_ATK_13_CROSS_PAGE_ACTION_HTTP_POSTGRES_DENIED=PASS",
  "P12_ATK_13_REVOKED_PAGE_ACTION_HTTP_POSTGRES_DENIED=PASS",
  "P12_ATK_16_IMMUTABLE_HISTORY_POSTGRES_DENIED=PASS",
  "P12_ATK_18_FAILED_TRANSACTION_AUDIT_OUTBOX_LEAKAGE_POSTGRES_DENIED=PASS",
  "P12_ATK_18_AUDIT_OUTBOX_SECRET_LEAKAGE_POSTGRES_DENIED=PASS",
  "P12_ATK_18_GENERATED_HTML_AND_WORKER_SECRET_LEAKAGE_DENIED=PASS",
  "P12_BOOTSTRAP_CRASH_PROTECTED_OWNER_RECOVERY=PASS",
  "P12_BOOTSTRAP_CRASH_SALES_AUTHORITY_RECOVERY=PASS",
  "P12_BOOTSTRAP_CRASH_TOKEN_CONSUMPTION_RECOVERY=PASS",
  "P12_ATK_19_BOOTSTRAP_SCOPE_AND_REPLAY_POSTGRES_DENIED=PASS",
  "P12_QUERY_BUDGET_PROCESS_LIFETIME_HTTP_RATE_AND_CONCURRENCY=PASS",
  "P12_ATK_20_REVOKED_AUTOSAVE_POSTGRES_DENIED=PASS",
  "P12_ATK_20_OPEN_PAGE_AND_EDITOR_SALES_AUTHORITY_REVOCATION_POSTGRES_HTTP_CHROMIUM_DENIED=PASS",
  "P12_ATK_20_REVOKED_STALE_PUBLISH_AND_LOST_INVALIDATION_DENIED=PASS"
];
for (const marker of processMarkers) {
  assert.match(processTap, new RegExp(`^# ${marker}$`, "mu"), `Missing ${marker}.`);
  passedProofs.add(`process:${marker}`);
}

const { phase12AttackMap } = await import("../packages/contracts/dist/index.js");
const attackProofs = {
  "P12-ATK-01": ["unit:contracts:keeps browser autosave input free of application, environment, ACL, route, and executable authority", "unit:contracts:rejects unrestricted URL/style/SQL/package/JS fields and non-namespaced engine metadata", "process:P12_ATK_01_PROTECTED_SHELL_HTTP_POSTGRES_DENIED=PASS"],
  "P12-ATK-02": ["unit:contracts:binds mutable working copies and immutable publications to one page/document identity", "unit:page-service:derives page, placement, theme, actor, and document identity on the server", "process:P12_ATK_02_CROSS_CUSTOMER_READ_POSTGRES_DENIED=PASS"],
  "P12-ATK-03": ["unit:contracts:rejects duplicate, cyclic, missing-parent, cross-owner, and System-shadowing navigation"],
  "P12-ATK-04": ["unit:navigation:rejects invalid or duplicate implemented System IDs alongside invalid graphs"],
  "P12-ATK-05": ["unit:page-service:returns the same non-enumerating denial for missing and unauthorized direct pages", "process:P12_ATK_05_UNAUTHORIZED_DIRECT_URL_AND_ENUMERATION_HTTP_DENIED=PASS"],
  "P12-ATK-06": ["unit:page-service:denies non-owner ACL expansion beyond the editor's exact held capability"],
  "P12-ATK-07": ["process:P12_ATK_07_PAGE_ACL_ONLY_SALES_ACTION_HTTP_POSTGRES_DENIED=PASS", "process:P12_ATK_07_PAGE_ACL_ONLY_SALES_SOURCE_AND_RECORD_HTTP_POSTGRES_DENIED=PASS", "process:P12_ATK_07_PAGE_ACL_ONLY_SALES_FIELD_HTTP_POSTGRES_DENIED=PASS"],
  "P12-ATK-08": ["process:P12_ATK_08_STALE_AUTOSAVE_CAS_POSTGRES_DENIED=PASS"],
  "P12-ATK-09": ["process:P12_ATK_09_CHANGED_IDEMPOTENCY_PAYLOAD_POSTGRES_DENIED=PASS"],
  "P12-ATK-10": ["unit:contracts:bounds depth, arrays, strings, and canonical document bytes", "process:P12_ATK_10_CSRF_REPLAY_AND_MALFORMED_AUTOSAVE_HTTP_DENIED=PASS"],
  "P12-ATK-11": [
    "unit:contracts:rejects unrestricted URL/style/SQL/package/JS fields and non-namespaced engine metadata",
    "unit:administration:escapes workspace page titles and descriptions as text",
    "unit:generic-blocks:escapes persisted text props in editor preview and production output",
    "unit:rich-text:renders validated structured content without an HTML injection surface",
    "unit:rich-text:rejects script URLs, arbitrary fields, duplicate marks, and unknown nodes",
    "process:P12_ATK_11_UNSAFE_PROPS_HTTP_POSTGRES_DENIED=PASS"
  ],
  "P12-ATK-12": ["process:P12_ATK_12_SOURCE_SUBSTITUTION_HTTP_POSTGRES_DENIED=PASS", "process:P12_ATK_12_PUBLISH_DOCUMENT_HTTP_POSTGRES_DENIED=PASS", "process:P12_ATK_12_PUBLISH_REVISION_HTTP_POSTGRES_DENIED=PASS"],
  "P12-ATK-13": ["sales:Sales rejects a stale opportunity card without a blind update", "unit:sales-builder:rejects missing blocks and unauthorized action replacement", "unit:sales-builder:inserts the Kanban with its trusted existing source and action bindings", "process:P12_ATK_12_SOURCE_SUBSTITUTION_HTTP_POSTGRES_DENIED=PASS", "process:P12_ATK_13_ACTION_SUBSTITUTION_HTTP_POSTGRES_DENIED=PASS", "process:P12_ATK_13_UNBOUND_ACTION_HTTP_POSTGRES_DENIED=PASS", "process:P12_ATK_13_CROSS_PAGE_ACTION_HTTP_POSTGRES_DENIED=PASS", "process:P12_ATK_13_REVOKED_PAGE_ACTION_HTTP_POSTGRES_DENIED=PASS"],
  "P12-ATK-14": ["unit:page-service:re-reads impact after a lost invalidation and rejects stale generation resurrection"],
  "P12-ATK-15": ["unit:page-service:requires current publish authority and fresh ready dependencies before storage"],
  "P12-ATK-16": ["unit:page-service:fails closed before page or pointer mutation and store rollback for missing or dependency-unavailable target revisions"],
  "P12-ATK-17": ["unit:generator:plans deterministic exact Sales applications for local or external Postgres"],
  "P12-ATK-18": ["unit:administration:renders server-projected native POST forms without client authority fields", "process:P12_ATK_18_FAILED_TRANSACTION_AUDIT_OUTBOX_LEAKAGE_POSTGRES_DENIED=PASS", "process:P12_ATK_18_AUDIT_OUTBOX_SECRET_LEAKAGE_POSTGRES_DENIED=PASS", "process:P12_ATK_18_GENERATED_HTML_AND_WORKER_SECRET_LEAKAGE_DENIED=PASS"],
  "P12-ATK-19": ["process:P12_BOOTSTRAP_CRASH_PROTECTED_OWNER_RECOVERY=PASS", "process:P12_BOOTSTRAP_CRASH_SALES_AUTHORITY_RECOVERY=PASS", "process:P12_BOOTSTRAP_CRASH_TOKEN_CONSUMPTION_RECOVERY=PASS", "process:P12_ATK_19_BOOTSTRAP_SCOPE_AND_REPLAY_POSTGRES_DENIED=PASS"],
  "P12-ATK-20": ["unit:page-service:cancels pending editor work after page-access invalidation", "process:P12_ATK_20_REVOKED_AUTOSAVE_POSTGRES_DENIED=PASS", "process:P12_ATK_20_OPEN_PAGE_AND_EDITOR_SALES_AUTHORITY_REVOCATION_POSTGRES_HTTP_CHROMIUM_DENIED=PASS", "process:P12_ATK_20_REVOKED_STALE_PUBLISH_AND_LOST_INVALIDATION_DENIED=PASS"],
  "P12-ATK-21": ["unit:generator:writes byte-identical controlled source to different clean targets"],
  "P12-ATK-22": ["unit:generator:uses workspace only for side-effect-free planning and defaults to the verified bundled release", "unit:generator:rejects a coherently forged manifest, tarball, and lock before target write", "unit:generator:binds a generated application to every exact artifact in a packed release mirror", "unit:generator:rejects tampered mirrors and installs immutable bytes captured by the verified plan"]
};
assert.deepEqual(Object.keys(attackProofs), phase12AttackMap.map(({ id }) => id), "Gate 12 attack proof IDs must match the contract exactly.");
for (const attack of phase12AttackMap) {
  assert.ok(attack.expectedDenial.length > 0, `${attack.id} has no expected denial.`);
  assert.ok(attackProofs[attack.id].length > 0, `${attack.id} has no exact executed denial proof.`);
  for (const proof of attackProofs[attack.id]) assert.ok(passedProofs.has(proof), `${attack.id} references unexecuted proof ${proof}.`);
}

const result = read("docs/implementation/phase-12-result.md");
for (const marker of ["# Phase 12 Result", "**Decision:** **READY FOR PHASE REVIEW**", "GO PHASE 13 CRM-FIRST PRODUCTIZATION"]) {
  assert.ok(result.includes(marker), `Phase 12 result is missing ${marker}.`);
}
for (let task = 1; task <= 10; task += 1) assert.ok(result.includes(`P12.${task}`), `Phase 12 result is missing task P12.${task}.`);

console.log(JSON.stringify({ gate: "Gate 12", unitProofs, processProofs: 2, attacks: attackProofs, referenceModules: ["sales"] }, null, 2));
console.log("GATE_12_PASS");
