import type { ActionDescriptor, AuthorizationPermissionDescriptor, PermissionPolicyBinding, PluginRouteDescriptor, RoleTemplate } from "@k-nex/contracts";
export declare const salesCrmPermissionIds: readonly ["sales.accounts.read", "sales.accounts.write", "sales.accounts.archive", "sales.contacts.read", "sales.contacts.write", "sales.contacts.archive", "sales.contacts.channels.read", "sales.leads.read", "sales.leads.write", "sales.leads.archive", "sales.leads.channels.read", "sales.leads.qualify", "sales.leads.disqualify", "sales.opportunities.read", "sales.opportunities.write", "sales.opportunities.archive", "sales.opportunities.amount.read", "sales.opportunities.stage.update", "sales.opportunities.close", "sales.activities.read", "sales.activities.write", "sales.tasks.read", "sales.tasks.write", "sales.tasks.archive", "sales.notes.read", "sales.notes.write", "sales.notes.body.read", "sales.attachments.read", "sales.attachments.write", "sales.pipelines.read", "sales.pipelines.configure", "sales.saved-views.read", "sales.saved-views.write", "sales.imports.read", "sales.imports.execute", "sales.exports.read", "sales.exports.execute", "sales.notifications.read", "sales.notifications.write", "sales.reminders.read", "sales.reminders.write", "sales.reports.read", "sales.reports.schedule", "sales.communications.email.send", "sales.communications.calendar.sync", "sales.communications.metadata.read", "sales.ownership.write", "sales.records.merge", "sales.settings.read", "sales.settings.write"];
export declare const salesCrmPermissionDescriptors: readonly AuthorizationPermissionDescriptor[];
export declare const salesCrmObjectFieldActionMatrix: readonly [{
    readonly objectId: "sales.object.account";
    readonly readPermissionId: "sales.accounts.read";
    readonly writePermissionId: "sales.accounts.write";
    readonly archivePermissionId: "sales.accounts.archive";
    readonly recordPolicyId: "sales.policy.accounts.current";
    readonly actionPermissions: {
        readonly "sales.account.create": "sales.accounts.write";
        readonly "sales.account.update": "sales.accounts.write";
        readonly "sales.account.archive": "sales.accounts.archive";
        readonly "sales.merge.commit": "sales.records.merge";
    };
}, {
    readonly objectId: "sales.object.contact";
    readonly readPermissionId: "sales.contacts.read";
    readonly writePermissionId: "sales.contacts.write";
    readonly archivePermissionId: "sales.contacts.archive";
    readonly recordPolicyId: "sales.policy.contacts.current";
    readonly sensitiveFields: {
        readonly email: "sales.contacts.channels.read";
        readonly phone: "sales.contacts.channels.read";
    };
    readonly actionPermissions: {
        readonly "sales.contact.create": "sales.contacts.write";
        readonly "sales.contact.update": "sales.contacts.write";
        readonly "sales.contact.archive": "sales.contacts.archive";
        readonly "sales.merge.commit": "sales.records.merge";
    };
}, {
    readonly objectId: "sales.object.lead";
    readonly readPermissionId: "sales.leads.read";
    readonly writePermissionId: "sales.leads.write";
    readonly archivePermissionId: "sales.leads.archive";
    readonly recordPolicyId: "sales.policy.leads.current";
    readonly sensitiveFields: {
        readonly email: "sales.leads.channels.read";
        readonly phone: "sales.leads.channels.read";
    };
    readonly actionPermissions: {
        readonly "sales.lead.create": "sales.leads.write";
        readonly "sales.lead.update": "sales.leads.write";
        readonly "sales.lead.qualify": "sales.leads.qualify";
        readonly "sales.lead.disqualify": "sales.leads.disqualify";
        readonly "sales.lead.archive": "sales.leads.archive";
    };
}, {
    readonly objectId: "sales.object.opportunity";
    readonly readPermissionId: "sales.opportunities.read";
    readonly writePermissionId: "sales.opportunities.write";
    readonly archivePermissionId: "sales.opportunities.archive";
    readonly recordPolicyId: "sales.policy.opportunities.current";
    readonly sensitiveFields: {
        readonly amount: "sales.opportunities.amount.read";
    };
    readonly actionPermissions: {
        readonly "sales.opportunity.create": "sales.opportunities.write";
        readonly "sales.opportunity.update": "sales.opportunities.write";
        readonly "sales.opportunity.stage.update": "sales.opportunities.stage.update";
        readonly "sales.opportunity.close": "sales.opportunities.close";
        readonly "sales.opportunity.archive": "sales.opportunities.archive";
    };
}, {
    readonly objectId: "sales.object.pipeline";
    readonly readPermissionId: "sales.pipelines.read";
    readonly writePermissionId: "sales.pipelines.configure";
    readonly recordPolicyId: "sales.policy.pipelines.current";
    readonly actionPermissions: {
        readonly "sales.pipeline.update": "sales.pipelines.configure";
        readonly "sales.pipeline.archive": "sales.pipelines.configure";
    };
}, {
    readonly objectId: "sales.object.pipeline-stage";
    readonly readPermissionId: "sales.pipelines.read";
    readonly writePermissionId: "sales.pipelines.configure";
    readonly recordPolicyId: "sales.policy.pipelines.current";
}, {
    readonly objectId: "sales.object.activity";
    readonly readPermissionId: "sales.activities.read";
    readonly writePermissionId: "sales.activities.write";
    readonly recordPolicyId: "sales.policy.activities.current";
    readonly sensitiveFields: {
        readonly providerMetadata: "sales.communications.metadata.read";
    };
    readonly actionPermissions: {
        readonly "sales.activity.create": "sales.activities.write";
        readonly "sales.activity.complete": "sales.activities.write";
        readonly "sales.activity.cancel": "sales.activities.write";
        readonly "sales.email.send": "sales.communications.email.send";
        readonly "sales.calendar.sync": "sales.communications.calendar.sync";
    };
}, {
    readonly objectId: "sales.object.task";
    readonly readPermissionId: "sales.tasks.read";
    readonly writePermissionId: "sales.tasks.write";
    readonly archivePermissionId: "sales.tasks.archive";
    readonly recordPolicyId: "sales.policy.tasks.current";
    readonly actionPermissions: {
        readonly "sales.task.create": "sales.tasks.write";
        readonly "sales.task.update": "sales.tasks.write";
        readonly "sales.task.archive": "sales.tasks.archive";
    };
}, {
    readonly objectId: "sales.object.note";
    readonly readPermissionId: "sales.notes.read";
    readonly writePermissionId: "sales.notes.write";
    readonly recordPolicyId: "sales.policy.notes.current";
    readonly sensitiveFields: {
        readonly body: "sales.notes.body.read";
    };
    readonly actionPermissions: {
        readonly "sales.note.create": "sales.notes.write";
    };
}, {
    readonly objectId: "sales.object.attachment-reference";
    readonly readPermissionId: "sales.attachments.read";
    readonly writePermissionId: "sales.attachments.write";
    readonly recordPolicyId: "sales.policy.attachments.current";
    readonly actionPermissions: {
        readonly "sales.attachment.link": "sales.attachments.write";
        readonly "sales.attachment.remove": "sales.attachments.write";
    };
}, {
    readonly objectId: "sales.object.saved-view";
    readonly readPermissionId: "sales.saved-views.read";
    readonly writePermissionId: "sales.saved-views.write";
    readonly recordPolicyId: "sales.policy.saved-views.current";
    readonly actionPermissions: {
        readonly "sales.saved-view.create": "sales.saved-views.write";
        readonly "sales.saved-view.update": "sales.saved-views.write";
        readonly "sales.saved-view.archive": "sales.saved-views.write";
    };
}, {
    readonly objectId: "sales.object.import-job";
    readonly readPermissionId: "sales.imports.read";
    readonly writePermissionId: "sales.imports.execute";
    readonly recordPolicyId: "sales.policy.imports.current";
    readonly actionPermissions: {
        readonly "sales.import.dry-run": "sales.imports.execute";
        readonly "sales.import.commit": "sales.imports.execute";
        readonly "sales.import.cancel": "sales.imports.execute";
    };
}, {
    readonly objectId: "sales.object.export-job";
    readonly readPermissionId: "sales.exports.read";
    readonly writePermissionId: "sales.exports.execute";
    readonly recordPolicyId: "sales.policy.exports.current";
    readonly actionPermissions: {
        readonly "sales.export.create": "sales.exports.execute";
        readonly "sales.export.cancel": "sales.exports.execute";
    };
}, {
    readonly objectId: "sales.object.notification";
    readonly readPermissionId: "sales.notifications.read";
    readonly writePermissionId: "sales.notifications.write";
    readonly recordPolicyId: "sales.policy.notifications.recipient";
    readonly actionPermissions: {
        readonly "sales.notification.read": "sales.notifications.write";
        readonly "sales.notification.archive": "sales.notifications.write";
    };
}, {
    readonly objectId: "sales.object.reminder";
    readonly readPermissionId: "sales.reminders.read";
    readonly writePermissionId: "sales.reminders.write";
    readonly recordPolicyId: "sales.policy.reminders.recipient";
    readonly actionPermissions: {
        readonly "sales.reminder.dismiss": "sales.reminders.write";
        readonly "sales.reminder.schedule": "sales.reminders.write";
    };
}];
export declare const salesCrmPermissionPolicyBindings: readonly PermissionPolicyBinding[];
export declare const salesCrmRoleTemplates: readonly RoleTemplate[];
export declare const salesPhoneMaxLength = 64;
export declare const salesCalendarDatePattern = "^(?:000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3})-[0-9]{2}-[0-9]{2}$";
export declare function isSalesCalendarDate(value: unknown): value is string;
export declare const salesCrmActionDescriptors: readonly ActionDescriptor[];
export declare const salesCrmRouteDescriptors: readonly PluginRouteDescriptor[];
export declare const salesCrmRoutePermissions: Readonly<{
    readonly "sales.route.overview": "sales.reports.read";
    readonly "sales.route.tasks": "sales.tasks.read";
    readonly "sales.route.notifications": "sales.notifications.read";
    readonly "sales.route.leads": "sales.leads.read";
    readonly "sales.route.lead-detail": "sales.leads.read";
    readonly "sales.route.accounts": "sales.accounts.read";
    readonly "sales.route.account-detail": "sales.accounts.read";
    readonly "sales.route.contacts": "sales.contacts.read";
    readonly "sales.route.contact-detail": "sales.contacts.read";
    readonly "sales.route.opportunities": "sales.opportunities.read";
    readonly "sales.route.opportunity-detail": "sales.opportunities.read";
    readonly "sales.route.pipeline-settings": "sales.pipelines.configure";
    readonly "sales.route.saved-views": "sales.saved-views.read";
    readonly "sales.route.imports": "sales.imports.read";
    readonly "sales.route.exports": "sales.exports.read";
    readonly "sales.route.calendar": "sales.activities.read";
    readonly "sales.route.reports": "sales.reports.read";
}>;
//# sourceMappingURL=crm-authority.d.ts.map