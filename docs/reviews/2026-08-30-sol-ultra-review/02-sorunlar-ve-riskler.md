# Sorunlar ve Riskler

## P0 — Phase 9 mevcut snapshot'ta review-ready değil

[status.md](../../../status.md) satır 14–18 exact-head Gate 9 tekrarının beklediğini söylerken [phase-9-result.md](../../implementation/phase-9-result.md) final committed-tree kanıtının tamamlandığını iddia etmektedir.

Mevcut dirty diff ayrıca branch HEAD'de no-op olan worker activation/drain davranışını gerçek Docker worker sürecine çevirmektedir. Eski gate bu davranışı tam kanıtlamamıştır.

**Etki:** Mevcut snapshot için GATE_9_PASS veya Ready for phase review denemez.

**Gerekli:** Düzeltmeleri tamamla, commit et, exact-head Gate 9 çalıştır, yeni review al; sonra state'i Ready for phase review yap.

## P0 — Hot Application route sahipliği çakışıyor

[hot-application-surfaces.ts](../../../packages/ui-runtime/src/hot-application-surfaces.ts) satır 21'de app ID içindeki noktalar tireye çevrilmektedir.

~~~text
app.foo.bar  → foo-bar
app.foo-bar  → foo-bar
~~~

Ayrıca route ownership kontrolü segment sınırı olmadan startsWith kullanmaktadır. app.sales, /apps/sales-assistant gibi başka bir namespace'i kabul edebilir.

**Etki:** Route collision, yanlış app ownership ve deny-of-service.

**Gerekli:** Çakışmasız canonical slug/encoding ve tam sınır kontrolü:

~~~text
route === base || route.startsWith(base + "/")
~~~

Collision ve prefix testleri eklenmeli.

## P0 ürün — Generator gerçek K-Nex uygulaması üretmiyor

[application-factory.ts](../../../packages/composition/src/application-factory.ts) satır 84–131 yalnız Sales registry ve iki Payload collection boot eder. Üretilen dosyalarda:

- Next app router;
- users/auth;
- Payload admin veya workspace shell;
- source/action/tool endpoint;
- dashboard runtime/persistence;
- gerçek theme provider;
- plugin lifecycle administration

yoktur.

**Etki:** create-knex-app çıktısı CRM/CMS generator ürünü değil, minimal Payload boot proof'udur.

**Gerekli:** Mevcut [composePayloadApplication](../../../packages/payload-adapter/src/index.ts) ve registration/runtime katmanlarını kullanan tek gerçek generated vertical application.

## P1 — Runner result ile capability etkisinin lifetime'ı ayrışıyor

[service-source.ts](../../../packages/extension-runner/src/service-source.ts) satır 16–35 app'in host.call çağrısını await etmeden result döndürmesine izin verir. [extension-runner index](../../../packages/extension-runner/src/index.ts) satır 321–366 capability handler'larını ayrı async akışta işler ve result geldiğinde invocation'ı bitirebilir.

**Etki:** Başarılı response, audit veya lease release sonrasında DB/network mutation commit olabilir.

**Gerekli:**

- invocation başına in-flight capability takibi;
- bütün çağrılar settled olmadan terminal result reddi veya bekletme;
- cancellation-aware handler;
- durable effect idempotency.

## P1 — Tool ve action idempotency durable değil

[tool-idempotency.ts](../../../packages/runtime/src/tool-idempotency.ts) yalnız process-local Map kullanır. Restart veya ikinci process aynı key'i tekrar çalıştırabilir.

[action-gateway.ts](../../../packages/runtime/src/action-gateway.ts) write action için idempotency key ister ancak replay state/result saklamaz.

**Etki:** Agent veya kullanıcı mutation'ı timeout, restart ve multi-process durumda iki kez çalışabilir.

**Gerekli:** PostgreSQL tabanlı coordinator:

~~~text
application + actor/delegation + tool/action/version
+ idempotency key + input digest
+ pending/uncertain/completed + result
~~~

Mutation, event/outbox ve idempotency kaydı mümkün olduğunda aynı transaction içinde olmalı.

## P1 — Supervisor crash orphan invocation container bırakabilir

