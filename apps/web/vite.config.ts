import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies API + WebSocket traffic to the collaboration
// server, so the browser stays same-origin (no CORS surface).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: false },
      "/ws": { target: "ws://localhost:3001", ws: true },
    },
  },
});
