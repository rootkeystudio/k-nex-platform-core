import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { payloadPostgresPatchSource } from "../packages/composition/dist/application-factory.js";

const root = resolve(import.meta.dirname, "..");
const filename = "patches/@payloadcms__db-postgres@3.88.0.patch";
const digest = "0889c7c61e08478410dfcb1112415677fa9f50267901ee15c99e3deb1c9edf2f";
const upstreamPatch = `diff --git a/dist/connect.js b/dist/connect.js
index bf4beedd6617e13dbafab75c82f356095ffa4e5f..80e127fdc494806d2018c7603a249645aad4c5bb 100644
--- a/dist/connect.js
+++ b/dist/connect.js
@@ -35,6 +35,7 @@ const connectWithReconnect = async function({ adapter, pool, reconnect = false }
         // swallow error
         }
     });
+    result.release();
 };
 export const connect = async function connect(options = {
     hotReload: false
`;

const source = readFileSync(resolve(root, filename), "utf8");
assert.equal(source, upstreamPatch, "Payload Postgres patch must remain exact upstream 134c89b.");
assert.equal(createHash("sha256").update(source).digest("hex"), digest, "Payload Postgres patch digest is invalid.");
assert.equal(payloadPostgresPatchSource(), source, "Packed composition patch bytes must equal the canonical repository patch.");
const workspace = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8");
assert.match(workspace, /patchedDependencies:\n  '@payloadcms\/db-postgres@3\.88\.0': patches\/@payloadcms__db-postgres@3\.88\.0\.patch\n/u, "Payload Postgres patch identity is invalid.");
const lock = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
assert.match(lock, new RegExp(`patchedDependencies:\\n  '@payloadcms/db-postgres@3\\.88\\.0': ${digest}\\n`, "u"), "Payload Postgres lock patch digest is invalid.");
process.stdout.write("P13_PAYLOAD_POSTGRES_PATCH_PASS\n");
