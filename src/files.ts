/**
 * Datei-Ein- und -Ausgabe.
 *
 * **Architekturregel:** Dateiarbeit gehört auf die Deno-Seite, nicht ins
 * Webview. Verifiziert für Deno 2.9 auf macOS: `<input type="file">` öffnet im
 * Fenster der gebauten App **keinen** Dialog (der WKWebView fehlt die
 * Delegate-Methode `runOpenPanelWithParameters`). Öffnen, „Im Finder zeigen"
 * und das Auflösen von Bildpfaden laufen deshalb hier.
 */
import { basename, isAbsolute, join, resolve } from "@std/path";
import { AppError } from "../shared/errors.ts";
import type { Encoding } from "../shared/schema.ts";
import { log } from "./log.ts";

// ── Kodierung ───────────────────────────────────────────────────────────────

const UTF8_BOM = [0xef, 0xbb, 0xbf];

export interface DetectedEncoding {
  encoding: Encoding;
  reason: string;
}

/**
 * BOM prüfen → UTF-8 strikt versuchen → auf `windows-1252` zurückfallen.
 *
 * Auch für Markdown kein Detail: Notizen, die einmal durch Notepad oder einen
 * alten Editor gelaufen sind, sind nicht UTF-8. Eine Vorschau, die bei „Größe"
 * ein Kästchen zeigt, gilt beim Anwender als kaputte Software.
 */
export function detectEncoding(sample: Uint8Array, partial = true): DetectedEncoding {
  if (sample.length >= 3 && UTF8_BOM.every((byte, index) => sample[index] === byte)) {
    return { encoding: "utf-8", reason: "UTF-8-BOM erkannt" };
  }
  /**
   * Am Ende einer *Stichprobe* kann eine Mehrbyte-Sequenz abgeschnitten sein —
   * deshalb bis zu drei Bytes kürzen, bevor „kein UTF-8" behauptet wird.
   *
   * `partial` ist dabei kein Beiwerk: Liegt die **ganze** Datei vor, wäre das
   * Kürzen falsch. Eine kurze cp1252-Datei („# Größe", 7 Bytes) gilt sonst als
   * UTF-8, weil nach dem Wegschneiden der drei letzten Bytes nur noch reines
   * ASCII übrig bleibt — und der Anwender sieht Kästchen.
   */
  const maxCut = partial ? 3 : 0;
  for (let cut = 0; cut <= maxCut && cut < sample.length; cut++) {
    const slice = cut === 0 ? sample : sample.subarray(0, sample.length - cut);
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(slice);
      return { encoding: "utf-8", reason: "als UTF-8 dekodierbar" };
    } catch { /* nächster Versuch mit kürzerer Stichprobe */ }
  }
  return { encoding: "windows-1252", reason: "keine gültige UTF-8-Folge — Rückfall auf windows-1252" };
}

export function decodeBytes(bytes: Uint8Array, encoding: Encoding): string {
  // `ignoreBOM: false` (Vorgabe) entfernt den BOM — sonst steht ein
  // unsichtbares Zeichen vor der ersten Überschrift.
  return new TextDecoder(encoding).decode(bytes);
}

// ── Pfade ───────────────────────────────────────────────────────────────────

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Ordner oder Datei? Entscheidet, ob ein Startargument ein Arbeitsordner ist. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

/**
 * Pfadprüfung für jeden Pfad, der aus dem Client kommt: nach `resolve()` muss
 * er innerhalb des erlaubten Verzeichnisses liegen. Ohne das ist jeder
 * Datei-Endpunkt ein „lies mir irgendwas"-Endpunkt.
 */
export function ensureInside(base: string, candidate: string): string {
  const root = resolve(base);
  const target = resolve(isAbsolute(candidate) ? candidate : join(root, candidate));
  if (target !== root && !target.startsWith(root + "/") && !target.startsWith(root + "\\")) {
    throw new AppError("forbidden", `Pfad liegt außerhalb von ${root}`);
  }
  return target;
}

export function isInside(base: string, candidate: string): boolean {
  try {
    ensureInside(base, candidate);
    return true;
  } catch {
    return false;
  }
}

// ── Native Dialoge ──────────────────────────────────────────────────────────

interface DesktopDialogApi {
  open?: (options: unknown) => Promise<string | string[] | null>;
  save?: (options: unknown) => Promise<string | null>;
}

/**
 * Deno Desktop ist jung — ob `Deno.dialog` existiert, ist versionsabhängig.
 * Deshalb: API abtasten, sonst über das Betriebssystem fragen. Der Aufrufer
 * merkt den Unterschied nicht.
 */
function desktopDialog(): DesktopDialogApi | null {
  const api = (Deno as unknown as { dialog?: DesktopDialogApi }).dialog;
  return api && (api.open || api.save) ? api : null;
}

