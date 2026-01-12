import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "simple-peer": "simple-peer/simplepeer.min.js",
    },
  },
  define: {
    global: "globalThis",
  },
  // Ayuda especialmente en dev (prebundle de deps)
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
});
