# Payload Sınırları ve Gereksiz Tekrarlar

## Temel karar

Payload, K-Nex'in framework çekirdeği olarak kullanılmalı; K-Nex Payload'ın yerine ikinci CMS framework yazmamalı.

Payload plugin modeli statik config composition'dır. Collection, hook, provider veya native admin import ekleyen kodun runtime hot-load edilmemesi doğrudur.

## Sorumluluk ayrımı

| Payload'a bırak | K-Nex'te kalmalı | Tekrar değerlendir |
|---|---|---|
| Auth/session | Plugin graph ve conflict resolution | Custom CMS publication storage |
| Collections/fields | Per-customer release/fleet | İkinci access-policy stack |
| Field validation | Hot App sandbox | Generic jobs/workflows |
| Admin/content operations | Remote UI protocol | Search ve form altyapısı |
| Drafts/versions | Agent approval/audit/budget | Import/export |
| Localization/live preview | Source/action/tool contracts | Custom CRUD/form engine |
| Upload/media | Theme ABI ve skins | Genel dashboard data modeli |
| REST/GraphQL/Local API | Blue/green/rollback | CMS metadata/versioning |
| Generic official plugins | Supply-chain policy | Generic hierarchy/redirect/SEO |

## Payload'ın zaten sağladığı alanlar

- collection/global schemas;
- auth collection ve session;
- collection/field access;
- Local API, REST ve GraphQL;
- hooks ve transactions;
- versions/drafts;
- localization;
- live preview;
- blocks/rich content;
- admin custom views/components;
- jobs/tasks/workflows/schedules;
- upload/media;
- official plugin ekosistemi.

K-Nex bunların üzerine stable contracts, policy, lifecycle ve customer deployment katmanı koymalıdır. Aynı davranışı ikinci kez genel framework olarak yazmamalıdır.

## K-Nex'in gerçek katma değeri

Aşağıdaki alanlar Payload'a devredilmemelidir:

- deterministic plugin graph ve exact customer inventory;
- dependency/conflict/capability çözümü;
- immutable customer releases;
- Hot Application isolation;
- remote component/event protocol;
- Theme Skin data-only güvenliği;
- actor/delegation-aware source/action/tool gateway;
- agent approval, risk budget, idempotency ve audit;
- per-customer repo/DB/secrets/deployment;
- fleet compatibility, rollback ve migration policy;
- plugin disable/uninstall etkisi ve receipts.

## Access control için öneri

Mevcut Sales yaklaşımı Payload access'i tamamen false yapıp bütün gerçek erişimi K-Nex gateway üzerinden overrideAccess:true ile yürütmektedir.

Bu güvenli deny-by-default sağlar ama iki risk yaratır:

1. Payload Admin/REST doğrudan kullanılamaz.
2. K-Nex ve Payload authorization semantiği drift edebilir.

Önerilen yapı:

~~~text
Canonical K-Nex permission/policy
→ Payload collection access adapter
→ Payload field access adapter
→ source/action/tool projection and budgets
~~~

User-triggered Local API çağrıları overrideAccess:false çalışmalıdır. overrideAccess:true yalnız açık system/service identity ve önceden doğrulanmış scoped operation için kalmalıdır.

## CMS publication için sadeleştirme fırsatı

Payload drafts/versions/localization/live preview önce denenmelidir.

Custom publication pair/outbox yalnız şu invariant gerçekten gerekiyorsa korunmalıdır:

> Page metadata ve canonical UiDocument ayrı authority olarak kalmalı ve tek atomik publication pointer ile birlikte yayınlanmalı.

Bu gerekmiyorsa UiDocument'i page document içinde saklamak ve Payload versions kullanmak daha küçük sistem üretir.

## Jobs kararı

Pinned Payload 3.88.0 Jobs Queue'nun owner token ve expiring lease sağlamadığı ölçülmüş; transactional outbox için reddedilmesi doğrudur.

Bu karar Payload Jobs'i her kullanım için reddetmez. Aşağıdaki generic işler için tekrar değerlendirilebilir:

- scheduled publishing;
- non-transactional imports/exports;
- media processing;
- email delivery orchestration;
- rebuild/index işleri.

Transactional domain event/outbox tek authoritative lease sistemi olarak kalmalıdır.

## Resmi Payload pluginleri

Mevcut [official plugin adoption planı](../../32-payload-official-plugin-adoption-plan.md) doğru yaklaşımı kullanır.

Öncelikli adaylar:

- @payloadcms/plugin-seo
- @payloadcms/plugin-redirects
- @payloadcms/plugin-search
- @payloadcms/plugin-nested-docs
- @payloadcms/plugin-form-builder
- @payloadcms/plugin-import-export
- @payloadcms/plugin-sentry

Zaten doğru kullanılan:

- @payloadcms/plugin-mcp — yalnız bounded transport adapter.

Baseline olmaması gerekenler:

- multi-tenant — customer isolation yerine kullanılmamalı;
- Stripe/ecommerce — yalnız seçilen product pack içinde;
- bütün resmi pluginleri varsayılan kurma.

## Adoption kontrol listesi

Her plugin için:

1. Exact installed version docs/source/types.
2. License, maintenance, vulnerabilities.
3. Bundle/runtime impact.
4. Collection/route/tool exposure allowlist.
5. Access ve direct-request attack tests.
6. Disable/upgrade/migration/rollback etkisi.
7. Secret/log/telemetry redaction.
8. Real customer acceptance flow.

Sonuç: Payload private types K-Nex public/persisted contract olmamalı; plugin bounded adapter olarak kalmalı.
