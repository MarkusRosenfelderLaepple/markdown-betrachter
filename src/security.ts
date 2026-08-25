/**
 * Absicherung der lokalen API.
 *
 * Zwei Befunde aus dem Review, beide hier behandelt:
 *
 * 1. `Deno.serve({ port })` ohne `hostname` hört auf **allen** Schnittstellen.
 *    Gebunden wird deshalb in `main.ts` explizit auf 127.0.0.1.
 * 2. Auch auf Loopback kann jeder Prozess des Rechners die API ansprechen —
 *    insbesondere jede Webseite im Browser, die die Portnummer kennt. Dagegen:
 *    ein Zufallstoken pro Start, das nur im ausgelieferten HTML steht, plus
 *    Prüfung des `Origin`-Headers.
 *
 * Grenze der Maßnahme, bewusst benannt: Ein *anderes lokales Programm* kann
 * `/` abrufen und das Token aus dem HTML lesen. Gegen fremde Webseiten hilft
 * das Token trotzdem, weil der Browser denen das Lesen der Antwort verbietet
 * (CORS) — und genau das ist der realistische Angriffsweg.
 */
import { createMiddleware } from "hono/factory";
import { AppError } from "../shared/errors.ts";
import { log } from "./log.ts";

import { TOKEN_HEADER, TOKEN_META } from "../ui/src/token.ts";

export const APP_TOKEN = crypto.randomUUID();
export { TOKEN_HEADER, TOKEN_META };

/** Im Entwicklungslauf liefert Vite das HTML aus — dort kann kein Token drinstehen. */
export const isDesktop = Deno.env.get("DENO_SERVE_ADDRESS") !== undefined;

const DEV_ORIGINS = ["http://localhost:5273", "http://127.0.0.1:5273"];

export const guard = createMiddleware(async (c, next) => {
  const origin = c.req.header("origin");
  if (origin) {
    const host = c.req.header("host");
    const sameOrigin = host !== undefined &&
      (origin === `http://${host}` || origin === `https://${host}`);
    if (!sameOrigin && !DEV_ORIGINS.includes(origin)) {
      log.warn(`Anfrage mit fremdem Origin abgelehnt: ${origin}`);
      throw new AppError("forbidden", "Fremder Origin");
    }
  }
  if (isDesktop) {
    const token = c.req.header(TOKEN_HEADER) ?? new URL(c.req.url).searchParams.get("token");
    if (token !== APP_TOKEN) throw new AppError("forbidden", "Ungültiges oder fehlendes App-Token");
  }
  await next();
});

/** Setzt das Token als `<meta>` in das ausgelieferte HTML. */
export function injectToken(html: string): string {
  const meta = `<meta name="${TOKEN_META}" content="${APP_TOKEN}" />`;
  return html.includes("</head>") ? html.replace("</head>", `  ${meta}\n  </head>`) : `${meta}${html}`;
}
