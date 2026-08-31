import { execFile as execFileCallback } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

it("exports the static deployment store without loading the Payload adapter root", async () => {
  const { stdout } = await execFile(process.execPath, [
    "--max-old-space-size=64", "--input-type=module", "--eval",
    "const { PostgresStaticDeploymentStore } = await import('@k-nex/payload-adapter/static-deployment-store'); if (typeof PostgresStaticDeploymentStore !== 'function') process.exitCode = 1; else console.log('STATIC_DEPLOYMENT_STORE_EXPORT_OK');"
  ], { cwd: packageDirectory });

  expect(stdout).toBe("STATIC_DEPLOYMENT_STORE_EXPORT_OK\n");
});
