/**
 * Die zwei Namen, über die sich Server (`src/security.ts`) und UI beim
 * App-Token verständigen. Eigene Datei, damit der Client nichts aus `src/`
 * importieren muss, das Deno-APIs anfasst.
 */
export const TOKEN_HEADER = "x-app-token";
export const TOKEN_META = "app-token";
