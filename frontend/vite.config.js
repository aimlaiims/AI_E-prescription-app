import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Vite's dev server rejects requests whose Host header it doesn't
    // recognize (a DNS-rebinding protection) — without this, a tunnel like
    // ngrok fails with "Blocked request. This host is not allowed." since
    // the forwarded Host is the ngrok domain, not localhost. Covers ngrok's
    // current (.ngrok-free.dev, .ngrok-free.app) and older (.ngrok.io,
    // .ngrok.app) domain suffixes, since this has changed before.
    allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io", ".ngrok.app"],
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
  preview: {
    port: 4173,
    allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io", ".ngrok.app"],
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});