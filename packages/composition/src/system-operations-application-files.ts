export interface SystemOperationsApplicationFilesOptions {
  readonly applicationId: string;
}

function runtimeSource(): string {
  return `import { OperationsCenterReferenceSchema, type OperationsCenterReference } from "@k-nex/contracts";
import { PostgresSystemOperationsStore, type RuntimeExtensionPool } from "@k-nex/payload-adapter";
import { SystemOperationsAdministrationService } from "@k-nex/runtime";
import type { Payload } from "payload";

import { kNexAuthority, type KnexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexHostInventoryDigest } from "./k-nex-system-extensions.js";

const clock = Object.freeze({ now: () => new Date() });
const services = new WeakMap<Payload, SystemOperationsAdministrationService<KnexRequestContext>>();

type ReferenceRow = Readonly<{ source: "backup" | "restore-drill" | "extension-operation"; operation_id: string; receipt_id: string | null }>;

function operationsStore(payload: Payload) {
  return new PostgresSystemOperationsStore(payload.db.pool as RuntimeExtensionPool, clock);
}

async function operationsState(operations: PostgresSystemOperationsStore, applicationId: string, environment: string) {
  await operations.initialize({ applicationId, environment, inventoryDigest: kNexHostInventoryDigest });
  return operations.state(applicationId, environment);
}

async function references(payload: Payload) {
  const rows = await (payload.db.pool as RuntimeExtensionPool).query<ReferenceRow>(
    \`select request.kind as source, request.operation_id, receipt.receipt_id
       from k_nex_system_operation_requests request
       left join lateral (select receipt_id from k_nex_system_operation_receipts where operation_id=request.operation_id order by terminal desc limit 1) receipt on true
       where request.application_id=$1 and request.environment=$2
       union all
       select 'extension-operation' as source, operation_id, (select receipt_id from runtime_extension_transition_receipts where operation_id=runtime_extension_operations.operation_id order by created_at desc limit 1) as receipt_id
       from runtime_extension_operations where application_id=$1 and environment=$2\`,
    [kNexIdentity.applicationId, kNexIdentity.environment]
  );
  return Object.freeze(rows.rows.map((row) => OperationsCenterReferenceSchema.parse({ source: row.source, operationId: row.operation_id, ...(row.receipt_id === null ? {} : { receiptId: row.receipt_id }) })));
}

export function systemOperationsAdministration(payload: Payload): SystemOperationsAdministrationService<KnexRequestContext> {
  let service = services.get(payload);
  if (service === undefined) {
    const authority = kNexAuthority(payload);
    const operations = operationsStore(payload);
    service = new SystemOperationsAdministrationService({
      authority: authority.adapter,
      state: { readState: async (applicationId, environment) => {
        const [authorization, state] = await Promise.all([authority.store.readState(applicationId, environment), operationsState(operations, applicationId, environment)]);
        return authorization === undefined || state === undefined ? undefined : Object.freeze({ ...authorization, ...state });
      } },
      projection: { read: async ({ applicationId, environment }) => {
        if (applicationId !== kNexIdentity.applicationId || environment !== kNexIdentity.environment) throw new TypeError("Operations scope is unavailable.");
        const before = await operationsState(operations, applicationId, environment);
        if (before === undefined) throw new TypeError("Operations state is unavailable.");
        const result = Object.freeze({ ...before, references: await references(payload), health: Object.freeze([]) });
        const after = await operations.state(applicationId, environment);
        if (after === undefined || after.operationsRevision !== before.operationsRevision || after.inventoryDigest !== before.inventoryDigest) throw new TypeError("Operations state changed.");
        return result;
      } },
      // This generated web process has no operations mutation authority.
      operator: { resolve: () => undefined },
      evidence: { verify: () => undefined }
    });
    services.set(payload, service);
  }
  return service;
}

export function systemOperationRouteId(value: string): string {
  if (!/^[a-z][a-z0-9-]{2,127}$/u.test(value)) throw new TypeError("System operation route identity is invalid.");
  return value;
}

export function systemOperationReferenceId(reference: OperationsCenterReference): string {
  if ("operationId" in reference) return reference.operationId;
  if ("refreshId" in reference) return reference.refreshId;
  return reference.receiptId;
}
`;
}

function operationsPageSource(): string {
  return `import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SystemOperationsPage } from "@k-nex/ui-pages";

import { bootKnexApplication } from "../../../../boot.js";
import { currentSystemAdministrationNavigation, kNexRequestContext } from "../../../../k-nex-authority.js";
import { systemOperationReferenceId, systemOperationsAdministration } from "../../../../k-nex-system-operations.js";

export const dynamic = "force-dynamic";

export default async function SystemOperationsRoute() {
  const payload = await bootKnexApplication("system-operations");
  const context = kNexRequestContext(await headers(), "system-operations");
  try {
    const operations = await systemOperationsAdministration(payload).read({ context });
    return <SystemOperationsPage view={{ navigation: await currentSystemAdministrationNavigation(payload, context), title: "Operations", revision: String(operations.operationsRevision),
      operations: operations.references.map((reference) => { const id = systemOperationReferenceId(reference); return { id, source: reference.source, href: "/system/operations/" + encodeURIComponent(id), state: reference.receiptId === undefined ? "receipt pending" : "receipt recorded", receipt: reference.receiptId ?? "—" }; }),
      health: operations.health.map((health) => ({ id: health.observationId, source: health.source, state: health.state, revision: String(health.revision), checks: health.checkIds.join(", ") }))
    }} />;
  } catch { notFound(); }
}

`;
}

function operationDetailPageSource(): string {
  return `import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SystemOperationDetailPage } from "@k-nex/ui-pages";

import { bootKnexApplication } from "../../../../../boot.js";
import { currentSystemAdministrationNavigation, kNexRequestContext } from "../../../../../k-nex-authority.js";
import { systemOperationReferenceId, systemOperationRouteId, systemOperationsAdministration } from "../../../../../k-nex-system-operations.js";

export const dynamic = "force-dynamic";

export default async function SystemOperationDetailRoute({ params }: Readonly<{ params: Promise<{ operationId: string }> }>) {
  const payload = await bootKnexApplication("system-operation-detail");
  const context = kNexRequestContext(await headers(), "system-operation-detail");
  try {
    const operationId = systemOperationRouteId((await params).operationId);
    const operations = await systemOperationsAdministration(payload).read({ context });
    const matches = operations.references.filter((reference) => systemOperationReferenceId(reference) === operationId);
    if (matches.length !== 1) notFound();
    const reference = matches[0]!;
    return <SystemOperationDetailPage view={{ navigation: await currentSystemAdministrationNavigation(payload, context), title: "Operation", operationId, source: reference.source,
      operationState: reference.receiptId === undefined ? "receipt pending" : "receipt recorded", receipt: reference.receiptId ?? "—", inventory: operations.inventoryDigest,
      audit: reference.receiptId === undefined ? "No terminal receipt recorded." : "Durable receipt " + reference.receiptId
    }} />;
  } catch { notFound(); }
}

`;
}

export function systemOperationsApplicationFiles(_options: SystemOperationsApplicationFilesOptions): Readonly<Record<string, string>> {
  return {
    "src/k-nex-system-operations.ts": runtimeSource(),
    "src/app/(workspace)/system/operations/page.tsx": operationsPageSource(),
    "src/app/(workspace)/system/operations/[operationId]/page.tsx": operationDetailPageSource()
  };
}
