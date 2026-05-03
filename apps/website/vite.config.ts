import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        // Match `@blankcollar/shared/<file>` -> `packages/shared/src/<file>(.ts)`
        find: /^@blankcollar\/shared\/(.*)$/,
        replacement:
          fileURLToPath(new URL("../../packages/shared/src/", import.meta.url)) + "$1",
      },
      {
        // Bare `@blankcollar/shared` -> the index module.
        find: /^@blankcollar\/shared$/,
        replacement: fileURLToPath(
          new URL("../../packages/shared/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
  },
});
