import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
  },
  server: {
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/assets": "http://127.0.0.1:8787",
    },
  },
});
