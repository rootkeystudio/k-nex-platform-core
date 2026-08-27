import {
  salesTaskCreateDescriptor,
  salesRouteDescriptors,
  salesTasksDescriptor,
  salesTotalPotentialRevenueDescriptor
} from "./contracts.js";

export const salesBrowserContract = Object.freeze({
  pluginId: "module.sales" as const,
  sourceIds: Object.freeze([
    salesTasksDescriptor.id,
    salesTotalPotentialRevenueDescriptor.id
  ]),
  actionIds: Object.freeze([salesTaskCreateDescriptor.id]),
  routeIds: Object.freeze(salesRouteDescriptors.map(({ id }) => id))
});
