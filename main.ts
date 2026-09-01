/**
 * Bootstrap: Einzelinstanz, Protokoll, Datenbank, Server, Fenster.
 *
 * Alles Fachliche liegt in `src/` — diese Datei bleibt bewusst kurz und ist
 * die einzige Stelle mit Prozess- und Fenster-Wissen.
 */
import { createApp } from "./src/api.ts";
import { getDb } from "./src/db.ts";
import { startupPath } from "./src/startup.ts";
import { APP_NAME } from "./src/paths.ts";
import { injectToken, isDesktop } from "./src/security.ts";
import { focusRunningInstance, releaseLock, writeLock } from "./src/instance.ts";
import { createWindow } from "./src/window.ts";
import { log, setupLog } from "./src/log.ts";
import { VERSION } from "./src/version.ts";

setupLog();

// Vor allem anderen: Läuft schon eine Instanz, gehört ihr das Fenster — und
// dieser Prozess hat nichts zu tun. Nur im Fensterbetrieb; im Browser-Loop
// sind zwei Server auf verschiedenen Ports völlig in Ordnung.
// Datei **oder Ordner** aus den Startargumenten („Öffnen mit …",
// `open -a … --args datei.md`) — wird an die laufende Instanz weitergereicht
// oder beim Start geöffnet.
const wanted = await startupPath(Deno.args);

if (isDesktop && await focusRunningInstance(wanted)) Deno.exit(0);

getDb();

let handle: ReturnType<typeof createWindow> = null;

const { app } = createApp({
  transformHtml: injectToken,
  onFocusRequest: () => handle?.focus(),
  startupTarget: wanted,
});

// `hostname` explizit: die Vorgabe von Deno.serve ist **nicht** Loopback —
// ohne diese Zeile ist die API im Entwicklungslauf im ganzen Netz erreichbar.
const server = Deno.serve({ hostname: "127.0.0.1", port: isDesktop ? 0 : 8777 }, app.fetch);
log.info(`${APP_NAME} ${VERSION} — API auf http://127.0.0.1:${server.addr.port}`);

if (isDesktop) {
  writeLock(server.addr.port);
  // Drei Wege aus dem Prozess, alle drei müssen die Sperre freigeben:
  // Fenster schließen (unten), `unload`, und ein Signal von außen. Bleibt sie
  // liegen, erkennt der nächste Start sie zwar als verwaist — das kostet aber
  // eine Sekunde Wartezeit auf die Antwort, die nie kommt.
  globalThis.addEventListener("unload", releaseLock);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    try {
      Deno.addSignalListener(signal, () => {
        releaseLock();
        Deno.exit(0);
      });
    } catch {
      // Windows kennt SIGTERM nicht — kein Grund, den Start abzubrechen.
    }
  }
}

handle = createWindow();

if (handle) {
  // Wichtig: Ohne das läuft der Prozess nach dem Schließen des letzten Fensters weiter —
  // Fenster ist weg, App hängt im Dock und ist nur noch über Menü ▸ Beenden killbar.
  // Verifiziert: der rote Schließen-Button feuert "close", danach ist isClosed() true.
  const quit = () => {
    releaseLock();
    Deno.exit(0);
  };
  handle.win.addEventListener?.("close", quit);
  // Fallback, falls das Event einmal ausbleibt (Fenster anders zerstört).
  setInterval(() => {
    if (handle?.win.isClosed?.()) quit();
  }, 400);
}

await server.finished;
