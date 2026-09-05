import type { ReactElement, ReactNode } from "react";

import { Alert, Badge, Button, Dialog, Heading, List, SkipLink, Stack, Status, Table, Text } from "@k-nex/ui-components";

import { SettingsPage, type PageTemplateProps } from "./templates.js";

export interface SystemAdministrationHiddenField {
  /** Server-projected string or JSON value; the mutation handler revalidates it. */
  readonly value: string;
  readonly name: string;
}

export interface SystemAdministrationForm {
  /** Fixed server route for this already-authorized operation. */
  readonly actionUrl: string;
  readonly method?: "post";
  readonly hiddenFields?: readonly SystemAdministrationHiddenField[];
  readonly textArea?: Readonly<{ readonly name: string; readonly label: string; readonly value: string; readonly rows?: number }>;
  readonly selection?: Readonly<{
    readonly name: string;
    readonly label: string;
    readonly options: readonly Readonly<{ readonly value: string; readonly label: string; readonly selected?: boolean }>[];
  }>;
  readonly inputs?: readonly Readonly<{
    readonly name: string;
    readonly label: string;
    readonly type: "text" | "password" | "number" | "select";
    readonly value?: string | number;
    readonly min?: number;
    readonly max?: number;
    readonly options?: readonly Readonly<{ readonly value: string; readonly label: string }>[];
  }>[];
}

export interface SystemAdministrationAction {
  /** The server-selected action callback receives no client-supplied authority fields. */
  readonly invoke?: () => void;
  /** A no-JavaScript mutation path with server-projected operation inputs only. */
  readonly form?: SystemAdministrationForm;
  readonly label: string;
  readonly disabled?: boolean;
  readonly confirmation?: Readonly<{ readonly title: string; readonly description: string; readonly confirmLabel?: string }>;
}

export interface SystemAdministrationState {
  readonly state?: "ready" | "denied" | "stale";
  readonly message?: string;
  readonly refresh?: SystemAdministrationAction;
}

export interface SystemAdministrationNavigationItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
}

export interface SystemAdministrationPageView extends SystemAdministrationState {
  readonly title: string;
  readonly navigation: readonly SystemAdministrationNavigationItem[];
  readonly description?: string;
  readonly revision?: string;
}

export interface SystemRoleListItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly assignmentCount: string;
  readonly permissionCount: string;
  readonly state: string;
}

export interface SystemRolesViewModel extends SystemAdministrationPageView {
  readonly roles: readonly SystemRoleListItem[];
  readonly createRole?: SystemAdministrationAction;
}

export interface SystemPermissionAction {
  readonly label: string;
  readonly description?: string;
  readonly add?: SystemAdministrationAction;
  readonly remove?: SystemAdministrationAction;
}

export interface SystemPermissionOperationGroup {
  readonly operation: string;
  readonly permissions: readonly SystemPermissionAction[];
}

export interface SystemPermissionResourceGroup {
  readonly resource: string;
  readonly operations: readonly SystemPermissionOperationGroup[];
}

export interface SystemPermissionOwnerGroup {
  readonly owner: string;
  readonly resources: readonly SystemPermissionResourceGroup[];
}

export interface SystemInactiveDiagnostic {
  readonly id: string;
  readonly label: string;
  readonly state: string;
  readonly detail: string;
}

export interface SystemRoleTemplateAction {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly instantiate?: SystemAdministrationAction;
  readonly copySelected?: SystemAdministrationAction;
}

export interface SystemRoleDetailViewModel extends SystemAdministrationPageView {
  readonly roleLabel: string;
  readonly roleState: string;
  readonly activePermissionGroups: readonly SystemPermissionOwnerGroup[];
  readonly templates: readonly SystemRoleTemplateAction[];
  readonly inactiveDiagnostics: readonly SystemInactiveDiagnostic[];
  readonly save?: SystemAdministrationAction;
}

export interface SystemPermissionListItem {
  readonly id: string;
  readonly label: string;
  readonly owner: string;
  readonly resource: string;
  readonly operation: string;
  readonly state: string;
  readonly detail?: string;
}

