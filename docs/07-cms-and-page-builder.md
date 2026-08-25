# CMS and Visual Page Composition

## Purpose

K-Nex uses one engine-independent UI block/layout architecture for both CMS pages and workspace composition. The CMS module owns content lifecycle and public routing semantics. The builder plugin owns visual editing integration. Domain modules and customer applications contribute public-safe blocks. Theme packages and customer profiles determine final presentation.

```text
module.cms
  content/page/media/navigation/publication lifecycle

ui-runtime + UI contracts
  canonical blocks/documents/validation/rendering

builder.puck (provisional)
  visual editor adapter

module/domain UI contributions
  reusable public-safe blocks/actions/data projections

customer repository
  customer blocks, brand assets, theme selection/profiles, routes, overrides
```

CMS and builder remain independently reasoned capabilities even when the standard product installs them together.

## CMS module

Working plugin/package:

```text
plugin ID: module.cms
package:   @k-nex/module-cms
```

Potential responsibilities:

- page identity, slug/path, locale, and route metadata;
- media/assets and relationships;
- navigation and reusable site settings;
- draft/publish/version lifecycle;
- scheduled publication where enabled;
- preview token/URL contract;
- redirects and canonical URL support;
- localization and translation relationships;
- SEO/social metadata;
- content permissions;
- publication/cache invalidation events/jobs;
- public content projection API;
- optional relationship to a visual builder document.

The CMS module does not own customer design or require every page to use the visual builder.

Example build-time options:

```ts
cmsModule({
  pages: {
    drafts: true,
    localization: ['tr', 'en'],
    visualPages: true,
  },
  media: {
    imageSizes: ['thumbnail', 'card', 'hero'],
  },
})
```

## Builder capability

A visual CMS configuration requires a plugin that provides:

```text
builder.engine@compatible-version
```

Initial implementation candidate:

```text
plugin ID: builder.puck
package:   @k-nex/builder-puck
```

The domain/CMS modules do not import Puck types. The adapter maps K-Nex UI field/block/layout contracts to Puck.

The selected builder is declared in `k-nex.app.json`:

```json
{
  "builder": {
    "plugin": "builder.puck",
    "package": "@k-nex/builder-puck",
    "version": "0.1.0",
    "profiles": {
      "cms": {
        "enabled": true,
        "drafts": true,
        "surfaces": ["cms", "public"]
      }
    }
  }
}
```

See [Builder Engine and Profiles](./17-builder-engine-and-profiles.md).

## CMS builder profile

The CMS profile controls:

```text
page/content kinds that can use the editor
public and CMS surfaces
public-safe component palette
allowed layout primitives
static/public-projection data sources
public-safe registered actions
draft/preview/publish workflow
selected public theme profile
SEO/locale/route metadata integration
```

Example:

```ts
export const cmsProfile = defineBuilderProfile({
  id: 'cms',
  surfaces: ['cms', 'public'],
  pageKinds: ['content-page', 'landing-page', 'public-form'],
  audiences: ['anonymous', 'signed-public-session'],
  publication: 'draft-preview-publish',
  themeSurface: 'public',
})
```

A block registered for `workspace` only never appears in the CMS palette.

## Canonical page document

A page can contain a K-Nex canonical UI document:

```json
{
  "schemaVersion": 1,
  "profile": "cms",
  "regions": {
    "main": [
      {
        "id": "block-hero-1",
        "type": "content.hero",
        "version": 1,
        "props": {
          "heading": "Fast delivery across the country",
          "body": "Track and manage every shipment.",
          "imageId": "media_123"
        }
      },
      {
        "id": "block-track-1",
        "type": "logistics.public-tracking-form",
        "version": 1,
        "props": {
          "title": "Track your shipment",
          "action": "logistics.public-tracking.lookup"
        }
      }
    ]
  }
}
```

The document stores registered identities and validated serializable properties. It does not store React code, imports, SQL, secrets, or unrestricted CSS.

## Block sources

### Foundational content blocks

A content/UI foundation package can provide reusable style-agnostic blocks:

```text
content.hero
content.rich-text
content.image
content.features
content.call-to-action
content.faq
layout.section
layout.grid
layout.columns
```

