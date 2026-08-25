import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const packageRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "k-nex-module-sales-pack-"));
const filename = "k-nex-module-sales-1.0.0.tgz";

try {
  execFileSync("pnpm", ["pack", "--pack-destination", temporaryRoot], { cwd: packageRoot, stdio: "ignore" });
  const generated = gunzipSync(readFileSync(join(temporaryRoot, filename)));
  const committed = gunzipSync(readFileSync(resolve(packageRoot, "../../fixtures/customer-gate-1/packages", filename)));
  if (!generated.equals(committed)) throw new Error("The committed Sales package tar content is stale or non-deterministic.");
  console.log("The committed Sales package tar content is current and reproducible.");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