export interface SystemPermissionsViewModel extends SystemAdministrationPageView {
  readonly permissions: readonly SystemPermissionListItem[];
}

export interface SystemAssignmentListItem {
  readonly id: string;
  readonly principal: string;
  readonly role: string;
  readonly state: string;
  readonly revision: string;
  readonly detail?: string;
  readonly revoke?: SystemAdministrationAction;
  readonly reactivate?: SystemAdministrationAction;
}

export interface SystemAssignmentsViewModel extends SystemAdministrationPageView {
  readonly assignments: readonly SystemAssignmentListItem[];
  readonly createAssignment?: SystemAdministrationAction;
  readonly manageAssignments?: SystemAdministrationAction;
}

export interface SystemTemplateListItem {
  readonly id: string;
  readonly title: string;
  readonly owner: string;
  readonly version: string;
  readonly state: string;
  readonly detail?: string;
  readonly instantiate?: SystemAdministrationAction;
}

export interface SystemTemplatesViewModel extends SystemAdministrationPageView {
  readonly templates: readonly SystemTemplateListItem[];
}

export interface SystemAuthorizationAuditItem {
  readonly id: string;
  readonly occurredAt: string;
  readonly outcome: string;
  readonly reason: string;
  readonly permission: string;
  readonly owner: string;
  readonly revision: string;
}

export interface SystemAuthorizationAuditViewModel extends SystemAdministrationPageView {
  readonly events: readonly SystemAuthorizationAuditItem[];
}

export interface SystemExtensionListItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Exact server-provided delivery class label; the browser does not derive it. */
  readonly deliveryClassLabel: string;
  /** Exact server-provided availability truth, including maintenance-required. */
  readonly availabilityLabel: string;
  readonly lifecycleLabel: string;
  readonly revision: string;
}

export interface SystemExtensionsViewModel extends SystemAdministrationPageView {
  readonly extensions: readonly SystemExtensionListItem[];
}

export interface SystemExtensionDetailViewModel extends SystemAdministrationPageView {
  readonly extensionLabel: string;
  readonly extensionId: string;
  readonly deliveryClassLabel: string;
  readonly availabilityLabel: string;
  readonly lifecycleLabel: string;
  readonly impact: string;
  readonly approval: string;
  readonly audit: string;
  readonly plan?: SystemAdministrationAction;
  readonly execute?: SystemAdministrationAction;
  readonly actions?: readonly SystemAdministrationAction[];
}

export interface SystemThemePackageListItem {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly surfaces: string;
  readonly availability: string;
  readonly referenceImpact: string;
}

export interface SystemThemeSkinListItem {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly lifecycle: string;
  readonly actions: string;
}

export interface SystemThemeProfileListItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly surface: string;
  readonly package: string;
  readonly skin: string;
  readonly revision: string;
  readonly accessibility: string;
}

export interface SystemThemesViewModel extends SystemAdministrationPageView {
  readonly packages: readonly SystemThemePackageListItem[];
  readonly skins: readonly SystemThemeSkinListItem[];
  readonly profiles: readonly SystemThemeProfileListItem[];
}

export interface SystemThemeProfileDetailViewModel extends SystemAdministrationPageView {
  readonly profileLabel: string;
  readonly profileId: string;
  readonly surface: string;
  readonly package: string;
  readonly skin: string;
  readonly publication: string;
  readonly accessibility: string;
  readonly preview?: SystemAdministrationAction;
  readonly stage?: SystemAdministrationAction;
  readonly publish?: SystemAdministrationAction;
  readonly rollback?: SystemAdministrationAction;
}

export interface SystemOperationListItem {
  readonly id: string;
  readonly source: string;
  readonly href: string;
  readonly state: string;
  readonly receipt: string;
}

export interface SystemHealthListItem {
  readonly id: string;
  readonly source: string;
  readonly state: string;
  readonly revision: string;
  readonly checks: string;
}

export interface SystemOperationsViewModel extends SystemAdministrationPageView {
  readonly operations: readonly SystemOperationListItem[];
  readonly health: readonly SystemHealthListItem[];
  readonly backup?: SystemAdministrationAction;
  readonly restoreDrill?: SystemAdministrationAction;
}

