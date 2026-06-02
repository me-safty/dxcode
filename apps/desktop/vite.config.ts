import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/main.ts"],
      clean: true,
      noExternal: (id) => id.startsWith("@t3tools/"),
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/preload.ts"],
    },
  ],
});
