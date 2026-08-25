export const registrationPhases = [
  "manifest",
  "contracts",
  "providers",
  "schema",
  "behavior",
  "jobs",
  "data-handlers",
  "ui",
  "admin",
  "validate",
  "freeze"
] as const;

export type RegistrationPhase = (typeof registrationPhases)[number];

export const registrationRules: Record<RegistrationPhase, string> = {
  manifest: "Load and validate side-effect-free package metadata.",
  contracts: "Register IDs, schemas, permissions, events, capabilities, source descriptors, action descriptors, block descriptors, and service tokens.",
  providers: "Bind only resolved capability implementations.",
  schema: "Register owned Payload collections, globals, fields, indexes, and storage schema.",
  behavior: "Bind domain services, commands, policies, endpoints, and subscribers.",
  jobs: "Bind tasks, workflows, schedules, and durable event processors.",
  "data-handlers": "Bind executable server handlers to previously declared data-source descriptors.",
  ui: "Bind browser-safe navigation, screens, renderers, state, and action clients.",
  admin: "Bind Payload admin and privileged system screens.",
  validate: "Compare declared and actual contributions, check collisions, dependencies, bundles, and readiness invariants.",
  freeze: "Produce immutable resolved inventory and reject later registration."
};
