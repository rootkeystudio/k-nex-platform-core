# Module and Extension System

## Three classes

K-Nex uses one product-facing Plugin Manager but three non-interchangeable technical classes.

## 1. Platform Plugin

Existing IDs:

```text
module.*
provider.*
builder.*
theme.*
integration.*
preset.*
```

A Platform Plugin is trusted application code and may contribute:

```text
Payload schema and customer migrations
services, permissions, policies, settings
sources, actions, tools
events, jobs, realtime
native routes/navigation/pages/admin
React components and Puck blocks
providers/builders/executable themes
health, lifecycle, testing metadata
```

Package entrypoints remain:

```text
./manifest
./contracts
./server
./browser
./ui
./migrations
./testing
```

Composition is static and frozen. Adding/upgrading/removing package bytes requires an immutable customer release. Compatible releases may deploy blue/green without user-visible outage; they are not host-process hot loads.

`module.sales` remains the reference Platform Plugin.

## 2. Hot Application

Identity:

```text
app.<namespace>[.<subsystem>]
```

A Hot Application is a signed prebuilt runtime artifact, not a Platform Plugin package installed into the host module graph.

Initial allowed contributions:

```text
application metadata and configuration schema
permissions and role-template descriptors
fixed-host navigation/screens/blocks
remote UI worker entrypoints
isolated server logic entrypoints
source/action/tool descriptors through fixed dispatchers
events/schedules through bounded host contracts
namespaced app document/KV schemas and quotas
assets/localization/health/testing metadata
```

Forbidden:

```text
Payload collections/globals/hooks
customer migration functions
host Next/Payload routes
host services/providers/builders
native host React imports
raw database or req.payload
Docker/host filesystem/ambient secrets
arbitrary package/import/network authority
```

A Hot Application can accomplish rich app-like behavior by combining generic host storage, source/action gateways, isolated functions, and remote UI. If a feature truly needs host schema/hooks/providers, it is a Platform Plugin.

## 3. Theme Skin

Identity:

```text
skin.<namespace>
```

A Theme Skin contains validated data-only visual behavior:

```text
tokens
palettes
recipe selections
scoped CSS
approved content-addressed assets
profile compatibility/data transforms
```

It cannot contain JavaScript, React components, primitive overrides, install scripts, or arbitrary URLs. A full executable `theme.*` remains a Platform Plugin.

## Dependency semantics

### Platform Plugin graph

The existing deterministic resolver handles direct plugin/capability dependencies, conflicts, provider selection, exact framework compatibility, registration order, and static inventory.

### Hot Application graph

A Hot Application bundle is self-contained for executable dependencies. It may request only versioned host ABI capabilities. Runtime does not recursively install arbitrary NPM dependencies or another app.

Optional app-to-app collaboration is deferred. Initial apps communicate through platform-owned public contracts, not direct imports or storage reads.

### Theme Skin

A skin targets an exact supported skin/theme ABI and installed platform component/theme profile capabilities. It has no executable dependency graph.

## Registration and activation

### Platform Plugin

```text
manifest → contracts → providers → schema → behavior → jobs
→ data-handlers → ui → admin → validate → freeze
```

### Hot Application

```text
catalog → download → verify → static inspect → stage
→ warm runner/UI → validate metadata/storage → activate generation
```

### Theme Skin

```text
catalog → download → verify → parse/scope CSS and tokens
→ preview/accessibility validation → activate generation/profile
```

No class can silently cross into another lifecycle.

## Static versus fixed runtime routes

Platform Plugins may add statically composed native routes. Hot Applications use routes already owned by the platform:

```text
/apps/:appId/*
/api/extensions/apps/:appId/sources/:sourceId
/api/extensions/apps/:appId/actions/:actionId
/api/extensions/apps/:appId/assets/:generation/*
```

These are illustrative host shapes, not a requirement to expose raw unrestricted endpoints. Typed IDs, actor policy, generation, limits, and ownership are mandatory.

## Server execution

Platform Plugin handlers run in the host with capability-scoped services because their bytes are part of the verified customer release.

Hot Application handlers run outside the host through the extension runner. Invocation uses structured schemas and short-lived scoped identity. The runner can call only declared host capabilities.

## UI execution

Platform Plugins provide browser-safe/native K-Nex component compositions at build time.

Hot Applications provide remote UI worker bundles. They emit an allowlisted component/event tree. The host maps this to K-Nex semantic and compound components, owns data/action transport, and retains focus/accessibility/security control.

Puck integration for Hot Applications, if later allowed, uses declarative remote block descriptors and the same remote renderer; app code does not run in the editor/host realm.

## Data

Platform Plugins own static Payload schema through customer migrations.

Hot Applications initially use namespaced generic app storage:

```text
closed JSON schemas
optimistic revisions
quota and bounded indexes
actor/app authorization
backup/restore
no cross-app read
```

A future dynamic object model requires its own gate; it is not smuggled into Phase 9.

## Settings and permissions

Hot Application settings are closed manifest-defined documents; secret-like fields hold references only. They cannot alter executable entrypoints, imports, topology, or capabilities.

Phase 10 lets Platform Plugins and Hot Applications expose permission and role-template descriptors. Runtime behavior requires permission IDs, never role names.

## Lifecycle

```text
Platform Plugin add/upgrade/remove  release + blue/green/maintenance plan
Platform Plugin enable/disable      runtime only when schema/code already present and safe
Hot Application install/update      live immutable generation
Hot Application disable/uninstall   live generation retirement and bounded cleanup
Theme Skin install/update           live immutable generation/profile
```

Uninstall does not mean data destruction. Retention, references, generation retirement, app storage archive/purge, and rollback limits are explicit.

## Conformance

Platform Plugin conformance continues from Sales.

Hot Application conformance must cover:

```text
manifest/bundle/capability/budget schemas
prebuilt dependency and forbidden-import inventory
signature/provenance/SBOM
secure extraction
runner isolation and resource limits
host API authorization
app storage isolation
remote UI protocol/CSP/accessibility
activation/update/rollback/drain
uninstall/restore/inventory
```

Theme Skin conformance covers no-code artifact rules, CSS scoping, tokens/assets, visual/accessibility, activation/rollback, and profile compatibility.
