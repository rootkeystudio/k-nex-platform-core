import type { AgentToolDescriptor, AgentToolJsonSchema, ActionDescriptor, DataSourceDescriptor, PluginPageTemplateDescriptor, SystemSettingsDescriptor, PluginUiContributionDescriptor, RuntimeSchema, MetricScalar, MetricScalarV2, TableRecords, DataSourceQueryControls } from "@k-nex/contracts";
export declare const salesRecordIdPattern = "^(?:[1-9][0-9]{0,8}|1[0-9]{9}|20[0-9]{8}|21[0-3][0-9]{7}|214[0-6][0-9]{6}|2147[0-3][0-9]{5}|21474[0-7][0-9]{4}|214748[0-2][0-9]{3}|2147483[0-5][0-9]{2}|21474836[0-3][0-9]|214748364[0-7])$";
export declare const salesTaskFields: NonNullable<DataSourceDescriptor["outputFields"]>;
export declare const salesTasksDescriptor: DataSourceDescriptor;
/** The P13.8 catalog is closed: no persisted report definition can select a source, field, or expression. */
export declare const salesReportWindowModes: readonly ["current-reporting-week", "previous-complete-reporting-week", "current-reporting-month", "previous-complete-reporting-month"];
export type SalesReportWindowMode = typeof salesReportWindowModes[number];
export type SalesReportId = "sales.report.pipeline-value-by-stage" | "sales.report.weighted-forecast" | "sales.report.won-lost-conversion" | "sales.report.lead-conversion" | "sales.report.activity-by-owner-team" | "sales.report.task-aging" | "sales.report.sales-cycle-duration";
export type SalesReportBlockId = "sales.block.report.pipeline-value-by-stage" | "sales.block.report.weighted-forecast" | "sales.block.report.won-lost-conversion" | "sales.block.report.lead-conversion" | "sales.block.report.activity-by-owner-team" | "sales.block.report.task-aging" | "sales.block.report.sales-cycle-duration";
/** Contribution IDs share one global runtime namespace, so report blocks intentionally differ from their bound sources. */
export declare function salesReportBlockId(reportId: string): SalesReportBlockId;
export declare const salesPipelineValueByStageFields: readonly [{
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}, {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}, {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}];
export declare const salesActivityByOwnerTeamFields: readonly [{
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}, {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}, {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}];
export declare const salesTaskAgingFields: readonly [{
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}, {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}];
export declare const salesPipelineValueByStageDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesWeightedForecastDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesWonLostConversionDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesLeadConversionDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesActivityByOwnerTeamDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesTaskAgingDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesSalesCycleDurationDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesReportDescriptors: readonly [{
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
}, {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
}, {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
}, {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
}, {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
}, {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
}, {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
}];
export declare const salesPipelineValueByStageOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesActivityByOwnerTeamOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesTaskAgingOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesMetricOutputRuntimeSchema: RuntimeSchema<MetricScalar>;
export declare const salesMetricOutputRuntimeV2Schema: RuntimeSchema<MetricScalarV2>;
export declare const salesOpportunityFields: NonNullable<DataSourceDescriptor["outputFields"]>;
export declare const salesOpportunityDetailFields: NonNullable<DataSourceDescriptor["outputFields"]>;
export declare const salesOpportunitiesDescriptor: DataSourceDescriptor;
export declare const salesAccountFields: NonNullable<DataSourceDescriptor["outputFields"]>;
export declare const salesContactFields: NonNullable<DataSourceDescriptor["outputFields"]>;
export declare const salesLeadFields: NonNullable<DataSourceDescriptor["outputFields"]>;
export declare const salesLeadDetailFields: NonNullable<DataSourceDescriptor["outputFields"]>;
export declare const salesAccountsDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesContactsDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesLeadsDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesAccountDetailDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesContactDetailDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesLeadDetailDescriptor: DataSourceDescriptor;
export declare const salesOpportunityDetailDescriptor: DataSourceDescriptor;
export declare const salesSavedViewTableFields: readonly {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}[];
export declare const salesSavedViewKanbanFields: readonly {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}[];
export declare const salesSavedViewCalendarFields: readonly {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}[];
export declare const salesPipelineSnapshotFields: readonly {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}[];
export declare const salesSavedViewListFields: readonly {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}[];
export declare const salesSavedViewDetailFields: readonly {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}[];
export declare const salesSavedViewTableDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesSavedViewKanbanDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesSavedViewCalendarDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesPipelineSnapshotDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesSavedViewListDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesSavedViewDetailDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesImportJobListFields: readonly {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}[];
export declare const salesImportJobDetailFields: readonly {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}[];
export declare const salesExportJobListFields: readonly {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}[];
export declare const salesExportJobDetailFields: readonly {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}[];
export declare const salesDedupeCandidateFields: readonly {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}[];
export declare const salesImportJobListDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesImportJobDetailDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesExportJobListDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesExportJobDetailDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesDedupeCandidatesDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export type SalesSavedViewSourceId = "sales.saved-view.table" | "sales.saved-view.kanban" | "sales.saved-view.calendar";
export type SalesSavedViewVisibility = Readonly<{
    kind: "personal";
} | {
    kind: "team";
    teamId: string;
}>;
export interface SalesSavedViewSourceBinding {
    readonly id: SalesSavedViewSourceId;
    readonly version: 1;
    readonly sourceSchema: Readonly<{
        id: string;
        version: 1;
    }>;
    readonly structuralCompatibilityHash: string;
}
export interface SalesSavedViewDefinition {
    readonly kind: "table" | "kanban" | "calendar";
    readonly targetObjectId: "sales.object.account" | "sales.object.contact" | "sales.object.lead" | "sales.object.opportunity" | "sales.object.task" | "sales.object.activity";
    readonly source: SalesSavedViewSourceBinding;
    readonly fields: readonly string[];
    readonly filters: readonly Readonly<{
        fieldId: string;
        operator: string;
        value?: unknown;
    }>[];
    readonly sorts: readonly Readonly<{
        fieldId: string;
        direction: "asc" | "desc";
    }>[];
    readonly grouping?: "stage-id";
    readonly dateField?: "scheduled-at" | "occurred-at";
    readonly calendarRange?: Readonly<{
        start: string;
        end: string;
        timezone: string;
    }>;
    readonly presentation: Readonly<{
        density: "comfortable" | "compact";
    } | {
        mode: "agenda" | "month";
    }>;
    readonly pageSize: number;
}
export interface SalesSavedViewBindingInput {
    readonly "saved-view-id"?: number;
    readonly "expected-revision"?: number;
}
export interface CompiledSalesSavedView {
    readonly selectedFields: readonly string[];
    readonly query: DataSourceQueryControls;
}
export interface SalesReportingTimezone {
    readonly timezone: string;
    readonly revision: number;
}
export interface SalesSavedViewCompileContext {
    readonly reportingTimezone?: SalesReportingTimezone;
    readonly now?: Date;
}
/** Exact persisted Saved View byte representation: recursively key-sorted and whitespace-free. */
export declare const canonicalSalesSavedViewJson: (value: unknown) => string;
export declare const isSalesBoundedNfcText: (value: unknown, maxUtf8Bytes?: number) => value is string;
export declare function canonicalSalesCalendarRange(reportingTimezone: SalesReportingTimezone, now?: Date): Readonly<{
    start: string;
    end: string;
    timezone: string;
}>;
export declare function parseSalesSavedViewBindingInput(value: unknown): Readonly<{
    savedViewId?: number;
    expectedRevision?: number;
}>;
/** Validates the persisted closed grammar and compiles only platform query controls. */
export declare function compileSalesSavedViewDefinition(definition: unknown, sourceId: SalesSavedViewSourceId, selectedFields: readonly string[], pageNumber: number, context?: SalesSavedViewCompileContext): CompiledSalesSavedView;
export declare function validateSalesPipelineSnapshotInput(value: unknown, applicationId: string, environment: string, deriveStageId: (applicationId: string, environment: string, pipelineId: number, semantic: SalesOpportunityStage) => string): Readonly<Record<string, unknown>>;
export declare const salesTimelineFields: NonNullable<DataSourceDescriptor["outputFields"]>;
export declare const salesTimelineDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
/** Recipient-scoped work queues expose neither provider data nor credential references. */
export declare const salesNotificationFields: readonly {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}[];
export declare const salesReminderFields: readonly {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}[];
/** Public provider configuration status. Secret references and values are intentionally unrepresentable. */
export declare const salesProviderConfigurationFields: readonly {
    id: string;
    kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
    binding: "optional" | "required";
    nullable: boolean;
    permission: string;
    sortable: boolean;
    filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
}[];
export declare const salesNotificationsDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesRemindersDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesProviderConfigurationsDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    primaryContract: {
        id: "metric.scalar" | "table.records";
        version: number;
    };
    sourceSchema: {
        id: string;
        version: number;
    };
    audience: "authenticated" | "public" | "internal";
    surfaces: ("system" | "workspace" | "cms" | "public" | "driver" | "mobile")[];
    permission: string;
    structuralCompatibilityHash: string;
    presentationMetadataRevision: number;
    title: string;
    inputFields: {
        id: string;
        kind: "string" | "number" | "boolean" | "integer" | "enum" | "date" | "datetime";
        required: boolean;
        nullable: boolean;
    }[];
    paginationModes: ("offset" | "cursor")[];
    limits: {
        maxSelectedFields: number;
        maxPageSize: number;
        maxFilters: number;
        maxSorts: number;
        maxBodyBytes: number;
        maxResultBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxConcurrency: number;
        ratePerMinute: number;
        burst: number;
        costClass: "medium" | "low" | "high";
        maxCost: number;
    };
    cacheClass: "public" | "no-store" | "actor" | "authorization-context";
    description?: string | undefined;
    outputFields?: {
        id: string;
        kind: "number" | "boolean" | "resource" | "integer" | "status" | "money" | "enum" | "date" | "datetime" | "duration" | "decimal" | "percentage" | "text";
        binding: "optional" | "required";
        nullable: boolean;
        permission: string;
        sortable: boolean;
        filterOperators: ("in" | "contains" | "eq" | "neq" | "not-in" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "is-not-null")[];
    }[] | undefined;
};
export declare const salesAccountsOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesContactsOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesLeadsOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesAccountDetailOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesContactDetailOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesLeadDetailOutputRuntimeSchema: RuntimeSchema<TableRecords>;
export declare const salesTimelineOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesNotificationsOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesRemindersOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesProviderConfigurationsOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesImportJobListOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesImportJobDetailOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesExportJobListOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesExportJobDetailOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesDedupeCandidatesOutputRuntimeSchema: RuntimeSchema<{
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
export declare const salesImportJobDetailInputRuntimeSchema: RuntimeSchema<Readonly<Record<string, number>>>;
export declare const salesExportJobDetailInputRuntimeSchema: RuntimeSchema<Readonly<Record<string, number>>>;
export declare const salesDedupeCandidatesInputRuntimeSchema: RuntimeSchema<Readonly<Record<string, unknown>>>;
export declare const salesCrmDetailInputRuntimeSchema: RuntimeSchema<Readonly<{
    id: string;
}>>;
export declare const salesTimelineInputRuntimeSchema: RuntimeSchema<Readonly<{
    relatedRecordType: "sales.account" | "sales.contact" | "sales.lead" | "sales.opportunity" | "sales.task";
    relatedRecordId: string;
}>>;
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
}
export interface CreateTaskOutput {
    readonly id: string;
    readonly title: string;
    readonly status: "open" | "completed" | "cancelled";
    readonly revision: number;
}
export interface UpdateTaskInput {
    readonly id: string;
    readonly expectedRevision: number;
    readonly expectedStatus: "open";
    readonly status: "completed" | "cancelled";
}
export interface UpdateTaskOutput {
    readonly id: string;
    readonly title: string;
    readonly status: "open" | "completed" | "cancelled";
    readonly revision: number;
}
export type SalesOpportunityStage = "qualification" | "discovery" | "proposal" | "negotiation" | "won" | "lost";
export interface UpdateOpportunityStageInput {
    readonly id: string;
    readonly expectedRevision: number;
    readonly expectedPipelineId: string;
    readonly expectedPipelineRevision: number;
    readonly expectedSourceStageId: string;
    readonly expectedSourceStageRevision: number;
    readonly destinationStageId: string;
    readonly expectedDestinationStageRevision: number;
}
export interface UpdateOpportunityStageOutput {
    readonly id: string;
    readonly revision: number;
    readonly pipelineId: string;
    readonly stageId: string;
}
export declare function isSalesRecordId(value: unknown): value is string;
export declare const salesEmptyInputRuntimeSchema: RuntimeSchema<Record<string, never>>;
export declare const salesCreateTaskInputRuntimeSchema: RuntimeSchema<CreateTaskInput>;
export declare const salesCreateTaskOutputRuntimeSchema: RuntimeSchema<CreateTaskOutput>;
export declare const salesUpdateTaskInputRuntimeSchema: RuntimeSchema<UpdateTaskInput>;
export declare const salesUpdateTaskOutputRuntimeSchema: RuntimeSchema<UpdateTaskOutput>;
export declare const salesOpportunityStageInputRuntimeSchema: RuntimeSchema<UpdateOpportunityStageInput>;
export declare const salesOpportunityStageOutputRuntimeSchema: RuntimeSchema<UpdateOpportunityStageOutput>;
export declare const salesTasksOutputRuntimeSchema: RuntimeSchema<TableRecords>;
export declare const salesOpportunitiesOutputRuntimeSchema: RuntimeSchema<TableRecords>;
export declare const salesOpportunityDetailOutputRuntimeSchema: RuntimeSchema<TableRecords>;
export declare const salesTaskCreateDescriptor: {
    readonly id: "sales.task.create";
    readonly version: 2;
    readonly ownerPluginId: "module.sales";
    readonly inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    readonly outputSchema: {
        readonly type: import("zod").infer<import("zod").ZodEnum<{
            string: "string";
            number: "number";
            boolean: "boolean";
            object: "object";
            array: "array";
            null: "null";
            integer: "integer";
        }>>;
        readonly title?: string | undefined;
        readonly description?: string | undefined;
        readonly enum?: readonly import("@k-nex/contracts").AgentToolJsonScalar[] | undefined;
        readonly properties?: Readonly<Record<string, AgentToolJsonSchema>> | undefined;
        readonly required?: readonly string[] | undefined;
        readonly additionalProperties?: false | undefined;
        readonly items?: AgentToolJsonSchema | undefined;
        readonly minLength?: number | undefined;
        readonly maxLength?: number | undefined;
        readonly maxUtf8Bytes?: number | undefined;
        readonly minimum?: number | undefined;
        readonly maximum?: number | undefined;
        readonly minItems?: number | undefined;
        readonly maxItems?: number | undefined;
    };
    readonly permission: "sales.tasks.write";
    readonly policy: "sales.policy.tasks.current";
    readonly effect: "write";
    readonly idempotency: "required";
    readonly dryRun: false;
};
export declare const salesTaskUpdateDescriptor: ActionDescriptor;
export declare const salesOpportunityStageUpdateDescriptor: ActionDescriptor;
export declare const salesAccountCreateDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesAccountUpdateDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesAccountArchiveDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesContactCreateDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesContactUpdateDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesContactArchiveDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesLeadCreateDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesLeadUpdateDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesLeadQualifyDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesLeadDisqualifyDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesLeadArchiveDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesOpportunityCreateDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesOpportunityUpdateDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesOpportunityCloseDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesOpportunityArchiveDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesPipelineUpdateDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesPipelineArchiveDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesSavedViewCreateDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesSavedViewUpdateDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesSavedViewArchiveDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesActivityCreateDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesActivityCompleteDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesActivityCancelDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesNoteCreateDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesAttachmentLinkDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesAttachmentRemoveDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesOwnershipAssignDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesImportDryRunDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesImportCommitDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesImportCancelDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesExportCreateDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesExportCancelDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesMergeCommitDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesEmailSendDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesCalendarSyncDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesReminderScheduleDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesNotificationReadDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesNotificationArchiveDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesReminderDismissDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesIntegrationConfigureDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesReportRunDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesReportScheduleDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
};
export declare const salesWorkflowActionInputRuntimeSchemas: Readonly<Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>>;
export declare const salesWorkflowActionOutputRuntimeSchemas: Readonly<Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>>;
export declare const salesDataMovementActionInputRuntimeSchemas: Readonly<Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>>;
export declare const salesCommunicationActionDescriptors: readonly {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
}[];
export declare const salesCommunicationActionInputRuntimeSchemas: Readonly<Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>>;
export declare const salesCommunicationActionOutputRuntimeSchemas: Readonly<Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>>;
export declare const salesReportActionDescriptors: readonly [{
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
}, {
    id: string;
    version: number;
    ownerPluginId: string;
    inputSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    permission: string;
    policy: string;
    effect: "write" | "external" | "read-only" | "destructive";
    idempotency: "required" | "not-applicable";
    dryRun: boolean;
    outputSchema?: AgentToolJsonSchema | undefined;
    outputContract?: string | undefined;
}];
export declare const salesReportActionInputRuntimeSchemas: Readonly<Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>>;
export declare const salesReportActionOutputRuntimeSchemas: Readonly<Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>>;
export declare const salesDataMovementActionOutputRuntimeSchemas: Readonly<Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>>;
export declare const salesSearchTasksDescriptor: AgentToolDescriptor;
export declare const salesCreateTaskToolDescriptor: AgentToolDescriptor;
export declare const salesWorkspaceSettingsDescriptor: SystemSettingsDescriptor;
export type SalesWorkspaceSettings = Readonly<{
    defaultTaskPageSize: number;
    showPotentialRevenue: boolean;
    defaultPage: "overview" | "tasks" | "opportunities";
}>;
export declare const salesRouteDescriptors: readonly {
    id: string;
    ownerPluginId: string;
    path: string;
    parameters: Record<string, {
        type: "string" | "boolean" | "integer";
    }>;
    surface: "system" | "workspace" | "cms" | "public" | "driver" | "mobile";
    audience: "system" | "authenticated" | "public";
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
export declare const salesAccountsPageTemplate: {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
};
export declare const salesAccountDetailPageTemplate: {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
};
export declare const salesContactsPageTemplate: {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
};
export declare const salesContactDetailPageTemplate: {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
};
export declare const salesLeadsPageTemplate: {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
};
export declare const salesLeadDetailPageTemplate: {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
};
export declare const salesOpportunityDetailPageTemplate: {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
};
export declare const salesCalendarPageTemplate: {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
};
export declare const salesPipelineSettingsPageTemplate: {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
};
export declare const salesSavedViewsPageTemplate: {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
};
export declare const salesImportsPageTemplate: {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
};
export declare const salesExportsPageTemplate: {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
};
export declare const salesReportsPageTemplate: {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
};
export declare const salesNotificationsPageTemplate: {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
};
export declare const salesPageTemplates: readonly {
    id: string;
    version: number;
    ownerPluginId: string;
    route: {
        routeId: string;
        params: Record<string, string | number | boolean>;
    };
    surface: "workspace" | "cms" | "public";
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
export declare const salesCalendarBlockDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesPipelineSettingsBlockDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesSavedViewsBlockDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesSavedViewTableBlockDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesNotificationsBlockDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesRemindersBlockDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesCommunicationActionsBlockDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesIntegrationSettingsBlockDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesQuickCreateComponentDescriptor: PluginUiContributionDescriptor;
export declare const salesOpportunityListComponentDescriptor: PluginUiContributionDescriptor;
export declare const salesOpportunityDetailComponentDescriptor: PluginUiContributionDescriptor;
export declare const salesPipelineStatusComponentDescriptor: PluginUiContributionDescriptor;
export declare const salesQuickCreateBlockDescriptor: PluginUiContributionDescriptor;
export declare const salesOpportunityListBlockDescriptor: PluginUiContributionDescriptor;
export declare const salesOpportunityDetailBlockDescriptor: PluginUiContributionDescriptor;
export declare const salesOpportunityKanbanBlockDescriptor: PluginUiContributionDescriptor;
export declare const salesSettingsSummaryBlockDescriptor: PluginUiContributionDescriptor;
export declare const salesAccountListComponentDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesAccountDetailComponentDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesContactListComponentDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesContactDetailComponentDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesLeadListComponentDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesLeadDetailComponentDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesAccountListBlockDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesAccountDetailBlockDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesContactListBlockDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesContactDetailBlockDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesLeadListBlockDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesLeadDetailBlockDescriptor: {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
};
export declare const salesImportsBlockDescriptor: PluginUiContributionDescriptor;
export declare const salesExportsBlockDescriptor: PluginUiContributionDescriptor;
export declare const salesReportBlockDescriptors: readonly [{
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
}, {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
}, {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
}, {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
}, {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
}, {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
}, {
    id: string;
    version: number;
    ownerPluginId: string;
    kind: "block" | "component";
    propsSchema: {
        type: "object";
        properties: Record<string, AgentToolJsonSchema>;
        additionalProperties: false;
        title?: string | undefined;
        description?: string | undefined;
        required?: string[] | undefined;
    };
    profiles: ("workspace" | "cms")[];
    surfaces: ("workspace" | "cms" | "public")[];
    audience: "authenticated" | "public";
    requiredStates: ("error" | "forbidden" | "loading" | "empty")[];
    permission?: string | undefined;
    sourcePolicy?: {
        required: boolean;
        contracts: {
            id: "metric.scalar" | "table.records";
            version: number;
        }[];
        requiredFields: string[];
    } | undefined;
    actionPolicy?: {
        required: boolean;
        actions: {
            id: string;
            version: number;
        }[];
    } | undefined;
}];
export declare const salesUiComponentDescriptors: readonly PluginUiContributionDescriptor[];
export declare const salesUiBlockDescriptors: readonly PluginUiContributionDescriptor[];
export declare const salesEventDescriptors: readonly {
    id: string;
    version: number;
    ownerPluginId: string;
    eventClass: string;
    sourceId: string;
}[];
/**
 * The only Sales workflow trigger catalog.  It is source code, rather than
 * customer configuration, so a persisted record can never add a trigger or
 * widen its effect.
 */
export declare const salesWorkflowTriggerDescriptors: readonly [{
    readonly id: "sales.workflow.opportunity-proposal-follow-up";
    readonly version: 1;
    readonly eventId: "sales.event.workflow.opportunity-proposal-entered";
    readonly eventClass: "durable-workflow";
    readonly actionId: "sales.opportunity.stage.update";
    readonly effectKind: "create-owner-follow-up-task";
    readonly targetCollection: "sales-opportunities";
    readonly recipient: "accepted-owner";
    readonly fanout: 1;
    readonly depth: 1;
}, {
    readonly id: "sales.workflow.lead-owner-assigned-notification";
    readonly version: 1;
    readonly eventId: "sales.event.workflow.lead-owner-assigned";
    readonly eventClass: "durable-workflow";
    readonly actionId: "sales.ownership.assign";
    readonly effectKind: "notify-new-owner";
    readonly targetCollection: "sales-leads";
    readonly recipient: "accepted-owner";
    readonly fanout: 1;
    readonly depth: 1;
}, {
    readonly id: "sales.workflow.scheduled-activity-reminder";
    readonly version: 1;
    readonly eventId: "sales.event.workflow.activity-scheduled";
    readonly eventClass: "durable-workflow";
    readonly actionId: "sales.activity.create";
    readonly effectKind: "schedule-reminder";
    readonly targetCollection: "sales-activities";
    readonly recipient: "original-actor";
    readonly fanout: 1;
    readonly depth: 1;
}];
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
    reminderJob: {
        id: string;
        version: number;
        ownerPluginId: string;
        timeoutMs: number;
        maxConcurrency: number;
        idempotent: boolean;
    };
    workflowJob: {
        id: string;
        version: number;
        ownerPluginId: string;
        timeoutMs: number;
        maxConcurrency: number;
        idempotent: boolean;
    };
    reportJob: {
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
            "sales.message.navigation-reports": string;
            "sales.message.navigation-accounts": string;
            "sales.message.navigation-contacts": string;
            "sales.message.navigation-leads": string;
            "sales.message.navigation-notifications": string;
            "sales.message.template-v2": string;
            "sales.message.template-v3": string;
            "sales.message.template-v4": string;
            "sales.message.settings-template-v3": string;
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