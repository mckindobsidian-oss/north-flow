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

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
