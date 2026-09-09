import { withPayload } from "@payloadcms/next/withPayload";

export default withPayload({
  output: "standalone",
  // The server registration intentionally binds Sales UI renderers. Keep that
  // package in the Node route-handler graph so Next does not evaluate its React
  // context dependencies through the `react-server` export condition.
  serverExternalPackages: ["@k-nex/module-sales"]
});
