import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: ".",
  base: "./",
  resolve: {
    alias: {
      "@speakerdust/shared": fileURLToPath(new URL("../shared/src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    target: "esnext",
  },
  server: {
    port: 5173,
    open: true,
    hmr: {
      host: "localhost",
    },
    proxy: {
      "/room/": {
        target: "http://localhost:8787",
        ws: true,
      },
    },
  },
});
