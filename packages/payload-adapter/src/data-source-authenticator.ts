import type { PayloadRequest } from "payload";

import {
  DataSourceGatewayError,
  isDataSourceActorContext,
  type AuthenticatedDataSourceRequest,
  type DataSourceActorContext,
  type DataSourceGatewayRequest,
  type RequestAuthenticator
} from "@k-nex/runtime";

export interface PayloadDataSourceRequestContext {
  readonly payload: PayloadRequest["payload"];
  readonly locale: PayloadRequest["locale"];
  readonly transactionID: PayloadRequest["transactionID"];
}

export interface PayloadDataSourceActorAdapter {
  actor(request: PayloadRequest): DataSourceActorContext;
  authorizationContext(request: PayloadRequest): unknown;
}

function isPayloadRequest(value: unknown): value is PayloadRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { payload?: unknown; user?: unknown };
  return (candidate.user === null || typeof candidate.user === "object")
    && typeof candidate.payload === "object"
    && candidate.payload !== null;
}

export class PayloadRequestAuthenticator implements RequestAuthenticator {
  constructor(private readonly adapter: PayloadDataSourceActorAdapter) {}

  authenticate(request: DataSourceGatewayRequest): AuthenticatedDataSourceRequest {
    if (!isPayloadRequest(request.rawRequest)) {
      throw new DataSourceGatewayError("INVALID_REQUEST_CONTEXT", 401, "Authentication context is invalid.");
    }
    const payloadRequest = request.rawRequest;
    const actor: DataSourceActorContext = payloadRequest.user === null
      ? { principal: { kind: "public", id: "anonymous" }, effectiveActor: { kind: "public", id: "anonymous" } }
      : this.adapter.actor(payloadRequest);
    if (!isDataSourceActorContext(actor)) {
      throw new DataSourceGatewayError("INVALID_ACTOR_CONTEXT", 401, "Authentication context is invalid.");
    }
    const safeRequest: PayloadDataSourceRequestContext = {
      payload: payloadRequest.payload,
      locale: payloadRequest.locale,
      transactionID: payloadRequest.transactionID
    };
    return {
      actor,
      request: safeRequest,
      authorizationContext: this.adapter.authorizationContext(payloadRequest)
    };
  }
}
