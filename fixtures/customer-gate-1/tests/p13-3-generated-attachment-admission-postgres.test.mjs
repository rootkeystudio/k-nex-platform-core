import assert from "node:assert/strict";
import test from "node:test";

import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

async function ownerSession(origin, persona) {
  const response = await fetch(`${origin}/api/users/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: persona.email, password: persona.password })
  });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const body = await response.json();
  assert.ok(body.user?.id !== undefined);
  return { cookie, id: String(body.user.id) };
}

async function link(origin, cookie, input, idempotencyKey) {
  return fetch(`${origin}/api/k-nex/sales/actions/sales.attachment.link`, {
    method: "POST", headers: { "content-type": "application/json", cookie, origin },
    body: JSON.stringify({ input, idempotencyKey })
  });
}

async function attachmentEvidence(pool) {
  return (await pool.query(`select
    (select count(*)::int from sales_attachment_references) rows,
    (select coalesce(sum(jsonb_array_length(audit)),0)::int from sales_attachment_references) audit_entries,
    (select count(*)::int from k_nex_outbox where payload->>'actionId'='sales.attachment.link') outbox_count,
    (select count(*)::int from sales_action_idempotency where action_id='sales.attachment.link') idempotency_count`)).rows[0];
}

test("P13.3 generated attachment admission ledger denies unissued or mismatched storage and survives host restart", { timeout: 360_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ origin, personas, records, pool, issueAttachmentUploadReceipt, stopWeb, startWeb }) => {
    const owner = await ownerSession(origin, personas.owner);
    const base = { relatedRecordType: "sales.account", relatedRecordId: records.accountId, mediaType: "text/plain", byteSize: 7 };
    const before = Number((await pool.query("select count(*)::int count from sales_attachment_references")).rows[0].count);
    const deniedEvidence = await attachmentEvidence(pool);

    const missing = await link(origin, owner.cookie, { ...base, storageReference: "p13/generated/missing", filename: "missing.txt" }, "p13-generated-attachment-missing");
    assert.equal(missing.status, 403, await missing.clone().text());

    issueAttachmentUploadReceipt({ storageRef: "p13/generated/foreign", uploaderActorId: "foreign-actor", filename: "foreign.txt", mediaType: "text/plain", byteSize: 7 });
    const foreign = await link(origin, owner.cookie, { ...base, storageReference: "p13/generated/foreign", filename: "foreign.txt" }, "p13-generated-attachment-foreign");
    assert.equal(foreign.status, 403, await foreign.clone().text());

    await pool.query("insert into k_nex_sales_attachment_upload_admissions (application_id,environment,storage_ref,uploader_actor_id,filename,media_type,byte_size,state,revision) values ($1,'foreign','p13/generated/foreign-scope',$2,'foreign-scope.txt','text/plain',7,'ready',1)", ["p13-crm-browser", owner.id]);
    const foreignScope = await link(origin, owner.cookie, { ...base, storageReference: "p13/generated/foreign-scope", filename: "foreign-scope.txt" }, "p13-generated-attachment-foreign-scope");
    assert.equal(foreignScope.status, 403, await foreignScope.clone().text());

    issueAttachmentUploadReceipt({ storageRef: "p13/generated/mismatch", uploaderActorId: owner.id, filename: "bound.txt", mediaType: "text/plain", byteSize: 7 });
    const mismatch = await link(origin, owner.cookie, { ...base, storageReference: "p13/generated/mismatch", filename: "forged.txt" }, "p13-generated-attachment-mismatch");
    assert.equal(mismatch.status, 403, await mismatch.clone().text());
    assert.deepEqual(await attachmentEvidence(pool), deniedEvidence);

    issueAttachmentUploadReceipt({ storageRef: "p13/generated/valid", uploaderActorId: owner.id, filename: "valid.txt", mediaType: "text/plain", byteSize: 7 });
    const validInput = { ...base, storageReference: "p13/generated/valid", filename: "valid.txt" };
    const valid = await link(origin, owner.cookie, validInput, "p13-generated-attachment-valid");
    assert.equal(valid.status, 200, await valid.clone().text());
    const validData = (await valid.json()).data;
    assert.deepEqual(Object.keys(validData).sort(), ["id", "revision", "status"]);
    assert.deepEqual((await pool.query("select storage_reference,filename,media_type,byte_size,uploader_id from sales_attachment_references where id=$1", [validData.id])).rows, [{ storage_reference: "p13/generated/valid", filename: "valid.txt", media_type: "text/plain", byte_size: 7, uploader_id: owner.id }]);
    const validEvidence = await attachmentEvidence(pool);
    const replay = await link(origin, owner.cookie, validInput, "p13-generated-attachment-valid");
    assert.equal(replay.status, 200, await replay.clone().text());
    assert.deepEqual((await replay.json()).data, validData);
    assert.deepEqual(await attachmentEvidence(pool), validEvidence);

    issueAttachmentUploadReceipt({ storageRef: "p13/generated/restart", uploaderActorId: owner.id, filename: "restart.txt", mediaType: "text/plain", byteSize: 7 });
    await stopWeb();
    await startWeb();
    const restartedReplay = await link(origin, owner.cookie, validInput, "p13-generated-attachment-valid");
    assert.equal(restartedReplay.status, 200, await restartedReplay.clone().text());
    assert.deepEqual((await restartedReplay.json()).data, validData);
    assert.deepEqual(await attachmentEvidence(pool), validEvidence);
    const restartedMissing = await link(origin, owner.cookie, { ...base, storageReference: "p13/generated/still-missing", filename: "still-missing.txt" }, "p13-generated-attachment-restart-missing");
    assert.equal(restartedMissing.status, 403, await restartedMissing.clone().text());
    const restarted = await link(origin, owner.cookie, { ...base, storageReference: "p13/generated/restart", filename: "restart.txt" }, "p13-generated-attachment-restart");
    assert.equal(restarted.status, 200, await restarted.clone().text());

    const mediaType128 = `text/${"a".repeat(123)}`;
    issueAttachmentUploadReceipt({ storageRef: "p13/generated/media-128", uploaderActorId: owner.id, filename: "media-128.txt", mediaType: mediaType128, byteSize: 7 });
    const media128 = await link(origin, owner.cookie, { ...base, storageReference: "p13/generated/media-128", filename: "media-128.txt", mediaType: mediaType128 }, "p13-generated-attachment-media-128");
    assert.equal(media128.status, 200, await media128.clone().text());
    assert.throws(() => issueAttachmentUploadReceipt({ storageRef: "p13/generated/media-129", uploaderActorId: owner.id, filename: "media-129.txt", mediaType: `${mediaType128}a`, byteSize: 7 }), /receipt facts are invalid/);
    assert.deepEqual((await pool.query("select storage_ref,media_type from k_nex_sales_attachment_upload_admissions where storage_ref like 'p13/generated/media-%' order by storage_ref")).rows, [{ storage_ref: "p13/generated/media-128", media_type: mediaType128 }]);
    assert.equal(Number((await pool.query("select count(*)::int count from sales_attachment_references")).rows[0].count), before + 3);
  });
});
