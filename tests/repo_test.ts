/**
 * (a) Repository und Dokumentenlogik gegen eine `:memory:`-Datenbank.
 *
 * Schnell, ohne Aufräumen und ohne Rücksicht auf die echte Datei des
 * Anwenders. Die Umgebungsvariable muss *vor* dem ersten `getDb()` stehen —
 * `getDb()` ist bewusst faul, deshalb reicht die Zuweisung hier oben.
 */
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { DB_ENV } from "../src/paths.ts";

Deno.env.set(DB_ENV, ":memory:");

const { getDb, migrate } = await import("../src/db.ts");
const history = await import("../src/repo/documents.ts");
const { extractTitle, isMarkdownPath, readDocument, resolveAsset } = await import("../src/documents.ts");
const { readSetting, writeSetting } = await import("../src/settings.ts");

const QUERY = { q: "", limit: 200 };

Deno.test("Migrationen laufen bis zur letzten Version und sind idempotent", () => {
  const version = (getDb().prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  assertEquals(version > 0, true);
  assertEquals(migrate(getDb()), version);
});

Deno.test("Verlauf: merken, erneut öffnen, anheften, entfernen", () => {
  const id = history.remember({ path: "/tmp/a.md", name: "a.md", dir: "/tmp", title: "Erstes" });
  assertEquals(history.byId(id)?.openCount, 1);

  // Zweites Öffnen zählt hoch statt eine zweite Zeile anzulegen — der Pfad ist
  // eindeutig, und der Titel kann sich geändert haben.
  history.remember({ path: "/tmp/a.md", name: "a.md", dir: "/tmp", title: "Umbenannt" });
  assertEquals(history.byId(id)?.openCount, 2);
  assertEquals(history.byId(id)?.title, "Umbenannt");
  assertEquals(history.count(), 1);

  assertEquals(history.setPinned(id, true)?.pinned, true);
  history.remove(id);
  assertEquals(history.byId(id), null);
});

Deno.test("Angeheftetes überlebt „Verlauf leeren“", () => {
  const keep = history.remember({ path: "/tmp/b.md", name: "b.md", dir: "/tmp", title: "Bleibt" });
  const drop = history.remember({ path: "/tmp/c.md", name: "c.md", dir: "/tmp", title: "Geht" });
  history.setPinned(keep, true);

  assertEquals(history.clearUnpinned() >= 1, true);
  assertEquals(history.byId(keep)?.pinned, true);
  assertEquals(history.byId(drop), null);
  history.remove(keep);
});

Deno.test("Verlaufssuche läuft in SQL über Titel, Name und Pfad", () => {
  history.remember({ path: "/tmp/protokoll.md", name: "protokoll.md", dir: "/tmp", title: "Sitzung" });
  history.remember({ path: "/tmp/rezept.md", name: "rezept.md", dir: "/tmp", title: "Kuchen" });

  assertEquals(history.list({ ...QUERY, q: "sitz" }).length, 1);
  assertEquals(history.list({ ...QUERY, q: "rezept" })[0].title, "Kuchen");
  assertEquals(history.list({ ...QUERY, q: "kommtnichtvor" }).length, 0);
  history.clearUnpinned();
});

Deno.test("Titel: Vorspann vor Überschrift, Codeblock zählt nicht", () => {
  assertEquals(extractTitle("---\ntitle: Aus dem Vorspann\n---\n# Andere\n", "datei"), "Aus dem Vorspann");
  assertEquals(extractTitle("# Erste Überschrift\n\nText", "datei"), "Erste Überschrift");
  assertEquals(extractTitle("Setext\n======\n", "datei"), "Setext");
  // Das `#` im Shell-Beispiel ist keine Überschrift.
  assertEquals(extractTitle("```sh\n# rm -rf /\n```\n\n## Danach\n", "datei"), "Danach");
  assertEquals(extractTitle("Nur Fließtext.", "datei"), "datei");
  // Auszeichnung gehört nicht in die Seitenleiste.
  assertEquals(extractTitle("# **Fett** und `Code`", "datei"), "Fett und Code");
});

Deno.test("Nur Markdown-Endungen gelten als Dokument", () => {
  assertEquals(isMarkdownPath("/tmp/a.md"), true);
  assertEquals(isMarkdownPath("/tmp/a.MARKDOWN"), true);
  assertEquals(isMarkdownPath("/tmp/a.pdf"), false);
});

Deno.test("Dokument lesen: Kodierung erkennen, Titel setzen, Verlauf füllen", async () => {
  const dir = await Deno.makeTempDir();
  const path = join(dir, "notiz.md");
  await Deno.writeTextFile(path, "# Plan für Größe\n\nText mit Ümlauten.\n");

  const doc = await readDocument(path);
  assertEquals(doc.title, "Plan für Größe");
  assertEquals(doc.encoding, "utf-8");
  assertEquals(doc.dir, dir);
  assertEquals(history.byId(doc.id)?.path, path);

  // Neu einlesen ohne zu merken: derselbe Eintrag, kein zweiter Zähler.
  await readDocument(path, { remember: false });
  assertEquals(history.byId(doc.id)?.openCount, 1);

  await Deno.remove(dir, { recursive: true });
  history.clearUnpinned();
});

Deno.test("windows-1252 wird erkannt statt Kästchen zu zeigen", async () => {
  const dir = await Deno.makeTempDir();
  const path = join(dir, "alt.md");
  // „Größe" in cp1252: ö = 0xF6, ß = 0xDF.
  await Deno.writeFile(path, new Uint8Array([0x23, 0x20, 0x47, 0x72, 0xf6, 0xdf, 0x65]));

  const doc = await readDocument(path);
  assertEquals(doc.encoding, "windows-1252");
  assertEquals(doc.title, "Größe");

  await Deno.remove(dir, { recursive: true });
  history.clearUnpinned();
});

Deno.test("Fehlende Datei ist ein 404, kein Absturz", async () => {
  await assertRejects(() => readDocument("/tmp/gibt-es-nicht-4711.md"));
});

Deno.test("Beigaben: Positivliste und Ordnergrenze", () => {
  const home = Deno.env.get("HOME") ?? "/";
  // Bild neben dem Dokument: erlaubt.
  assertEquals(resolveAsset(`${home}/docs`, "bilder/plan.png"), `${home}/docs/bilder/plan.png`);
  // `../assets/` ist die übliche Ablage eine Ebene höher: erlaubt.
  assertEquals(resolveAsset(`${home}/docs`, "../assets/logo.svg"), `${home}/assets/logo.svg`);
  // Kein Bild: nicht ausliefern, egal wo es liegt.
  assertThrows(() => resolveAsset(`${home}/docs`, "../../.ssh/id_rsa"));
  assertThrows(() => resolveAsset(`${home}/docs`, "geheim.env"));
  // Bild außerhalb von Dokumentordner und Benutzerverzeichnis: nicht ausliefern.
  assertThrows(() => resolveAsset("/opt/docs", "../../etc/ssl/cert.png"));
});

Deno.test("Einstellungen: unbekannter Wert fällt auf die Vorgabe zurück", () => {
  assertEquals(readSetting("reading"), "normal");
  assertEquals(writeSetting("reading", "weit"), "weit");
  assertEquals(readSetting("reading"), "weit");

  // Von Hand editierte Zeile: das Schema fängt sie ab, statt abzustürzen.
  getDb().prepare("UPDATE settings SET value = ? WHERE key = ?").run('"riesig"', "reading");
  assertEquals(readSetting("reading"), "normal");
});
