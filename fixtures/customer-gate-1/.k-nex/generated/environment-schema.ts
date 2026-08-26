export const environmentSchema = {
  "DATABASE_URL": { type: "string" },
  "PAYLOAD_SECRET": { type: "string" },
} as const;

export default environmentSchema;
