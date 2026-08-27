import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const customerDirectory = resolve(process.argv[2]);
const customer = process.argv[3];
if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(customer)) throw new Error("Customer boot proof requires a canonical application ID.");

const requireFromCustomer = createRequire(resolve(customerDirectory, "package.json"));
const resolvedPackages = [
  "@k-nex/composition", "@k-nex/contracts", "@k-nex/module-sales/server", "@k-nex/payload-adapter",
  "@k-nex/runtime", "@k-nex/ui-runtime"
].map((packageName) => requireFromCustomer.resolve(packageName));
for (const resolved of resolvedPackages) {
  if (!resolved.startsWith(resolve(customerDirectory, "node_modules", ".pnpm"))) {
    throw new Error(`Customer resolved a K-Nex package outside its packed install: ${resolved}`);
  }
}

const { bootKnexApplication } = await import(pathToFileURL(resolve(customerDirectory, "dist/boot.js")));
const payload = await bootKnexApplication(`packed-${customer}`);
try {
  const result = await payload.find({ collection: "sales-tasks", depth: 0, limit: 1, overrideAccess: true });
  const collections = Object.keys(payload.collections).filter((slug) => slug.startsWith("sales-")).sort();
  process.stdout.write(`PACKED_CUSTOMER_BOOT ${JSON.stringify({ customer, collections, documents: result.totalDocs, resolvedPackages })}\n`);
} finally {
  const timeout = () => new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000));
  await Promise.race([payload.destroy(), timeout()]);
  if (typeof payload.db.pool?.end === "function") await Promise.race([payload.db.pool.end(), timeout()]);
  process.exit(0);
}
