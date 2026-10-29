// ── PRODUCTION ENTRY ──────────────────────────────────────────────────────
// index.html loads this file, so `npm run dev` and `npm run build` serve the
// real NORTH app. The demo harness is separate on purpose:
//
//   preview.html → src/preview.jsx → seeds the host storage shim with a demo
//                                    account (used for screenshots/preview)
//   index.html   → src/entry.jsx   → no seeding; you sign in, or you use the
//                                    device record the app already holds
//
// No storage shim is installed here: the app's own `S.*` boundary already
// falls back to localStorage and then to memory (see src/focusly.jsx), which
// is exactly the behaviour a browser tab should get.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./focusly.jsx";
import { desktopOAuthDestination } from "./lib/desktop-oauth.js";

const desktopReturn = desktopOAuthDestination(window.location.search);
if (desktopReturn) {
  const params = new URLSearchParams(window.location.search);
  for (const key of ["code", "error"]) if (params.has(key)) desktopReturn.searchParams.set(key, params.get(key));
  if (params.has("code") || params.has("error")) window.location.replace(desktopReturn.toString());
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {desktopReturn ? <main style={{ padding: 32, fontFamily: "system-ui", color: "#f8f9fc", background: "#191b24", minHeight: "100vh" }}><h1>Return to North Desktop</h1><p>Finish signing in from the browser window that opened.</p></main> : <App />}
  </StrictMode>
);
