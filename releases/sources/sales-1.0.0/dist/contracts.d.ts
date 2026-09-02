import type { AgentToolDescriptor, AgentToolJsonSchema, ActionDescriptor, DataSourceDescriptor, MetricScalar, AuthorizationPermissionDescriptor, PermissionPolicyBinding, PluginPageTemplateDescriptor, SystemSettingsDescriptor, PluginUiContributionDescriptor, RoleTemplate, RuntimeSchema, TableRecords } from "@k-nex/contracts";
export declare const salesTaskFields: NonNullable<DataSourceDescriptor["outputFields"]>;
export declare const salesTotalPotentialRevenueDescriptor: DataSourceDescriptor;
export declare const salesTasksDescriptor: DataSourceDescriptor;
export declare const salesOpportunityFields: NonNullable<DataSourceDescriptor["outputFields"]>;
export declare const salesOpportunitiesDescriptor: DataSourceDescriptor;
export declare const salesTaskTablePropsSchema: {
    type: "object";
    properties: {
        title: {
            type: "string";
            minLength: number;
            maxLength: number;
        };
    };
    required: string[];
    additionalProperties: false;
};
export interface CreateTaskInput {
    readonly title: string;
    readonly status?: "open" | "done";
    readonly potentialRevenue?: string;
    readonly privateNote?: string;
}
export interface CreateTaskOutput {
    readonly id: string;
    readonly title: string;
    readonly status: "open" | "done";
}
export interface UpdateTaskInput {
    readonly id: string;
    readonly title?: string;
    readonly status?: "open" | "done";
}
export interface UpdateTaskOutput {
    readonly id: string;
    readonly title: string;
    readonly status: "open" | "done";
}
export interface UpdateOpportunityStageInput {
    readonly id: string;
    readonly stage: "lead" | "qualified" | "won" | "lost";
}
export interface UpdateOpportunityStageOutput {
    readonly id: string;
    readonly name: string;
    readonly stage: "lead" | "qualified" | "won" | "lost";
}
export declare const salesEmptyInputRuntimeSchema: RuntimeSchema<Record<string, never>>;
export declare const salesCreateTaskInputRuntimeSchema: RuntimeSchema<CreateTaskInput>;
export declare const salesCreateTaskOutputRuntimeSchema: RuntimeSchema<CreateTaskOutput>;
export declare const salesUpdateTaskInputRuntimeSchema: RuntimeSchema<UpdateTaskInput>;
export declare const salesUpdateTaskOutputRuntimeSchema: RuntimeSchema<UpdateTaskOutput>;
export declare const salesOpportunityStageInputRuntimeSchema: RuntimeSchema<UpdateOpportunityStageInput>;
export declare const salesOpportunityStageOutputRuntimeSchema: RuntimeSchema<UpdateOpportunityStageOutput>;
export declare const salesTotalPotentialRevenueOutputRuntimeSchema: RuntimeSchema<MetricScalar>;
export declare const salesTasksOutputRuntimeSchema: RuntimeSchema<TableRecords>;
export declare const salesOpportunitiesOutputRuntimeSchema: RuntimeSchema<TableRecords>;
export declare const salesTaskCreateDescriptor: {
    readonly id: "sales.task.create";
    readonly version: 1;
    readonly ownerPluginId: "module.sales";
    readonly inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    readonly outputSchema: AgentToolJsonSchema;
    readonly permission: "sales.tasks.write";
    readonly policy: "sales.tasks.domain";
    readonly effect: "write";
    readonly idempotency: "required";
    readonly dryRun: false;
};
export declare const salesTaskUpdateDescriptor: ActionDescriptor;
export declare const salesOpportunityStageUpdateDescriptor: ActionDescriptor;
export declare const salesSearchTasksDescriptor: AgentToolDescriptor;
export declare const salesCreateTaskToolDescriptor: AgentToolDescriptor;
export declare const salesWorkspaceSettingsDescriptor: SystemSettingsDescriptor;
export type SalesWorkspaceSettings = Readonly<{
    defaultTaskPageSize: number;
    showPotentialRevenue: boolean;
    defaultPage: "overview" | "tasks" | "opportunities";
    pipelineStages: readonly string[];
}>;
export declare const salesPermissionDescriptors: readonly AuthorizationPermissionDescriptor[];
/** Static bindings for the existing Sales record and field policy seams. */
export declare const salesPermissionPolicyBindings: readonly PermissionPolicyBinding[];
/** Static Sales role defaults; customer roles and assignments remain platform-owned. */
export declare const salesRoleTemplates: readonly RoleTemplate[];
export declare const salesRouteDescriptors: readonly {
    id: string;
    ownerPluginId: string;
    path: string;
    parameters: {};
    surface: "workspace";
    audience: "authenticated";
    permission: string;
    viewId: string;
}[];
export declare const salesNavigationDescriptors: readonly {
    id: string;
    ownerPluginId: string;
    labelMessageId: string;
    route: {
        routeId: string;
        params: {};
    };
    permission: string;
    order: number;
}[];
export declare const salesTaskPageTemplate: PluginPageTemplateDescriptor;
export declare const salesOverviewPageTemplate: PluginPageTemplateDescriptor;
export declare const salesOpportunitiesPageTemplate: PluginPageTemplateDescriptor;
export declare const salesSettingsPageTemplate: PluginPageTemplateDescriptor;
export declare const salesPageTemplates: readonly {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "public" | "workspace" | "cms";
    profile: "workspace" | "cms";
    permission: string;
    publicationPolicy: {
        ownership: "customer";
        adoption: "explicit";
    };
    requirements: {
        capabilities: {
            id: string;
            version: string;
        }[];
        sources: {
            id: string;
            version: number;
        }[];
        actions: {
            id: string;
            version: number;
        }[];
        blocks: {
            id: string;
            version: number;
        }[];
    };
    document: {
        id: string;
        version: number;
        schemaVersion: 1;
        profile: "workspace" | "cms";
        regions: Record<string, import("@k-nex/contracts").UiNodeShape[]>;
    };
    migration?: {
        adoptableFromVersions: number[];
        notesMessageId: string;
    } | undefined;
}[];
export declare const salesTaskTableComponentDescriptor: PluginUiContributionDescriptor;
export declare const salesTaskTableBlockDescriptor: PluginUiContributionDescriptor;
export declare const salesRevenueMetricComponentDescriptor: PluginUiContributionDescriptor;
export declare const salesQuickCreateComponentDescriptor: PluginUiContributionDescriptor;
export declare const salesOpportunityListComponentDescriptor: PluginUiContributionDescriptor;
export declare const salesOpportunityDetailComponentDescriptor: PluginUiContributionDescriptor;
export declare const salesPipelineStatusComponentDescriptor: PluginUiContributionDescriptor;
export declare const salesRevenueMetricBlockDescriptor: PluginUiContributionDescriptor;
export declare const salesQuickCreateBlockDescriptor: PluginUiContributionDescriptor;
export declare const salesOpportunityListBlockDescriptor: PluginUiContributionDescriptor;
export declare const salesOpportunityDetailBlockDescriptor: PluginUiContributionDescriptor;
export declare const salesSettingsSummaryBlockDescriptor: PluginUiContributionDescriptor;
export declare const salesUiComponentDescriptors: readonly PluginUiContributionDescriptor[];
export declare const salesUiBlockDescriptors: readonly PluginUiContributionDescriptor[];
export declare const salesEventDescriptors: readonly {
    id: string;
    version: number;
    ownerPluginId: string;
    eventClass: string;
    sourceId: string;
}[];
export declare const salesRealtimeTopicDescriptors: readonly {
    id: string;
    version: number;
    ownerPluginId: string;
    eventId: string;
    sourceId: string;
    permission: string;
}[];
export declare const salesReferenceMetadata: Readonly<{
    migration: {
        id: string;
        version: number;
        ownerPluginId: string;
        predecessorRevisions: number[];
    };
    service: {
        id: string;
        version: number;
        ownerPluginId: string;
    };
    job: {
        id: string;
        version: number;
        ownerPluginId: string;
        timeoutMs: number;
        maxConcurrency: number;
        idempotent: boolean;
    };
    localization: {
        id: string;
        version: number;
        ownerPluginId: string;
        locale: string;
        messages: {
            "sales.message.overview": string;
            "sales.message.tasks": string;
            "sales.message.opportunities": string;
            "sales.message.settings": string;
            "sales.message.navigation-overview": string;
            "sales.message.navigation-tasks": string;
            "sales.message.navigation-opportunities": string;
            "sales.message.navigation-settings": string;
        };
    };
    health: {
        id: string;
        version: number;
        ownerPluginId: string;
        safe: boolean;
    };
    lifecycle: {
        id: string;
        version: number;
        ownerPluginId: string;
        disable: string;
        reenable: string;
        purge: string;
    };
    testing: {
        id: string;
        version: number;
        ownerPluginId: string;
        conformancePluginId: string;
    };
}>;
//# sourceMappingURL=contracts.d.ts.map