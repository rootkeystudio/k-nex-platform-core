# Plugin, Tema ve Feature Önerileri

## Plugin stratejisi

Her şeyi baseline kurma. Küçük production core + seçilebilir product packs kullan.

## P0 production core

### Identity ve authorization

- OIDC/OAuth2;
- SAML;
- MFA/WebAuthn;
- SCIM;
- RBAC;
- approval;
- session/device administration;
- permission audit.

### Operasyon

- OpenTelemetry;
- optional Sentry;
- structured log/redaction;
- health/SLO;
- backup/restore drill;
- database migration visibility;
- secret-reference provider;
- rate limit/abuse protection.

### Storage ve delivery

- S3-compatible object storage;
- media transform;
- malware scanning;
- transactional email;
- webhook delivery;
- notification center;
- global search;
- import/export.

## CMS pack

Önce official Payload adayları:

- @payloadcms/plugin-seo
- @payloadcms/plugin-redirects
- @payloadcms/plugin-search
- @payloadcms/plugin-nested-docs
- @payloadcms/plugin-form-builder
- @payloadcms/plugin-import-export

Ürün capability'leri:

- page tree;
- drafts/versions;
- localization;
- live preview;
- scheduled publishing;
- DAM/media library;
- image transformations;
- reusable content;
- content approval;
- broken-link check;
- sitemap/robots;
- form → CRM action binding.

## CRM pack

Must-have:

- contacts;
- companies;
- opportunities/pipeline;
- tasks;
- activity timeline;
- notes/comments/mentions;
- notifications;
- saved views;
- CSV import mapping;
- duplicate detection/merge;
- email/calendar sync;
- workflow/automation;
- audit/history;
- consent and retention.

Integration plugins:

- Google Gmail/Calendar;
- Microsoft Outlook/Calendar;
- generic IMAP/SMTP where required;
- Slack/Teams notifications;
- webhook/integration gateway;
- optional WhatsApp/telephony;
- optional enrichment provider;
- optional quotes/invoices/payment pack.

## AI pack

### Olmazsa olmaz kontrol düzlemi

- model-provider abstraction;
- prompt/tool version registry;
- cost/token/latency budget;
- durable idempotency;
- approval/dry-run;
- PII redaction;
- audit and replay;
- citations;
- eval suite;
- failure/fallback policy;
- actor/delegation-aware page/record context.

### AI feature'ları

- record/page copilot;
- natural-language search;
- lead qualification;
- email draft;
- content draft;
- summarization;
- duplicate suggestion;
- workflow suggestion;
- dashboard creation assistant;
- plugin pack recommendation;
- migration/permission impact explanation.

AI hiçbir zaman raw Payload collection veya ambient req.payload almamalıdır. Yalnız K-Nex tool/source/action catalog kullanmalıdır.

## Baseline olmaması gereken pluginler

- Payload multi-tenant — customer isolation yerine kullanılmamalı;
- Stripe/ecommerce — seçilen vertical pack dışında;
- telephony/WhatsApp — müşteri ihtiyacı olmadan;
- birden fazla workflow engine;
- birden fazla search engine;
- bütün AI provider SDK'ları;
- bütün official Payload pluginleri.

## Tema stratejisi

### 1. Neutral SaaS

Default güvenli tema:

- açık/ferah;
- güçlü form/table;
- AA contrast;
- düşük marka baskısı;
- comfortable density.

### 2. Enterprise Dense

İlk öncelik:

- kompakt CRM/ERP tabloları;
- dense forms;
- split panes;
- sticky headers;
- keyboard-first;
- yüksek bilgi yoğunluğu.

### 3. Dark Command Center

- analytics;
- pipeline monitoring;
- realtime operations;
- güçlü chart palette;
- status semantics.

### 4. High Contrast

- forced-colors;
- büyük focus ring;
- reduced motion;
- accessible status/color pairing;
- minimum 44px touch target alternatifi.

### 5. Editorial CMS

- güçlü typography;
- content preview;
- media-forward layouts;
- article/landing templates;
- serif/sans pairing;
- spacious public surface.

### 6. White-label Brand Skin Generator

Customer'ın data-only değiştirebildiği alanlar:

- logo/assets;
- color roles;
- typography selection;
- radius;
- density;
- shadows;
- chart palette;
- status colors;
- light/dark preference.

JavaScript, primitive replacement ve behavior değişikliği Skin'e girmemelidir.

### Sonraya bırakılabilecek stiller

- luxury;
- neon;
- glassmorphism;
- playful;
- retro;
- neobrutalism production variant.

Mevcut Neobrutalism mekanizma/isolation proof olarak değerlidir; default enterprise tema olmamalıdır.

## Dashboard feature set

Must-have:

- private/team/role/workspace dashboards;
- tabs;
- drag/resize;
- desktop/mobile layout;
- widget templates;
- source/action bindings;
- saved filters;
- drilldown;
- realtime refresh;
- export/share;
- revision/rollback;
- plugin disable placeholder;
- per-widget authorization/cache/budget;
- dashboard role templates.

Twenty'nin private dashboard eksikliği K-Nex için farklılaşma fırsatıdır.

## Projeyi level atlatacak feature'lar

### 1. Compatibility and impact planner

Plugin enable/update öncesi kullanıcıya:

- version conflicts;
- permissions;
- migrations;
- downtime;
- new collections/routes/tools;
- SBOM/vulnerabilities;
- rollback window;
- estimated resource/cost

göster.

### 2. AI application composer

Kullanıcı ihtiyacını anlatır; AI:

- uygun plugin pack'lerini seçer;
- conflict çözer;
- theme/skin önerir;
- permissions ve migration impact üretir;
- reviewed application manifest çıkarır.

AI doğrudan runtime code veya Payload config mutate etmez.

### 3. Universal object/view builder

- custom object;
- fields/relations;
- table/form/kanban/calendar;
- permissions;
- import;
- workflow;
- dashboard widget.

Bu özellik Twenty/Odoo seviyesine yaklaşmak için zorunludur.

### 4. Cross-CMS/CRM journey

~~~text
landing page/form
→ lead/contact
→ dedupe/enrichment
→ governed AI
→ workflow/approval
→ dashboard
~~~

Payload + CRM + AI birleşiminin en güçlü demosu budur.

### 5. Fleet console

- customer inventory;
- version drift;
- vulnerability/revocation;
- staged rollout;
- health;
- backup state;
- migration readiness;
- rollback.

### 6. Command palette ve global search

- records;
- pages;
- dashboards;
- actions;
- tools;
- plugin administration.

Authorization her sonuç ve action için server-side uygulanmalıdır.

### 7. Workflow builder

- event/schedule/webhook triggers;
- conditions;
- source/action/tool steps;
- human approval;
- retry/idempotency;
- run history;
- replay;
- versioned publication.

Yeni workflow engine eklemeden önce Payload Jobs ile transactional K-Nex outbox sınırı net tutulmalıdır.

## Öncelik özeti

~~~text
P0  RBAC, idempotency, exact-head Gate 9, real generator
P1  custom objects/views, dashboards, search/import, email/calendar
P2  AI composer, marketplace impact UI, fleet console, workflows
P3  geniş vertical plugin ve tema kataloğu
~~~
