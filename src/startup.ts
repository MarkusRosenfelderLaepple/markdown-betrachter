/**
 * „Öffnen mit …": den Pfad aus den Startargumenten holen.
 *
 * Auf macOS bekommt ein Bündel Argumente nur über
 * `open -a Markdown-Betrachter.app --args datei.md`; im Entwicklungslauf steht
 * die Datei einfach hinter dem Task. Beides landet in `Deno.args`.
 *
 * Ein **Ordner** ist dabei genauso gültig wie eine Datei: Wer die App auf ein
 * Projektverzeichnis zieht, meint den Arbeitsordner. Welches von beidem es war,
 * steht im Ergebnis — die Oberfläche öffnet danach entweder ein Dokument oder
 * den Baum.
 */
import { resolve } from "@std/path";
import { isMarkdownPath } from "./documents.ts";
import { log } from "./log.ts";

export interface StartupTarget {
  path: string;
  kind: "file" | "dir";
}

export async function startupPath(args: string[]): Promise<StartupTarget | null> {
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    const path = resolve(arg.startsWith("file://") ? new URL(arg).pathname : arg);
    const stat = await Deno.stat(path).catch(() => null);
    if (stat?.isDirectory) {
      log.info(`Startargument (Ordner): ${path}`);
      return { path, kind: "dir" };
    }
    if (!isMarkdownPath(path)) continue;
    if (stat?.isFile) {
      log.info(`Startargument: ${path}`);
      return { path, kind: "file" };
    }
    log.warn(`Startargument ist keine lesbare Datei: ${path}`);
  }
  return null;
}
