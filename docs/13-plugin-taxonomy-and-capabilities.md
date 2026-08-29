# Extension Taxonomy and Capabilities

## Product term versus execution class

The administration product may call every installable item a “plugin,” but architecture, manifests, plans, receipts, and inventory use the exact class:

```text
platform-plugin
hot-application
theme-skin
```

Ambiguous class inference from package contents is forbidden.

## Platform Plugin

Canonical existing kinds:

```text
module
provider
builder
theme
integration
preset
```

Examples:

```text
module.sales
provider.realtime.socketio
builder.puck
theme.minimal
integration.sales-logistics
preset.sales
```

A Platform Plugin is trusted code compiled into a customer application release. It may provide deep host contributions, including Payload schema, migrations, services, native UI, providers, and jobs.

## Hot Application

Canonical identity:

```text
app.<namespace>[.<subsystem>]
```

A Hot Application is a signed prebuilt runtime bundle. It uses fixed host capabilities and runs server/UI code outside the host execution realm.

Initial contribution categories:

```text
metadata
settings
permissions
roleTemplates
navigation
screens
remoteComponents
remoteBlocks
sources
actions
tools
logicFunctions
eventSubscriptions
schedules
appStorageSchemas
assets
localization
health
testingMetadata
```

Each category has a closed descriptor and explicit owner. No category can map to arbitrary import, Payload config, SQL, or host service registration.

## Theme Skin

Canonical identity:

```text
skin.<namespace>
```

Contribution categories:

```text
tokens
palettes
recipes
scopedCss
assets
profileCompatibility
localization
```

No executable entrypoint exists.

## Capability model

### Platform Plugin capabilities

Existing deterministic capability resolution remains for genuinely replaceable host providers:

```text
realtime.gateway
storage.objects
email.delivery
builder.engine
```

A single-cardinality capability requires explicit provider selection. Optional dependencies never auto-install.

### Hot Application host capabilities

An app requests a versioned bounded host ABI rather than importing another package:

```text
records.query@1
records.action@1
app-storage.documents@1
files.scoped@1
events.scoped@1
jobs.bounded@1
secrets.references@1
http.destinations@1
ui.remote-components@1
```

Names are illustrative until P9.1 freezes exact IDs. A granted host capability remains constrained by current actor/delegation, app identity/generation, permission, record/field policy, quotas, and request budgets.

A capability request declares:

```text
capability ID/version range
reason
required/optional
resource budget
secret-reference names
destination/storage scope
surfaces
```

The installer shows impact before approval.

## Dependency rules

- A Platform Plugin has static direct/capability dependencies resolved into the host graph.
- A Hot Application is executable-dependency self-contained and cannot auto-install another app/package.
- App-to-app imports and direct storage access are forbidden initially.
- An app may consume stable platform/public extension contracts through host capabilities.
- A Theme Skin targets a supported skin ABI and installed theme/profile surface; it has no executable dependency graph.

## Ownership and collisions

```text
Platform Plugin contribution owner  existing plugin ID
Hot Application contribution owner  app ID + immutable generation
Theme Skin owner                     skin ID + immutable generation
```

IDs must use their owner's namespace. Collision diagnostics identify both owners and generations. Runtime content cannot claim another owner.

## Execution and trust

```text
Platform Plugin  trusted in host release; customer blast radius
Hot Application  treated as isolated capability client even if official
Theme Skin       untrusted structured visual data
```

Signing/review does not replace isolation. TypeScript/package exports are not a sandbox.

## Lifecycle mapping

```text
Platform Plugin package add/update/remove
  build and deploy immutable host generation

Platform Plugin enabled state
  runtime toggle only if code/schema already present and readiness permits

Hot Application install/update
  download/verify/stage/warm/activate immutable app generation

Hot Application disable
  revoke routing/execution while preserving reviewed state

Hot Application uninstall
  retire generation; archive/purge app storage by explicit policy

Theme Skin install/update
  verify/parse/preview/activate skin generation
```

## Catalog classification

Each official catalog item declares:

```text
extension class
identity/version
publisher/source/release
artifact/manifest/SBOM/provenance digests
host ABI/framework compatibility
requested capabilities/permissions/secrets/network/storage
migration/rollback/no-outage eligibility
support and revocation state
```

The catalog cannot reclassify an artifact after publication.

## Conformance

A Platform Plugin uses the existing plugin conformance suite.

A Hot Application conformance suite proves manifest/bundle, dependency closure, forbidden imports, runner isolation, capability enforcement, app storage, remote UI, activation/update/rollback, restore, and resource budgets.

A Theme Skin conformance suite proves no executable content, CSS/asset scoping, tokens/recipes, accessibility/visual behavior, generation activation, and rollback.
