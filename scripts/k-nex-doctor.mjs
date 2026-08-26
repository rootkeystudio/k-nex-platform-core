import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ApplicationManifestSchema } from "../packages/contracts/dist/index.js";
import { doctorRealtimeTopology } from "../packages/runtime/dist/index.js";

const manifestPath = resolve(process.argv.slice(2).find((argument) => argument !== "--") ?? "k-nex.app.json");

try {
  const manifest = ApplicationManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  if (!manifest.runtime.realtime) throw new Error("runtime.realtime topology is required for realtime doctor validation.");
  const report = doctorRealtimeTopology(manifest.runtime.realtime);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Doctor validation failed."}\n`);
  process.exit(2);
}