async function run(command: string, args: string[]): Promise<string> {
  const { code, stdout, stderr } = await new Deno.Command(command, { args, stdout: "piped", stderr: "piped" })
    .output();
  if (code !== 0) {
    const message = new TextDecoder().decode(stderr).trim();
    // Abbruch durch den Anwender ist kein Fehler.
    if (/cancel|abgebrochen|-128/i.test(message) || !message) return "";
    throw new AppError("io_error", message);
  }
  return new TextDecoder().decode(stdout).trim();
}

/** Ob überhaupt ein nativer Dialog erreichbar ist (steht in `/api/info`). */
export function canPickFiles(): boolean {
  if (desktopDialog()?.open) return true;
  return Deno.build.os === "darwin" || Deno.build.os === "windows" || Deno.build.os === "linux";
}

/**
 * Startverzeichnis prüfen, bevor es in einen Dialog geht.
 *
 * Der Grund ist ein echter Fehlschlag, kein Vorsichtsprinzip: AppleScript
 * wandelt `POSIX file "…"` nur dann in einen `alias` um, wenn der Pfad
 * **existiert**. Zeigt das gemerkte Verzeichnis auf etwas Gelöschtes — ein
 * abgeräumter Projektordner, ein abgezogener USB-Stick —, bricht `osascript`
 * mit `-1700` ab und der Anwender bekommt gar keinen Dialog zu sehen. Ein
 * veraltetes Startverzeichnis darf höchstens Komfort kosten, nie das Öffnen.
 */
export async function usableStartDir(path?: string): Promise<string | undefined> {
  if (!path) return undefined;
  // Anführungszeichen im Pfad würden das AppleScript-Literal sprengen.
  if (path.includes('"') || path.includes("\\")) return undefined;
  return (await isDirectory(path)) ? path : undefined;
}

/**
 * AppleScript-Dialog mit Startverzeichnis — und ohne, falls das schiefgeht.
 *
 * Das zweite Netz unter `usableStartDir()`: Der Ordner kann zwischen Prüfung
 * und Aufruf verschwinden, und nicht jeder Pfad, den `stat` mag, lässt sich in
 * einen `alias` wandeln (Netzlaufwerke, Ordner ohne Leserecht). Scheitert der
 * Versuch, wird der Dialog **ohne** Startverzeichnis wiederholt statt dem
 * Anwender einen Fehler statt eines Dialogs zu zeigen.
 */
async function osaDialog(build: (location: string) => string, startDir?: string): Promise<string | null> {
  if (startDir) {
    try {
      return (await run("osascript", ["-e", build(` default location (POSIX file "${startDir}")`)])) || null;
    } catch (error) {
      log.warn(`Startverzeichnis für den Dialog unbrauchbar (${startDir}): ${error}`);
    }
  }
  return (await run("osascript", ["-e", build("")])) || null;
}

/**
 * Öffnen-Dialog, auf Markdown eingeschränkt. Der Filter ist plattformabhängig
 * formuliert; wo er nicht durchsetzbar ist, prüft der Aufrufer die Endung.
 */
export async function pickMarkdownFile(wanted?: string): Promise<string | null> {
  const startDir = await usableStartDir(wanted);
  const dialog = desktopDialog();
  if (dialog?.open) {
    const picked = await dialog.open({ multiple: false, defaultPath: startDir });
    return Array.isArray(picked) ? picked[0] ?? null : picked ?? null;
  }
  if (Deno.build.os === "darwin") {
    // `of type` erwartet UTIs; "net.daringfireball.markdown" deckt .md/.markdown ab,
    // "public.plain-text" den Rest (.txt, .mdx bei manchen Systemen).
    return await osaDialog(
      (location) =>
        `POSIX path of (choose file with prompt "Markdown-Datei öffnen"${location} ` +
        `of type {"net.daringfireball.markdown", "public.plain-text"})`,
      startDir,
    );
  }
  if (Deno.build.os === "windows") {
    const script = `Add-Type -AssemblyName System.Windows.Forms; ` +
      `$d = New-Object System.Windows.Forms.OpenFileDialog; ` +
      `$d.Filter = 'Markdown|*.md;*.markdown;*.mdown;*.mkd;*.mdx|Text|*.txt|Alle Dateien|*.*'; ` +
      `${startDir ? `$d.InitialDirectory = '${startDir}'; ` : ""}` +
      `if ($d.ShowDialog() -eq 'OK') { $d.FileName }`;
    return (await run("powershell", ["-NoProfile", "-Command", script])) || null;
  }
  for (const tool of ["zenity", "kdialog"]) {
    try {
      const args = tool === "zenity"
        ? ["--file-selection", "--file-filter=Markdown | *.md *.markdown *.mdown *.mkd *.mdx *.txt"]
        : ["--getopenfilename", startDir ?? ".", "*.md *.markdown *.txt"];
      return (await run(tool, args)) || null;
    } catch { /* nächstes Werkzeug */ }
  }
  log.warn("Kein nativer Öffnen-Dialog verfügbar");
  return null;
}

