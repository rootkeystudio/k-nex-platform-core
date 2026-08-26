import * as server0 from "@k-nex/module-sales/server";
import * as server1 from "@k-nex/provider-realtime-socketio/server";

export const runtimeRegistration = {
  "module.sales": server0,
  "provider.realtime.socketio": server1,
} as const;

export default runtimeRegistration;