[extension-runner index](../../../packages/extension-runner/src/index.ts) satır 434–457 startup sırasında yalnız generation artık active değilse runner container'ını öldürür. Invocation container'ına supervisor lease/instance ownership bağlanmamıştır.

**Etki:** Aktif generation için busy-loop yapan orphan container yaşamaya devam edebilir; tekrar eden crash kaynak tüketimini artırabilir.

**Gerekli:**

- supervisor instance/lease label;
- startup'ta unattached invocation reap;
- stdin/parent death durumunda runner exit;
- container-side hard wall-time.

## P1 — Hot Application provenance gerçek hosted attestation değil

[bundle.ts](../../../packages/extension-bundler/src/bundle.ts) satır 45 provenance JSON'unu caller'ın verdiği repository ve workflowIdentity stringlerinden üretir. [catalog.ts](../../../packages/extension-bundler/src/catalog.ts) satır 79–84 yalnız string/digest binding kontrolü yapar.

Publisher public key parse ve allowlist karşılaştırması vardır; artifact üzerinde publisher signature doğrulanmamaktadır.

**Etki:** Catalog signer, trusted publisher adına artifact/provenance mint edebilir. GitHub Actions OIDC veya builder identity kriptografik olarak kanıtlanmaz.

**Gerekli:** Phase 8'de kullanılan DSSE/Sigstore/GitHub attestation doğrulama zincirini Hot App ve Skin publication'a taşı.

## P1 — SBOM dependency SBOM değil

[bundle.ts](../../../packages/extension-bundler/src/bundle.ts) satır 29–30 her dosyayı CycloneDX type:file component yapar. Package, version, PURL, license ve transitive dependency closure yoktur.

**Etki:** Bundle dependency vulnerability/license taraması yapılamaz.

**Gerekli:** Publication bundler gerçek dependency closure çıkarmalı; SBOM package-level component ve relationship içermeli.

## P1 performans — Her invocation Docker cold start

[extension-runner index](../../../packages/extension-runner/src/index.ts) her invoke için:

- artifact load;
- seccomp temp file;
- docker run;
- inspect;
- protocol exchange;
- kill

yapar.

[verified-artifact-store.ts](../../../packages/payload-adapter/src/verified-artifact-store.ts) executable read sırasında artifact bytes, tar, SBOM ve provenance'ı tekrar doğrular.

**Etki:** Interactive dashboard ve agent multi-tool akışlarında yüksek latency/CPU/DB maliyeti. Mevcut gate Docker invocation p50/p95 veya concurrent load ölçmez.

**Gerekli:** Generation başına bounded warm sandbox/pool ve immutable digest/revision'a bağlı verified materialization cache. Restore/revocation cache invalidation zorunlu.

## P1 güvenlik — Sandbox proof production hostile-code seviyesi değil

[policy.ts](../../../packages/extension-runner/src/policy.ts) custom seccomp profilinde defaultAction olarak allow kullanır ve kısa denylist uygular. Varsayılan isolation policy Docker Desktop VM'dir.

Mevcut network-none, read-only root, non-root UID, tmpfs, cgroup, cap-drop ve effective inspection kontrolleri güçlüdür. Ancak bu proof tek başına Linux production hostile multi-tenant isolation kanıtı değildir.

**Gerekli:**

- gerçek Linux AppArmor/SELinux CI;
- daha dar syscall allowlist;
- third-party risk tier için gVisor, Kata veya microVM değerlendirmesi;
- resmi supported browser/host matrix.

## P1 — Sales authorization TOCTOU

[action-endpoint.ts](../../../fixtures/customer-gate-1/src/action-endpoint.ts) önce actor record scope kontrolü yapar. [Sales server](../../../modules/sales/src/server.ts) satır 608–640 daha sonra raw ID ve overrideAccess:true ile update yapar.

**Etki:** Kontrol ile update arasında kayıt actor scope dışına taşınabilir.

**Gerekli:** Authorization ve update aynı transaction/row lock içinde; expected revision veya conditional scope update kullan.

## P1/P2 — Payload access kapatılıp ikinci policy stack kurulmuş

[Sales collections](../../../modules/sales/src/server.ts) satır 643–688 bütün Payload access operasyonlarını false yapar. K-Nex gateway daha sonra overrideAccess:true kullanır.

