# Öneriler ve Yol Haritası

## Ana prensip

Yeni platform primitive eklemeyi durdur. Mevcut platformu gerçek customer product akışına bağla.

## Önerilen sıra

### 1. Phase 9'u gerçek kapat

- Route ownership collision düzelt.
- Worker activation/drain proof'u tamamla.
- Runner capability lifetime düzelt.
- Orphan invocation cleanup ekle.
- Operation capacity recovery ekle.
- Current dirty snapshot üzerinde exact-head Gate 9 çalıştır.
- Result/status ifadelerini kanıtla eşitle.

### 2. Phase 10 RBAC ve authorization

- Owner/role/grant/assignment contracts.
- Record ve field-aware policy.
- Extension permission descriptors.
- Role templates.
- Plugin lifecycle administration permission'ları.
- Current actor/delegation reauthorization.
- Durable action/tool idempotency.
- Approval invalidation ve audit.

Phase 10 tamamlanmadan user-facing extension lifecycle veya autonomous agent mutation production'a açılmamalıdır.

### 3. Gerçek generated customer application

Tek acceptance journey:

~~~text
create-k-nex-app
→ install/frozen lock
→ migrate
→ boot Next + Payload
→ login
→ Sales list/create/update
→ dashboard edit/save
→ agent tool call
→ plugin disable/enable
→ audit/rollback
~~~

Generator aşağıdakileri gerçek üretmelidir:

- Next application shell;
- Payload auth/users/admin;
- workspace routes;
- source/action/tool endpoints;
- generated registration;
- theme provider;
- dashboard persistence;
- lifecycle administration;
- Docker/web/worker topology;
- readiness/smoke.

Bu bitmeden yeni domain plugin veya component family eklenmemelidir.

### 4. Custom object/field modelini çöz

Önerilen hibrit:

~~~text
Core/domain module
  Payload collections
  static Platform Plugin release

Customer no-code object
  metadata + constrained JSONB record store
  bounded declared indexes and relations
  live activation

Hot Application
  only host capabilities
  no Payload config mutation
~~~

Gerekli object platform parçaları:

- object/field/relationship definitions;
- exact schema revision;
- bounded field types;
- validated/default values;
- unique/index policy;
- record/field permission;
- migration/backfill;
- table/form/kanban/calendar/timeline projection;
- import/export;
- audit;
- search;
- API/tool descriptors.

Yüksek ölçek veya güçlü relational invariant isteyen customer object daha sonra Platform Plugin/Payload collection'a promote edilebilir.

### 5. Universal view ve dashboard ürünü

Önce generic views:

- table;
- form/detail;
- kanban;
- calendar;
- timeline/activity;
- metrics/chart;
- saved filters;
- global search.

Sonra dashboard:

- private/team/role/workspace scope;
- tabs ve responsive grid;
- widget instance ID;
- component ID + exact version;
- source/action bindings;
- saved view state;
- permission-aware data;
- per-widget cache/budget;
- realtime invalidation;
- revision/rollback;
- role template inheritance;
- plugin disable placeholder;
- widget migration.

Plugin raw React vermemeli. Signed Platform Plugin native renderer veya Hot App remote descriptor vermelidir.

### 6. Author SDK ve CLI

Minimum author API:

~~~text
defineApp
defineObject
defineSource
defineAction
defineTool
defineWidget
defineThemeSkin
~~~

Minimum CLI:

~~~text
k-nex extension dev
k-nex extension build
k-nex extension verify
k-nex extension install
k-nex extension impact
~~~

Dev live sync production path olmamalı; açık development gate ve disposable generation kullanmalı.

### 7. CMS product pack

Payload native özelliklerini ve official pluginleri kullanarak:

- pages;
- media/DAM;
- drafts/versions;
- localization;
- live preview;
- SEO;
- redirects;
- nested docs;
- search;
- forms;
- scheduled publishing

çıkar.

Custom publication sistemi yalnız canonical UiDocument ile page metadata atomik ayrımı gerçekten gerekiyorsa korunmalıdır.

### 8. CRM integrations ve workflows

- email/calendar sync;
- activity timeline;
- notifications;
- webhooks;
- import mapping/dedupe;
- workflow builder;
- approvals;
- scheduled actions;
- consent/retention.

### 9. Marketplace ve fleet

- publisher onboarding;
- signed release;
- permission/impact diff;
- dependency/conflict explanation;
- SBOM/license/vulnerability display;
- staged rollout;
- health/quarantine;
- fleet upgrade/rollback;
- revocation/tombstones.

## Şöyle yapsak daha iyi olurdu

### Platform-first yerine vertical-first

Önce tek customer journey, sonra gerçek reuse boundary.

**Sebep:** Product ihtiyacı kanıtlanmadan ABI/component/gate yüzeyi büyümüş.

### Manifest'i minimum çalışan yüzeye indir

Runtime'a bind edilmeyen settings/schedules/tools/screens kategorilerini v1'de dondurma.

**Sebep:** Pre-v1 dead ABI ve compatibility borcu.

### Payload policy'yi ikinci kez yazma

Canonical K-Nex policy'yi Payload access/field access'e bağla.

**Sebep:** Native admin/API kullanımı ve tek authorization semantiği.

### Per-call container yerine warm generation pool

**Sebep:** Interactive UI/agent çağrılarında Docker cold start kabul edilemez; aynı isolation boundary korunabilir.

### Phase 8 attestation mekanizmasını yeniden kullan

**Sebep:** Phase 9 string provenance yeni ve daha zayıf ikinci supply-chain sistemi oluşturuyor.

### UI breadth'i dondur

**Sebep:** 131 family yerine gerçek ürünün kullandığı sınırlı component setini tam kalitede bitirmek daha değerli.

### Official pluginleri bounded adapter olarak kullan

**Sebep:** SEO, redirect, search, nested docs, forms ve import/export genel problemi tekrar çözmek ürün avantajı yaratmaz.

### Dashboard'ı canonical document + descriptors olarak kur

**Sebep:** Raw plugin React yerine versioned data contract disable/rollback/security açısından yönetilebilir.

## Performans yol haritası

Ölçülmesi gereken gerçek SLO'lar:

- runner invocation cold/warm p50/p95/p99;
- agent 5-tool sequence latency;
- artifact size versus verify latency/memory;
- concurrent app/generation load;
- DB pool saturation;
- outbox backlog/recovery;
- remote UI first interactive;
- dashboard widget fan-out;
- 10k/100k record table query;
- object metadata cache hit/miss;
- plugin activation and rollback time.

Optimization ancak bu ölçümlerden sonra yapılmalıdır. Bilinen per-call Docker ve full reverify maliyeti önce mimari olarak düzeltilmelidir.

## Ürün başarı kriteri

K-Nex ancak aşağıdaki akış dış fixture veya manuel wiring olmadan generator çıktısında çalıştığında ilk gerçek ürün milestone'una ulaşmış sayılmalıdır:

~~~text
CMS form submission
→ CRM lead
→ dedupe/enrichment
→ AI qualification
→ human approval
→ task/email workflow
→ private dashboard widget
→ complete audit trail
~~~
