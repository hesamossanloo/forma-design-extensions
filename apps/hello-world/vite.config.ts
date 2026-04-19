import { defineConfig } from "vite";

const basePath =
  process.env.BASE_PATH ?? "/forma-design-extensions/hello-world/";

export default defineConfig({
  base: basePath,
  build: {
    outDir: "dist",
  },
});
