import type { ReactElement, ReactNode } from "react";

import { Breadcrumbs, Heading, Stack, Text } from "@k-nex/ui-components";

export interface PageTemplateProps {
  readonly templateId: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly breadcrumbs?: readonly { readonly id: string; readonly label: string; readonly href: string; readonly current?: boolean }[];
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly aside?: ReactNode;
}

function Page({ template, templateId, title, description, breadcrumbs, actions, children, aside }: PageTemplateProps & { readonly template: string }): ReactElement {
  return <main id="main-content" data-k-nex-component={template} data-page-template-id={templateId} data-slot="root">
    {breadcrumbs === undefined ? null : <Breadcrumbs label="Breadcrumbs" items={breadcrumbs} />}
    <header data-slot="header"><Stack gap="content"><Heading level={1}>{title}</Heading>{description === undefined ? null : <Text>{description}</Text>}{actions === undefined ? null : <div data-slot="actions">{actions}</div>}</Stack></header>
    <div data-slot="body">{children}</div>{aside === undefined ? null : <aside data-slot="aside">{aside}</aside>}
  </main>;
}

export function DashboardPage(props: PageTemplateProps): ReactElement { return <Page {...props} template="dashboard-page" />; }
export interface IndexPageProps extends PageTemplateProps { readonly filters?: ReactNode; }
export function IndexPage({ filters, ...props }: IndexPageProps): ReactElement { return <Page {...props} template="index-page">{filters === undefined ? null : <div data-slot="filters">{filters}</div>}{props.children}</Page>; }
export function DetailPage(props: PageTemplateProps): ReactElement { return <Page {...props} template="detail-page" />; }
export function CreatePage(props: PageTemplateProps): ReactElement { return <Page {...props} template="create-page" />; }
export function EditPage(props: PageTemplateProps): ReactElement { return <Page {...props} template="edit-page" />; }
export interface SettingsPageProps extends PageTemplateProps { readonly navigation?: ReactNode; }
export function SettingsPage({ navigation, ...props }: SettingsPageProps): ReactElement { return <Page {...props} template="settings-page" aside={navigation ?? props.aside}>{props.children}</Page>; }
export interface WizardPageProps extends PageTemplateProps { readonly step: number; readonly stepCount: number; }
export function WizardPage({ step, stepCount, ...props }: WizardPageProps): ReactElement { return <Page {...props} template="wizard-page"><div role="status" aria-label={`Step ${step} of ${stepCount}`} data-slot="progress">Step {step} of {stepCount}</div>{props.children}</Page>; }
export interface BuilderPageProps extends PageTemplateProps { readonly inspector?: ReactNode; }
export function BuilderPage({ inspector, ...props }: BuilderPageProps): ReactElement { return <Page {...props} template="builder-page" aside={inspector ?? props.aside}>{props.children}</Page>; }
