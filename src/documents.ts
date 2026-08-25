/**
 * Das Fachliche der App: eine Markdown-Datei einlesen und daraus ein `Doc`
 * machen — samt Titel, Kodierung und Verlaufseintrag.
 *
 * Gerendert wird **nicht** hier, sondern im Webview (`ui/src/markdown.ts`):
 * Mermaid und KaTeX brauchen ein DOM, und die Vorschau soll beim Blättern
 * nicht auf den Server warten. Der Server liefert Text und Pfade.
 */
import { basename, dirname, extname, resolve } from "@std/path";
import { AppError } from "../shared/errors.ts";
import { type Doc, MARKDOWN_EXTENSIONS } from "../shared/schema.ts";
import { decodeBytes, detectEncoding, isInside } from "./files.ts";
import * as history from "./repo/documents.ts";
import { log } from "./log.ts";

/**
 * Obergrenze für den Text. Eine 200-MB-Datei ins Webview zu schicken heißt:
 * Fenster blockiert, kein Fortschritt, kein Abbruch. Lieber eine klare
 * Meldung — ein Betrachter ist kein Editor für Logdateien.
 */
const MAX_BYTES = 16 * 1024 * 1024;

export function isMarkdownPath(path: string): boolean {
  return (MARKDOWN_EXTENSIONS as readonly string[]).includes(extname(path).toLowerCase());
}

/**
 * Titel des Dokuments: `title` aus dem YAML-Vorspann, sonst die erste
 * Überschrift, sonst der Dateiname ohne Endung.
 *
 * Bewusst eine Zeichenketten-Heuristik und kein Parser: Der Titel steht in der
 * Seitenleiste, er wird nicht weiterverarbeitet. Codeblöcke werden trotzdem
 * ausgenommen — sonst wird aus `# TODO` in einem Shell-Beispiel der Titel.
 */
export function extractTitle(text: string, fallback: string): string {
  const lines = text.split(/\r?\n/);
  let index = 0;

  // YAML-Vorspann: nur, wenn die *erste* Zeile die Trennlinie ist.
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, position) => position > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const match = /^title\s*:\s*(.+)$/i.exec(line);
        if (match) {
          const value = match[1].trim().replace(/^["']|["']$/g, "").trim();
          if (value) return value;
        }
      }
      index = end + 1;
    }
  }

  let inFence = false;
  for (; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const atx = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (atx) return clean(atx[1]);
    // Setext: Text mit `====` darunter.
    if (line.trim() && /^\s{0,3}=+\s*$/.test(lines[index + 1] ?? "")) return clean(line);
  }
  return fallback;
}

/** Auszeichnungen aus dem Titel nehmen — er steht als Text in der Liste. */
function clean(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/([*_])([^*_]+)\1/g, "$2")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

export interface ReadOptions {
  /** `false` beim automatischen Neuladen — das ist kein neues „Öffnen". */
  remember?: boolean;
}

/** Liest eine Datei und macht daraus das `Doc`, das die Oberfläche anzeigt. */
export async function readDocument(path: string, options: ReadOptions = {}): Promise<Doc> {
  const full = resolve(path);
  const stat = await Deno.stat(full).catch(() => {
    throw new AppError("not_found", `Datei nicht gefunden: ${full}`);
  });
  if (!stat.isFile) throw new AppError("bad_request", `Kein Dokument: ${full}`);
  if (stat.size > MAX_BYTES) {
    throw new AppError(
      "bad_request",
      `Datei ist ${Math.round(stat.size / 1024 / 1024)} MB groß — der Betrachter zeigt bis 16 MB an.`,
    );
  }

  const bytes = await Deno.readFile(full);
  // Die ganze Datei liegt vor — deshalb `partial: false`: Am Ende darf keine
  // Mehrbyte-Sequenz „abgeschnitten" sein, es gibt kein Danach.
  const detected = detectEncoding(bytes, false);
  const text = decodeBytes(bytes, detected.encoding);
  const name = basename(full);
  const dir = dirname(full);
  const title = extractTitle(text, name.replace(/\.[^.]+$/, ""));

  const id = options.remember === false
    ? (history.idOf(full) ?? history.remember({ path: full, name, dir, title }))
    : history.remember({ path: full, name, dir, title });
  if (options.remember === false) history.touchTitle(full, title);

  log.debug(`Dokument gelesen: ${full} (${stat.size} Bytes, ${detected.encoding})`);

  return {
    id,
    path: full,
    name,
    dir,
    title,
    text,
    size: stat.size,
    modifiedAt: (stat.mtime ?? new Date()).toISOString(),
    encoding: detected.encoding,
    encodingReason: detected.reason,
  };
}

// ── Beigaben: Bilder, PDFs, Videos ──────────────────────────────────────────

/**
 * Was der Betrachter aus dem Dateisystem nachlädt. Eine Positivliste, keine
 * Sperrliste: Ein Markdown-Dokument darf Bilder einbetten, es darf aber nicht
 * dazu führen, dass `~/.ssh/id_rsa` über einen `<img>`-Tag im Fenster landet.
 */
const ASSET_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".bmp",
  ".ico",
  ".pdf",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".ogg",
]);

function home(): string {
  return Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "/";
}

/**
 * Löst `![](bilder/plan.png)` relativ zum Dokument auf.
 *
 * Zwei Grenzen, beide bewusst: die Endung muss in der Positivliste stehen, und
 * das Ergebnis muss entweder im Ordner des Dokuments (inklusive
 * Unterordnern und, für das übliche `../assets/`, im Elternordner) oder
 * irgendwo im Benutzerverzeichnis liegen. Ein Dokument aus fremder Hand kann
 * damit nichts anfordern, was der Anwender nicht ohnehin selbst öffnen könnte.
 */
export function resolveAsset(docDir: string, reference: string): string {
  const base = resolve(docDir);
  const target = resolve(base, decodeURIComponent(reference.split("#")[0].split("?")[0]));
  if (!ASSET_EXTENSIONS.has(extname(target).toLowerCase())) {
    throw new AppError("forbidden", `Dateityp wird nicht ausgeliefert: ${basename(target)}`);
  }
  const allowed = isInside(base, target) || isInside(dirname(base), target) || isInside(home(), target);
  if (!allowed) throw new AppError("forbidden", `Beigabe liegt außerhalb des Dokumentordners: ${target}`);
  return target;
}
