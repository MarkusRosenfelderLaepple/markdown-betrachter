/**
 * „Öffnen mit …": den Pfad aus den Startargumenten holen.
 *
 * Auf macOS bekommt ein Bündel Argumente nur über
 * `open -a Markdown-Betrachter.app --args datei.md`; im Entwicklungslauf steht
 * die Datei einfach hinter dem Task. Beides landet in `Deno.args`.
 */
import { resolve } from "@std/path";
import { isMarkdownPath } from "./documents.ts";
import { log } from "./log.ts";

export async function startupPath(args: string[]): Promise<string | null> {
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    const path = resolve(arg.startsWith("file://") ? new URL(arg).pathname : arg);
    if (!isMarkdownPath(path)) continue;
    const stat = await Deno.stat(path).catch(() => null);
    if (stat?.isFile) {
      log.info(`Startargument: ${path}`);
      return path;
    }
    log.warn(`Startargument ist keine lesbare Datei: ${path}`);
  }
  return null;
}
