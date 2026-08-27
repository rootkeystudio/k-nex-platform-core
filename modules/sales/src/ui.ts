import { salesBrowserContract } from "./browser.js";
export { salesNavigationDescriptors, salesRouteDescriptors } from "./contracts.js";

export const salesWorkspaceUiContract = Object.freeze({
  pluginId: salesBrowserContract.pluginId,
  surface: "workspace" as const,
  sourceIds: salesBrowserContract.sourceIds,
  actionIds: salesBrowserContract.actionIds,
  routeIds: salesBrowserContract.routeIds
});
