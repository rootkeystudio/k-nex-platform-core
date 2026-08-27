import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MatrixFixture } from "./matrix-fixture.js";

function App() { useEffect(() => { window.__K_NEX_P7_READY__ = true; window.__K_NEX_P7_RENDER_MS__ = performance.now() - window.__K_NEX_P7_STARTED__; }, []); return <MatrixFixture />; }
window.__K_NEX_P7_STARTED__ = performance.now();
createRoot(document.getElementById("root")!).render(<App />);
declare global { interface Window { __K_NEX_P7_READY__?: boolean; __K_NEX_P7_STARTED__: number; __K_NEX_P7_RENDER_MS__?: number; } }
