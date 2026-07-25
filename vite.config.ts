import { defineConfig } from "vite";

// Project is deployed to GitHub Pages at https://<user>.github.io/chord2tab/
// so the base path must match the repo name in production builds.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/chord2tab/" : "/",
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
}));
