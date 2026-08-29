import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { PostgresThemeProfileStore } from "@k-nex/payload-adapter";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const digest = (character) => `sha256:${character.repeat(64)}`;
const skinAuthority = (generation) => ({
  applicationId: "customer-alpha",
  environment: "production",
  deliveryClass: "theme-skin",
  extensionId: "skin.neobrutalism",
  generationId: `skin-generation-${generation}`,
  sourceCommit: "a".repeat(40),
  artifactDigest: digest(String(generation)),
  manifestDigest: digest("b"),
  catalogDigest: digest("c"),
  provenanceDigest: digest("d"),
  sbomDigest: digest("e")
});
const generationEvidence = (generation) => ({
  authority: "verified-bundle",
  version: generation === 1 ? "1.0.0" : "1.1.0",
  receiptId: `skin-receipt-${generation}`,
  ...skinAuthority(generation)
});

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p9-7-theme-profile-secret", BOOT_KEY: "p9-7-theme-profile" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function profile({ state, revision, generation, previousRevisionId }) {
  return {
    schemaVersion: 1,
    id: "theme-profile.public-skin",
    surface: "public",
    themeId: "theme.minimal",
    themeVersion: "1.0.0",
    palette: "light",
    mode: "light",
    values: { "color.accent": generation === 1 ? "#2457ff" : "#004fa8" },
    skin: {
      id: "skin.neobrutalism",
      generationId: `skin-generation-${generation}`,
      version: generation === 1 ? "1.0.0" : generation === 2 ? "1.1.0" : "2.0.0",
      palette: "skin.bright",
      values: { "--k-nex-color-accent": generation === 1 ? "#2457ff" : "#004fa8" }
    },
    revision: {
      id: revision,
      number: Number(revision.at(-1)),
      createdAt: "2026-08-29T09:00:00.000Z",
      ...(previousRevisionId ? { previousRevisionId } : {}),
      state,
      ...(state === "published" ? { publishedAt: "2026-08-29T09:01:00.000Z" } : {})
    }
  };
}

async function seedSkinGenerations(pool) {
  await pool.query(
    `insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition)
     values ('customer-alpha','production','theme-skin','skin.neobrutalism',1,'removed')`
  );
  for (const generation of [1, 2]) {
    await pool.query(
      `insert into runtime_extension_generations (
         application_id, environment, delivery_class, extension_id, generation_id, version, authority_json, authority_digest,
         rollback_eligible, state, server_generation_id, ui_generation_id, storage_generation_id
       ) values ('customer-alpha','production','theme-skin','skin.neobrutalism',$1,$2,$3::jsonb,$4,true,$5,$1,$1,$1)`,
      [`skin-generation-${generation}`, generation === 1 ? "1.0.0" : "1.1.0", JSON.stringify(skinAuthority(generation)), digest(generation === 1 ? "f" : "9"), generation === 1 ? "active" : "rollback"]
    );
  }
  await pool.query(
    `update runtime_extensions set disposition='active', active_generation_id='skin-generation-1',
       active_generation=$1::jsonb, rollback_generation_id='skin-generation-2', rollback_generation=$2::jsonb
     where application_id='customer-alpha' and environment='production' and delivery_class='theme-skin' and extension_id='skin.neobrutalism'`,
    [JSON.stringify(generationEvidence(1)), JSON.stringify(generationEvidence(2))]
  );
}

async function activateSkin(pool, active, rollback) {
  await pool.query("begin");
  try {
    await pool.query(
      `update runtime_extension_generations set state=case when generation_id=$1 then 'active' when generation_id=$2 then 'rollback' else state end
       where application_id='customer-alpha' and environment='production' and delivery_class='theme-skin' and extension_id='skin.neobrutalism'`,
      [`skin-generation-${active}`, `skin-generation-${rollback}`]
    );
    await pool.query(
      `update runtime_extensions set revision=revision+1, active_generation_id=$1::varchar, rollback_generation_id=$2::varchar,
         active_generation=$3::jsonb, rollback_generation=$4::jsonb
       where application_id='customer-alpha' and environment='production' and delivery_class='theme-skin' and extension_id='skin.neobrutalism'`,
      [`skin-generation-${active}`, `skin-generation-${rollback}`, JSON.stringify(generationEvidence(active)), JSON.stringify(generationEvidence(rollback))]
    );
    await pool.query("commit");
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }
}

