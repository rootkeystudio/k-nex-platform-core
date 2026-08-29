import { type UiBlockRenderInput, type UiContributionDefinition } from "@k-nex/ui-runtime";
export { salesNavigationDescriptors, salesRouteDescriptors, salesTaskPageTemplate } from "./contracts.js";
export type SalesUiRenderState = NonNullable<UiBlockRenderInput["sourceResult"]>["state"] | "idle";
export interface SalesTaskTablePresentation {
    readonly kind: "data-table";
    readonly component: "DataTable";
    readonly title: string;
    readonly accessibility: Readonly<{
        readonly role: "table";
        readonly label: string;
    }>;
    readonly state: SalesUiRenderState;
    readonly element: unknown;
    readonly action?: NonNullable<UiBlockRenderInput["action"]>;
    readonly table?: unknown;
    readonly problemCode?: string;
}
export interface SalesContributionPresentation {
    readonly kind: "data-table" | "metric" | "form" | "data-list" | "detail" | "status" | "settings-summary";
    readonly component: string;
    readonly title: string;
    readonly accessibility: Readonly<{
        readonly role: "table" | "form" | "list" | "status" | "region";
        readonly label: string;
    }>;
    readonly state: SalesUiRenderState;
    readonly element: unknown;
    readonly action?: NonNullable<UiBlockRenderInput["action"]>;
    readonly data?: unknown;
    readonly problemCode?: string;
}
export declare function salesTaskTableRenderer(input: UiBlockRenderInput): Readonly<SalesTaskTablePresentation>;
export declare const salesTaskTableComponent: UiContributionDefinition<Readonly<SalesTaskTablePresentation>>;
export declare const salesTaskTableBlock: UiContributionDefinition<Readonly<SalesTaskTablePresentation>>;
export declare const salesUiComponentDefinitions: readonly (UiContributionDefinition<Readonly<SalesTaskTablePresentation>> | UiContributionDefinition<Readonly<SalesContributionPresentation>>)[];
export declare const salesUiBlockDefinitions: readonly (UiContributionDefinition<Readonly<SalesTaskTablePresentation>> | UiContributionDefinition<Readonly<SalesContributionPresentation>>)[];
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
export declare const salesWorkspaceUiContract: Readonly<{
    pluginId: "module.sales";
    surface: "workspace";
    sourceIds: readonly string[];
    actionIds: readonly string[];
    routeIds: readonly string[];
    pageTemplateIds: readonly string[];
    componentIds: readonly string[];
    blockIds: readonly string[];
}>;
//# sourceMappingURL=ui.d.ts.map