import { salesOpportunitiesCollection, salesRegistration, salesTasksCollection } from "@k-nex/module-sales/server";
import { salesMigrationReadiness, salesUpgradeMigrations } from "@k-nex/module-sales/migrations";
import { salesPageTemplates } from "@k-nex/module-sales/contracts";

export const kNexSalesRegistry = Object.freeze({
  registration: salesRegistration,
  collections: Object.freeze([salesTasksCollection, salesOpportunitiesCollection]),
  migrations: salesUpgradeMigrations,
  readiness: salesMigrationReadiness,
  defaultPages: salesPageTemplates
});
