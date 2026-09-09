import type { CollectionConfig, Field } from "payload";
export declare const salesCoreCollectionSlugs: readonly ["sales-accounts", "sales-contacts", "sales-leads", "sales-pipelines", "sales-pipeline-stages", "sales-activities", "sales-opportunities", "sales-tasks", "sales-notes", "sales-attachment-references", "sales-saved-views", "sales-import-jobs", "sales-import-rows", "sales-import-chunks", "sales-export-jobs", "sales-merge-lineage", "sales-notifications", "sales-reminders"];
export declare const salesRelatedRecordTypes: readonly ["sales.account", "sales.contact", "sales.lead", "sales.opportunity", "sales.task"];
/** Fields controlled only by registered Sales actions; generic Payload access is denied. */
export declare function salesCommonFields(options: {
    readonly ownerRequired: boolean;
    readonly teamRequired?: boolean;
    readonly lifecycle?: readonly string[];
}): Field[];
export declare const salesAccountsCollection: CollectionConfig;
export declare const salesContactsCollection: CollectionConfig;
export declare const salesLeadsCollection: CollectionConfig;
export declare const salesPipelinesCollection: CollectionConfig;
export declare const salesPipelineStagesCollection: CollectionConfig;
export declare const salesSavedViewsCollection: CollectionConfig;
export declare const salesActivitiesCollection: CollectionConfig;
export declare const salesOpportunitiesCollection: CollectionConfig;
export declare const salesTasksCollection: CollectionConfig;
/** Recipient-only delivery records. Provider credentials and raw payloads never enter Sales rows. */
export declare const salesNotificationsCollection: CollectionConfig;
/** A reminder is always rooted in one open task or scheduled Activity and one exact recipient. */
export declare const salesRemindersCollection: CollectionConfig;
export declare const salesNotesCollection: CollectionConfig;
export declare const salesAttachmentReferencesCollection: CollectionConfig;
export declare const salesImportJobsCollection: CollectionConfig;
export declare const salesImportRowsCollection: CollectionConfig;
export declare const salesImportChunksCollection: CollectionConfig;
export declare const salesExportJobsCollection: CollectionConfig;
export declare const salesMergeLineageCollection: CollectionConfig;
export declare const salesCoreCollections: readonly CollectionConfig[];
//# sourceMappingURL=crm-core.d.ts.map