export interface SystemOperationDetailViewModel extends SystemAdministrationPageView {
  readonly operationId: string;
  readonly source: string;
  readonly operationState: string;
  readonly receipt: string;
  readonly inventory: string;
  readonly audit: string;
}

export interface SystemSettingsListItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly owner: string;
  readonly state: string;
  readonly revision: string;
}

export interface SystemSettingsViewModel extends SystemAdministrationPageView {
  readonly settings: readonly SystemSettingsListItem[];
}

export interface SystemSettingsFieldItem {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly state: string;
}

export interface SystemSettingsDetailViewModel extends SystemAdministrationPageView {
  readonly settingsId: string;
  readonly settingsLabel: string;
  readonly owner: string;
  readonly documentState: string;
  readonly fields: readonly SystemSettingsFieldItem[];
  readonly save?: SystemAdministrationAction;
}

export interface SystemWorkspacePageListItem {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly state: string;
  readonly placement: string;
  readonly theme: string;
  readonly impact: string;
  readonly revision: string;
}

export interface SystemWorkspaceFolderListItem {
  readonly id: string;
  readonly label: string;
  readonly parent: string;
  readonly order: string;
  readonly revision: string;
  readonly update?: SystemAdministrationAction;
}

export interface SystemWorkspacePagesViewModel extends SystemAdministrationPageView {
  readonly pages: readonly SystemWorkspacePageListItem[];
  readonly folders: readonly SystemWorkspaceFolderListItem[];
  readonly create?: SystemAdministrationAction;
  readonly createFolder?: SystemAdministrationAction;
}

export interface SystemWorkspacePageAccessItem {
  readonly subject: string;
  readonly capability: "view" | "edit";
}

export interface SystemWorkspacePageAuditItem {
  readonly id: string;
  readonly operation: string;
  readonly actor: string;
  readonly revision: string;
  readonly occurredAt: string;
}

export interface SystemWorkspacePageDetailViewModel extends SystemAdministrationPageView {
  readonly pageId: string;
  readonly pageTitle: string;
  readonly pageState: string;
  readonly placement: string;
  readonly theme: string;
  readonly impact: string;
  readonly viewHref?: string;
  readonly editorHref?: string;
  readonly access: readonly SystemWorkspacePageAccessItem[];
  readonly audit: readonly SystemWorkspacePageAuditItem[];
  readonly saveMetadata?: SystemAdministrationAction;
  readonly replaceAccess?: SystemAdministrationAction;
  readonly archive?: SystemAdministrationAction;
}

function administrationNavigation(navigation: readonly SystemAdministrationNavigationItem[], current: string): ReactElement {
  return <nav aria-label="System administration"><List>{navigation.map((item) => <li key={item.id}><a href={item.href} aria-current={item.id === current ? "page" : undefined}>{item.label}</a></li>)}</List></nav>;
}

