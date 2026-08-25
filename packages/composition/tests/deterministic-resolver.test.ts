import goldenCases from "./fixtures/resolver-golden.json";
import { describe, expect, it } from "vitest";

import {
  PluginGraphResolutionError,
  resolvePluginGraph,
  resolverVersion
} from "../src/deterministic-resolver.js";

type CompactDependency = {
  plugin?: string;
  capability?: string;
  version: string;
};

type CompactPlugin = {
  id: string;
  package: string;
  version: string;
  kind?: string;
  provides?: CompactDependency[];
  requires?: CompactDependency[];
  optional?: CompactDependency[];
  conflicts?: CompactDependency[];
};

type CompactRequest = {
  id: string;
  package: string;
  version: string;
  enabled?: boolean;
};

type CompactProviderRequest = {
  plugin: string;
  package: string;
  version: string;
};

type GoldenSuccess = {
  ok: true;
  output: unknown;
};

type GoldenFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    path: string[];
  };
};

type GoldenCase = {
  name: string;
  installed: CompactPlugin[];
  plugins: CompactRequest[];
  providers: Record<string, CompactProviderRequest>;
  expected: GoldenSuccess | GoldenFailure;
};

type ResolverOptions = Parameters<typeof resolvePluginGraph>[0];

const cases = goldenCases as GoldenCase[];

function fakeIntegrity(plugin: CompactPlugin): string {
  return `sha512-${Buffer.from(`${plugin.package}@${plugin.version}`, "utf8").toString("base64")}`;
}

function copyDependencies(dependencies: CompactDependency[] | undefined): CompactDependency[] {
  return (dependencies ?? []).map((dependency) => ({ ...dependency }));
}

function expandInstalled(plugin: CompactPlugin) {
  return {
    package: {
      name: plugin.package,
      version: plugin.version,
      integrity: fakeIntegrity(plugin)
    },
    manifest: {
      apiVersion: 1 as const,
      id: plugin.id,
      kind: plugin.kind ?? "module",
      displayName: plugin.id,
      version: plugin.version,
      package: plugin.package,
      compatibility: {
        core: ">=1.0.0 <2.0.0",
        payload: ">=3.0.0 <4.0.0",
        node: ">=24.0.0 <25.0.0",
        payloadDatabaseAdapters: ["postgres" as const]
      },
      provides: copyDependencies(plugin.provides),
      requires: copyDependencies(plugin.requires),
      optional: copyDependencies(plugin.optional),
      conflicts: copyDependencies(plugin.conflicts),
      lifecycle: {
        ownsPayloadSchema: false as const,
        ownsPersistentData: false,
        disable: "supported" as const,
        uninstall: "supported" as const,
        purge: "supported" as const
      }
    }
  };
}

function expandOptions(testCase: GoldenCase): ResolverOptions {
  return {
    plugins: testCase.plugins.map((plugin) => ({
      id: plugin.id,
      package: plugin.package,
      version: plugin.version,
      enabled: plugin.enabled ?? true
    })),
    providers: Object.fromEntries(
      Object.entries(testCase.providers).map(([capability, provider]) => [capability, { ...provider }])
    ),
    installed: testCase.installed.map(expandInstalled)
  };
}

function thrownResolutionError(callback: () => unknown): PluginGraphResolutionError {
  try {
    callback();
  } catch (error) {
    if (error instanceof PluginGraphResolutionError) return error;
    throw error;
  }
  throw new Error("Expected resolvePluginGraph to throw PluginGraphResolutionError.");
}

describe("deterministic resolver golden corpus", () => {
  it.each(cases)("$name", (testCase) => {
    const options = expandOptions(testCase);
    if (testCase.expected.ok) {
      const result = resolvePluginGraph(options);
      expect(result).toEqual(testCase.expected.output);
      expect(result.resolverVersion).toBe(resolverVersion);
      return;
    }

    const error = thrownResolutionError(() => resolvePluginGraph(options));
    expect({ code: error.code, message: error.message, path: [...error.path] }).toEqual(testCase.expected.error);
  });

  it("is byte-equivalent across input orderings and does not mutate input objects", () => {
    const sourceCase = cases.find((testCase) => testCase.name.includes("explicit provider selection"));
    if (!sourceCase || !sourceCase.expected.ok) throw new Error("The ordering corpus case is missing.");

    const options = expandOptions(sourceCase);
    const before = structuredClone(options);
    const reversed: ResolverOptions = {
      plugins: [...options.plugins].reverse(),
      providers: Object.fromEntries(Object.entries(options.providers).reverse()),
      installed: [...options.installed].reverse()
    };
    const forward = resolvePluginGraph(options);
    const reverse = resolvePluginGraph(reversed);

    expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward));
    expect(options).toEqual(before);
  });
});
