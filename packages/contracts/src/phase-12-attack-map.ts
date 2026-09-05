export const phase12AttackMap = Object.freeze([
  ["P12-ATK-01", "database/browser-authored route, import, JavaScript, React, SQL, CSS, or policy", "reject non-data workspace contracts", "P12.1"],
  ["P12-ATK-02", "forged application/environment/page/document/navigation/theme identity", "reject identity mismatch", "P12.1"],
  ["P12-ATK-03", "custom page shadowing a fixed system or plugin route", "reject route ownership mismatch", "P12.4"],
  ["P12-ATK-04", "navigation cycle, foreign parent, missing plugin parent, or cross-customer placement", "reject invalid navigation graph", "P12.4"],
  ["P12-ATK-05", "unauthorized direct URL and page enumeration", "deny without disclosure", "P12.6"],
  ["P12-ATK-06", "role/user ACL self-escalation or delegated authority expansion", "deny unauthorized access mutation", "P12.6"],
  ["P12-ATK-07", "page ACL used to bypass Sales source, field, record, or action permission", "deny underlying operation", "P12.6"],
  ["P12-ATK-08", "stale autosave tab overwriting a newer working revision", "return revision conflict", "P12.5"],
  ["P12-ATK-09", "changed payload under one idempotency key", "reject idempotency conflict", "P12.5"],
  ["P12-ATK-10", "CSRF, replay, oversized/deep document, and malformed canonical JSON", "reject unsafe write", "P12.7"],
  ["P12-ATK-11", "title/description/prop rich-text XSS or unsafe URL", "escape or reject unsafe content", "P12.7"],
  ["P12-ATK-12", "component owner/generation/schema/structural-hash substitution", "reject dependency substitution", "P12.7"],
  ["P12-ATK-13", "source/action/record/target-stage substitution", "reject action substitution", "P12.9"],
  ["P12-ATK-14", "disabled, quarantined, updated, or uninstalled plugin component resurrection", "render dependency unavailable", "P12.6"],
  ["P12-ATK-15", "wrong-surface, stale, or missing Theme Profile override", "reject theme override", "P12.8"],
  ["P12-ATK-16", "rollback to an incompatible or missing dependency", "reject rollback", "P12.6"],
  ["P12-ATK-17", "editor/Puck code entering the production page runtime", "fail production dependency check", "P12.7"],
  ["P12-ATK-18", "authority, ACL, document, or secret leakage through HTML, logs, audit, outbox, or preferences", "reject leaked authority data", "P12.8"],
  ["P12-ATK-19", "first-owner bootstrap replay or cross-application token", "reject bootstrap token", "P12.3"],
  ["P12-ATK-20", "lost invalidation preserving stale sidebar, route, editor, or publication authority", "reconcile to current authority", "P12.6"],
  ["P12-ATK-21", "generator path/time/random/environment nondeterminism", "fail deterministic generation proof", "P12.2"],
  ["P12-ATK-22", "tampered packed release or mutable package resolution", "reject generation before write", "P12.2"]
].map(([id, attack, expectedDenial, deliveryTask]) => Object.freeze({ id, attack, expectedDenial, deliveryTask })));

export const phase12AttackRegistry = Object.freeze({ schemaVersion: 1, phase: 12, attacks: phase12AttackMap });
