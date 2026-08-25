# CMS and Page Builder

## Separation of concerns

CMS and page building are separate modules.

- **CMS module:** content models, pages, media, navigation, drafts, publishing, localization, preview contracts, and content APIs.
- **Page builder module:** visual editor integration, builder data storage, editor routes, validation, preview/render contracts, and component schema versioning.
- **Customer application:** visual component catalog, renderers, CSS, design tokens, responsive behavior, and final website.

This keeps reusable content logic independent from customer design.

## CMS module

Working package:

```text
@k-nex/module-cms
```

Potential responsibilities:

- page collection and route metadata;
- media collection;
- navigation and reusable site settings;
- draft/publish lifecycle;
- preview URL generation contract;
- redirects and canonical URL support;
- localization configuration;
- content permission definitions;
- publishing events and jobs;
- hooks or services for cache invalidation.

The CMS module should be configurable without knowing the customer's layout.

```ts
cmsModule({
  pages: {
    drafts: true,
    localization: ['tr', 'en'],
  },
  media: {
    imageSizes: ['thumbnail', 'card', 'hero'],
  },
})
```

## Page builder module

Working package:

```text
@k-nex/module-page-builder
```

The current implementation candidate is the Payload–Puck integration referenced in [references.md](./references.md). The module should wrap or adapt that integration behind a K-Nex contract instead of leaking every implementation detail to other modules.

Potential responsibilities:

- add builder data to configured page collections;
- register visual editor views/routes;
- expose editor load/save endpoints;
- connect Payload draft/publish behavior;
- validate builder documents;
- register preview and render contracts;
- expose migration utilities for builder data;
- allow the customer application to supply a Puck component configuration;
- expose editor stylesheet hooks owned by the customer application.

Example composition:

```ts
pageBuilderModule({
  collections: ['pages'],
  config: customerPuckConfig,
  editorStylesheets: ['/page-builder/editor.css'],
})
```

## What the page builder module must not own

- customer colors;
- typography;
- final section spacing;
- button appearance;
- customer-specific hero design;
- logistics tracking form design;
- restaurant menu card design;
- the full list of components available to every customer.

Those belong to the customer repository.

## Customer component catalog

Example for a logistics customer:

```text
src/page-builder/components/
├── Hero.tsx
├── TrackingForm.tsx
├── ServicesGrid.tsx
├── BranchMap.tsx
├── DeliveryTimeline.tsx
└── ContactCallout.tsx
```

Example for a restaurant:

```text
src/page-builder/components/
├── Hero.tsx
├── MenuCategory.tsx
├── FeaturedDish.tsx
├── ReservationForm.tsx
├── BranchSelector.tsx
└── AllergenLegend.tsx
```

Example Puck configuration:

```tsx
import type { Config } from '@puckeditor/core'
import { Hero } from './components/Hero'
import { TrackingForm } from './components/TrackingForm'

export const customerPuckConfig: Config = {
  components: {
    HeroV1: {
      fields: {
        title: { type: 'text' },
        description: { type: 'textarea' },
      },
      render: Hero,
    },
    TrackingFormV1: {
      fields: {
        title: { type: 'text' },
      },
      render: TrackingForm,
    },
  },
}
```

## Stable component identities

Builder documents persist component IDs and field data. Renaming or removing a renderer can break already published pages.

Use stable versioned identifiers:

```text
HeroV1
HeroV2
TrackingFormV1
MenuCategoryV1
```

Do not use filenames or visual marketing names as the only persisted identity.

## Component lifecycle

Recommended lifecycle:

1. **active:** selectable for new content and renderable;
2. **deprecated:** existing content remains renderable, but editors cannot add new instances;
3. **migrating:** data can be transformed to a replacement component;
4. **removed:** allowed only after all persisted documents have been migrated and verified.

A redesign should normally add a new renderer or change CSS while keeping existing stored data compatible.

## Builder schema migrations

Page builder data is application data and needs explicit migrations.

Example:

```ts
export const migrateHeroV1ToV2 = defineBuilderMigration({
  from: 'HeroV1',
  to: 'HeroV2',
  migrateProps: (props) => ({
    heading: props.title,
    body: props.description,
    alignment: 'left',
  }),
})
```

Migrations should be:

- deterministic;
- idempotent where possible;
- testable against saved fixtures;
- previewable before production mutation;
- committed in the customer repository when they affect that customer's stored pages.

## Domain-aware components

A page component may consume public contracts from another module without coupling the page builder core to that domain.

For example, a logistics customer can render `TrackingFormV1` using the public tracking client:

```tsx
import { createPublicTrackingClient } from '@k-nex/module-live-tracking/client'
```

The page builder module does not need to know what tracking means. The customer application composes the renderer and client.

## Preview and rendering

Preview and production rendering should use the same component registry whenever possible.

The customer repository owns:

- component registry;
- CSS bundles;
- fonts and assets;
- route-level data loading;
- error boundaries and missing-component fallback;
- cache strategy;
- analytics instrumentation.

The module owns the editor/storage protocol and validates that the configured registry can render stored documents.

## Security considerations

- Treat builder documents as untrusted structured input.
- Validate component type and field schema server-side.
- Do not allow arbitrary module imports or executable code from editor data.
- Sanitize rich text and URLs according to context.
- Authorize preview access separately from public access.
- Keep unpublished drafts out of public API responses.
- Restrict file relationships according to media permissions.

## POC acceptance criteria

- CMS and page builder can be installed independently where meaningful.
- Two customer applications use the same backend page builder module but completely different component catalogs and CSS.
- Draft, preview, publish, and render flows work.
- Removing a component used in stored data causes validation failure before deployment.
- A deprecated component remains renderable but is unavailable for new pages.
- A logistics component can consume the tracking client without the page builder module importing logistics code.
- Builder data migration runs against fixtures and a customer database.