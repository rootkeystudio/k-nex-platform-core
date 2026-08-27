import { hydrateRoot } from "react-dom/client";
import { HydrationFixture } from "./hydration-fixture.js";

hydrateRoot(document.getElementById("root")!, <HydrationFixture />);
window.__kNexHydrated = true;

declare global { interface Window { __kNexHydrated?: boolean } }
