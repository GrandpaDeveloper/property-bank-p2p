import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANTE: cambiá esto por el nombre EXACTO de tu repo en GitHub
// Ej: si tu repo es https://github.com/tuuser/property-bank-p2p -> base "/property-bank-p2p/"
const GH_REPO_BASE = "/property-bank-p2p/";

export default defineConfig({
  plugins: [react()],
  base: GH_REPO_BASE,
});