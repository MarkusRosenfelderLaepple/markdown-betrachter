/**
 * (b) API-Handler direkt aufgerufen — `app.request()` braucht keinen Server,
 * keinen Port und keine Wartezeit. Das ist der Grund, warum die Routen in
 * `src/api.ts` als Funktion und nicht als Nebenwirkung von `main.ts` entstehen.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { DB_ENV } from "../src/paths.ts";

Deno.env.set(DB_ENV, ":memory:");

const { createApp } = await import("../src/api.ts");
const { app } = createApp({ requestLog: false });

const json = (path: string, method: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Ein echtes Dokument samt Bild — beides brauchen mehrere Tests. */
async function fixture(): Promise<{ dir: string; path: string }> {
  const dir = await Deno.makeTempDir();
  const path = join(dir, "handbuch.md");
  await Deno.writeTextFile(path, "# Handbuch\n\n![Plan](bilder/plan.png)\n");
  await Deno.mkdir(join(dir, "bilder"));
  await Deno.writeFile(join(dir, "bilder", "plan.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  return { dir, path };
}

Deno.test("POST /api/documents/open liefert Text, Titel und Ordner", async () => {
  const { dir, path } = await fixture();
  const response = await json("/api/documents/open", "POST", { path });
  assertEquals(response.status, 200);

  const { doc } = await response.json();
  assertEquals(doc.title, "Handbuch");
  assertEquals(doc.dir, dir);
  assertStringIncludes(doc.text, "![Plan](bilder/plan.png)");

  // Der Verlauf kennt das Dokument jetzt.
  const list = await (await json("/api/documents?q=Handbuch", "GET")).json();
  assertEquals(list.length, 1);
  assertEquals(list[0].exists, true);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("Andere Dateitypen kommen gar nicht erst herein", async () => {
  const response = await json("/api/documents/open", "POST", { path: "/tmp/tabelle.xlsx" });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, "bad_request");
});

Deno.test("Validierungsfehler kommt in der einen Fehlerform", async () => {
  const response = await json("/api/documents/open", "POST", { path: "" });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, "bad_request");
  assertEquals(Array.isArray(body.error.details), true);
});

Deno.test("GET /api/asset liefert Bilder neben dem Dokument", async () => {
  const { dir } = await fixture();
  const query = `dir=${encodeURIComponent(dir)}&ref=${encodeURIComponent("bilder/plan.png")}`;
  const response = await app.request(`/api/asset?${query}`);
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "image/png");
  await response.body?.cancel();

  await Deno.remove(dir, { recursive: true });
});

Deno.test("GET /api/asset gibt nichts heraus, was kein Bild ist", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "geheim.env"), "TOKEN=abc");

  const query = `dir=${encodeURIComponent(dir)}&ref=geheim.env`;
  const response = await app.request(`/api/asset?${query}`);
  assertEquals(response.status, 403);
  assertEquals((await response.json()).error.code, "forbidden");

  await Deno.remove(dir, { recursive: true });
});

Deno.test("Verlauf: anheften, leeren, verwaiste Einträge entfernen", async () => {
  const { dir, path } = await fixture();
  const { doc } = await (await json("/api/documents/open", "POST", { path })).json();

  const pinned = await (await json(`/api/documents/${doc.id}/pin`, "POST", { pinned: true })).json();
  assertEquals(pinned.pinned, true);

  // Leeren lässt Angeheftetes stehen.
  await json("/api/documents", "DELETE");
  assertEquals((await (await json("/api/documents", "GET")).json()).length >= 1, true);

  // Datei weg → „verwaiste Einträge entfernen" räumt auf.
  await Deno.remove(dir, { recursive: true });
  const pruned = await (await json("/api/documents/prune", "POST")).json();
  assertEquals(pruned.removed >= 1, true);
});

Deno.test("Einstellungen: gültiger Wert wird gespeichert, ungültiger abgelehnt", async () => {
  const ok = await json("/api/settings/reading", "PUT", { value: "schmal" });
  assertEquals(ok.status, 200);
  assertEquals((await ok.json()).value, "schmal");

  const bad = await json("/api/settings/reading", "PUT", { value: "riesig" });
  assertEquals(bad.status, 400);

  const unknown = await json("/api/settings/gibtesnicht", "PUT", { value: 1 });
  assertEquals(unknown.status, 400);
});

Deno.test("Startpfad wird genau einmal ausgeliefert", async () => {
  const { app: withStartup } = createApp({ requestLog: false, startupPath: "/tmp/start.md" });
  const first = await withStartup.request("/api/startup/claim", { method: "POST" });
  assertEquals((await first.json()).path, "/tmp/start.md");

  // Zweiter Aufruf ist leer — sonst springt die Ansicht bei jedem Neuladen
  // zurück auf die Startdatei.
  const second = await withStartup.request("/api/startup/claim", { method: "POST" });
  assertEquals((await second.json()).path, null);
});

Deno.test("Externe Links: nur Web-Protokolle gehen nach draußen", async () => {
  const response = await json("/api/open-external", "POST", { url: "file:///etc/passwd" });
  assertEquals(response.status, 403);
  assertEquals((await response.json()).error.code, "forbidden");
});

Deno.test("Unbekannter API-Pfad ist ein 404 in derselben Fehlerform", async () => {
  const response = await app.request("/api/gibtesnicht");
  assertEquals(response.status, 404);
  assertEquals((await response.json()).error.code, "not_found");
});