### Domain module public blocks

Modules can provide deliberately public-safe blocks:

```text
crm.public-lead-form
logistics.public-tracking-form
logistics.delivery-timeline-public
restaurant.menu-category
restaurant.branch-selector
restaurant.allergen-legend
```

The module owns the block contract, public projection/action, validation, and domain behavior. The customer theme determines visual appearance.

### Customer blocks

The customer repository can define product-specific components:

```text
acme.hero-with-fleet-video
acme.branch-network-map
mamma.chef-story
mamma.reservation-callout
```

Customer blocks register through `k-nex.config.ts` and follow the same schema, security, versioning, and migration rules.

### Renderer overrides

A customer can replace a module block renderer through a typed extension point while preserving block identity/data contract where compatible.

```ts
export default defineCustomerConfig({
  ui: {
    blockRendererOverrides: {
      'logistics.public-tracking-form': AcmeTrackingForm,
    },
  },
})
```

This is code and requires review/deployment. It does not become arbitrary builder data.

## Style boundary

Module/public blocks are style-agnostic:

```text
headless logic/controller
semantic domain component
semantic design-system primitives
runtime public theme tokens
customer override when required
```

Shared blocks do not encode customer colors, logo, brand font, fixed marketing gradients, or a single visual language.

They can include structural/accessibility behavior required to function.

## Theme integration

CMS content uses the published public theme profile.

```text
installed public theme packages
        ↓
published validated public theme profile
        ↓
semantic primitive adapter + CSS variables
        ↓
CMS document render
```

The same page document can be previewed/rendered with:

```text
theme.neobrutalism
theme.glassmorphism
theme.minimal
```

without changing block data.

Page editors can preview theme drafts and responsive modes, but the editor chrome remains on a stable system theme.

## Data and actions

### Static content

Stored directly in validated block props.

### CMS resources

Blocks can reference media, pages, navigation entries, or other configured content through typed resource IDs.

### Public domain data

A block references an explicit registered public data source:

```ts
export const publicMenuSource = defineUiDataSource({
  id: 'restaurant.public-menu',
  surfaces: ['public'],
  audiences: ['anonymous'],
  input: publicMenuInputSchema,
  output: publicMenuProjectionSchema,
  execute: ...,
})
```

### Public actions

Forms use registered actions:

```text
crm.public-lead.submit
cms.newsletter.subscribe
logistics.public-tracking.lookup
restaurant.reservation.request
```

Actions define server validation, rate limiting, spam/abuse controls, idempotency where appropriate, audit/consent policy, and narrow output.

The builder never stores an arbitrary endpoint URL or server function.

## Public versus authenticated data

A CMS block does not gain workspace authority merely because an editor is authenticated.

Preview and public render should use the block's declared public projection/action policy. If editor-only preview data is necessary, it is a separate authenticated preview data source and cannot be serialized into published output.

This prevents accidental publication of internal CRM, cost, shipment, inventory, or budget data.

## Page storage

Provisional recommended shape:

- CMS page record owns route/locale/SEO/publication metadata;
- the builder document is embedded in or transactionally related to the page version;
- page publication and builder document publication occur atomically;
- workspace layouts use a separate scoped layout collection;
- both reuse the same UI validation/migration services.

The exact Payload storage shape is a POC decision. See the [Decision Register](./21-decision-register.md).

## Draft, preview, publish

```text
edit page metadata and builder document
  → validate block IDs/versions/props
  → validate public data/action bindings
  → save draft revision
  → preview with signed editor authorization and selected theme revision
  → publish page and document atomically
  → emit cms.page.published
  → invalidate public cache/projection
```

Publishing fails when:

- a block/provider is unavailable;
- block props fail current schema;
- a migration is required;
- a public block references an authenticated-only source/action;
- required media/content relationships are unauthorized or invalid;
- the selected public theme profile is invalid/unavailable.

## Routing

The CMS module owns route metadata and route-resolution contracts, while the customer application owns final Next.js route composition.

Requirements:

- locale-aware path uniqueness;
- redirect/canonical handling;
- preview path separate from public cache;
- draft content never returned by public queries;
- customer/domain path rules configurable without customer IDs in shared code;
- route collision validation with module/customer routes.

