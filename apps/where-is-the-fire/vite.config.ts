import { resolve } from "node:path";
import { defineConfig } from "vite";

const basePath =
  process.env.BASE_PATH ?? "/forma-design-extensions/where-is-the-fire/";

export default defineConfig({
  base: basePath,
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        auth: resolve(__dirname, "auth/index.html"),
      },
    },
  },
});
