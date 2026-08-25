import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * `ui/` ist ein **eigenständiges** Deno-Projekt (eigene `deno.json`, eigenes
 * `node_modules`) und kein Workspace-Mitglied der Wurzel: `deno compile` bettet
 * das physische `node_modules` des Compile-Roots vollständig ein — react,
 * echarts & Co. lägen sonst zusätzlich zum fertigen Bundle noch einmal roh im
 * Binary.
 *
 * Deshalb `root: "."` und der Aufruf aus `ui/` heraus (`deno task ui:dev`).
 * `fs.allow: [".."]` ist nötig, weil `ui/src/*` auf `../shared/*` zugreift.
 */
export default defineConfig({
  root: ".",
  base: "./",
  plugins: [react()],
  // Die Bündelgröße zählt bei lokaler Auslieferung nicht (der Server liegt auf
  // derselben Maschine) — Mermaid und KaTeX sind groß, und das ist in Ordnung.
  // Die Warnung deshalb hochsetzen statt Zeit in Aufteilung zu stecken.
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { port: 5273, fs: { allow: [".."] }, proxy: { "/api": "http://localhost:8777" } },
});
