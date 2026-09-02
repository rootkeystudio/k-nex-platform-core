import { describe, expect, it } from "vitest";

import type { SettingsStoredDocument, SystemSettingsDescriptor } from "@k-nex/contracts";

import {
  SystemSettingsProjectionError,
  projectSettingsAdministrationView,
  projectSystemSettingsValues,
  validateSystemSettingsValues
} from "../src/plugin-settings.js";

const descriptor: SystemSettingsDescriptor = {
  schemaVersion: 1,
  id: "sales.settings.workspace",
  publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" },
  descriptorSchemaVersion: 1,
  validation: "immediate",
  fields: {
    defaultTaskPageSize: { type: "integer", required: true, default: 25, minimum: 1, maximum: 100 },
    showPotentialRevenue: { type: "boolean", required: true, default: true },
    defaultPage: { type: "string", required: true, default: "tasks", allowed: ["overview", "tasks", "opportunities"] },
    apiToken: { type: "secret-reference", required: false },
    label: { type: "string", required: false }
  },
  readPermission: "sales.settings.read",
  changePermission: "sales.settings.write"
};

const identity = {
  applicationId: "customer-alpha",
  environment: "production",
  descriptorId: descriptor.id,
  owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 },
  descriptorSchemaVersion: descriptor.descriptorSchemaVersion
} as const;

function expectCode(run: () => unknown, code: SystemSettingsProjectionError["code"]): void {
  try {
    run();
    throw new Error("Expected system settings projection failure.");
  } catch (error) {
    expect(error).toBeInstanceOf(SystemSettingsProjectionError);
    expect((error as SystemSettingsProjectionError).code).toBe(code);
  }
}

describe("P11.3 system settings projection", () => {
  it("applies declared defaults to the immutable host-owned projection", () => {
    const values = projectSystemSettingsValues(descriptor);
    expect(values).toEqual({ defaultTaskPageSize: 25, showPotentialRevenue: true, defaultPage: "tasks" });
    expect(Object.isFrozen(values)).toBe(true);
  });

  it("validates declared values and rejects unknown keys, types, and bounds", () => {
    expect(validateSystemSettingsValues(descriptor, {
      defaultTaskPageSize: 50,
      showPotentialRevenue: false,
      defaultPage: "opportunities"
    })).toEqual({ defaultTaskPageSize: 50, showPotentialRevenue: false, defaultPage: "opportunities" });
    expectCode(() => validateSystemSettingsValues(descriptor, { unknown: true }), "FIELD_UNKNOWN");
    expectCode(() => validateSystemSettingsValues(descriptor, { defaultTaskPageSize: "50" } as never), "FIELD_INVALID");
    expectCode(() => validateSystemSettingsValues(descriptor, { defaultTaskPageSize: null } as never), "FIELD_INVALID");
    expectCode(() => validateSystemSettingsValues(descriptor, { defaultTaskPageSize: 101 }), "FIELD_INVALID");
  });

  it("retains secret references only in stored projection and redacts the administration view", () => {
    const stored: SettingsStoredDocument = {
      schemaVersion: 1,
      identity,
      state: "effective",
      documentRevision: 3,
      settingsRevision: 8,
      values: {
        defaultTaskPageSize: 50,
        showPotentialRevenue: true,
        defaultPage: "tasks",
        apiToken: { kind: "secret-reference", provider: "environment", key: "SALES_API_TOKEN" }
      }
    };
    expect(projectSystemSettingsValues(descriptor, stored.values).apiToken).toEqual(stored.values.apiToken);
    expect(projectSettingsAdministrationView(descriptor, stored, stored.settingsRevision)).toMatchObject({
      fields: {
        defaultTaskPageSize: { kind: "visible-value", value: 50 },
        apiToken: { kind: "redacted-secret" },
        label: { kind: "unset" }
      }
    });
    expect(projectSettingsAdministrationView(descriptor, {
      ...stored,
      values: { defaultTaskPageSize: 50, showPotentialRevenue: true, defaultPage: "tasks" }
    }, stored.settingsRevision).fields.apiToken).toEqual({ kind: "unset" });
  });

  it("projects retained values deterministically across a schema change without executable migrations", () => {
    const nextDescriptor: SystemSettingsDescriptor = {
      ...descriptor,
      descriptorSchemaVersion: 2,
      fields: {
        defaultTaskPageSize: { type: "integer", required: true, default: 40, minimum: 1, maximum: 100 },
        enabled: { type: "boolean", required: true, default: true }
      }
    };
    expect(projectSystemSettingsValues(nextDescriptor, {
      defaultTaskPageSize: 60,
      legacyCallbackOutput: "ignored"
    })).toEqual({ defaultTaskPageSize: 60, enabled: true });
  });
});
