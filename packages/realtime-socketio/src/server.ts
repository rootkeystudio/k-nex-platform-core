import type { PluginRegistration, ProvidersRegistrationContext } from "@k-nex/runtime";

import { createSocketIoMemoryGateway } from "./index.js";

export const socketIoRealtimeProvider = Object.freeze({
  adapter: "memory" as const,
  create: createSocketIoMemoryGateway,
  pluginId: "provider.realtime.socketio" as const
});

export const socketIoRealtimeProviderRegistration: PluginRegistration = Object.freeze({
  pluginId: socketIoRealtimeProvider.pluginId,
  providers: (context: ProvidersRegistrationContext) => context.provide("realtime.gateway", socketIoRealtimeProvider)
});
