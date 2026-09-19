import { execFileSync } from "node:child_process";

export const DEFAULT_GENERATED_APPLICATION_COMMAND_TIMEOUT_MS = 120_000;
export const GENERATED_APPLICATION_BUILD_TIMEOUT_MS = 300_000;

export function generatedApplicationCommandTimeout(command, arguments_) {
  return command === "pnpm" && arguments_.length === 1 && arguments_[0] === "build"
    ? GENERATED_APPLICATION_BUILD_TIMEOUT_MS
    : DEFAULT_GENERATED_APPLICATION_COMMAND_TIMEOUT_MS;
}

export function runGeneratedApplicationCommand(command, arguments_, options) {
  return execFileSync(command, arguments_, {
    ...options,
    encoding: "utf8",
    timeout: generatedApplicationCommandTimeout(command, arguments_)
  });
}
