/**
 * Protokoll in Datei *und* Konsole.
 *
 * Warum die Datei zwingend ist: In der ausgelieferten App gibt es keine
 * Konsole, in die der Anwender schauen könnte. Ohne Datei ist die Frage
 * „was stand da genau?" nicht beantwortbar. Der Menüpunkt/Knopf
 * „Protokoll anzeigen" in der Einstellungsansicht öffnet genau diese Datei.
 */
import { ConsoleHandler, getLogger, RotatingFileHandler, setup } from "@std/log";
import { dirname } from "@std/path";
import { logPath } from "./paths.ts";

let ready = false;

export function setupLog(level: "DEBUG" | "INFO" = "INFO"): void {
  if (ready) return;
  ready = true;
  const filename = logPath();
  Deno.mkdirSync(dirname(filename), { recursive: true });

  setup({
    handlers: {
      console: new ConsoleHandler("DEBUG", {
        formatter: (record) => `${record.levelName.padEnd(8)} ${record.msg}`,
      }),
      file: new RotatingFileHandler(level, {
        filename,
        maxBytes: 2 * 1024 * 1024,
        maxBackupCount: 5,
        formatter: (record) =>
          JSON.stringify({
            time: record.datetime.toISOString(),
            level: record.levelName,
            msg: record.msg,
            args: record.args.length ? record.args : undefined,
          }),
      }),
    },
    loggers: { default: { level: "DEBUG", handlers: ["console", "file"] } },
  });

  // Der Dateihandler puffert. Ohne regelmäßiges Flush fehlen genau die Zeilen,
  // die man nach einem Absturz braucht. `unref` verhindert, dass der Timer den
  // Prozess am Leben hält.
  const timer = setInterval(flushLog, 1000);
  Deno.unrefTimer(timer);
}

export function flushLog(): void {
  try {
    for (const handler of getLogger().handlers) {
      (handler as { flush?: () => void }).flush?.();
    }
  } catch { /* Datei kann beim Rotieren kurz weg sein */ }
}

/**
 * Immer über diese Funktionen protokollieren, nie über eine gespeicherte
 * Logger-Instanz: `setup()` ersetzt den Logger, eine vor `setupLog()`
 * geholte Referenz schreibt danach ins Leere.
 */
export const log = {
  debug: (msg: string, ...args: unknown[]) => getLogger().debug(msg, ...args),
  info: (msg: string, ...args: unknown[]) => getLogger().info(msg, ...args),
  warn: (msg: string, ...args: unknown[]) => getLogger().warn(msg, ...args),
  error: (msg: string, ...args: unknown[]) => getLogger().error(msg, ...args),
};

export { logPath };
