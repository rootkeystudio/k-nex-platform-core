import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MatrixFixture } from "./matrix-fixture.js";

function App() { useEffect(() => { window.__K_NEX_P7_READY__ = true; }, []); return <MatrixFixture />; }
createRoot(document.getElementById("root")!).render(<App />);
declare global { interface Window { __K_NEX_P7_READY__?: boolean; } }
