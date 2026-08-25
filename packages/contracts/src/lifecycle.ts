export const lifecycleOperationSupport = ["supported", "unsupported"] as const;

export const lifecyclePolicy = {
  schemaOwningPluginV1: {
    ownsPayloadSchema: true,
    manifestUninstall: "unsupported",
    reversibleOperations: ["disable", "re-enable"],
    destructiveOperations: ["purge"],
    uninstallWithRetainedSchema: "unsupported-until-executable-proof",
    archiveOrExport: "explicit-project-operation"
  },
  schemaLessPluginV1: {
    ownsPayloadSchema: false,
    uninstall: "allowed-after-dependency-and-reference-checks"
  }
} as const;
