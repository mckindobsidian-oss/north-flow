import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Preview config: serves the Focusly web app (src/focusly.jsx) behind the
// in-memory storage shim. Port 5174 is pinned to stay clear of 5173.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
  },
});