## Localization

Builder documents can support localization through one of two patterns:

```text
localized page/document version per locale
localized fields inside one document
```

Initial recommendation: locale-specific page versions/documents where layout may differ, while shared content references can remain localized resources. The exact model must be tested against Payload version/localization behavior.

Block definitions declare which props are localizable. Component IDs/versions remain stable across locales.

## SEO and metadata

SEO should remain structured page metadata, not only visual blocks:

```text
title
description
canonical URL
robots policy
social image
structured data inputs
locale alternates
```

A module/block can contribute structured data fragments through a validated API, but arbitrary script injection is forbidden.

## Navigation

CMS can own reusable navigation content while the public application theme/customer renderer decides presentation.

A visual page builder does not need to make global site navigation itself freely editable. Navigation content and shell placement can use controlled models/components.

## Media

Media references are IDs/relationships, not arbitrary filesystem paths.

Controls:

- public/private classification;
- image processing variants;
- file type/size validation;
- alt text requirements where relevant;
- protected asset authorization;
- signed URLs for private media;
- storage provider abstraction;
- orphan/reference checks before destructive deletion.

## Component identity

Persisted identity uses stable IDs and versions:

```text
content.hero@1
logistics.public-tracking-form@1
restaurant.menu-category@2
```

Do not use a display label or filename as the persisted identity.

Lifecycle:

```text
active
  → deprecated (renderable, not selectable)
  → migration/replacement available
  → all drafts/published content migrated
  → removed in later compatible release
```

## Component migrations

```ts
registerUiMigration({
  blockId: 'content.hero',
  from: 1,
  to: 2,
  migrate: old => ({
    heading: old.title,
    body: old.description,
    alignment: old.alignment ?? 'left',
  }),
})
```

Migrations must scan:

- drafts;
- published versions;
- retained revisions according to policy;
- reusable templates/symbols if introduced;
- locale variants.

Customer repositories own execution against their content data and final migration/release plan.

## Missing module/block behavior

When a CMS document references an unavailable block:

- public render uses a deliberate safe failure policy (normally omit/fallback rather than expose internals);
- preview/admin shows owning plugin/block/version and remediation;
- readiness/publish checks fail until resolved;
- uninstall preserves the document/reference by default;
- purge requires explicit content migration/deletion.

A build should detect known missing renderers before production deployment.

## Third-party Payload–Puck package

The referenced Payload–Puck package is useful as:

- an implementation spike;
- a reference for editor routes/storage/config integration;
- a possible accelerator for the CMS POC.

K-Nex should wrap or replace it if necessary. K-Nex contracts must not depend on its exact data model or expose it to domain modules.

Possible outcomes after POC:

```text
wrap directly
reuse selected integration patterns
build a custom Payload storage/editor adapter
reject Puck and use another builder provider
```

## Security

- Treat builder documents as untrusted structured input.
- Validate every write/read/publication server-side.
- Sanitize rich text and URLs contextually.
- Do not allow arbitrary script/style/import/query execution.
- Separate public, preview, and workspace data sources.
- Rate-limit and abuse-protect public actions.
- Keep unpublished drafts outside public responses/caches.
- Enforce media access policy.
- Use CSP-compatible rendering.
- Audit publish/rollback and high-risk settings changes.

See [Security and Trust Boundaries](./20-security-and-trust-boundaries.md).

## CMS POC acceptance criteria

- CMS works without requiring customer-specific core patches.
- CMS and workspace use the same canonical block/layout contracts with separate profiles.
- Cargo and restaurant applications use the same CMS/builder packages but different plugin graphs, blocks, and themes.
- Module-provided public blocks and customer-specific blocks coexist.
- Public block cannot access authenticated workspace data.
- Draft/preview/publish is atomic and permission-aware.
- A page document renders unchanged under two installed public themes.
- Component migration covers drafts and published content.
- Missing component blocks publication before production damage.
- Puck types do not appear in CMS/domain module public contracts.
- The third-party Payload–Puck integration can be wrapped or replaced without changing canonical documents.
