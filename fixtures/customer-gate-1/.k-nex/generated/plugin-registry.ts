import manifest0 from "@k-nex/module-sales/manifest" with { type: "json" };
import manifest1 from "@k-nex/provider-realtime-socketio/manifest" with { type: "json" };

export const pluginRegistry = {
  "module.sales": manifest0,
  "provider.realtime.socketio": manifest1,
} as const;

export default pluginRegistry;
