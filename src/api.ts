/**
 * Der gesamte HTTP-Teil an einer Stelle: Hono-Router, Validierung gegen die
 * Schemata aus `shared/schema.ts`, eine Fehlerform, ein Typ-Export für den
 * Client.
 *
 * Der Gewinn steckt in `export type AppType`: `ui/src/api.ts` erzeugt daraus
 * mit `hc<AppType>()` einen Client, der Pfade, Methoden, Bodies *und*
 * Antworttypen kennt — ohne Codegenerierung und ohne ein einziges `as Doc`.
 */
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { serveDir, serveFile } from "@std/http/file-server";
import { dirname, join } from "@std/path";
import { z, type ZodType } from "zod";

import { HistoryQuery, OpenRequest, SettingKeyEnum, SETTINGS } from "../shared/schema.ts";
import { AppError, badRequest, notFound, toErrorBody } from "../shared/errors.ts";
import * as history from "./repo/documents.ts";
import { isMarkdownPath, readDocument, resolveAsset } from "./documents.ts";
import { scanTree } from "./tree.ts";
import type { StartupTarget } from "./startup.ts";
import { watchFile, watchTree } from "./watch.ts";
import { allSettings, readSetting, writeSetting, writeSettingChecked } from "./settings.ts";
import { backupTo, databasePath } from "./db.ts";
import {
  canPickFiles,
  exists,
  openExternal,
  pickFolder,
  pickMarkdownFile,
  pickSaveFile,
  revealPath,
} from "./files.ts";
import { APP_NAME, dataDir, logPath } from "./paths.ts";
import { flushLog, log } from "./log.ts";
import { guard } from "./security.ts";
import { FOCUS_HEADER, FOCUS_PATH, INSTANCE_SECRET } from "./instance.ts";
import { BUILD_DATE, COMMIT, VERSION } from "./version.ts";

const UI_DIR = join(import.meta.dirname ?? ".", "..", "ui", "dist");

/**
 * Letzte Verteidigungslinie — und in dieser App keine Formalie: Der Betrachter
 * zeigt **fremdes Markdown** an. Der Sanitizer im Webview
 * (`ui/src/markdown.ts`) ist die erste Schicht, diese Kopfzeile die zweite.
 *
 * Bewusst als Header und nicht als `<meta>` in der index.html: Im
 * Entwicklungslauf liefert Vite das HTML aus, dort würde eine Meta-CSP die
 * HMR-Verbindung blockieren.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Mermaid setzt Stile am Element, KaTeX ebenso.
  "style-src 'self' 'unsafe-inline'",
  // `data:` für eingebettete Bilder im Markdown, `blob:` für Mermaid-Ausgaben.
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export interface ApiOptions {
  /** Kann im Test auf `false` gesetzt werden, damit die Ausgabe ruhig bleibt. */
  requestLog?: boolean;
  /** HTML-Nachbearbeitung — im Betrieb das Einsetzen des App-Tokens. */
  transformHtml?: (html: string) => string;
  /** Zweitstart holt das vorhandene Fenster nach vorn (siehe `src/instance.ts`). */
  onFocusRequest?: () => void;
  /** Datei oder Ordner aus `Deno.args` — „Öffnen mit …" bzw. `open -a … --args datei.md`. */
  startupTarget?: StartupTarget | null;
}

/**
 * `zValidator` antwortet von sich aus mit einer eigenen ZodError-Form. Damit es
 * **eine** Fehlerform gibt, wird der Fehler stattdessen geworfen und von
 * `app.onError()` übersetzt.
 */
function check<T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator(target, schema, (result) => {
    if (!result.success) throw badRequest("Eingabe ungültig", result.error.issues);
  });
}

/** Pfad-`:id` kommt als String an — genau eine Stelle wandelt und prüft. */
const IdParam = z.object({ id: z.coerce.number().int().positive() });

