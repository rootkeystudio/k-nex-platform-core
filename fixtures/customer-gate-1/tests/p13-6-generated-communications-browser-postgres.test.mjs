import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import test from "node:test";

import { chromium } from "playwright";

import { seriousAccessibilityViolations } from "./p13-3-browser-accessibility.mjs";
import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

const forbiddenSecrets = ["p136-fixture-email-provider-secret", "p136-fixture-calendar-provider-secret", "secret-ref:v1:email-reference:webhook", "secret-ref:v1:calendar-reference:default"];
function assertNoSecrets(value, message) { for (const secret of forbiddenSecrets) assert.doesNotMatch(String(value), new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"), message); }

async function login(browser, origin, persona) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage(); page.setDefaultTimeout(20_000);
  const response = await page.goto(`${origin}/login`); assert.equal(response?.status(), 200);
  await page.getByLabel("Email").fill(persona.email); await page.getByLabel("Password").fill(persona.password);
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL((url) => url.origin === origin && url.pathname !== "/login");
  return { context, page };
}

async function visit(page, origin, path, heading, diagnostics) {
  const response = await page.goto(new URL(path, origin).toString()); assert.equal(response?.status(), 200, diagnostics());
  await page.locator("#workspace-main").waitFor(); await page.getByRole("heading", { name: heading, exact: true }).waitFor();
  assert.deepEqual(await seriousAccessibilityViolations(page), [], `serious/critical accessibility violations at ${path}`);
}

async function clickAction(page, actionId, recordId, diagnostics) {
  const button = page.locator(`button[data-action-id="${actionId}"][data-record-id="${recordId}"]`); await button.waitFor();
  const [response] = await Promise.all([page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/k-nex/sales/actions/${actionId}`), button.click()]);
  const body = await response.text(); assert.equal(response.status(), 200, `${actionId}: ${body}\n${diagnostics()}`); assert.match(response.headers()["cache-control"] ?? "", /no-store/u); assertNoSecrets(`${response.url()}\n${body}`, `${actionId} leaked provider authority`);
  return JSON.parse(body);
}

async function submitActionForm(page, actionId, buttonName, values, diagnostics) {
  const button = page.getByRole("button", { name: buttonName, exact: true }); await button.waitFor();
  const form = button.locator("xpath=ancestor::form");
  for (const [label, value] of Object.entries(values)) {
    const control = form.getByLabel(label, { exact: true });
    if (await control.evaluate((element) => element.tagName === "SELECT")) await control.selectOption(String(value));
    else await control.fill(String(value));
  }
  const [response] = await Promise.all([page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/k-nex/sales/actions/${actionId}`), button.click()]);
  const body = await response.text(); assert.equal(response.status(), 200, `${actionId}: ${body}\n${diagnostics()}`); assert.match(response.headers()["cache-control"] ?? "", /no-store/u); assertNoSecrets(`${response.url()}\n${body}`, `${actionId} leaked provider authority`);
  return JSON.parse(body);
}

