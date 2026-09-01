# Genel Review Analizi

## Yönetici özeti

K-Nex iki farklı olgunluk seviyesini aynı anda taşıyor:

1. Güvenlik, extension yaşam döngüsü, deployment ve agent tool kontratlarında ileri bir platform temeli.
2. Kullanıcının görebileceği CRM/CMS ürününde çok erken bir proof.

Bu ayrım dokümanlarda her zaman yeterince net değil. Bazı result dokümanları mekanizma proof'unu ürün entegrasyonu gibi anlatıyor. Gerçekte Sales tek domain fixture; generated app, dashboard, Hot Application authoring loop ve canlı custom object modeli tamamlanmış değil.

## Genel puanlama

| Alan | Puan | Değerlendirme |
|---|---:|---|
| Mimari vizyon | 8/10 | Extension sınıfları ve trust boundary doğru |
| Güvenlik tasarımı | 8/10 | Capability, isolation, audit ve deployment yaklaşımı güçlü |
| Mevcut güvenlik uygulaması | 5/10 | Runner lifetime, idempotency ve attestation açıkları var |
| Doğruluk ve dayanıklılık | 5/10 | Race, restore, replay ve lifecycle cleanup açıkları var |
| Performans | 4/10 | Hot path Docker cold start ve full revalidation taşıyor |
| Ürün olgunluğu | 3/10 | Sales fixture var; bütünleşik CRM/CMS yok |
| Geliştirici deneyimi | 3/10 | Hot App SDK/CLI/dev loop henüz yok |
| Test/gate disiplini | 8/10 | Real Postgres, Docker, Chromium ve attack corpus iyi |
| Production readiness | 4/10 | Phase 10 RBAC ve önemli correctness işleri eksik |

## En önemli mimari karar

Üç extension sınıfı doğru:

~~~text
Platform Plugin
  trusted static Payload/Next composition
  immutable customer release

Hot Application
  isolated prebuilt server/UI bundle
  fixed host capabilities
  live generation activation

Theme Skin
  data-only tokens/recipes/scoped CSS/assets
  live generation activation
~~~

Payload config ve import map statik olduğu için bütün eklentileri sahte biçimde hot-load etmeye çalışmamak doğru karardır. Deep Payload collection/hook/provider ekleyen kod Platform Plugin olarak kalmalıdır.

## Bugünkü ürün gerçeği

[application-factory.ts](../../../packages/composition/src/application-factory.ts) Sales collection'larını boot eden minimal Payload uygulaması üretmektedir. Çıktıda tam Next application shell, auth/users, admin/workspace ürün akışı, dashboard persistence, tool endpoint'leri ve uygulanan tema bulunmamaktadır.

Bu nedenle bugünkü doğru tanım:

> K-Nex, güvenli ve müşteriye özel CRM/CMS üretmeyi hedefleyen güçlü bir platform temeli; henüz bitmiş CRM/CMS generator ürünü değil.

## En büyük stratejik açık

Twenty, Odoo ve Directus'un temel avantajı yalnız plugin katalogları değildir. Asıl avantajları metadata-driven object/field/view katmanıdır.

K-Nex Phase 9 Hot Application verisini bilinçli olarak namespaced KV/document storage ile sınırlar. Bu güvenli ama aşağıdaki kullanıcı beklentisini karşılamaz:

- deploy olmadan custom object oluşturma;
- field/relationship ekleme;
- table, kanban, calendar ve record view üretme;
- role-aware layout ve dashboard oluşturma;
- import, dedupe, workflow ve reporting.

Bu boşluk için ayrı, açık bir ürün kararı gereklidir. Hot Application'ın Payload config mutate etmesine izin verilmemelidir.

## Ana risk

Ana risk kötü mimari değildir. Ana risk ürün doğrulanmadan platform yüzeyinin büyümeye devam etmesidir.

Repo:

- geniş manifest/ABI yüzeyi;
- 100'den fazla UI component family;
- büyük gate ve fixture altyapısı;
- deployment, provenance ve runtime mekanizmaları

taşırken hâlâ tek gerçek customer journey'i uçtan uca üretmemektedir.

Yeni platform primitive'leri Phase 10 sonrasında dondurulmalı; önce şu akış çıkarılmalıdır:

~~~text
login
→ Sales list/create/update
→ dashboard edit/save
→ governed agent tool call
→ plugin disable/enable
→ audit/rollback
~~~

## Review kapsamı ve sınırlama

- Aktif Phase 9 worktree ve ilgili plan/ADR/result dokümanları incelendi.
- Main checkout veya branch state değiştirilmedi.
- Yeni test, build, dependency audit veya runtime benchmark çalıştırılmadı.
- Performans değerlendirmesi kod yolu ve mevcut gate kapsamına dayanır.
- Rakip karşılaştırması 2026-08-30 tarihindeki resmi dokümantasyona dayanır.
