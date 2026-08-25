import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const status = await new Promise<string>((resolvePromise, reject) => {
  const child = spawn("git", ["status", "--porcelain=v1", "--untracked-files=all", "--", "contracts", "schemas"], {
    cwd: repositoryRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolvePromise(stdout.trim()) : reject(new Error(`git status failed with exit ${String(code)}: ${stderr.trim()}`)));
});

if (status !== "") throw new Error(`Contract generation left repository changes:\n${status}`);
console.log("Generated contract artifact locations are clean.");