/**
 * Ordner-Dialog für den Arbeitsordner.
 *
 * Dieselbe Abstufung wie beim Datei-Dialog: erst `Deno.dialog` (dort schaltet
 * `directory: true` um), sonst das Bordmittel des Betriebssystems.
 */
export async function pickFolder(wanted?: string): Promise<string | null> {
  const startDir = await usableStartDir(wanted);
  const dialog = desktopDialog();
  if (dialog?.open) {
    const picked = await dialog.open({ directory: true, multiple: false, defaultPath: startDir });
    return Array.isArray(picked) ? picked[0] ?? null : picked ?? null;
  }
  if (Deno.build.os === "darwin") {
    return await osaDialog(
      (location) => `POSIX path of (choose folder with prompt "Ordner öffnen"${location})`,
      startDir,
    );
  }
  if (Deno.build.os === "windows") {
    const script = `Add-Type -AssemblyName System.Windows.Forms; ` +
      `$d = New-Object System.Windows.Forms.FolderBrowserDialog; ` +
      `${startDir ? `$d.SelectedPath = '${startDir}'; ` : ""}` +
      `if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`;
    return (await run("powershell", ["-NoProfile", "-Command", script])) || null;
  }
  for (const tool of ["zenity", "kdialog"]) {
    try {
      const args = tool === "zenity"
        ? ["--file-selection", "--directory"]
        : ["--getexistingdirectory", startDir ?? "."];
      return (await run(tool, args)) || null;
    } catch { /* nächstes Werkzeug */ }
  }
  log.warn("Kein nativer Ordner-Dialog verfügbar");
  return null;
}

export async function pickSaveFile(suggested: string, wanted?: string): Promise<string | null> {
  const startDir = await usableStartDir(wanted);
  const dialog = desktopDialog();
  if (dialog?.save) {
    return await dialog.save({ defaultPath: startDir ? join(startDir, suggested) : suggested }) ?? null;
  }
  if (Deno.build.os === "darwin") {
    return await osaDialog(
      (location) =>
        `POSIX path of (choose file name with prompt "Speichern unter" default name "${
          basename(suggested)
        }"${location})`,
      startDir,
    );
  }
  if (Deno.build.os === "windows") {
    const script = `Add-Type -AssemblyName System.Windows.Forms; ` +
      `$d = New-Object System.Windows.Forms.SaveFileDialog; $d.FileName = '${basename(suggested)}'; ` +
      `${startDir ? `$d.InitialDirectory = '${startDir}'; ` : ""}` +
      `if ($d.ShowDialog() -eq 'OK') { $d.FileName }`;
    return (await run("powershell", ["-NoProfile", "-Command", script])) || null;
  }
  try {
    return (await run("zenity", ["--file-selection", "--save", "--filename", suggested])) || null;
  } catch {
    return null;
  }
}

/** Datei oder Ordner im Dateimanager zeigen („Im Finder anzeigen"). */
export async function revealPath(path: string): Promise<void> {
  const command = Deno.build.os === "darwin" ? "open" : Deno.build.os === "windows" ? "explorer" : "xdg-open";
  const args = Deno.build.os === "darwin" ? ["-R", path] : [path];
  await new Deno.Command(command, { args, stdout: "null", stderr: "null" }).output().catch(() => {});
}

/**
 * Externen Link im Standardbrowser öffnen.
 *
 * Der Grund, warum das überhaupt hier steht: Ein Klick auf `https://…` im
 * Webview würde die App-Seite *ersetzen* — das Fenster zeigt danach eine
 * fremde Webseite und es gibt keinen Zurück-Knopf. Links gehen deshalb
 * grundsätzlich nach draußen.
 */
export async function openExternal(url: string): Promise<void> {
  // Nur Web-Protokolle: `file:` oder `javascript:` aus einem fremden Dokument
  // an das Betriebssystem weiterzureichen wäre eine Lücke, kein Komfort.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("bad_request", `Keine gültige URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "mailto:") {
    throw new AppError("forbidden", `Protokoll nicht erlaubt: ${parsed.protocol}`);
  }
  const command = Deno.build.os === "darwin" ? "open" : Deno.build.os === "windows" ? "explorer" : "xdg-open";
  await new Deno.Command(command, { args: [parsed.href], stdout: "null", stderr: "null" }).output()
    .catch((error) => log.warn(`Link nicht geöffnet: ${error}`));
}
