import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatDiagnostics, validateRepository } from "./repository-validation.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const argument = process.argv[2];
if (argument !== undefined && argument !== "--format=json") throw new Error(`Unknown argument: ${argument}`);

const diagnostics = await validateRepository(repositoryRoot);
process.stdout.write(formatDiagnostics(diagnostics, argument === "--format=json" ? "json" : "human"));
if (diagnostics.length > 0) process.exitCode = 1;
