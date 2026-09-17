import assert from "node:assert/strict";

/**
 * The corpus prints its own verdict, so a gate that only checks that verdict
 * reads a literal rather than a measurement. This re-derives every claim from
 * the proofs the corpus reports executing: the executed set must be exactly the
 * proof groups it declares, and every attack, journey, and evidence class must
 * cite proofs from that set before its outcome may read as observed.
 */
export function assertEvidenceLinkage(evidence) {
  assert.ok(Array.isArray(evidence.proofs) && evidence.proofs.length > 0, "Phase 13 corpus declared no proof groups.");
  assert.ok(Array.isArray(evidence.executedProofs) && evidence.executedProofs.length > 0, "Phase 13 corpus did not report the proofs it executed.");
  const executedProofs = new Set(evidence.executedProofs);
  assert.equal(executedProofs.size, evidence.executedProofs.length, "Phase 13 corpus reported duplicate executed proofs.");
  const declaredProofs = new Set(evidence.proofs.flatMap(({ id, names }) => {
    assert.ok(typeof id === "string" && id.length > 0, "Phase 13 proof group has no identity.");
    assert.ok(Array.isArray(names) && names.length > 0, `Phase 13 proof group ${id} declares no named evidence.`);
    return names.map((name) => `node:${id}:${name}`);
  }));
  assert.deepEqual([...executedProofs].sort(), [...declaredProofs].sort(),
    "Phase 13 executed proofs differ from the proof groups the corpus declares.");
  for (const collection of [evidence.attacks, evidence.requiredAttackClasses, evidence.journeys, evidence.evidenceClasses]) {
    assert.ok(Array.isArray(collection) && collection.length > 0, "Phase 13 corpus emitted an empty evidence collection.");
    for (const item of collection) {
      const label = item.id ?? item.scenario;
      assert.ok(typeof label === "string" && label.length > 0, "Phase 13 evidence item has no identity.");
      assert.ok(Array.isArray(item.evidence) && item.evidence.length > 0, `Phase 13 evidence has no executed proof: ${label}`);
      for (const proof of item.evidence) {
        assert.ok(executedProofs.has(proof), `Phase 13 evidence cites a proof this run did not execute: ${label} -> ${proof}`);
      }
      assert.equal(item.outcome, "observed", `Phase 13 evidence was not observed: ${label}`);
    }
  }
  return executedProofs;
}
