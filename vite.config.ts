import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/property-bank-p2p/",
  plugins: [react()],
  define: { global: "globalThis" },
  optimizeDeps: {
    esbuildOptions: { define: { global: "globalThis" } },
  },
});
