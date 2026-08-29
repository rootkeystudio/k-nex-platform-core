import readline from "node:readline";

import pg from "pg";

import { PostgresRuntimeExtensionStore } from "@k-nex/payload-adapter";
import { RuntimeExtensionRevisionConsumer } from "@k-nex/runtime";

const configuration = JSON.parse(process.env.P9_RUNTIME_CONSUMER_CONFIGURATION ?? "{}");
const required = ["databaseUrl", "role", "applicationId", "environment", "deliveryClass", "extensionId"];
if (!required.every((key) => typeof configuration[key] === "string" && configuration[key].length > 0)) {
  throw new Error("Runtime extension consumer configuration is incomplete.");
}

const pool = new pg.Pool({ connectionString: configuration.databaseUrl });
const store = new PostgresRuntimeExtensionStore(pool, { now: () => new Date() }, configuration.auditKey ?? "sha256:7777777777777777777777777777777777777777777777777777777777777777");
const extension = { deliveryClass: configuration.deliveryClass, id: configuration.extensionId };
const consumer = new RuntimeExtensionRevisionConsumer(store, configuration.applicationId, configuration.environment, extension);

function emit(event, extra = {}) {
  process.stdout.write(`${JSON.stringify({ event, role: configuration.role, pid: process.pid, snapshot: consumer.snapshot(), ...extra })}\n`);
}

async function combinedGeneration() {
  const result = await pool.query(
    `select g.generation_id, g.server_generation_id, g.ui_generation_id, g.storage_generation_id
       from runtime_extensions e join runtime_extension_generations g
         on g.application_id=e.application_id and g.environment=e.environment and g.delivery_class=e.delivery_class and g.extension_id=e.extension_id and g.generation_id=e.active_generation_id
      where e.application_id=$1 and e.environment=$2 and e.delivery_class=$3 and e.extension_id=$4`,
    [configuration.applicationId, configuration.environment, extension.deliveryClass, extension.id]
  );
  const generation = result.rows[0];
  return generation === undefined ? undefined : {
    generationId: generation.generation_id,
    serverGenerationId: generation.server_generation_id,
    uiGenerationId: generation.ui_generation_id,
    storageGenerationId: generation.storage_generation_id
  };
}

async function execute(line) {
  const command = JSON.parse(line);
  if (command.type === "invalidate") {
    emit("invalidated", { accepted: consumer.invalidate(command.invalidation.inventoryRevision) });
    return;
  }
  if (command.type === "snapshot") {
    emit("snapshot", { combinedGeneration: await combinedGeneration() });
    return;
  }
  if (command.type === "poll") {
    const changed = await consumer.poll();
    emit("polled", { changed, combinedGeneration: await combinedGeneration() });
    return;
  }
  if (command.type === "close") {
    await pool.end();
    emit("closed");
    process.exit(0);
  }
  throw new Error("Runtime extension consumer command is invalid.");
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let commands = Promise.resolve();
input.on("line", (line) => {
  commands = commands.then(() => execute(line)).catch(async (error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    await pool.end();
    process.exitCode = 1;
  });
});

await consumer.poll();
emit("ready", { combinedGeneration: await combinedGeneration() });
