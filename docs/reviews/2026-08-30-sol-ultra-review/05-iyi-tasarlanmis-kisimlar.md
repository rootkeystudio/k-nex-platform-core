# İyi Tasarlanmış Kısımlar

## 1. Üç extension sınıfı

Platform Plugin, Hot Application ve Theme Skin ayrımı projenin en doğru kararıdır.

Bu ayrım:

- Payload statik config gerçeğini kabul eder;
- sahte hot-reload iddiasını engeller;
- trusted host code ile hostile remote code'u ayırır;
- data-only theme değişikliğini executable code'dan ayırır.

## 2. Host process mutation yasağı

Production web/worker sürecinin:

- pnpm/npm install çalıştırmaması;
- node_modules mutate etmemesi;
- downloaded code'u Payload/Next process'e import etmemesi;
- Docker socket ve build credential almaması

doğru ve kritik güvenlik kararıdır.

## 3. Deterministic composition

Exact versions, frozen lockfile, declared-versus-runtime inventory ve deterministic registration yaklaşımı version conflict hedefi için güçlü tabandır.

Customer repository'nin desired state olması; runtime database'in statik plugin graph üretememesi doğrudur.

## 4. Agent tool kontrol düzlemi

Tool pipeline'ın aşamaları güçlüdür:

~~~text
principal/delegation
→ catalog visibility
→ input validation
→ authorization
→ risk/resource budget
→ approval
→ idempotency
→ dispatch
→ output validation/redaction
→ audit
~~~

Özellikle:

- raw Payload CRUD'ı MCP'ye otomatik açmama;
- actor/delegation taşıma;
- tool visibility ile execution authority'yi ayırma;
- approval ve audit'i transporttan bağımsız tutma

doğru kararlardır.

Durable idempotency açığı kapatıldığında bu katman ürünün ana farklılaştırıcısı olabilir.

## 5. MCP'nin bounded adapter olması

@payloadcms/plugin-mcp yalnız API-key/admin/transport adapter olarak kullanılmakta; K-Nex tool catalog ve execution gateway authoritative kalmaktadır.

Bu, MCP metadata veya Payload collection'larının yanlışlıkla güvenlik otoritesi olmasını engeller.

## 6. Transactional outbox ve revision convergence

Pinned Payload Jobs lease kontratı yetmediğinde gerçek Postgres outbox'a geçilmesi ölçülmüş ve gerekçeli karardır.

Güçlü parçalar:

- FOR UPDATE SKIP LOCKED;
- owner token;
- expiring lease;
- stale-owner denial;
- bounded retry/backoff;
- dead letter;
- checkpoint;
- periodic revision recovery.

## 7. Remote UI protokolü

Remote UI host tarafındaki:

- exact app/generation identity;
- sequence/replay kontrolü;
- byte/depth/node/rate budget;
- allowlisted component/event/source/action/route;
- MessagePort;
- host-owned DOM/focus/accessibility/routing

yaklaşımı sağlamdır.

Runtime registry ve browser portability açıkları çözülmeli; temel protokol korunmalıdır.

## 8. Docker sandbox kontrolleri

Güçlü mevcut kontroller:

- pinned image digest;
- network none;
- read-only root;
- non-root unique UID;
- bounded tmpfs;
- cap-drop ALL;
- no-new-privileges;
- pids/memory/cpu/nofile;
- seccomp/MAC policy;
- effective Docker state inspection;
- cross-app/OOM/timeout testleri.

Bu iyi POC'dir. Production Linux/higher-risk sandbox proof ile tamamlanmalıdır.

## 9. Theme Skin modeli

Theme Skin'in:

- JavaScript içermemesi;
- native primitive override etmemesi;
- token/recipe/scoped CSS/assets ile sınırlı olması;
- AST tabanlı selector scope;
- exact ABI ve immutable generation kullanması

doğru karardır.

Compound behavior platform component'lerinde kalmalıdır.

## 10. Zero-downtime konusunda dürüstlük

Expand, backfill, post-retirement contract ve offline-required fazlarının ayrılması iyi tasarımdır.

Incompatible/destructive migration'a sahte zero-downtime etiketi vermeyip maintenance-required dönmek doğrudur.

## 11. Worker fencing

HTTP traffic promotion ile worker side-effect authority'nin ayrı tutulması; monotonic Postgres fence ve stale completion denial düşüncesi güçlüdür.

Mevcut dirty düzeltmenin exact-head gerçek worker proof ile kapanması gerekir.

## 12. Customer isolation

Customer başına:

- repository;
- database;
- secrets;
- deployment;
- inventory;
- build/release

ayrımı SaaS platform riskini azaltır. Payload multi-tenant plugin'i bunun yerine kullanılmamalıdır.

## 13. Resmi Payload plugin adoption politikası

Her official plugin'in:

- exact version;
- license/maintenance/security;
- exposure;
- migration/rollback;
- performance;
- access boundaries

ile değerlendirilmesi doğrudur. Plugin private types'ın K-Nex public contract olmaması özellikle iyi karardır.

## 14. Test/gate yaklaşımı

Real Postgres, Docker, Chromium, process crash, race ve attack corpus kullanılması güçlüdür.

Gate marker'larının exact named proof'lara bağlanması sahte başarı riskini azaltır. Current exact-head eksikliği süreç problemi; gate tasarımının kendisi güçlüdür.

## 15. Dokümantasyon kalitesi

ADR, plan, result ve trust-boundary dokümanları erken proje için olağanüstü ayrıntılıdır.

İyileştirme gereken tek nokta:

- mechanism proof;
- production-shaped fixture;
- generated product integration;
- production deployment

ifadelerini daha katı ayırmak.
