import { type SalesWorkspaceSettings } from "./contracts.js";
export interface SalesWorkspacePresentation {
    readonly routeId: "sales.route.overview" | "sales.route.opportunities" | "sales.route.tasks";
    readonly taskPageSize: number;
    readonly showPotentialRevenue: boolean;
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
export declare const salesSavedViewTableQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, unknown>, {
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
export declare const salesSavedViewKanbanQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, unknown>, {
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
export declare const salesSavedViewCalendarQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, unknown>, {
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
export declare const salesPipelineSnapshotQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, unknown>, {
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
export declare const salesSavedViewListQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, unknown>, {
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
export declare const salesSavedViewDetailQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, unknown>, {
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
export declare const salesImportJobListQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, unknown>, {
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
export declare const salesImportJobDetailQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, unknown>, {
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
export declare const salesExportJobListQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, unknown>, {
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
export declare const salesExportJobDetailQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, unknown>, {
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
export declare const salesDedupeCandidatesQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, unknown>, {
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
export declare const salesNotificationsQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, unknown>, {
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
export declare const salesRemindersQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, unknown>, {
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
export declare const salesProviderConfigurationsQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, unknown>, {
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
export declare const salesAccountsQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, never>, {
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
export declare const salesContactsQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, never>, {
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
export declare const salesLeadsQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Record<string, never>, {
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
export declare const salesAccountDetailQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Readonly<{
    id: string;
}>, {
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
export declare const salesContactDetailQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Readonly<{
    id: string;
}>, {
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
export declare const salesLeadDetailQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Readonly<{
    id: string;
}>, {
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
export declare const salesOpportunityDetailQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Readonly<{
    id: string;
}>, {
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
export declare const salesTimelineQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Readonly<{
    "related-record-type": "sales.account" | "sales.contact" | "sales.lead" | "sales.opportunity" | "sales.task";
    "related-record-id": string;
}>, {
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
export declare const salesTimelineWithBodyQuery: import("@k-nex/ui-runtime").SourceQueryDefinition<Readonly<{
    "related-record-type": "sales.account" | "sales.contact" | "sales.lead" | "sales.opportunity" | "sales.task";
    "related-record-id": string;
}>, {
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
export declare const salesAccountCreateMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesAccountUpdateMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesAccountArchiveMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesContactCreateMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesContactUpdateMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesContactArchiveMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesLeadCreateMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesLeadUpdateMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesLeadQualifyMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesLeadDisqualifyMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesLeadArchiveMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesOpportunityCreateMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesOpportunityUpdateMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesOpportunityCloseMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesOpportunityArchiveMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesActivityCreateMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesActivityCompleteMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesActivityCancelMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesNoteCreateMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesAttachmentLinkMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesAttachmentRemoveMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesOwnershipAssignMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesWorkflowMutations: readonly import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>[];
export declare const salesCreateTaskMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<import("./contracts.js").CreateTaskInput, import("./contracts.js").CreateTaskOutput>;
export declare const salesUpdateTaskMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<import("./contracts.js").UpdateTaskInput, import("./contracts.js").UpdateTaskOutput>;
export declare const salesOpportunityStageMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<import("./contracts.js").UpdateOpportunityStageInput, import("./contracts.js").UpdateOpportunityStageOutput>;
export declare const salesPipelineUpdateMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesPipelineArchiveMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesSavedViewCreateMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesSavedViewUpdateMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesSavedViewArchiveMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesImportDryRunMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesImportCommitMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesImportCancelMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesExportCreateMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesExportCancelMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesMergeCommitMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesNotificationReadMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesNotificationArchiveMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesReminderDismissMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesReminderScheduleMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesEmailSendMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesCalendarSyncMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesIntegrationConfigureMutation: import("@k-nex/ui-runtime").ActionMutationDefinition<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
export declare const salesBrowserContract: Readonly<{
    pluginId: "module.sales";
    sourceIds: readonly string[];
    actionIds: readonly string[];
    routeIds: readonly string[];
}>;
//# sourceMappingURL=browser.d.ts.map