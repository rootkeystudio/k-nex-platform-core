import { getPayload } from "payload";

import config from "./payload.config.js";

export async function bootKnexApplication(key = "customer-alpha") {
  const payload = await getPayload({ config, key });
  const collections = Object.keys(payload.collections).sort();
  if (!collections.includes("sales-opportunities") || !collections.includes("sales-tasks")) {
    throw new Error("K-Nex Sales collections did not register.");
  }
  return payload;
}