export function createApp(options: ApiOptions = {}) {
  const app = new Hono();
  let startupTarget = options.startupTarget ?? null;

  if (options.requestLog !== false) app.use("*", honoLogger((message) => log.debug(message.trim())));

  // Genau eine Fehlerform für die ganze App — die UI hat damit eine Stelle zum
  // Anzeigen, und keine geworfene Exception ist mehr ein 500 ohne Body.
  app.onError((error, c) => {
    const { body, status } = toErrorBody(error);
    if (status >= 500) log.error(`${c.req.method} ${c.req.path}: ${body.error.message}`);
    else log.warn(`${c.req.method} ${c.req.path}: ${body.error.code} — ${body.error.message}`);
    return c.json(body, status as 400);
  });

  app.use("/api/*", guard);

  /**
   * Bewusst **außerhalb** von `/api/*` und damit außerhalb der Token-Prüfung:
   * Der zweite Prozess kennt das App-Token nicht. Er weist sich stattdessen mit
   * dem Geheimnis aus der Lockdatei aus, die nur das eigene Benutzerkonto
   * lesen kann.
   */
  app.post(FOCUS_PATH, async (c) => {
    if (c.req.header(FOCUS_HEADER) !== INSTANCE_SECRET) {
      throw new AppError("forbidden", "Falsches Instanz-Geheimnis");
    }
    // Ein Zweitstart mit Datei („Öffnen mit …", während die App schon läuft)
    // reicht den Pfad hier herein; die Oberfläche holt ihn beim Fokussieren ab.
    const body = await c.req.json().catch(() => ({})) as { path?: unknown; kind?: unknown };
    if (typeof body.path === "string" && body.path) {
      startupTarget = { path: body.path, kind: body.kind === "dir" ? "dir" : "file" };
    }
    options.onFocusRequest?.();
    return c.json({ ok: true } as const);
  });

  const routes = app
    .get("/api/health", (c) => c.json({ ok: true } as const))
    .get("/api/info", (c) =>
      c.json({
        name: APP_NAME,
        version: VERSION,
        buildDate: BUILD_DATE,
        commit: COMMIT,
        databasePath: databasePath(),
        logPath: logPath(),
        deno: Deno.version.deno,
        canPickFiles: canPickFiles(),
        startupPath: startupTarget?.path ?? null,
      }))
    /**
     * Einmalig: Der Startpfad wird beim Abholen gelöscht. Sonst springt die
     * Oberfläche bei jedem `refetch` von `/api/info` zurück auf die Datei, mit
     * der die App gestartet wurde.
     */
    .post("/api/startup/claim", (c) => {
      const target = startupTarget;
      startupTarget = null;
      return c.json({ path: target?.path ?? null, kind: target?.kind ?? null });
    })
    // ── Dokument öffnen ────────────────────────────────────────────────────
    /**
     * Nativer Öffnen-Dialog. Er läuft **auf der Deno-Seite**: Im Fenster der
     * gebauten App öffnet `<input type="file">` keinen Dialog (WKWebView ohne
     * `runOpenPanelWithParameters`). Antwort ist `{ doc: null }`, wenn der
     * Anwender abgebrochen hat — das ist kein Fehler.
     */
    .post("/api/documents/pick", async (c) => {
      const path = await pickMarkdownFile(readSetting("lastDir") || undefined);
      if (!path) return c.json({ doc: null });
      const doc = await readDocument(path);
      writeSetting("lastDir", doc.dir);
      return c.json({ doc });
    })
    /** Öffnen über einen bekannten Pfad: Verlauf, Link im Dokument, Startargument. */
    .post("/api/documents/open", check("json", OpenRequest), async (c) => {
      const { path, remember } = c.req.valid("json");
      if (!isMarkdownPath(path)) {
        throw badRequest(`Kein Markdown-Dokument: ${path}`);
      }
      const doc = await readDocument(path, { remember });
      if (remember) writeSetting("lastDir", doc.dir);
      return c.json({ doc });
    })
    // ── Verlauf ────────────────────────────────────────────────────────────
    .get("/api/documents", check("query", HistoryQuery), (c) => c.json(history.list(c.req.valid("query"))))
    .post(
      "/api/documents/:id/pin",
      check("param", IdParam),
      check("json", z.object({ pinned: z.boolean() })),
      (c) => {
        const entry = history.setPinned(c.req.valid("param").id, c.req.valid("json").pinned);
        if (!entry) throw notFound("Eintrag");
        return c.json(entry);
      },
    )
    .delete("/api/documents/:id", check("param", IdParam), (c) => {
      history.remove(c.req.valid("param").id);
      return c.json({ ok: true } as const);
    })
    /** „Verlauf leeren" lässt Angeheftetes stehen. */
    .delete("/api/documents", (c) => c.json({ removed: history.clearUnpinned() }))
    .post("/api/documents/prune", (c) => c.json({ removed: history.removeMissing() }))
    // ── Ordnerbaum ─────────────────────────────────────────────────────────
    /**
     * Arbeitsordner wählen. Wie beim Datei-Dialog läuft er auf der Deno-Seite;
     * `root: null` heißt „abgebrochen" und ist kein Fehler.
     */
    .post("/api/tree/pick", async (c) => {
      const path = await pickFolder(readSetting("workspaceDir") || readSetting("lastDir") || undefined);
      if (!path) return c.json({ tree: null });
      const tree = await scanTree(path);
      writeSetting("workspaceDir", tree.root);
      return c.json({ tree });
    })
    /**
     * Den Baum eines bekannten Ordners liefern — beim Start (gemerkter
     * Arbeitsordner) und nach jeder Meldung des Beobachters.
     *
     * Der ganze Baum in einer Antwort, nicht Ebene für Ebene: Nach dem Beschnitt
     * sind selbst große Projekte ein paar hundert Knoten, und nur so kann der
     * Filter in der Seitenleiste den **gesamten** Baum durchsuchen statt nur das
     * gerade Aufgeklappte.
     */
    .get("/api/tree", check("query", z.object({ root: z.string().min(1) })), async (c) => {
      const tree = await scanTree(c.req.valid("query").root);
      return c.json(tree);
    })
    /**
     * Wie `/api/watch`, nur für den Arbeitsordner: Wird eine Datei angelegt,
     * gelöscht oder umbenannt, meldet sich der Server und die Seitenleiste
     * liest den Baum neu ein. Was hier durchkommt, filtert `src/watch.ts` —
     * eine gespeicherte `.ts`-Datei ist keine Änderung am Baum.
     */
    .get("/api/tree/watch", check("query", z.object({ root: z.string().min(1) })), (c) => {
      const root = c.req.valid("query").root;
      return streamSSE(c, async (stream) => {
        let pending = 0;
        let wake: () => void = () => {};
        let aborted = false;
        const unsubscribe = watchTree(root, () => {
          pending++;
          wake();
        });
        stream.onAbort(() => {
          aborted = true;
          wake();
        });
        try {
          await stream.writeSSE({ event: "ready", data: root });
          while (!aborted) {
            while (pending > 0) {
              pending = 0;
              await stream.writeSSE({ event: "change", data: new Date().toISOString() });
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        } finally {
          unsubscribe();
        }
      });
    })
    // ── Beigaben (Bilder, PDFs, Videos im Dokument) ────────────────────────
    /**
     * Bilder im Markdown stehen relativ zum Dokument (`![](bilder/plan.png)`).
     * Das Webview kann keine `file://`-URL laden (andere Herkunft, von der CSP
     * ausgeschlossen) — also liefert der eigene Server sie aus.
     *
     * `serveFile` bringt Content-Type, ETag und Range-Anfragen mit; letzteres
     * ist der Unterschied zwischen „Video spielt" und „Video spult nicht".
     */
    .get(
      "/api/asset",
      check("query", z.object({ dir: z.string().min(1), ref: z.string().min(1) })),
      async (c) => {
        const { dir, ref } = c.req.valid("query");
        const target = resolveAsset(dir, ref);
        if (!await exists(target)) throw notFound(`Beigabe „${ref}“`);
        return await serveFile(c.req.raw, target);
      },
    )
    // ── Überwachung ────────────────────────────────────────────────────────
    /**
     * Server-Sent Events: Ändert sich die Datei auf der Platte, meldet der
     * Server ein `change`, und die Oberfläche lädt neu. Ein Handshake ist das
     * nicht — `new EventSource(...)` auf der einen Seite, diese Route auf der
     * anderen, und es geht durch den Vite-Proxy.
     */
    .get("/api/watch", check("query", z.object({ path: z.string().min(1) })), (c) => {
      const path = c.req.valid("query").path;
      return streamSSE(c, async (stream) => {
        let pending = 0;
        let wake: () => void = () => {};
        let aborted = false;
        const unsubscribe = watchFile(path, () => {
          pending++;
          wake();
        });
        stream.onAbort(() => {
          aborted = true;
          wake();
        });
        try {
          await stream.writeSSE({ event: "ready", data: path });
          while (!aborted) {
            while (pending > 0) {
              pending = 0;
              await stream.writeSSE({ event: "change", data: new Date().toISOString() });
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        } finally {
          unsubscribe();
        }
      });
    })
    // ── Betriebssystem ─────────────────────────────────────────────────────
    .post("/api/reveal", check("json", z.object({ path: z.string().min(1) })), async (c) => {
      await revealPath(c.req.valid("json").path);
      return c.json({ ok: true } as const);
    })
    /**
     * Ein Klick auf `https://…` im Webview würde die App-Seite *ersetzen* —
     * das Fenster zeigt danach eine fremde Webseite, ohne Zurück-Knopf. Links
     * gehen deshalb nach draußen, in den Standardbrowser.
     */
    .post("/api/open-external", check("json", z.object({ url: z.string().min(1) })), async (c) => {
      await openExternal(c.req.valid("json").url);
      return c.json({ ok: true } as const);
    })
    // ── Einstellungen ──────────────────────────────────────────────────────
    .get("/api/settings", (c) => c.json(allSettings()))
    .put(
      "/api/settings/:key",
      check("param", z.object({ key: SettingKeyEnum })),
      check("json", z.object({ value: z.unknown() })),
      (c) => {
        const { key } = c.req.valid("param");
        const parsed = SETTINGS[key].safeParse(c.req.valid("json").value);
        if (!parsed.success) throw badRequest(`Wert für "${key}" ungültig`, parsed.error.issues);
        return c.json({ key, value: writeSettingChecked(key, parsed.data) });
      },
    )
    // ── Wartung ────────────────────────────────────────────────────────────
    .post("/api/backup", async (c) => {
      const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
      const suggested = `${APP_NAME}-${stamp}.db`;
      const chosen = await pickSaveFile(suggested, join(dataDir(), "backups"));
      const target = chosen ?? join(dataDir(), "backups", suggested);
      await Deno.mkdir(dirname(target), { recursive: true });
      return c.json({ path: backupTo(target) });
    })
    .get("/api/log", async (c) => {
      flushLog();
      const path = logPath();
      const text = await Deno.readTextFile(path).catch(() => "");
      const lines = text.split("\n").filter(Boolean).slice(-300);
      return c.json({ path, lines });
    })
    .post("/api/log/reveal", async (c) => {
      flushLog();
      await revealPath(logPath());
      return c.json({ ok: true } as const);
    });

  // Statik zuletzt: alles, was keine API-Route war, kommt aus `ui/dist`.
  app.notFound(async (c) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith("/api/")) {
      return c.json({ error: { code: "not_found", message: `Kein Endpunkt: ${url.pathname}` } }, 404);
    }
    // Die index.html geht **nicht** über serveDir: sie muss durch
    // `transformHtml` laufen, sonst fehlt das App-Token im Fenster und jede
    // API-Anfrage der UI bekäme 403.
    const wantsIndex = url.pathname === "/" || url.pathname === "/index.html";
    if (!wantsIndex) {
      const response = await serveDir(c.req.raw, { fsRoot: UI_DIR, quiet: true });
      // Pfade mit Punkt sind Dateien: fehlt die Datei, bleibt es bei 404.
      if (response.status !== 404 || url.pathname.includes(".")) return response;
    }
    const html = await Deno.readTextFile(join(UI_DIR, "index.html")).catch(() => null);
    if (html === null) return c.text("ui/dist fehlt — `deno task ui:build` ausführen", 404);
    return c.html(options.transformHtml ? options.transformHtml(html) : html, 200, {
      "content-security-policy": CSP,
    });
  });

  return { app, routes };
}

/** Nur für den Typ-Export gedacht — der Client hängt nicht an der Instanz. */
export type AppType = ReturnType<typeof createApp>["routes"];
