/**
 * Ordnerbaum und `.gitignore`.
 *
 * Der Beschnitt und der Musterabgleich sind die zwei Stellen der Funktion, an
 * denen ein Fehler still bleibt: Ein zu viel versteckter Ordner fällt niemandem
 * auf — die Datei ist dann einfach „nicht da". Deshalb werden hier vor allem
 * die Fälle geprüft, die *sichtbar* bleiben müssen.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { join } from "@std/path";
import { usableStartDir } from "../src/files.ts";
import { isIgnored, parseGitignore } from "../src/gitignore.ts";
import { scanTree } from "../src/tree.ts";
import type { TreeNode } from "../shared/schema.ts";

function rules(text: string, base = "") {
  return parseGitignore(text, base);
}

Deno.test("gitignore: einfache Namen treffen in jeder Tiefe", () => {
  const set = rules("dist\n");
  assert(isIgnored(set, "dist", true));
  assert(isIgnored(set, "paket/dist", true));
  assert(isIgnored(set, "a/b/dist/datei.md", false) === false, "Datei darunter wird nicht selbst geprüft");
});

Deno.test("gitignore: führender Schrägstrich bindet an das Verzeichnis", () => {
  const set = rules("/build\n");
  assert(isIgnored(set, "build", true));
  assertFalse(isIgnored(set, "paket/build", true));
});

Deno.test("gitignore: `dir/` trifft nur Ordner", () => {
  const set = rules("temp/\n");
  assert(isIgnored(set, "temp", true));
  assertFalse(isIgnored(set, "temp", false));
});

Deno.test("gitignore: Sterne, Fragezeichen und Klassen", () => {
  const set = rules("*.log\nnotiz?.md\n[Tt]est.md\n");
  assert(isIgnored(set, "a/b/fehler.log", false));
  assert(isIgnored(set, "notiz1.md", false));
  assertFalse(isIgnored(set, "notiz12.md", false));
  assert(isIgnored(set, "Test.md", false));
  assert(isIgnored(set, "test.md", false));
});

Deno.test("gitignore: `**` überspringt beliebig viele Ebenen — auch keine", () => {
  const set = rules("doc/**/entwurf.md\n");
  assert(isIgnored(set, "doc/entwurf.md", false));
  assert(isIgnored(set, "doc/a/b/entwurf.md", false));
  assertFalse(isIgnored(set, "anders/entwurf.md", false));
});

Deno.test("gitignore: die letzte passende Regel gewinnt", () => {
  const set = rules("*.md\n!wichtig.md\n");
  assert(isIgnored(set, "beliebig.md", false));
  assertFalse(isIgnored(set, "wichtig.md", false));
});

Deno.test("gitignore: Kommentare und Leerzeilen zählen nicht", () => {
  const set = rules("# nur ein Hinweis\n\n   \n*.tmp\n");
  assertEquals(set.length, 1);
  assert(isIgnored(set, "x.tmp", false));
});

Deno.test("gitignore: eine verschachtelte Datei gilt nur für ihren Unterbaum", () => {
  const set = [...rules("*.md\n"), ...rules("!*.md\n", "docs")];
  assert(isIgnored(set, "oben.md", false));
  assertFalse(isIgnored(set, "docs/unten.md", false));
});

// ── Der Baum selbst ─────────────────────────────────────────────────────────

/** Legt einen Beispielordner an; der Aufrufer räumt ihn wieder weg. */
async function fixture(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "baum-test-" });
  const write = async (rel: string, text = "# Inhalt\n") => {
    const path = join(root, rel);
    await Deno.mkdir(join(path, ".."), { recursive: true });
    await Deno.writeTextFile(path, text);
  };
  await write(".gitignore", "build/\ngeheim.md\n");
  await write("README.md");
  await write("notizen.txt", "kein Baum-Dokument");
  await write("geheim.md");
  await write("docs/anleitung.md");
  await write("docs/bilder/plan.png", "kein Dokument");
  await write("build/erzeugt.md");
  await write("code/api/server.ts", "kein Dokument");
  await write("tief/eins/zwei/kapitel.md");
  await Deno.mkdir(join(root, "node_modules", "paket"), { recursive: true });
  await Deno.writeTextFile(join(root, "node_modules", "paket", "README.md"), "# fremd\n");
  return root;
}