Bu yaklaşım güvenli deny-by-default sağlar. Fakat native Payload Admin/REST kullanımını kapatır ve K-Nex ile Payload field/record policy arasında drift riski yaratır.

**Gerekli:** Canonical K-Nex policy'yi Payload collection/field access adapter'ına compile et. overrideAccess:true yalnız açık system/service identity için kullanılsın.

## P1 — App-storage restore normal write ile serialize olmuyor

[app-storage.ts](../../../packages/payload-adapter/src/app-storage.ts) put/delete sırasında namespace-level advisory lock, restore sırasında farklı app-level advisory lock kullanır.

**Etki:** Concurrent başarılı write restore tarafından silinebilir.

**Gerekli:** Bütün mutasyonların paylaştığı app-level fence veya restore öncesi generation quiesce; expected backup/app revision. Backup tamper threat varsa unkeyed digest yerine signature/MAC.

## P1 — Aktif catalog policy bazı durumları fail-open ele alıyor

[verifier.ts](../../../packages/extension-bundler/src/verifier.ts) install sırasında pending/rejected/advisory sürümü engeller. Active revalidation sırasında revoked/compromised/unsupported dışındaki durumları clear kabul eder.

**Etki:** Sonradan review:rejected olan release active kalabilir. Catalog'dan kaybolan release için açık signed tombstone politikası yoktur.

**Gerekli:** Active policy'yi açıkça tanımla; rejected ve trusted evidence mismatch fail-closed olsun. Removal için signed tombstone/revocation kullan.

## P1 — Network capability response budget'ı geç uygulanıyor

[extension-network-capability.ts](../../../packages/runtime/src/extension-network-capability.ts) adapter response'unu tamamen materialize eder; output budget gateway'de daha sonra uygulanır. Secret echo kontrolü yalnız literal substring eşitliğidir.

**Etki:** Host-memory DoS ve encoded/transformed secret echo.

**Gerekli:**

- streaming byte ceiling;
- redirect ve DNS/private-IP policy;
- integration-specific response schema;
- raw credential yerine credential broker;
- secret-bearing endpoint response'unu app'e doğrudan vermeme.

## P1 — Runtime outbox external publish'i transaction içinde yapıyor

[runtime-extension-outbox.ts](../../../packages/payload-adapter/src/runtime-extension-outbox.ts) row lock aldıktan sonra sink.publish çağrısını transaction içinde bekler.

**Etki:** Yavaş/hanging sink DB connection ve row lock tutar.

**Gerekli:** Kısa claim/lease transaction, idempotent publish transaction dışında, ardından delivered mark. Publish timeout ve AbortSignal ekle.

## P1 — Terk edilmiş operation global kapasite tüketebilir

[runtime-extension-store.ts](../../../packages/payload-adapter/src/runtime-extension-store.ts) global active-operation sayacını claim sırasında artırır; yalnız terminal transition/completion azaltır. Expired lease'i ancak operation ID'yi bilen caller devralabilir.

**Etki:** Kaybolan operation ID'leri ortamı kalıcı GLOBAL_BUDGET_EXHAUSTED durumuna taşıyabilir.

**Gerekli:** Expired-operation reconciler, audited failure/compensation ve capacity recovery.

## P1 ürün — Puck document değişimini güvenli resetlemiyor

[editor-host.ts](../../../packages/builder-puck/src/editor-host.ts) mounted Puck instance'ına değişen document için yeni data verir ancak document identity key veya resmi reset/store API kullanmaz. Pinned Puck initialData'yı initial mount'ta okur.

**Etki:** Başka sayfa/layout açıldığında eski document gösterilebilir veya yanlış document kaydedilebilir.

**Gerekli:** Document identity key veya resmi editor reset API; mount/rerender browser regression testi.

## P1 ürün — Builder DataTable kontrolleri görünür ama state değiştirmiyor

[ui-builder-blocks library](../../../packages/ui-builder-blocks/src/library.ts) fresh view state oluşturur ve DataTable'a onViewStateChange vermez.

**Etki:** Search, sort, filter ve pagination UI görünür fakat query/state güncellenmez.

**Gerekli:** Host-owned ve persist edilebilir view state; source query binding; real browser interaction testi.