function actionControl(action: SystemAdministrationAction): ReactElement {
  if (action.form !== undefined) return <form action={action.form.actionUrl} method={action.form.method ?? "post"}>
    {action.form.hiddenFields?.map((field) => <input key={field.name} type="hidden" name={field.name} value={field.value} />)}
    {action.form.textArea === undefined ? null : <label>{action.form.textArea.label}<textarea name={action.form.textArea.name} defaultValue={action.form.textArea.value} rows={action.form.textArea.rows ?? 16} /></label>}
    {action.form.selection === undefined ? null : <fieldset><legend>{action.form.selection.label}</legend>{action.form.selection.options.map((option) => <label key={option.value}><input type="checkbox" name={action.form!.selection!.name} value={option.value} defaultChecked={option.selected === true} />{option.label}</label>)}</fieldset>}
    {action.form.inputs?.map((input) => <label key={input.name}>{input.label}{input.type === "select"
      ? <select name={input.name} defaultValue={String(input.value ?? "")}>{input.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : <input name={input.name} type={input.type} defaultValue={input.value} {...(input.min === undefined ? {} : { min: input.min })} {...(input.max === undefined ? {} : { max: input.max })} />}</label>)}
    {action.confirmation === undefined ? null : <><Text element="p" weight="strong">{action.confirmation.title}</Text><Text element="p">{action.confirmation.description}</Text></>}
    <Button type="submit" {...(action.disabled === undefined ? {} : { isDisabled: action.disabled })}>{action.confirmation?.confirmLabel ?? action.label}</Button>
  </form>;
  const buttonProps = { ...(action.invoke === undefined ? {} : { onPress: action.invoke }), ...(action.disabled === undefined ? {} : { isDisabled: action.disabled }) };
  if (action.confirmation === undefined) return <Button {...buttonProps}>{action.label}</Button>;
  return <Dialog triggerLabel={action.label} title={action.confirmation.title} dismissable={!action.disabled}>
    <Text>{action.confirmation.description}</Text>
    <Button {...buttonProps}>{action.confirmation.confirmLabel ?? action.label}</Button>
  </Dialog>;
}

function pageState(view: SystemAdministrationState): ReactElement | null {
  if (view.state === "denied") return <Alert title="Access denied" tone="critical">{view.message ?? "Current server authority does not permit this view."}</Alert>;
  if (view.state === "stale") return <Alert title="Data may be stale" tone="warning">{view.message ?? "Refresh to obtain the current server revision."}{view.refresh === undefined ? null : actionControl(view.refresh)}</Alert>;
  return null;
}

function pageProps(view: SystemAdministrationPageView): Pick<PageTemplateProps, "templateId" | "title" | "description"> {
  return { templateId: "system-administration", title: view.title, ...(view.description === undefined ? {} : { description: view.description }) };
}

function fixedPage(page: ReactElement): ReactElement {
  return <><SkipLink href="#main-content" />{page}</>;
}

function administrationPage(view: SystemAdministrationPageView, current: string, children: ReactNode): ReactElement {
  return fixedPage(<SettingsPage {...pageProps(view)} navigation={administrationNavigation(view.navigation, current)}>
    {pageState(view)}
    {view.revision === undefined ? null : <Status>Server revision: {view.revision}</Status>}
    {view.state === "denied" ? null : children}
  </SettingsPage>);
}

function rows(label: string, columns: readonly string[], values: readonly (readonly ReactNode[])[]): ReactElement {
  const ids = columns.map((_, index) => `column-${index}`);
  return <Table label={label} columns={columns.map((column, index) => ({ id: ids[index]!, label: column, ...(index === 0 ? { isRowHeader: true } : {}) }))} rows={values.map((cells, rowIndex) => ({ id: `row-${rowIndex}`, cells: Object.fromEntries(cells.map((cell, index) => [ids[index]!, cell])) }))} />;
}

export function SystemRolesPage({ view }: { readonly view: SystemRolesViewModel }): ReactElement {
  return administrationPage(view, "roles", <Stack gap="content">
    {view.createRole === undefined ? null : <section aria-label="Role actions">{actionControl(view.createRole)}</section>}
    {rows("Roles", ["Role", "Permissions", "Assignments", "State"], view.roles.map((role) => [<a key={role.id} href={role.href}>{role.label}</a>, role.permissionCount, role.assignmentCount, role.state]))}
  </Stack>);
}

export function SystemRoleDetailPage({ view }: { readonly view: SystemRoleDetailViewModel }): ReactElement {
  return administrationPage(view, "roles", <Stack gap="content">
    <section aria-label="Role summary"><Heading level={2}>{view.roleLabel}</Heading><Badge>{view.roleState}</Badge></section>
    <section aria-label="Active permissions"><Heading level={2}>Active permissions</Heading>{view.activePermissionGroups.map((owner) => <section key={owner.owner} aria-label={`Owner ${owner.owner}`}><Heading level={3}>{owner.owner}</Heading>{owner.resources.map((resource) => <section key={resource.resource}><Heading level={4}>{resource.resource}</Heading>{resource.operations.map((operation) => <section key={operation.operation}><Heading level={5}>{operation.operation}</Heading><List>{operation.permissions.map((permission) => <li key={permission.label}><Stack gap="tight"><span>{permission.label}</span>{permission.description === undefined ? null : <Text>{permission.description}</Text>}{permission.add === undefined ? null : actionControl(permission.add)}{permission.remove === undefined ? null : actionControl(permission.remove)}</Stack></li>)}</List></section>)}</section>)}</section>)}</section>
    <section aria-label="Role templates"><Heading level={2}>Role templates</Heading><List>{view.templates.map((template) => <li key={template.id}><Heading level={3}>{template.title}</Heading>{template.description === undefined ? null : <Text>{template.description}</Text>}{template.instantiate === undefined ? null : actionControl(template.instantiate)}{template.copySelected === undefined ? null : actionControl(template.copySelected)}</li>)}</List></section>
    <section aria-label="Inactive permission diagnostics"><Heading level={2}>Inactive permission diagnostics</Heading>{view.inactiveDiagnostics.length === 0 ? <Text>None.</Text> : <List>{view.inactiveDiagnostics.map((diagnostic) => <li key={diagnostic.id}><strong>{diagnostic.label}</strong> <Badge tone="warning">{diagnostic.state}</Badge><Text>{diagnostic.detail}</Text></li>)}</List>}</section>
    {view.save === undefined ? null : actionControl(view.save)}
  </Stack>);
}

export function SystemPermissionsPage({ view }: { readonly view: SystemPermissionsViewModel }): ReactElement {
  return administrationPage(view, "permissions", rows("Permissions", ["Permission", "Owner", "Resource", "Operation", "State"], view.permissions.map((permission) => [<span key={permission.id}>{permission.label}{permission.detail === undefined ? null : <><br /><small>{permission.detail}</small></>}</span>, permission.owner, permission.resource, permission.operation, permission.state])));
}

export function SystemAssignmentsPage({ view }: { readonly view: SystemAssignmentsViewModel }): ReactElement {
  return administrationPage(view, "assignments", <Stack gap="content">
    {view.createAssignment === undefined && view.manageAssignments === undefined ? null : <section aria-label="Assignment actions">{view.createAssignment === undefined ? null : actionControl(view.createAssignment)}{view.manageAssignments === undefined ? null : actionControl(view.manageAssignments)}</section>}
    {rows("Role assignments", ["Principal", "Role", "State", "Revision", "Action"], view.assignments.map((assignment) => [<span key={assignment.id}>{assignment.principal}{assignment.detail === undefined ? null : <><br /><small>{assignment.detail}</small></>}</span>, assignment.role, assignment.state, assignment.revision, assignment.revoke === undefined ? assignment.reactivate === undefined ? "—" : actionControl(assignment.reactivate) : actionControl(assignment.revoke)]))}
  </Stack>);
}

export function SystemTemplatesPage({ view }: { readonly view: SystemTemplatesViewModel }): ReactElement {
  return administrationPage(view, "templates", rows("Role templates", ["Template", "Owner", "Version", "State", "Action"], view.templates.map((template) => [<span key={template.id}>{template.title}{template.detail === undefined ? null : <><br /><small>{template.detail}</small></>}</span>, template.owner, template.version, template.state, template.instantiate === undefined ? "—" : actionControl(template.instantiate)])));
}

export function SystemAuthorizationAuditPage({ view }: { readonly view: SystemAuthorizationAuditViewModel }): ReactElement {
  return administrationPage(view, "audit", rows("Authorization audit", ["Time", "Outcome", "Reason", "Permission", "Owner", "Revision"], view.events.map((event) => [event.occurredAt, event.outcome, event.reason, event.permission, event.owner, event.revision])));
}

export function SystemExtensionsPage({ view }: { readonly view: SystemExtensionsViewModel }): ReactElement {
  return administrationPage(view, "extensions", rows("Extensions", ["Extension", "Class", "Availability", "Lifecycle", "Revision"], view.extensions.map((extension) => [<a key={extension.id} href={extension.href}>{extension.label}</a>, extension.deliveryClassLabel, extension.availabilityLabel, extension.lifecycleLabel, extension.revision])));
}

export function SystemExtensionDetailPage({ view }: { readonly view: SystemExtensionDetailViewModel }): ReactElement {
  const actions = [view.plan, view.execute, ...(view.actions ?? [])].filter((action): action is SystemAdministrationAction => action !== undefined);
  return administrationPage(view, "extensions", <Stack gap="content">
    <section aria-label="Extension identity"><Heading level={2}>{view.extensionLabel}</Heading><Text>{view.extensionId}</Text></section>
    <section aria-label="Delivery truth">{rows("Extension delivery truth", ["Class", "Availability", "Lifecycle"], [[view.deliveryClassLabel, view.availabilityLabel, view.lifecycleLabel]])}</section>
    <section aria-label="Operation safeguards"><Heading level={2}>Operation safeguards</Heading><dl><dt>Impact</dt><dd>{view.impact}</dd><dt>Approval</dt><dd>{view.approval}</dd><dt>Audit</dt><dd>{view.audit}</dd></dl></section>
    <section aria-label="Extension actions"><Heading level={2}>Extension actions</Heading>{actions.length === 0 ? <Text>No server-authorized actions are available.</Text> : <List>{actions.map((action, index) => <li key={`${action.label}-${index}`}>{actionControl(action)}</li>)}</List>}</section>
  </Stack>);
}

export function SystemThemesPage({ view }: { readonly view: SystemThemesViewModel }): ReactElement {
  return administrationPage(view, "themes", <Stack gap="content">
    <section aria-label="Theme Packages"><Heading level={2}>Theme Packages</Heading>{rows("Theme Packages", ["Package", "Version", "Surfaces", "Availability", "Reference impact"], view.packages.map((item) => [item.label, item.version, item.surfaces, item.availability, item.referenceImpact]))}</section>
    <section aria-label="Theme Skins"><Heading level={2}>Theme Skins</Heading>{rows("Theme Skins", ["Skin", "Version", "Lifecycle", "Actions"], view.skins.map((item) => [item.label, item.version, item.lifecycle, item.actions]))}</section>
    <section aria-label="Theme Profiles"><Heading level={2}>Theme Profiles</Heading>{rows("Theme Profiles", ["Profile", "Surface", "Package", "Skin", "Revision", "Accessibility"], view.profiles.map((item) => [<a key={item.id} href={item.href}>{item.label}</a>, item.surface, item.package, item.skin, item.revision, item.accessibility]))}</section>
  </Stack>);
}

export function SystemThemeProfileDetailPage({ view }: { readonly view: SystemThemeProfileDetailViewModel }): ReactElement {
  const actions = [view.preview, view.stage, view.publish, view.rollback].filter((action): action is SystemAdministrationAction => action !== undefined);
  return administrationPage(view, "themes", <Stack gap="content">
    <section aria-label="Theme Profile identity"><Heading level={2}>{view.profileLabel}</Heading><Text>{view.profileId}</Text></section>
    {rows("Theme Profile state", ["Surface", "Package", "Skin", "Publication", "Accessibility"], [[view.surface, view.package, view.skin, view.publication, view.accessibility]])}
    <section aria-label="Theme Profile actions"><Heading level={2}>Theme Profile actions</Heading>{actions.length === 0 ? <Text>No server-authorized actions are available.</Text> : <List>{actions.map((action) => <li key={action.label}>{actionControl(action)}</li>)}</List>}</section>
  </Stack>);
}

export function SystemOperationsPage({ view }: { readonly view: SystemOperationsViewModel }): ReactElement {
  return administrationPage(view, "operations", <Stack gap="content">
    <section aria-label="Operation requests"><Heading level={2}>Operations</Heading>{view.backup === undefined ? null : actionControl(view.backup)}{view.restoreDrill === undefined ? null : actionControl(view.restoreDrill)}{rows("Operations", ["Operation", "Source", "State", "Receipt"], view.operations.map((item) => [<a key={item.id} href={item.href}>{item.id}</a>, item.source, item.state, item.receipt]))}</section>
    <section aria-label="System health"><Heading level={2}>System health</Heading>{rows("System health", ["Source", "State", "Revision", "Checks"], view.health.map((item) => [item.source, item.state, item.revision, item.checks]))}</section>
  </Stack>);
}

export function SystemOperationDetailPage({ view }: { readonly view: SystemOperationDetailViewModel }): ReactElement {
  return administrationPage(view, "operations", <Stack gap="content">
    <section aria-label="Operation identity"><Heading level={2}>{view.operationId}</Heading><Badge>{view.operationState}</Badge></section>
    <dl><dt>Source</dt><dd>{view.source}</dd><dt>Receipt</dt><dd>{view.receipt}</dd><dt>Inventory</dt><dd>{view.inventory}</dd><dt>Audit</dt><dd>{view.audit}</dd></dl>
  </Stack>);
}

export function SystemSettingsPage({ view }: { readonly view: SystemSettingsViewModel }): ReactElement {
  return administrationPage(view, "settings", rows("Settings", ["Settings", "Owner", "State", "Revision"], view.settings.map((item) => [<a key={item.id} href={item.href}>{item.label}</a>, item.owner, item.state, item.revision])));
}

export function SystemSettingsDetailPage({ view }: { readonly view: SystemSettingsDetailViewModel }): ReactElement {
  return administrationPage(view, "settings", <Stack gap="content">
    <section aria-label="Settings identity"><Heading level={2}>{view.settingsLabel}</Heading><Text>{view.settingsId}</Text><Text>{view.owner}</Text><Badge>{view.documentState}</Badge></section>
    {rows("Settings fields", ["Field", "Value", "State"], view.fields.map((field) => [field.label, field.value, field.state]))}
    {view.save === undefined ? null : <section aria-label="Settings action">{actionControl(view.save)}</section>}
  </Stack>);
}

export function SystemWorkspacePagesPage({ view }: { readonly view: SystemWorkspacePagesViewModel }): ReactElement {
  return administrationPage(view, "workspace-pages", <Stack gap="content">
    {view.create === undefined ? null : <section aria-label="Create workspace page"><Heading level={2}>Create page</Heading>{actionControl(view.create)}</section>}
    {view.createFolder === undefined ? null : <section aria-label="Create workspace folder"><Heading level={2}>Create folder</Heading>{actionControl(view.createFolder)}</section>}
    {rows("Workspace folders", ["Folder", "Parent", "Order", "Revision", "Action"], view.folders.map((folder) => [folder.label, folder.parent, folder.order, folder.revision, folder.update === undefined ? "—" : actionControl(folder.update)]))}
    {rows("Workspace pages", ["Page", "State", "Placement", "Theme", "Dependencies", "Revision"], view.pages.map((page) => [<a key={page.id} href={page.href}>{page.title}</a>, page.state, page.placement, page.theme, page.impact, page.revision]))}
  </Stack>);
}

export function SystemWorkspacePageDetailPage({ view }: { readonly view: SystemWorkspacePageDetailViewModel }): ReactElement {
  return administrationPage(view, "workspace-pages", <Stack gap="content">
    <section aria-label="Workspace page identity"><Heading level={2}>{view.pageTitle}</Heading><Text>{view.pageId}</Text><Badge>{view.pageState}</Badge>{view.viewHref === undefined ? null : <a href={view.viewHref}>Open page</a>}{view.editorHref === undefined ? null : <a href={view.editorHref}>Edit page</a>}</section>
    {rows("Workspace page state", ["Placement", "Theme", "Dependencies"], [[view.placement, view.theme, view.impact]])}
    <section aria-label="Workspace page metadata"><Heading level={2}>Metadata</Heading>{view.saveMetadata === undefined ? <Text>No metadata action available.</Text> : actionControl(view.saveMetadata)}</section>
    <section aria-label="Workspace page access"><Heading level={2}>Access</Heading>{rows("Workspace page access assignments", ["Subject", "Capability"], view.access.map((item) => [item.subject, item.capability]))}{view.replaceAccess === undefined ? null : actionControl(view.replaceAccess)}</section>
    <section aria-label="Workspace page audit"><Heading level={2}>Audit</Heading>{rows("Workspace page audit events", ["Time", "Operation", "Actor", "Revision"], view.audit.map((item) => [item.occurredAt, item.operation, item.actor, item.revision]))}</section>
    {view.archive === undefined ? null : <section aria-label="Archive workspace page"><Heading level={2}>Archive</Heading>{actionControl(view.archive)}</section>}
  </Stack>);
}
