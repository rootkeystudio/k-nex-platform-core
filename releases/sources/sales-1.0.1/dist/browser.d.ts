import { type SalesWorkspaceSettings } from "./contracts.js";
export interface SalesWorkspacePresentation {
    readonly routeId: "sales.route.overview" | "sales.route.opportunities" | "sales.route.tasks";
    readonly taskPageSize: number;
    readonly showPotentialRevenue: boolean;
    readonly pipelineStages: readonly string[];
}
export declare function salesWorkspacePresentation(settings: SalesWorkspaceSettings): Readonly<SalesWorkspacePresentation>;
export declare const salesTasksQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, never>, {
    fields: string[];
    rows: {
        key: string;
        values: Record<string, {
            kind: "text";
            value: string;
        } | {
            kind: "integer";
            value: number;
        } | {
            kind: "number";
            value: number;
        } | {
            kind: "decimal";
            value: string;
            scale: number;
            unit?: string | undefined;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "money";
            value: string;
            currency: string;
            scale: number;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "datetime";
            value: string;
        } | {
            kind: "date";
            value: string;
        } | {
            kind: "boolean";
            value: boolean;
        } | {
            kind: "status";
            value: string;
        } | {
            kind: "enum";
            value: string;
        } | {
            kind: "resource";
            resourceType: string;
            id: string;
            label: string;
            route: {
                routeId: string;
                params: Record<string, string>;
            };
        } | null>;
    }[];
    page: {
        number: number;
        pageSize: number;
        hasNext: boolean;
        nextCursor?: string | undefined;
    };
}>;
export declare const salesTotalPotentialRevenueQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, never>, {
    value: {
        kind: "integer";
        value: number;
    } | {
        kind: "number";
        value: number;
    } | {
        kind: "decimal";
        value: string;
        scale: number;
        unit?: string | undefined;
        rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
    } | {
        kind: "money";
        value: string;
        currency: string;
        scale: number;
        rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
    } | {
        kind: "percentage";
        value: string;
    } | {
        kind: "duration";
        value: string;
        unit: "milliseconds" | "seconds" | "minutes" | "hours" | "days";
    } | {
        kind: "text";
        value: string;
    };
    comparison?: {
        value: {
            kind: "integer";
            value: number;
        } | {
            kind: "number";
            value: number;
        } | {
            kind: "decimal";
            value: string;
            scale: number;
            unit?: string | undefined;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "money";
            value: string;
            currency: string;
            scale: number;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "percentage";
            value: string;
        } | {
            kind: "duration";
            value: string;
            unit: "milliseconds" | "seconds" | "minutes" | "hours" | "days";
        } | {
            kind: "text";
            value: string;
        };
        sentiment: "positive" | "neutral" | "negative";
    } | undefined;
}>;
export declare const salesOpportunitiesQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, never>, {
    fields: string[];
    rows: {
        key: string;
        values: Record<string, {
            kind: "text";
            value: string;
        } | {
            kind: "integer";
            value: number;
        } | {
            kind: "number";
            value: number;
        } | {
            kind: "decimal";
            value: string;
            scale: number;
            unit?: string | undefined;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "money";
            value: string;
            currency: string;
            scale: number;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "datetime";
            value: string;
        } | {
            kind: "date";
            value: string;
        } | {
            kind: "boolean";
            value: boolean;
        } | {
            kind: "status";
            value: string;
        } | {
            kind: "enum";
            value: string;
        } | {
            kind: "resource";
            resourceType: string;
            id: string;
            label: string;
            route: {
                routeId: string;
                params: Record<string, string>;
            };
        } | null>;
    }[];
    page: {
        number: number;
        pageSize: number;
        hasNext: boolean;
        nextCursor?: string | undefined;
    };
}>;
export declare const salesCreateTaskMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<import("./contracts.js").CreateTaskInput, import("./contracts.js").CreateTaskOutput>;
export declare const salesUpdateTaskMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<import("./contracts.js").UpdateTaskInput, import("./contracts.js").UpdateTaskOutput>;
export declare const salesOpportunityStageMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<import("./contracts.js").UpdateOpportunityStageInput, import("./contracts.js").UpdateOpportunityStageOutput>;
export declare const salesBrowserContract: Readonly<{
    pluginId: "module.sales";
    sourceIds: readonly string[];
    actionIds: readonly string[];
    routeIds: readonly string[];
}>;
//# sourceMappingURL=browser.d.ts.map