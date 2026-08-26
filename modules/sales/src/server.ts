import type { PluginRegistration } from "@k-nex/runtime";
import type { CollectionConfig } from "payload";

export const salesTasksCollection: CollectionConfig = {
  slug: "sales-tasks",
  access: {
    read: ({ req }) => Boolean(req.user)
  },
  fields: [
    { name: "title", type: "text", required: true },
    {
      name: "status",
      type: "select",
      defaultValue: "open",
      options: [
        { label: "Open", value: "open" },
        { label: "Done", value: "done" }
      ],
      required: true
    }
  ],
  indexes: [{ fields: ["status"] }]
};

export const salesRegistration: PluginRegistration = {
  pluginId: "module.sales",
  schema: (context) => context.register("sales.tasks.collection", {
    type: "payload.collection",
    collection: salesTasksCollection
  })
};
