import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Builds the fava extension bundle. fava serves exactly one JS file per
// extension, so everything (including CSS) is inlined into FavaAI.js.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Lib mode leaves process.env.NODE_ENV untouched, but several dependencies
  // read it at runtime; the browser has no `process`, so inline it.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    lib: {
      entry: "src/extension.ts",
      formats: ["es"],
      fileName: () => "FavaAI.js",
    },
    cssCodeSplit: false,
    // The out dir is the Python package directory: never empty it.
    outDir: "../src/favai",
    emptyOutDir: false,
    minify: true,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
