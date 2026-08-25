/**
 * Eine Fehlerform für die ganze App: `{ error: { code, message, details? } }`.
 * Erzwungen durch `app.onError()` in `src/api.ts`, angezeigt durch
 * `ui/src/api.ts` + Toaster. Die UI hat damit genau eine Stelle zum Anzeigen.
 */
export const ERROR_CODES = [
  "bad_request", // Validierung fehlgeschlagen
  "not_found",
  "conflict",
  "forbidden", // Token-/Origin-Prüfung
  "io_error", // Datei nicht lesbar, Pfad außerhalb erlaubter Wurzel
  "upstream_error", // Fremd-API
  "internal", // alles Unerwartete
] as const;

export type ErrorCode = typeof ERROR_CODES[number];

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  io_error: 422,
  upstream_error: 502,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const notFound = (what: string) => new AppError("not_found", `${what} nicht gefunden`);
export const badRequest = (message: string, details?: unknown) =>
  new AppError("bad_request", message, details);

/** Nimmt beliebiges `unknown` aus einem `catch` und macht eine Fehlerform daraus. */
export function toErrorBody(error: unknown): { body: ErrorBody; status: number } {
  if (error instanceof AppError) return { body: error.toBody(), status: error.status };
  const message = error instanceof Error ? error.message : String(error);
  return { body: { error: { code: "internal", message } }, status: 500 };
}
