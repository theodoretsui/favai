import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

// Builds the fava extension bundle. fava serves exactly one JS file per
// extension, so everything (including CSS and the anydoc wasm binary) is
// inlined into FavaAI.js.
export default defineConfig({
  plugins: [react(), tailwindcss(), stripAnyDocWasmUrl()],
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

/**
 * Drop the dead ``new URL("anydoc_wasm_bg.wasm", import.meta.url)`` reference
 * from the wasm-bindgen glue.
 *
 * The anydoc worker never calls the async ``init()`` — it decodes the wasm
 * bytes from a Vite ``?url`` data URL and instantiates them synchronously
 * with ``initSync``. Without this, Vite would also inline the wasm binary a
 * second time for the glue's unused asset reference, roughly doubling the
 * bundle. The replacement is fail-soft: if the pattern ever changes, the
 * build still succeeds, only with a larger bundle.
 */
function stripAnyDocWasmUrl(): Plugin {
  return {
    name: "favai-strip-anydoc-wasm-url",
    enforce: "pre",
    transform(code, id) {
      if (
        id.includes("@firecrawl/anydoc-wasm") &&
        id.endsWith("anydoc_wasm.js")
      ) {
        return code.replace(
          "new URL('anydoc_wasm_bg.wasm', import.meta.url)",
          "undefined",
        );
      }
      return code;
    },
  };
}
