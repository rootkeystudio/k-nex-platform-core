# Twenty, Odoo, Directus ve Payload Benchmark

## Özet tablo

| Alan | K-Nex bugün | Benchmark sonucu |
|---|---|---|
| CRM breadth | Sales fixture | Odoo ve Twenty ileride |
| CMS | Payload temeli var, generator bağlamıyor | Payload ve Odoo ileride |
| Custom object/field | Deferred; KV/document | Twenty, Odoo, Directus ileride |
| Generic views | Component proof | Twenty/Odoo/Directus ürünleşmiş |
| Dashboard | Library proof | Odoo/Directus/Twenty ürünleşmiş |
| Workflow | Contract/infra parçaları | Odoo/Directus/Twenty ileride |
| Live extension | Güçlü Phase 9 POC | Twenty author DX daha olgun |
| Hostile plugin isolation | Güçlü potansiyel | K-Nex farklılaşabilir |
| AI tool governance | Tasarım güçlü, durability açık | K-Nex farklılaşabilir |
| Plugin author DX | CLI/SDK yok | Twenty/Odoo ileride |
| Fleet/rollback | Güçlü tasarım | K-Nex potansiyel avantajlı |
| Per-customer isolation | Tasarım güçlü | K-Nex potansiyel avantajlı |

## Payload benchmark

Payload'ın güçlü tarafı:

- modern TypeScript/React/Next tabanı;
- güçlü collection/field sistemi;
- auth/access;
- drafts/versions/localization/live preview;
- Local API/REST/GraphQL;
- özelleştirilebilir admin;
- resmi pluginler.

Payload'ın K-Nex açısından sınırı:

- plugin config ve import map statik;
- arbitrary downloaded extension kodu için hostile-code sandbox değil;
- müşteri başına plugin conflict/fleet/blue-green çözümü hazır ürün olarak gelmiyor;
- generic no-code CRM object/view/dashboard ürünü değil.

K-Nex'in iki-path extension modeli bu sınır için doğru çözümdür.

Resmi kaynak: [Payload Plugins](https://payloadcms.com/docs/plugins/overview)

## Twenty benchmark

Twenty'nin alınması gereken güçlü tarafları:

- TypeScript Apps SDK;
- object/field/view/navigation contributions;
- typed generated client;
- logic function ve front component modeli;
- hızlı dev/live-sync loop;
- metadata-driven table, kanban, calendar ve record layout;
- dashboard → tab → widget yapısı.

Twenty'nin K-Nex'e en büyük dersi güvenlik mimarisi değil, ürün ve author DX bütünlüğüdür.

K-Nex'in potansiyel farkı:

- Payload CMS kabiliyeti;
- müşteri başına repo/DB/deployment;
- daha sıkı supply-chain ve rollback;
- data-only Theme Skins;
- governed agent tool execution.

Resmi kaynaklar:

- [Twenty Apps](https://docs.twenty.com/getting-started/core-concepts/apps)
- [Twenty Data Model](https://docs.twenty.com/getting-started/core-concepts/data-model)
- [Twenty Dashboards](https://docs.twenty.com/user-guide/dashboards/capabilities/dashboards)

## Odoo benchmark

Odoo'nun güçlü tarafları:

- çok geniş domain/app kataloğu;
- Studio ile model, field, view, automation, approval ve security;
- table/form/kanban/report üretimi;
- mature workflow ve accounting/ERP breadth;
- modül bağımlılık ve asset sistemi;
- dashboard/report/spreadsheet deneyimi.

Kopyalanması gereken:

- metadata-driven CRUD/view;
- universal record page;
- workflow/approval;
- domain pack yaklaşımı;
- report ve dashboard derinliği.

Kopyalanmaması gereken:

- host içinde trusted arbitrary module hot install;
- install hooks ile kontrolsüz veri/şema mutation;
- extension class sınırlarını bulanıklaştırma.

K-Nex'in Platform Plugin / Hot Application / Theme Skin ayrımı bu noktada daha temizdir.

Resmi kaynaklar:

- [Odoo Studio](https://www.odoo.com/documentation/19.0/applications/studio.html)
- [Odoo Module Manifests](https://www.odoo.com/documentation/19.0/developer/reference/backend/module.html)
- [Odoo Dashboards](https://www.odoo.com/documentation/19.0/applications/productivity/dashboards.html)
- [Odoo AI Agents](https://www.odoo.com/documentation/19.0/applications/productivity/ai/agents.html)

## Directus benchmark

Directus'un güçlü tarafları:

- runtime metadata-driven collections;
- generic data studio;
- extension türleri;
- Insights dashboards/panels;
- Flows automation;
- headless API-first ürünleşme.

K-Nex için dersi:

- custom object/field motoru platformun merkezinde olmalı;
- dashboard ve workflow ayrı proof değil, metadata modelinin doğal tüketicisi olmalı;
- extension author'a hızlı dış-repo loop verilmeli.

Resmi kaynaklar:

- [Directus Extensions](https://docs.directus.io/extensions/introduction)
- [Directus Dashboards](https://docs.directus.io/user-guide/insights/dashboards)
- [Directus Flows](https://docs.directus.io/app/flows)

## Rekabetçi konumlandırma

K-Nex Odoo'nun breadth'i veya Twenty'nin CRM polish'i ile kısa vadede yarışmamalı.

En güçlü konum:

> Payload tabanlı CMS + metadata-driven CRM + müşteri başına güvenli plugin composition + governed AI agents.

Savunulabilir farklar:

1. Plugin permission/impact diff.
2. Customer-specific reproducible release.
3. Hostile Hot App isolation.
4. Data-only white-label theme activation.
5. Actor/delegation-aware agent tools.
6. Exact rollback/fleet inventory.
7. CMS form/content akışından CRM ve AI workflow'a tek platform.

## Benchmark sonucu

K-Nex'in temel güvenlik ve deployment vizyonu rakiplerden daha iddialı olabilir. Ancak bugün rakiplerin ürün seviyesine ulaşmadan önce üç boşluk kapanmalıdır:

1. Gerçek generated customer application.
2. Live custom object/field/view motoru.
3. Persisted customizable dashboard/workflow ürünü.
