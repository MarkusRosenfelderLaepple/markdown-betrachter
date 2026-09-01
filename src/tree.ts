/**
 * Der Ordnerbaum: ein Projektverzeichnis auf seine Markdown-Dateien eindampfen.
 *
 * Der eigentliche Trick ist nicht das Filtern, sondern das **Beschneiden**.
 * Wer in einem Repository nur die `.md`-Dateien stehen lässt, hat danach
 * hunderte leere Ordner in der Liste — sichtbar bleibt deshalb nur, was
 * irgendwo unter sich ein Dokument hat.
 *
 * Drei Entscheidungen, die den Unterschied zwischen brauchbar und unbenutzbar
 * machen:
 *
 * 1. **Nicht absteigen statt hinterher wegwerfen.** `.git` und `node_modules`
 *    zu betreten und danach zu verwerfen kostet in einem echten Projekt
 *    Sekunden bis Minuten — die Ordner werden gar nicht erst geöffnet.
 * 2. **`.gitignore` gilt.** Was das Projekt selbst als Müll führt, ist auch
 *    hier Müll; siehe `gitignore.ts`.
 * 3. **Einzelketten werden zusammengezogen.** `docs` → `adr` → `2024` steht als
 *    eine Zeile `docs/adr/2024` in der Leiste. In einer 260 px schmalen
 *    Seitenleiste ist das der Unterschied zwischen drei und neun Ebenen.
 */
import { basename, join, resolve } from "@std/path";
import { AppError } from "../shared/errors.ts";
import { TREE_EXTENSIONS, type TreeNode, type TreeResult } from "../shared/schema.ts";
import { type IgnoreRule, isIgnored, parseGitignore } from "./gitignore.ts";
import { log } from "./log.ts";

/**
 * Immer übersprungen, unabhängig von `.gitignore`.
 *
 * `.git` steht in keiner `.gitignore` (Git verwaltet es selbst) und enthält bei
 * jedem Repository tausende Dateien. Der Rest sind Ordner, die zwar meist
 * ignoriert *sind*, aber eben nur in einem Repository — ein einfach
 * heruntergeladener Projektordner ohne `.git` hätte sie sonst voll im Baum.
 *
 * Bewusst **nicht** dabei: `dist`, `build`, `target`. Die können generierte
 * Dokumentation enthalten, und in einem Repository greift dafür `.gitignore`.
 */
const ALWAYS_SKIP = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
]);

/**
 * Obergrenzen. Sie sind da, damit ein versehentlich geöffnetes
 * Benutzerverzeichnis die App nicht für Minuten anhält — erreicht werden sie
 * im Alltag nicht. Wird eine überschritten, sagt das Ergebnis das (`truncated`)
 * und die Seitenleiste zeigt es an; stillschweigend gekürzt wird nichts.
 */
const MAX_FILES = 5000;
const MAX_DEPTH = 12;

export function isTreeDocument(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return (TREE_EXTENSIONS as readonly string[]).includes(name.slice(dot).toLowerCase());
}

interface ScanState {
  files: number;
  truncated: boolean;
}

/**
 * Einen Ordner einlesen. Wirft, wenn der Pfad kein Verzeichnis ist — alles
 * andere (nicht lesbare Unterordner, kaputte Verknüpfungen) wird übersprungen,
 * nicht gemeldet: In fremden Projektordnern ist das der Normalfall.
 */
export async function scanTree(root: string): Promise<TreeResult> {
  const full = resolve(root);
  const stat = await Deno.stat(full).catch(() => {
    throw new AppError("not_found", `Ordner nicht gefunden: ${full}`);
  });
  if (!stat.isDirectory) throw new AppError("bad_request", `Kein Ordner: ${full}`);

  const started = performance.now();
  const state: ScanState = { files: 0, truncated: false };
  const nodes = await walk(full, "", 0, [], state);
  const took = Math.round(performance.now() - started);
  log.debug(`Ordner eingelesen: ${full} (${state.files} Dokumente, ${took} ms)`);

  return {
    root: full,
    name: basename(full) || full,
    nodes: collapse(nodes),
    files: state.files,
    truncated: state.truncated,
  };
}

async function walk(
  dir: string,
  rel: string,
  depth: number,
  inherited: readonly IgnoreRule[],
  state: ScanState,
): Promise<TreeNode[]> {
  if (depth > MAX_DEPTH) {
    state.truncated = true;
    return [];
  }

  const entries: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) entries.push(entry);
  } catch (error) {
    // Kein Leserecht, Ordner gerade gelöscht, Netzlaufwerk weg — der Rest des
    // Baums bleibt trotzdem brauchbar.
    log.debug(`Ordner übersprungen: ${dir} (${error})`);
    return [];
  }

  // Eine `.gitignore` in diesem Ordner gilt für alles darunter — sie kommt
  // deshalb *hinter* die geerbten Regeln (die letzte passende gewinnt).
  let rules = inherited;
  if (entries.some((entry) => entry.isFile && entry.name === ".gitignore")) {
    const text = await Deno.readTextFile(join(dir, ".gitignore")).catch(() => "");
    if (text) rules = [...inherited, ...parseGitignore(text, rel)];
  }

  const dirs: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const entry of entries) {
    // Verknüpfungen werden nicht verfolgt: Ein Symlink auf einen Elternordner
    // ist eine Endlosschleife, und ein Baum ohne Zyklusprüfung ist eine
    // Zeitbombe. Verknüpfte *Dateien* zeigt der Baum ebenfalls nicht — sie
    // wären beim Öffnen ein zweiter Pfad auf dasselbe Dokument.
    if (entry.isSymlink) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;

    if (entry.isDirectory) {
      if (ALWAYS_SKIP.has(entry.name)) continue;
      if (isIgnored(rules, childRel, true)) continue;
      const children = await walk(join(dir, entry.name), childRel, depth + 1, rules, state);
      // Der Beschnitt: ein Ordner ohne Dokument darunter verschwindet.
      if (children.length === 0) continue;
      dirs.push({ kind: "dir", name: entry.name, path: join(dir, entry.name), rel: childRel, children });
      continue;
    }

    if (!entry.isFile || !isTreeDocument(entry.name)) continue;
    if (isIgnored(rules, childRel, false)) continue;
    if (state.files >= MAX_FILES) {
      state.truncated = true;
      continue;
    }
    state.files++;
    files.push({ kind: "file", name: entry.name, path: join(dir, entry.name), rel: childRel });
  }

  // Ordner vor Dateien, beides alphabetisch — und zwar mit `localeCompare`
  // samt `numeric`, damit `kapitel-10.md` hinter `kapitel-9.md` steht.
  const byName = (a: TreeNode, b: TreeNode) =>
    a.name.localeCompare(b.name, "de", { numeric: true, sensitivity: "base" });
  dirs.sort(byName);
  files.sort(byName);
  return [...dirs, ...files];
}

/**
 * Ordnerketten ohne Verzweigung zu einer Zeile zusammenziehen (`docs/adr/2024`).
 *
 * `path` und `rel` bleiben dabei die des **untersten** Ordners — das ist der,
 * dessen Inhalt die Zeile aufklappt, und der, den „Im Finder zeigen" meint.
 */
function collapse(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind !== "dir" || !node.children) return node;
    let current = node;
    let name = node.name;
    while (current.children?.length === 1 && current.children[0].kind === "dir") {
      current = current.children[0];
      name = `${name}/${current.name}`;
    }
    return { ...current, name, children: collapse(current.children ?? []) };
  });
}
