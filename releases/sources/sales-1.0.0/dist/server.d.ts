import { type DataSourceDefinition } from "@k-nex/contracts";
import { createOutboxRealtimeRelay } from "@k-nex/payload-adapter";
import type { ActionDefinition, ActionHandler, DataSourceHandler, PlatformPluginPolicyExecutor } from "@k-nex/runtime";
import type { CollectionConfig } from "payload";
import type { CollectionAfterChangeHook } from "payload";
import { type CreateTaskInput, type CreateTaskOutput, type UpdateOpportunityStageInput, type UpdateOpportunityStageOutput, type UpdateTaskInput, type UpdateTaskOutput } from "./contracts.js";
export { salesCreateTaskToolDescriptor, salesNavigationDescriptors, salesPermissionDescriptors, salesPermissionPolicyBindings, salesReferenceMetadata, salesRouteDescriptors, salesRoleTemplates, salesSearchTasksDescriptor, salesTaskCreateDescriptor, salesTaskPageTemplate, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor, salesWorkspaceSettingsDescriptor } from "./contracts.js";
export declare const salesEventAfterChange: CollectionAfterChangeHook;
export declare function createSalesRealtimeRelay(gateway: Parameters<typeof createOutboxRealtimeRelay>[0]["gateway"]): import("@k-nex/payload-adapter").OutboxSubscriber;
export declare function salesPipelineAuditJob(input: {
    readonly opportunities: readonly {
        readonly stage: "lead" | "qualified" | "won" | "lost";
    }[];
    readonly signal: AbortSignal;
}): Readonly<{
    pluginId: "module.sales";
    jobId: "sales.job.pipeline-audit";
    stageCounts: Readonly<{
        lead: number;
        qualified: number;
        won: number;
        lost: number;
    }>;
}>;
export declare const salesTotalPotentialRevenueDefinition: DataSourceDefinition;
export declare const salesTasksDefinition: DataSourceDefinition;
export declare const salesOpportunitiesDefinition: DataSourceDefinition;
export declare const salesTotalPotentialRevenueHandler: DataSourceHandler;
export declare const salesTasksHandler: DataSourceHandler;
export declare const salesOpportunitiesHandler: DataSourceHandler;
export declare const salesTaskCreateDefinition: ActionDefinition<CreateTaskInput, CreateTaskOutput>;
export declare const salesTaskUpdateDefinition: ActionDefinition<UpdateTaskInput, UpdateTaskOutput>;
export declare const salesOpportunityStageUpdateDefinition: ActionDefinition<UpdateOpportunityStageInput, UpdateOpportunityStageOutput>;
export declare const salesTaskCreateHandler: ActionHandler<CreateTaskInput, CreateTaskOutput>;
export declare const salesTaskUpdateHandler: ActionHandler<UpdateTaskInput, UpdateTaskOutput>;
export declare const salesOpportunityStageUpdateHandler: ActionHandler<UpdateOpportunityStageInput, UpdateOpportunityStageOutput>;
export declare const salesTasksCollection: CollectionConfig;
export declare const salesOpportunitiesCollection: CollectionConfig;
export declare const salesDefaultSettings: Readonly<Record<string, string | number | boolean | string[] | {
    kind: "secret-reference";
    provider: "environment";
    key: string;
} | null>>;
/** Static domain policy executors bound by the host to the exact Sales generation. */
export declare const salesPermissionPolicyExecutors: Readonly<{
    "sales.tasks.domain": PlatformPluginPolicyExecutor;
    "sales.opportunities.domain": PlatformPluginPolicyExecutor;
}>;
export declare const salesRegistration: Readonly<{
    readonly pluginId: "module.sales";
    readonly contracts: (context: import("@k-nex/runtime").ContractsRegistrationContext) => void;
    readonly schema: (context: import("@k-nex/runtime").SchemaRegistrationContext) => void;
    readonly behavior: (context: import("@k-nex/runtime").BehaviorRegistrationContext) => void;
    readonly jobs: (context: import("@k-nex/runtime").JobsRegistrationContext) => void;
    readonly dataHandlers: (context: import("@k-nex/runtime").DataHandlersRegistrationContext) => void;
    readonly ui: (context: import("@k-nex/runtime").UiRegistrationContext) => void;
    readonly validate: (context: import("@k-nex/runtime").ValidateRegistrationContext) => void;
}>;
//# sourceMappingURL=server.d.ts.map