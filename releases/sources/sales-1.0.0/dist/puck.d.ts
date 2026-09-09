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
                input: {
                    "window-mode": string;
                } | {
                    id?: never;
                };
                structuralCompatibilityHash: string;
                selectedFields: string[];
            };
            action?: never;
        } | {
            action: {
                id: "sales.task.create";
                version: 2;
            };
            source?: never;
        } | {
            action?: {
                readonly id: string;
                readonly version: number;
            };
            source: {
                source: {
                    id: string;
                    version: number;
                };
                input: {
                    id: string;
                } | {
                    id?: never;
                };
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
            title?: never;
        } | {
            title: string;
        }>;
    }>;
}>;
export declare const salesPuckBlockBridges: readonly import("@k-nex/builder-puck").PuckBlockBridge[];
//# sourceMappingURL=puck.d.ts.map