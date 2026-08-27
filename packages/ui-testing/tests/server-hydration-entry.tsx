import { renderToString } from "react-dom/server";
import { HydrationProbe } from "./matrix-fixture.js";

export const hydrationMarkup = renderToString(<HydrationProbe />);