## P2 — Remote UI session registry owner identity'yi kaybediyor

[remote-ui-host.ts](../../../packages/ui-runtime/src/remote-ui-host.ts) session identity içinde applicationId/environment taşırken generation registry key'inde yalnız appId/generationId kullanır. Normal dispose edilen session registry Set'inden çıkarılmaz.

**Etki:** Registry shared scope'ta kullanılırsa cross-owner collision; her durumda uzun yaşayan generation için session memory leak.

**Gerekli:** Full owner identity key ve dispose-unregister callback. Eğer registry her deployment'ta kesin single-owner ise bu invariant constructor/type seviyesinde kapatılmalı.

## P2 — Monoton büyüyen map/table state

Retention/eviction bulunmayan başlıca alanlar:

- query rate buckets;
- tool runCalls/buckets;
- runner generations/workloadUsers;
- remote UI sessions;
- capability replay rows.

**Etki:** Uzun yaşayan process ve yüksek-cardinality actor/run/generation durumunda memory veya table büyümesi.

**Gerekli:** TTL/LRU, lifecycle eviction, DB retention/partition/cleanup job.

## P2 — Hot Application ABI çalışan yüzeyden geniş

[extension-runtime.ts](../../../packages/contracts/src/extension-runtime.ts) settings, screens, navigation, sources, actions, tools, logic functions, events, schedules, storage, assets, localization ve health yüzeyi ilan eder. Concrete runtime bunların yalnız bir bölümünü bind eder.

**Etki:** Pre-v1 dead ABI, compatibility ve bakım yükü.

**Gerekli:** Manifest v1'i çalışan minimuma küçült veya her kategori için descriptor loader → runtime gateway → non-fixture acceptance tamamla.

## P2 — Hot App author SDK/CLI yok

Dokümanlar extension build/dev/install/live sync vaat eder. [extension-bundler package](../../../packages/extension-bundler/package.json) private library'dir; bin/CLI sağlamaz. Bundler önceden build edilmiş bytes bekler.

**Etki:** Yalnız fixture yazarları Hot App üretebilir.

**Gerekli:** Küçük typed SDK, esbuild publication bundler, create command ve live dev sync.

## P2 — UI breadth ürün derinliğini geçmiş

Component inventory çok geniş; çoğu family yalnız SSR/default-state kanıtına sahiptir. Gerçek Sales/CMS/dashboard akışının state, persistence ve browser interaction kapsamı daha dardır.

**Etki:** Bakım yüzeyi artarken temel ürün akışları yarım kalır.

**Gerekli:** Yeni component family eklemeyi dondur; kullanılan 20–30 family'yi tam etkileşim, accessibility, theme ve product state açısından bitir.

## P2 — Tema sistemi mekanizma proof seviyesinde

Minimal ve Neobrutalism temaları public surface ve temel primitives üzerinde iyi izolasyon kanıtlar. Workspace/admin, density, dark mode, charts ve geniş component family coverage tamamlanmış değildir.

**Etki:** Tema seçilmiş görünür; tüm CRM/CMS ürününe gerçekten giydirilmiş değildir.

**Gerekli:** Enterprise Dense, dark/system mode ve workspace/admin coverage'ı gerçek generated app üzerinde kanıtla.

## P3 — Semver parser yeniden yazılmış

[catalog.ts](../../../packages/extension-bundler/src/catalog.ts) kendi semver comparison implementation'ını taşır. Workspace zaten semver dependency kullanmaktadır.

**Etki:** Gereksiz edge-case ve bakım yüzeyi.

**Gerekli:** Tek approved shared semver implementation kullan.

## Test ve gate gerçeği

Güçlü taraflar:

- Gates 0–8 zincirli;
- real Postgres, Docker, Chromium;
- named attack corpus ve fail-closed marker kontrolleri;
- strict TypeScript;
- bundle gzip ve seçili UI performance budget'ları.

Eksikler:

- current dirty exact-head Gate 9 yok;
- Docker invocation latency/throughput benchmark yok;
- artifact-size scaling ve DB pool saturation yok;
- Firefox/WebKit matrix yok;
- repo-wide coverage threshold bulunamadı;
- genel lint/formatter gate görünmüyor.