function names(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) => [node.name, ...names(node.children ?? [])]);
}

Deno.test("Baum: nur Markdown, ohne Ignoriertes und ohne leere Ordner", async () => {
  const root = await fixture();
  try {
    const tree = await scanTree(root);
    const found = names(tree.nodes);

    assert(found.includes("README.md"));
    assert(found.includes("anleitung.md"));
    // `.txt` steht bewusst nicht in TREE_EXTENSIONS.
    assertFalse(found.includes("notizen.txt"));
    // Aus der `.gitignore`.
    assertFalse(found.includes("geheim.md"), "Datei aus der .gitignore");
    assertFalse(found.includes("erzeugt.md"), "Ordner aus der .gitignore");
    // Fest übersprungen, auch ohne Eintrag in der `.gitignore`.
    assertFalse(found.some((name) => name.includes("node_modules")));
    // `code/api` enthält kein Dokument und verschwindet vollständig.
    assertFalse(found.some((name) => name.startsWith("code")));
    // `docs/bilder` enthält nur ein Bild — der Ordner fällt weg, `docs` bleibt.
    assertFalse(found.includes("bilder"));
    assert(found.includes("docs"));

    assertEquals(tree.files, 3);
    assertFalse(tree.truncated);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Baum: Ordnerketten ohne Verzweigung werden zusammengezogen", async () => {
  const root = await fixture();
  try {
    const tree = await scanTree(root);
    const chain = tree.nodes.find((node) => node.name.startsWith("tief"));
    assertEquals(chain?.name, "tief/eins/zwei");
    assertEquals(chain?.children?.map((child) => child.name), ["kapitel.md"]);
    // `rel` und `path` zeigen auf den **untersten** Ordner der Kette.
    assertEquals(chain?.rel, "tief/eins/zwei");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Baum: Ordner vor Dateien, beides natürlich sortiert", async () => {
  const root = await Deno.makeTempDir({ prefix: "baum-sort-" });
  try {
    await Deno.mkdir(join(root, "unterordner"));
    await Deno.writeTextFile(join(root, "unterordner", "x.md"), "# x\n");
    for (const name of ["kapitel-10.md", "kapitel-9.md", "a.md"]) {
      await Deno.writeTextFile(join(root, name), "# k\n");
    }
    const tree = await scanTree(root);
    assertEquals(tree.nodes.map((node) => node.name), [
      "unterordner",
      "a.md",
      "kapitel-9.md",
      "kapitel-10.md",
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// ── Startverzeichnis der Dialoge ────────────────────────────────────────────

/**
 * Regression: Ein gemerkter Ordner, den es nicht mehr gibt, hat den
 * **Öffnen-Dialog verhindert** — AppleScript wandelt `POSIX file "…"` nur bei
 * existierendem Pfad in einen `alias` und bricht sonst mit `-1700` ab. Ein
 * veralteter Wert darf Komfort kosten, nie das Öffnen.
 */
Deno.test("Startverzeichnis: nur existierende Ordner gehen in den Dialog", async () => {
  const root = await Deno.makeTempDir({ prefix: "dialog-start-" });
  try {
    assertEquals(await usableStartDir(root), root);
    assertEquals(await usableStartDir(join(root, "gibtesnicht")), undefined);
    assertEquals(await usableStartDir(""), undefined);
    assertEquals(await usableStartDir(undefined), undefined);

    // Eine Datei ist kein Startverzeichnis.
    const file = join(root, "datei.md");
    await Deno.writeTextFile(file, "# x\n");
    assertEquals(await usableStartDir(file), undefined);

    // Anführungszeichen würden das AppleScript-Literal sprengen.
    assertEquals(await usableStartDir(`${root}/mit"Zitat`), undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
