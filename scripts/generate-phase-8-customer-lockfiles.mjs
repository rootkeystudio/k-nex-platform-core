import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
for (const customer of ["customer-alpha", "customer-beta"]) {
  execFileSync("pnpm", ["install", "--lockfile-only"], {
    cwd: resolve(repositoryRoot, "fixtures", customer),
    env: process.env,
    stdio: "inherit"
  });
}
