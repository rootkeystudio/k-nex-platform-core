export declare const salesTaskTablePuckAuthoring: Readonly<{
    label: "Sales task table";
    fields: readonly {
        prop: string;
        label: string;
        kind: "text";
    }[];
    allowChildren: false;
    defaultProps: Readonly<{
        title: "Sales tasks";
    }>;
}>;
export declare const salesPuckBlockAuthoring: Readonly<{
    [k: string]: Readonly<{
        defaultBindings?: {
            source: {
                source: {
                    id: string;
                    version: number;
                };
                input: {};
                structuralCompatibilityHash: string;
                selectedFields?: never;
            };
            action?: never;
        } | {
            action: {
                id: "sales.task.create";
                version: number;
            };
            source?: never;
        } | {
            action?: {
                id: string;
                version: number;
            };
            source: {
                source: {
                    id: string;
                    version: number;
                };
                input: {};
                structuralCompatibilityHash: string;
                selectedFields: string[];
            };
        } | undefined;
        label: string;
        fields: readonly {
            prop: string;
            label: string;
            kind: "text";
        }[];
        allowChildren: false;
        defaultProps: Readonly<{
            title: string;
        }>;
    }>;
}>;
export declare const salesPuckBlockBridges: readonly import("@k-nex/builder-puck").PuckBlockBridge[];
//# sourceMappingURL=puck.d.ts.map