async function postAction(page, actionId, body) {
  return await page.evaluate(async ({ actionId: id, body: requestBody }) => {
    const response = await fetch(`/api/k-nex/sales/actions/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody) });
    return { status: response.status, cacheControl: response.headers.get("cache-control"), url: response.url, body: await response.json() };
  }, { actionId, body });
}

function webhook(secret, event) {
  const body = Buffer.from(JSON.stringify(event)); const timestamp = String(Date.now());
  return { body, timestamp, signature: `v1=${createHmac("sha256", secret).update(timestamp).update(".").update(body).digest("hex")}` };
}

async function postWebhook(origin, request) {
  const response = await fetch(`${origin}/api/k-nex/sales/providers/email-reference/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-k-nex-timestamp": request.timestamp, "x-k-nex-signature": request.signature }, body: request.body });
  return { status: response.status, body: await response.json() };
}

async function oversizedWebhook(origin) {
  const url = new URL("/api/k-nex/sales/providers/email-reference/webhook", origin);
  return await new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: "POST", headers: { "content-type": "application/json", "x-k-nex-timestamp": String(Date.now()), "x-k-nex-signature": `v1=${"0".repeat(64)}` } }, (response) => {
      const chunks = []; response.on("data", (chunk) => chunks.push(chunk)); response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    request.on("error", reject); for (let index = 0; index < 67; index += 1) request.write(Buffer.alloc(1_000)); request.end();
  });
}

test("P13.6 generated HTTP and Chromium prove webhook bounds and recipient-only notification journeys", { timeout: 360_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ origin, personas, records, pool, applicationOutput }) => {
    const ownerId = String((await pool.query("select id from users where email=$1", [personas.owner.email])).rows[0].id);
    const managerId = String((await pool.query("select id from users where email=$1", [personas.manager.email])).rows[0].id);
    const representativeId = String((await pool.query("select id from users where email=$1", [personas.representative.email])).rows[0].id);
    assert.equal(Number((await pool.query("select count(*) count from k_nex_role_permission_grants where application_id='p13-crm-browser' and role_id='p13.crm.representative' and permission_id='sales.communications.email.send'")).rows[0].count), 0, "canonical representative persona grant matrix must remain unchanged");
    await pool.query("insert into k_nex_roles(application_id,role_id,label) values ('p13-crm-browser','p136.cross-team-email','P13.6 cross-team email test only')");
    await pool.query(`insert into k_nex_role_permission_grants(application_id,grant_id,role_id,permission_id,owner_kind,owner_namespace,owner_delivery_class,owner_extension_id,owner_generation,revision)
      select application_id,'p136-cross-team-email-send','p136.cross-team-email',permission_id,owner_kind,owner_namespace,owner_delivery_class,owner_extension_id,owner_generation,revision from k_nex_role_permission_grants where application_id='p13-crm-browser' and role_id='customer.initial-sales-administrator' and permission_id='sales.communications.email.send'`);
    await pool.query("insert into k_nex_role_assignments(application_id,assignment_id,role_id,subject_kind,subject_id,state) values ('p13-crm-browser','p136-cross-team-email-assignment','p136.cross-team-email','user',$1,'active')", [representativeId]);
    assert.equal(Number((await pool.query("select count(*) count from k_nex_role_permission_grants where application_id='p13-crm-browser' and role_id='p13.crm.representative' and permission_id='sales.communications.email.send'")).rows[0].count), 0, "test-only grant must not mutate canonical representative persona role");
    await pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,configured_by) values ('p13-crm-browser','test','email.reference.v1','secret-ref:v1:email-reference:webhook',$1)", [managerId]);
    const operationId = "provider-browser-webhook-operation";
    await pool.query(`insert into sales_provider_operations(operation_id,application_id,environment,provider_id,action_id,actor_id,related_record_type,related_record_id,idempotency_digest,payload_json,configuration_revision,authorization_revision,lifecycle_revision,scope_revision,state,attempt,next_attempt_at,accepted_at)
      values($1,'p13-crm-browser','test','email.reference.v1','sales.email.send',$2,'sales.contact',$3,$4,'{}',1,1,0,1,'accepted',1,now(),now())`, [operationId, managerId, 1, `sha256:${"2".repeat(64)}`]);
    const event = { applicationId: "p13-crm-browser", environment: "test", eventId: "p136-browser-webhook-001", operationId, recipientId: managerId, kind: "message-delivered", metadata: { providerMessageId: "p136-browser-message-001" } };
    const signed = webhook("p136-fixture-email-provider-secret", event);
    assert.deepEqual(await postWebhook(origin, signed), { status: 202, body: { accepted: true, replay: false } });
    assert.deepEqual(await postWebhook(origin, signed), { status: 202, body: { accepted: true, replay: true } });
    const crossRecipient = { ...event, eventId: "p136-browser-cross-recipient", recipientId: representativeId, metadata: { providerMessageId: "p136-browser-cross-recipient" } };
    assert.deepEqual(await postWebhook(origin, webhook("p136-fixture-email-provider-secret", crossRecipient)), { status: 400, body: { code: "WEBHOOK_INVALID", status: 400 } });
    assert.deepEqual(await oversizedWebhook(origin), { status: 400, body: { code: "WEBHOOK_INVALID", status: 400 } });
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications where recipient_id=$1 and reference_id=$2", [managerId, event.eventId])).rows[0].count), 1);

    const managerContactId = String((await pool.query("select id from sales_contacts where application_id='p13-crm-browser' and environment='test' and owner_id=$1 and display_name='Manager browser contact'", [managerId])).rows[0].id);
    const managerTask = (await pool.query("insert into sales_tasks(application_id,environment,owner_id,team_id,created_by,updated_by,title,status,archive_status,revision,audit) values ('p13-crm-browser','test',$1,$2,$1,$1,'P13.6 reminder source','open','active',1,'[]') returning id", [managerId, `team:${managerId}`])).rows[0];
    await pool.query(`update sales_tasks set audit=jsonb_build_array(jsonb_build_object('actionId','sales.task.create','resourceId',id::text,'applicationId',application_id,'environment',environment,'fromState','absent','toState','open','occurredAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T'||to_char(now() at time zone 'UTC','HH24:MI:SS.MS')||'Z','actorId',owner_id,'revision',1,'idempotencyKey','p136-browser-task-genesis','ownershipGenesis',jsonb_build_object('ownerId',owner_id,'teamId',team_id))) where id=$1`, [managerTask.id]);

    const managerNotification = (await pool.query("insert into sales_notifications(application_id,environment,recipient_id,subject,reference_kind,reference_id,state,revision,metadata,audit,delivered_at) values ('p13-crm-browser','test',$1,'Manager private notification','task','101','unread',1,'{}','[]',now()) returning id", [managerId])).rows[0];
    const managerDeniedNotification = (await pool.query("insert into sales_notifications(application_id,environment,recipient_id,subject,reference_kind,reference_id,state,revision,metadata,audit,delivered_at) values ('p13-crm-browser','test',$1,'Manager denial target','task','105','unread',1,'{}','[]',now()) returning id", [managerId])).rows[0];
    const managerReminder = (await pool.query("insert into sales_reminders(application_id,environment,recipient_id,reference_kind,reference_id,subject,scheduled_at,delivered_at,state,revision,attempt,idempotency_digest,audit) values ('p13-crm-browser','test',$1,'task','102','Manager private reminder',now()-interval '1 hour',now(),'delivered',2,0,$2,'[]') returning id", [managerId, `sha256:${"1".repeat(64)}`])).rows[0];
    const scheduledReminder = (await pool.query("insert into sales_reminders(application_id,environment,recipient_id,reference_kind,reference_id,subject,scheduled_at,state,revision,attempt,idempotency_digest,audit) values ('p13-crm-browser','test',$1,'task','104','Manager scheduled reminder',now()+interval '1 day','scheduled',1,0,$2,'[]') returning id", [managerId, `sha256:${"3".repeat(64)}`])).rows[0];
    await pool.query(`update sales_notifications set audit=jsonb_build_array(jsonb_build_object('actionId','sales.notification.deliver','resourceId',id::text,'applicationId',application_id,'environment',environment,'fromState','absent','toState','unread','occurredAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T'||to_char(now() at time zone 'UTC','HH24:MI:SS.MS')||'Z','actorId',recipient_id,'revision',1,'idempotencyKey','p136-browser-notification-genesis')) where id=$1`, [managerNotification.id]);
    await pool.query(`update sales_notifications set audit=jsonb_build_array(jsonb_build_object('actionId','sales.notification.deliver','resourceId',id::text,'applicationId',application_id,'environment',environment,'fromState','absent','toState','unread','occurredAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T'||to_char(now() at time zone 'UTC','HH24:MI:SS.MS')||'Z','actorId',recipient_id,'revision',1,'idempotencyKey','p136-browser-denial-genesis')) where id=$1`, [managerDeniedNotification.id]);
    await pool.query(`update sales_reminders set audit=jsonb_build_array(
      jsonb_build_object('actionId','sales.reminder.schedule','resourceId',id::text,'applicationId',application_id,'environment',environment,'fromState','absent','toState','scheduled','occurredAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T'||to_char(now() at time zone 'UTC','HH24:MI:SS.MS')||'Z','actorId',recipient_id,'revision',1,'idempotencyKey','p136-browser-reminder-schedule'),
      jsonb_build_object('actionId','sales.job.reminder-delivery','resourceId',id::text,'applicationId',application_id,'environment',environment,'fromState','scheduled','toState','delivered','occurredAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T'||to_char(now() at time zone 'UTC','HH24:MI:SS.MS')||'Z','actorId',recipient_id,'revision',2,'idempotencyKey','p136-browser-reminder-delivery')) where id=$1`, [managerReminder.id]);
    await pool.query(`update sales_reminders set audit=jsonb_build_array(jsonb_build_object('actionId','sales.reminder.schedule','resourceId',id::text,'applicationId',application_id,'environment',environment,'fromState','absent','toState','scheduled','occurredAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T'||to_char(now() at time zone 'UTC','HH24:MI:SS.MS')||'Z','actorId',recipient_id,'revision',1,'idempotencyKey','p136-browser-reminder-cancel-genesis')) where id=$1`, [scheduledReminder.id]);
    await pool.query("insert into sales_notifications(application_id,environment,recipient_id,subject,reference_kind,reference_id,state,revision,metadata,audit,delivered_at) values ('p13-crm-browser','test',$1,'Representative private notification','task','103','unread',1,'{}','[]',now())", [representativeId]);

    const browser = await chromium.launch({ headless: true });
    try {
      const owner = await login(browser, origin, personas.owner); const manager = await login(browser, origin, personas.manager); const representative = await login(browser, origin, personas.representative); const viewer = await login(browser, origin, personas.viewer);
      try {
        const observedRequests = []; for (const page of [owner.page, manager.page]) page.on("request", (request) => observedRequests.push({ url: request.url(), body: request.postData() }));
        const managerProjection = await manager.page.evaluate(async () => { const response = await fetch("/api/k-nex/sales/routes/sales.route.notifications?page=1"); return { status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json() }; });
        assert.equal(managerProjection.status, 200, `${JSON.stringify(managerProjection.body)}\n${applicationOutput()}`);
        assert.match(managerProjection.cacheControl ?? "", /no-store/u); assertNoSecrets(JSON.stringify(managerProjection), "recipient projection leaked provider authority");
        assert.match(JSON.stringify(managerProjection.body), /Manager private notification/u, `recipient projection omitted own notification: ${JSON.stringify(managerProjection.body)}`);
        await visit(manager.page, origin, "/sales/notifications", "Notifications", applicationOutput);
        assertNoSecrets(await manager.page.content(), "notification HTML leaked provider authority");
        await manager.page.getByText("Manager private notification", { exact: false }).first().waitFor(); await manager.page.getByText("Manager private reminder", { exact: false }).first().waitFor();
        assert.equal(await manager.page.getByText("Representative private notification", { exact: false }).count(), 0);
        const readResult = await clickAction(manager.page, "sales.notification.read", String(managerNotification.id), applicationOutput);
        assert.deepEqual(readResult.data, { id: String(managerNotification.id), revision: 2, status: "read" });
        await manager.page.getByText("Manager private notification (read)", { exact: true }).first().waitFor();
        await manager.page.locator(`button[data-action-id="sales.notification.archive"][data-record-id="${managerNotification.id}"]`).waitFor();
        const archiveResult = await clickAction(manager.page, "sales.notification.archive", String(managerNotification.id), applicationOutput);
        const dismissResult = await clickAction(manager.page, "sales.reminder.dismiss", String(managerReminder.id), applicationOutput);
        const cancelResult = await clickAction(manager.page, "sales.reminder.dismiss", String(scheduledReminder.id), applicationOutput);
        assert.deepEqual(archiveResult.data, { id: String(managerNotification.id), revision: 3, status: "archived" });
        assert.deepEqual(dismissResult.data, { id: String(managerReminder.id), revision: 3, status: "dismissed" });
        assert.deepEqual(cancelResult.data, { id: String(scheduledReminder.id), revision: 2, status: "cancelled" });
        assert.deepEqual((await pool.query("select state,revision from sales_notifications where id=$1", [managerNotification.id])).rows, [{ state: "archived", revision: 3 }]);
        assert.deepEqual((await pool.query("select state,revision from sales_reminders where id=$1", [managerReminder.id])).rows, [{ state: "dismissed", revision: 3 }]);
        assert.deepEqual((await pool.query("select state,revision,cancelled_at is not null cancelled from sales_reminders where id=$1", [scheduledReminder.id])).rows, [{ state: "cancelled", revision: 2, cancelled: true }]);
        await manager.page.getByLabel("Scheduled at UTC").waitFor();

        const scheduleResult = await submitActionForm(manager.page, "sales.reminder.schedule", "Reminder Schedule", { "Reference kind": "task", "Reference ID": String(managerTask.id), "Expected revision": "1", "Scheduled at UTC": "2026-09-20T12:00:00.000Z", Subject: "Manager form scheduled reminder" }, applicationOutput);
        const formReminder = (await pool.query("select id,state,revision,audit from sales_reminders where recipient_id=$1 and subject='Manager form scheduled reminder'", [managerId])).rows[0];
        assert.deepEqual(scheduleResult.data, { id: String(formReminder.id), revision: 1, status: "scheduled" });
        assert.equal(formReminder.state, "scheduled"); assert.equal(formReminder.revision, 1); assert.equal(formReminder.audit[0].resourceId, String(formReminder.id)); assert.equal(formReminder.audit[0].actionId, "sales.reminder.schedule");
        await manager.page.getByText("Manager form scheduled reminder", { exact: false }).first().waitFor();
        const formCancelResult = await clickAction(manager.page, "sales.reminder.dismiss", String(formReminder.id), applicationOutput);
        assert.deepEqual(formCancelResult.data, { id: String(formReminder.id), revision: 2, status: "cancelled" });
        assert.deepEqual((await pool.query("select state,revision,cancelled_at is not null cancelled from sales_reminders where id=$1", [formReminder.id])).rows, [{ state: "cancelled", revision: 2, cancelled: true }]);

        const liveOperationId = "provider-browser-live-operation";
        await pool.query(`insert into sales_provider_operations(operation_id,application_id,environment,provider_id,action_id,actor_id,related_record_type,related_record_id,idempotency_digest,payload_json,configuration_revision,authorization_revision,lifecycle_revision,scope_revision,state,attempt,next_attempt_at,accepted_at)
          values($1,'p13-crm-browser','test','email.reference.v1','sales.email.send',$2,'sales.contact',$3,$4,'{}',1,1,0,1,'accepted',1,now(),now())`, [liveOperationId, managerId, 1, `sha256:${"4".repeat(64)}`]);
        const liveEvent = { ...event, eventId: "p136-browser-live-event", operationId: liveOperationId, metadata: { providerMessageId: "p136-browser-live-message" } };
        const liveSigned = webhook("p136-fixture-email-provider-secret", liveEvent); const beforeLive = await manager.page.getByText("message-delivered", { exact: false }).count();
        assert.deepEqual(await postWebhook(origin, liveSigned), { status: 202, body: { accepted: true, replay: false } });
        await manager.page.waitForFunction((before) => [...document.querySelectorAll("span")].filter((node) => node.textContent?.includes("message-delivered")).length > before, beforeLive, { timeout: 20_000 });
        assert.deepEqual(await postWebhook(origin, liveSigned), { status: 202, body: { accepted: true, replay: true } });
        assert.equal(Number((await pool.query("select count(*) count from sales_notifications where reference_id=$1", [liveEvent.eventId])).rows[0].count), 1, "realtime replay must not duplicate notification rows");

        await visit(owner.page, origin, "/sales/settings", "Sales settings", applicationOutput);
        assertNoSecrets(await owner.page.content(), "settings HTML leaked provider authority");
        await submitActionForm(owner.page, "sales.integration.configure", "Integration Configure", { Provider: "calendar.reference.v1", "Expected revision": "0", Operation: "activate" }, applicationOutput);
        assert.deepEqual((await pool.query("select provider_id,state,revision from sales_provider_configurations where application_id='p13-crm-browser' and environment='test' and provider_id='calendar.reference.v1'")).rows, [{ provider_id: "calendar.reference.v1", state: "active", revision: 1 }]);

        await visit(owner.page, origin, "/sales/calendar", "Sales calendar", applicationOutput);
        assertNoSecrets(await owner.page.content(), "calendar HTML leaked provider authority");
        await submitActionForm(owner.page, "sales.email.send", "Email Send", { "Recipient record type": "sales.contact", "Recipient record ID": records.contactId, Subject: "P13.6 form email", Message: "Authorized contact channel only" }, applicationOutput);
        const emailActivity = (await pool.query("select id,status,revision,owner_id,team_id,audit from sales_activities where subject='P13.6 form email'", [])).rows[0];
        assert.ok(["scheduled", "completed"].includes(emailActivity.status)); assert.ok([1, 2].includes(emailActivity.revision)); assert.equal(emailActivity.owner_id, ownerId); assert.equal(emailActivity.team_id, `team:${ownerId}`); assert.equal(emailActivity.audit[0].resourceId, String(emailActivity.id)); assert.equal(emailActivity.audit[0].actionId, "sales.email.send");
        assert.equal(Number((await pool.query("select count(*) count from sales_provider_operations where actor_id=$1 and action_id='sales.email.send' and related_record_id=$2 and payload_json ? 'activityId' and not (payload_json ?| array['recipient','address','email'])", [ownerId, records.contactId])).rows[0].count), 1);
        await submitActionForm(owner.page, "sales.calendar.sync", "Calendar Sync", { "Activity ID": records.activityId, "Expected revision": "1" }, applicationOutput);
        assert.equal(Number((await pool.query("select count(*) count from sales_provider_operations where actor_id=$1 and action_id='sales.calendar.sync' and payload_json->>'activityId'=$2", [ownerId, records.activityId])).rows[0].count), 1);

        await visit(owner.page, origin, "/sales/settings", "Sales settings", applicationOutput);
        await submitActionForm(owner.page, "sales.integration.configure", "Integration Configure", { Provider: "calendar.reference.v1", "Expected revision": "1", Operation: "revoke" }, applicationOutput);
        assert.deepEqual((await pool.query("select state,revision,revoked_at is not null revoked from sales_provider_configurations where application_id='p13-crm-browser' and environment='test' and provider_id='calendar.reference.v1'")).rows, [{ state: "revoked", revision: 2, revoked: true }]);
        const calendarOperationsBeforeDenied = Number((await pool.query("select count(*) count from sales_provider_operations where actor_id=$1 and action_id='sales.calendar.sync'", [ownerId])).rows[0].count);
        const revokedSync = await postAction(owner.page, "sales.calendar.sync", { routeId: "sales.route.calendar", nodeId: "calendar-sync", input: { providerId: "calendar.reference.v1", activityId: records.activityCancelId, expectedRevision: 1 }, selection: {}, idempotencyKey: "p136-calendar-revoked-denial" });
        assert.equal(revokedSync.status, 503, JSON.stringify(revokedSync)); assert.match(revokedSync.cacheControl ?? "", /no-store/u); assertNoSecrets(JSON.stringify(revokedSync), "revoked provider response leaked authority");
        assert.equal(Number((await pool.query("select count(*) count from sales_provider_operations where actor_id=$1 and action_id='sales.calendar.sync'", [ownerId])).rows[0].count), calendarOperationsBeforeDenied, "revoked provider must not create operation");

        await visit(representative.page, origin, "/sales/notifications", "Notifications", applicationOutput);
        await representative.page.getByText("Representative private notification", { exact: false }).first().waitFor();
        assert.equal(await representative.page.getByText("Manager private notification", { exact: false }).count(), 0); assert.equal(await representative.page.getByText("Manager private reminder", { exact: false }).count(), 0);
        const crossActorAction = await postAction(representative.page, "sales.notification.read", { routeId: "sales.route.notifications", nodeId: "notification-list", input: { id: String(managerDeniedNotification.id), expectedRevision: 1 }, selection: {}, idempotencyKey: "p136-cross-actor-notification" });
        assert.ok([403, 409].includes(crossActorAction.status), JSON.stringify(crossActorAction));
        assert.deepEqual((await pool.query("select state,revision from sales_notifications where id=$1", [managerDeniedNotification.id])).rows, [{ state: "unread", revision: 1 }]);
        const crossTeamEmail = await postAction(representative.page, "sales.email.send", { routeId: "sales.route.calendar", nodeId: "email-send", input: { providerId: "email.reference.v1", relatedRecordType: "sales.contact", relatedRecordId: managerContactId, subject: "Cross-team denied", body: "Denied" }, selection: {}, idempotencyKey: "p136-cross-team-email-denied" });
        assert.ok([403, 409].includes(crossTeamEmail.status), JSON.stringify(crossTeamEmail)); assert.match(crossTeamEmail.cacheControl ?? "", /no-store/u);
        assert.equal(Number((await pool.query("select count(*) count from sales_activities where subject='Cross-team denied'")).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from sales_provider_operations where actor_id=$1 and action_id='sales.email.send'", [representativeId])).rows[0].count), 0);
        const viewerEmail = await postAction(viewer.page, "sales.email.send", { routeId: "sales.route.calendar", nodeId: "email-send", input: { providerId: "email.reference.v1", relatedRecordType: "sales.contact", relatedRecordId: managerContactId, subject: "Denied", body: "Denied" }, selection: {}, idempotencyKey: "p136-viewer-email-denied" });
        assert.equal(viewerEmail.status, 403, JSON.stringify(viewerEmail));
        assert.equal(Number((await pool.query("select count(*) count from sales_activities where subject='Denied'")).rows[0].count), 0);
        assertNoSecrets(JSON.stringify([observedRequests, crossActorAction, crossTeamEmail, viewerEmail]), "browser requests or action responses leaked provider authority");
      } finally { await owner.context.close(); await manager.context.close(); await representative.context.close(); await viewer.context.close(); }
    } finally { await browser.close(); }
  });
});
