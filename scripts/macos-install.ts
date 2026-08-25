/**
 * Installiert die App unter macOS und macht sie zum Standardprogramm für
 * Markdown-Dateien.
 *
 * Warum der Umweg über ein zweites, winziges Programm:
 * Der Finder übergibt eine doppelt geklickte Datei **nicht** als Argument,
 * sondern als Apple-Event (`kAEOpenDocuments`). `deno desktop` (2.9) wertet das
 * nicht aus — `Deno.BrowserWindow` kennt dafür kein Ereignis, und ein Test mit
 * `open -a App datei.md` kam ohne Pfad an. Ein als Handler eingetragener
 * „Öffner" nimmt das Ereignis entgegen und startet die eigentliche App mit
 * `open -n -a … --args <pfad>`; deren Einzelinstanz-Sperre reicht den Pfad an
 * ein schon laufendes Fenster weiter (`/instance/focus`).
 *
 * `-n` ist Pflicht: Ohne das ignoriert `open` die `--args` einer bereits
 * laufenden App und aktiviert sie nur.
 */
import { basename, join } from "@std/path";

const APP_NAME = "Markdown-Betrachter";
const BUNDLE_ID = "com.laepple.markdown-betrachter";
const OPENER_ID = `${BUNDLE_ID}.opener`;
const OPENER_NAME = `${APP_NAME} (Öffnen mit)`;
/** `.md` und `.markdown` hat macOS selbst; die übrigen meldet der Öffner an. */
const MARKDOWN_UTI = "net.daringfireball.markdown";
const EXTENSIONS = ["md", "markdown", "mdown", "mkd", "mdx"];

const home = Deno.env.get("HOME")!;
const source = join(Deno.cwd(), "dist-app", `${APP_NAME}.app`);
const installed = join("/Applications", `${APP_NAME}.app`);
const supportDir = join(home, "Library", "Application Support", APP_NAME);
const opener = join(supportDir, `${OPENER_NAME}.app`);

const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

async function run(cmd: string, ...args: string[]): Promise<string> {
  const { success, stdout, stderr } = await new Deno.Command(cmd, { args }).output();
  const out = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);
  if (!success) throw new Error(`${basename(cmd)} ${args.join(" ")}\n${out}`);
  return out.trim();
}

/**
 * Ein PlistBuddy-Befehl pro Aufruf, Fehler werden geschluckt: Ob ein Schlüssel
 * `Set` oder `Add` braucht, hängt davon ab, was `osacompile` schon
 * hineingeschrieben hat — und das ist von Version zu Version verschieden.
 * Deshalb erst `Delete`, dann `Add`, und beides darf danebengehen.
 */
async function plist(file: string, ...commands: string[]): Promise<void> {
  for (const c of commands) {
    await new Deno.Command("/usr/libexec/PlistBuddy", { args: ["-c", c, file] }).output();
  }
}

if (Deno.build.os !== "darwin") {
  console.error("Dieses Skript ist für macOS. Auf anderen Systemen läuft die Zuordnung anders.");
  Deno.exit(1);
}
if (!(await Deno.stat(source).catch(() => null))?.isDirectory) {
  console.error(`Kein Bündel unter ${source} — zuerst \`deno task build\`.`);
  Deno.exit(1);
}

// ── 1. App nach /Applications ───────────────────────────────────────────────
// `ditto` statt `cp`: behält Rechte und erweiterte Attribute, und die laufende
// Alt-Version wird vorher entfernt, damit keine Reste zweier Bauten mischen.
console.log(`→ ${installed}`);
await new Deno.Command("pkill", { args: ["-f", "laufey_webview"] }).output();
await Deno.remove(installed, { recursive: true }).catch(() => {});
await run("/usr/bin/ditto", source, installed);

// ── 2. Öffner bauen ─────────────────────────────────────────────────────────
// Ein AppleScript-Droplet: `on open` bekommt die Dateien aus dem Apple-Event.
const script = `
on run
	do shell script "open -a " & quoted form of "${installed}"
end run

on open theFiles
	repeat with f in theFiles
		do shell script "open -n -a " & quoted form of "${installed}" & " --args " & quoted form of (POSIX path of f)
	end repeat
end open
`;
console.log(`→ ${opener}`);
await Deno.mkdir(supportDir, { recursive: true });
await Deno.remove(opener, { recursive: true }).catch(() => {});
const scriptFile = await Deno.makeTempFile({ suffix: ".applescript" });
await Deno.writeTextFile(scriptFile, script);
await run("/usr/bin/osacompile", "-o", opener, scriptFile);
await Deno.remove(scriptFile);

// Icon der App übernehmen, damit der Eintrag in „Öffnen mit" richtig aussieht.
const icns = join(installed, "Contents", "Resources", "AppIcon.icns");
if (await Deno.stat(icns).then(() => true, () => false)) {
  await Deno.copyFile(icns, join(opener, "Contents", "Resources", "applet.icns"));
}

// ── 3. Öffner als Markdown-Handler anmelden ─────────────────────────────────
const openerPlist = join(opener, "Contents", "Info.plist");
await plist(
  openerPlist,
  "Delete :CFBundleIdentifier",
  `Add :CFBundleIdentifier string ${OPENER_ID}`,
  "Delete :CFBundleName",
  `Add :CFBundleName string ${OPENER_NAME}`,
  "Delete :CFBundleDocumentTypes",
  "Delete :LSUIElement",
  // Kein Programmsymbol im Dock: Der Öffner reicht nur weiter und endet sofort.
  "Add :LSUIElement bool true",
  "Add :CFBundleDocumentTypes array",
  "Add :CFBundleDocumentTypes:0 dict",
  "Add :CFBundleDocumentTypes:0:CFBundleTypeName string Markdown",
  "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer",
  "Add :CFBundleDocumentTypes:0:LSHandlerRank string Default",
  "Add :CFBundleDocumentTypes:0:LSItemContentTypes array",
  `Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string ${MARKDOWN_UTI}`,
  "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions array",
  ...EXTENSIONS.map((ext, i) => `Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:${i} string ${ext}`),
);
// Nach dem Ändern der Info.plist ist die Signatur ungültig — neu ad-hoc signieren.
await run("/usr/bin/codesign", "--force", "--sign", "-", opener);

await run(LSREGISTER, "-f", installed);
await run(LSREGISTER, "-f", opener);

// ── 4. Als Standard eintragen ───────────────────────────────────────────────
// `LSSetDefaultRoleHandlerForContentType` ist die offizielle API dafür; über
// die ObjC-Brücke von JXA ist sie ohne Zusatzwerkzeug (`duti`) erreichbar.
const jxa = `
ObjC.import('CoreServices');
$.LSSetDefaultRoleHandlerForContentType($('${MARKDOWN_UTI}'), $.kLSRolesAll, $('${OPENER_ID}'));
`;
const setDefault = await new Deno.Command("/usr/bin/osascript", {
  args: ["-l", "JavaScript", "-e", jxa],
}).output();

console.log("");
console.log(`✓ ${APP_NAME} liegt in /Applications`);
console.log(`✓ Öffner angemeldet für ${MARKDOWN_UTI} und .${EXTENSIONS.join(" .")}`);
console.log(
  setDefault.success
    ? "✓ Als Standard für Markdown eingetragen"
    : "! Standard konnte nicht gesetzt werden — im Finder: Datei auswählen, ⌘I,\n" +
      `  unter „Öffnen mit" ${OPENER_NAME} wählen, dann „Alle ändern …"`,
);
