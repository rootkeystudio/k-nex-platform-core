import { useEffect, type ReactElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydrationProbe } from "./matrix-fixture.js";

function App(): ReactElement { useEffect(() => { window.__K_NEX_P7_HYDRATION_READY__ = true; }, []); return <HydrationProbe />; }
window.__K_NEX_P7_HYDRATION_ERRORS__ = [];
hydrateRoot(document.getElementById("root")!, <App />, { onRecoverableError: (error) => window.__K_NEX_P7_HYDRATION_ERRORS__.push(error instanceof Error ? error.message : String(error)) });

declare global { interface Window { __K_NEX_P7_HYDRATION_READY__?: boolean; __K_NEX_P7_HYDRATION_ERRORS__: string[]; } }