test("publishes and rolls back Theme Profiles atomically against exact active skin generations", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("theme_profiles").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const store = new PostgresThemeProfileStore(pool, { now: () => new Date("2026-08-29T09:02:00.000Z") });
  try {
    await boot(container.getConnectionUri());
    await seedSkinGenerations(pool);
    const tableShape = await pool.query("select to_regclass('public.runtime_theme_profile_publications')::text profiles, to_regclass('public.runtime_theme_profile_outbox')::text outbox");
    assert.deepEqual(tableShape.rows, [{ profiles: "runtime_theme_profile_publications", outbox: "runtime_theme_profile_outbox" }]);

    const firstRevision = "theme-revision.skin-1";
    await store.stageDraft({ applicationId: "customer-alpha", environment: "production", profile: profile({ state: "draft", revision: firstRevision, generation: 1 }) });
    assert.equal((await store.read({ applicationId: "customer-alpha", environment: "production", profileId: "theme-profile.public-skin" })).active, undefined);
    await assert.rejects(store.publish({
      applicationId: "customer-alpha", environment: "production", expectedRevision: 0,
      profile: { ...profile({ state: "published", revision: firstRevision, generation: 1 }), mode: "dark" }
    }), { code: "DRAFT_CONFLICT" });
    const first = await store.publish({ applicationId: "customer-alpha", environment: "production", expectedRevision: 0, profile: profile({ state: "published", revision: firstRevision, generation: 1 }) });
    assert.equal(first.revisionAfter, 1);
    assert.equal(first.skinGenerationId, "skin-generation-1");

    const badRevision = "theme-revision.bad-2";
    await store.stageDraft({ applicationId: "customer-alpha", environment: "production", profile: profile({ state: "draft", revision: badRevision, generation: 3, previousRevisionId: firstRevision }) });
    await assert.rejects(store.publish({
      applicationId: "customer-alpha", environment: "production", expectedRevision: 1,
      profile: profile({ state: "published", revision: badRevision, generation: 3, previousRevisionId: firstRevision })
    }), { code: "SKIN_GENERATION_UNAVAILABLE" });
    assert.equal((await store.read({ applicationId: "customer-alpha", environment: "production", profileId: "theme-profile.public-skin" })).active.revision.id, firstRevision);

    await activateSkin(pool, 2, 1);
    const secondRevision = "theme-revision.skin-2";
    await store.stageDraft({ applicationId: "customer-alpha", environment: "production", profile: profile({ state: "draft", revision: secondRevision, generation: 2, previousRevisionId: firstRevision }) });
    await pool.query(`create function p9_fail_theme_profile_outbox() returns trigger language plpgsql as $$ begin raise exception 'simulated profile crash before commit'; end $$`);
    await pool.query(`create trigger p9_fail_theme_profile_outbox before insert on runtime_theme_profile_outbox for each row when (new.revision=2) execute function p9_fail_theme_profile_outbox()`);
    await assert.rejects(store.publish({
      applicationId: "customer-alpha", environment: "production", expectedRevision: 1,
      profile: profile({ state: "published", revision: secondRevision, generation: 2, previousRevisionId: firstRevision })
    }), /simulated profile crash before commit/);
    assert.equal((await store.read({ applicationId: "customer-alpha", environment: "production", profileId: "theme-profile.public-skin" })).active.revision.id, firstRevision);
    await pool.query(`drop trigger p9_fail_theme_profile_outbox on runtime_theme_profile_outbox`);
    await pool.query(`drop function p9_fail_theme_profile_outbox()`);

    const readers = Array.from({ length: 24 }, () => store.read({ applicationId: "customer-alpha", environment: "production", profileId: "theme-profile.public-skin" }));
    const [second, ...observations] = await Promise.all([
      store.publish({
        applicationId: "customer-alpha", environment: "production", expectedRevision: 1,
        profile: profile({ state: "published", revision: secondRevision, generation: 2, previousRevisionId: firstRevision })
      }),
      ...readers
    ]);
    assert.equal(second.revisionAfter, 2);
    assert.equal(observations.every((entry) => [firstRevision, secondRevision].includes(entry.active.revision.id)), true);
    const active = await store.read({ applicationId: "customer-alpha", environment: "production", profileId: "theme-profile.public-skin" });
    assert.equal(active.active.revision.id, secondRevision);
    assert.equal(active.previous.revision.id, firstRevision);
    assert.equal(active.draft, undefined);

    await assert.rejects(store.rollback({
      applicationId: "customer-alpha", environment: "production", profileId: "theme-profile.public-skin", expectedRevision: 2
    }), { code: "SKIN_GENERATION_UNAVAILABLE" });
    await activateSkin(pool, 1, 2);
    const rolledBack = await store.rollback({ applicationId: "customer-alpha", environment: "production", profileId: "theme-profile.public-skin", expectedRevision: 2 });
    assert.equal(rolledBack.revisionAfter, 3);
    assert.equal(rolledBack.activeRevisionId, firstRevision);
    assert.equal(rolledBack.previousRevisionId, secondRevision);
    const final = await store.read({ applicationId: "customer-alpha", environment: "production", profileId: "theme-profile.public-skin" });
    assert.equal(final.active.revision.id, firstRevision);
    assert.equal(final.previous.revision.id, secondRevision);
    assert.match(final.stateDigest, /^sha256:[0-9a-f]{64}$/);
    const outbox = await pool.query("select revision, event_json->>'operation' operation from runtime_theme_profile_outbox order by revision");
    assert.deepEqual(outbox.rows, [{ revision: 1, operation: "publish" }, { revision: 2, operation: "publish" }, { revision: 3, operation: "rollback" }]);
  } finally {
    await pool.end();
    await container.stop();
  }
});
