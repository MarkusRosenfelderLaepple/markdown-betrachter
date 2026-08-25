/**
 * Version, Baudatum und Commit für den „Über"-Dialog und für Fehlermeldungen
 * aus dem Kollegenkreis. Im Entwicklungslauf steht hier „dev"; der Build kann
 * die Werte über Umgebungsvariablen setzen
 * (`MARKDOWN_BETRACHTER_BUILD_DATE`, `MARKDOWN_BETRACHTER_COMMIT`).
 */
export const VERSION = "0.1.0";
export const BUILD_DATE = Deno.env.get("MARKDOWN_BETRACHTER_BUILD_DATE") ?? "dev";
export const COMMIT = Deno.env.get("MARKDOWN_BETRACHTER_COMMIT") ?? "dev";
