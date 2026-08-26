import type { ToolCatalog, ToolCatalogListResult, ToolCatalogRequest } from "./tool-catalog.js";
import type {
  ToolExecutionGateway,
  ToolGatewayRequest,
  ToolGatewayResponse,
  ToolPreparationResponse
} from "./tool-gateway.js";

export interface ScriptedToolReference {
  readonly id: string;
  readonly version: number;
}

export interface ScriptedToolRequestDetails {
  readonly context: ToolCatalogRequest;
  readonly tool: ScriptedToolReference;
  readonly input: unknown;
  readonly correlationId: string;
  readonly idempotencyKey?: string;
  readonly approvalId?: string;
}

export interface ScriptedToolClientDependencies {
  readonly catalog: Pick<ToolCatalog, "list">;
  readonly gateway: Pick<ToolExecutionGateway, "execute" | "prepare" | "submitApproval">;
  readonly authenticate: () => ToolCatalogRequest | Promise<ToolCatalogRequest>;
  readonly request: (details: ScriptedToolRequestDetails) => ToolGatewayRequest;
}

export interface ScriptedToolApproval {
  readonly id: string;
  readonly decision: "approve";
  readonly expiresAtEpochMs: number;
}

export type ScriptedApprovalStage = "initial" | "replay" | "changed-input";

export interface ScriptedApprovalRequest {
  readonly stage: ScriptedApprovalStage;
  readonly input: unknown;
  readonly prepared: ToolPreparationResponse;
}

export interface ScriptedSalesToolFlow {
  readonly readTool: ScriptedToolReference;
  readonly readInput: unknown;
  readonly forbiddenTool: ScriptedToolReference;
  readonly forbiddenInput: unknown;
  readonly writeTool: ScriptedToolReference;
  readonly writeInput: unknown;
  readonly changedWriteInput: unknown;
  readonly idempotencyKey: string;
  readonly approval: (request: ScriptedApprovalRequest) => ScriptedToolApproval | Promise<ScriptedToolApproval>;
}

export interface ScriptedSalesToolProof {
  readonly authentication: ToolCatalogRequest;
  readonly catalog: ToolCatalogListResult;
  readonly read: ToolGatewayResponse;
  readonly forbidden: ToolGatewayResponse;
  readonly prepared: ToolPreparationResponse;
  readonly approval: ToolPreparationResponse;
  readonly write: ToolGatewayResponse;
  readonly replayPrepared: ToolPreparationResponse;
  readonly replayApproval: ToolPreparationResponse;
  readonly replay: ToolGatewayResponse;
  readonly changedPrepared: ToolPreparationResponse;
  readonly changedApproval: ToolPreparationResponse;
  readonly changedReplay: ToolGatewayResponse;
}

function requestFor(
  dependencies: ScriptedToolClientDependencies,
  context: ToolCatalogRequest,
  tool: ScriptedToolReference,
  input: unknown,
  correlationId: string,
  idempotencyKey?: string,
  approvalId?: string
): ToolGatewayRequest {
  return dependencies.request({
    context,
    tool,
    input,
    correlationId,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(approvalId === undefined ? {} : { approvalId })
  });
}

export class ScriptedSalesToolClient {
  constructor(private readonly dependencies: ScriptedToolClientDependencies) {}

  async run(flow: ScriptedSalesToolFlow): Promise<ScriptedSalesToolProof> {
    const authentication = await this.dependencies.authenticate();
    const catalog = await this.dependencies.catalog.list(authentication);

    const read = await this.dependencies.gateway.execute(requestFor(
      this.dependencies,
      authentication,
      flow.readTool,
      flow.readInput,
      "scripted-read"
    ));
    const forbidden = await this.dependencies.gateway.execute(requestFor(
      this.dependencies,
      authentication,
      flow.forbiddenTool,
      flow.forbiddenInput,
      "scripted-forbidden"
    ));

    const preparedRequest = requestFor(
      this.dependencies,
      authentication,
      flow.writeTool,
      flow.writeInput,
      "scripted-write",
      flow.idempotencyKey
    );
    const prepared = await this.dependencies.gateway.prepare(preparedRequest);
    const approval = await flow.approval({ stage: "initial", input: flow.writeInput, prepared });
    const approvalResponse = await this.dependencies.gateway.submitApproval(preparedRequest, approval);
    const write = await this.dependencies.gateway.execute(requestFor(
      this.dependencies,
      authentication,
      flow.writeTool,
      flow.writeInput,
      "scripted-write",
      flow.idempotencyKey,
      approval.id
    ));

    const replayPrepared = await this.dependencies.gateway.prepare(preparedRequest);
    const replayApproval = await flow.approval({ stage: "replay", input: flow.writeInput, prepared: replayPrepared });
    const replayApprovalResponse = await this.dependencies.gateway.submitApproval(preparedRequest, replayApproval);
    const replay = await this.dependencies.gateway.execute(requestFor(
      this.dependencies,
      authentication,
      flow.writeTool,
      flow.writeInput,
      "scripted-write-replay",
      flow.idempotencyKey,
      replayApproval.id
    ));

    const changedRequest = requestFor(
      this.dependencies,
      authentication,
      flow.writeTool,
      flow.changedWriteInput,
      "scripted-write-changed",
      flow.idempotencyKey
    );
    const changedPrepared = await this.dependencies.gateway.prepare(changedRequest);
    const changedApproval = await flow.approval({ stage: "changed-input", input: flow.changedWriteInput, prepared: changedPrepared });
    const changedApprovalResponse = await this.dependencies.gateway.submitApproval(changedRequest, changedApproval);
    const changedReplay = await this.dependencies.gateway.execute(requestFor(
      this.dependencies,
      authentication,
      flow.writeTool,
      flow.changedWriteInput,
      "scripted-write-changed",
      flow.idempotencyKey,
      changedApproval.id
    ));

    return Object.freeze({
      authentication,
      catalog,
      read,
      forbidden,
      prepared,
      approval: approvalResponse,
      write,
      replayPrepared,
      replayApproval: replayApprovalResponse,
      replay,
      changedPrepared,
      changedApproval: changedApprovalResponse,
      changedReplay
    });
  }
}
