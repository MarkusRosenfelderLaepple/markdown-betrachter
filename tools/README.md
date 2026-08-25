# tools/

Eigenständiges Deno-Projekt für Werkzeuge, die **nur beim Entwickeln** laufen und npm-Abhängigkeiten
mitbringen — derzeit `build-icons.ts` mit `@resvg/resvg-js`.

Der Grund für die Trennung: `deno compile` bettet das **physische `node_modules` des Compile-Roots
vollständig** ein, unabhängig vom Modulgraph. Läge `@resvg/resvg-js` in der Wurzel, wanderten seine
vorkompilierten Rust-Binaries in jede ausgelieferte App.

```
deno task icons     # aus dem Projektstamm — ruft hier hinein
```
