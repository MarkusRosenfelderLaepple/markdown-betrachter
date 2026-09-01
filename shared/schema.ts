/**
 * Ein Schema, beide Seiten.
 *
 * Alles, was zwischen Server und Oberfläche fließt, steht hier — der
 * TypeScript-Typ wird daraus abgeleitet, nie umgekehrt. `await res.json() as
 * Doc` wäre eine Lüge gegenüber dem Typsystem: Zur Laufzeit prüft niemand
 * etwas. Hier prüft das Schema.
 */
import { z } from "zod";

// ── Dokumente ───────────────────────────────────────────────────────────────

/** Erlaubte Endungen beim Öffnen. Alles andere ist kein Markdown. */
export const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd", ".mdx", ".txt"] as const;

/**
 * Endungen, die der **Ordnerbaum** zeigt — `.txt` fehlt hier mit Absicht.
 * Beim Öffnen einer einzelnen Datei ist es richtig, sie anzubieten; in einem
 * Projektordner wäre die Liste danach voll mit `requirements.txt` und
 * `LICENSE.txt`, und um die geht es beim Durchblättern von Dokumentation nicht.
 */
export const TREE_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd", ".mdx"] as const;

export const Encoding = z.enum(["utf-8", "windows-1252"]);
export type Encoding = z.infer<typeof Encoding>;

/**
 * Ein Eintrag der Verlaufsliste. Bewusst ohne Inhalt: Die Seitenleiste zeigt
 * hunderte Einträge, der Inhalt kommt erst beim Öffnen dazu (`Doc`).
 */
export const HistoryEntry = z.object({
  id: z.number().int().positive(),
  path: z.string(),
  /** Dateiname mit Endung — `basename(path)`. */
  name: z.string(),
  /** Verzeichnis, für die zweite Zeile in der Seitenleiste. */
  dir: z.string(),
  /** Erste Überschrift der Datei, sonst der Dateiname ohne Endung. */
  title: z.string(),
  openedAt: z.string(),
  openCount: z.number().int().nonnegative(),
  pinned: z.boolean(),
  /** Beim Anzeigen geprüft: Pfade veralten (verschoben, USB-Stick weg). */
  exists: z.boolean(),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

/** Ein geöffnetes Dokument samt Inhalt. */
export const Doc = z.object({
  id: z.number().int().positive(),
  path: z.string(),
  name: z.string(),
  dir: z.string(),
  title: z.string(),
  text: z.string(),
  size: z.number().int().nonnegative(),
  /** Änderungszeit der Datei — der Überwacher meldet damit echte Änderungen. */
  modifiedAt: z.string(),
  encoding: Encoding,
  /** Warum diese Kodierung gewählt wurde — steht in der Fußzeile, wenn es nicht UTF-8 war. */
  encodingReason: z.string(),
});
export type Doc = z.infer<typeof Doc>;

export const OpenRequest = z.object({
  path: z.string().min(1),
  /** `false` beim automatischen Neuladen: Das ist kein neues „Öffnen". */
  remember: z.boolean().default(true),
});
export type OpenRequest = z.infer<typeof OpenRequest>;

export const HistoryQuery = z.object({
  /** Suchtext über Titel, Dateiname und Pfad. */
  q: z.string().default(""),
  limit: z.coerce.number().int().positive().max(500).default(200),
});
export type HistoryQuery = z.infer<typeof HistoryQuery>;

// ── Ordnerbaum ──────────────────────────────────────────────────────────────

/**
 * Ein Knoten des Ordnerbaums.
 *
 * Der Typ ist rekursiv, das Schema deshalb ausdrücklich annotiert — Zod kann
 * den Typ eines `z.lazy()` nicht selbst herleiten. Geprüft wird der Baum nur
 * auf dem Weg *aus* der App heraus (Antworttyp); hereinkommende Daten sind
 * immer nur ein Pfad.
 */
export interface TreeNode {
  kind: "dir" | "file";
  /** Anzeigename. Bei zusammengezogenen Ordnerketten mehrteilig: `docs/adr`. */
  name: string;
  /** Absoluter Pfad — damit wird geöffnet und im Finder gezeigt. */
  path: string;
  /** Pfad relativ zur Wurzel — der Filter sucht darin, und er ist der Schlüssel. */
  rel: string;
  children?: TreeNode[];
}

export const TreeNode: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({
    kind: z.enum(["dir", "file"]),
    name: z.string(),
    path: z.string(),
    rel: z.string(),
    children: z.array(TreeNode).optional(),
  })
);

export const TreeResult = z.object({
  /** Absoluter Pfad der Wurzel. */
  root: z.string(),
  /** Name der Wurzel für die Kopfzeile der Seitenleiste. */
  name: z.string(),
  nodes: z.array(TreeNode),
  /** Anzahl gefundener Dokumente. */
  files: z.number().int().nonnegative(),
  /** Obergrenze erreicht — die Seitenleiste sagt es dann, statt still zu kürzen. */
  truncated: z.boolean(),
});
export type TreeResult = z.infer<typeof TreeResult>;

// ── Einstellungen ───────────────────────────────────────────────────────────

/**
 * Registry der erlaubten Schlüssel. Jeder Wert hat ein Schema — damit ist eine
 * per Hand editierte oder aus einer alten Version stammende Zeile in der
 * `settings`-Tabelle nie ein Laufzeitfehler, sondern fällt auf die Vorgabe.
 */
export const SETTINGS = {
  theme: z.enum(["system", "light", "dark"]).default("system"),
  /** Startverzeichnis des Öffnen-Dialogs. */
  lastDir: z.string().default(""),
  /** Lesebreite des Textes. `weit` nutzt das ganze Fenster (breite Tabellen). */
  reading: z.enum(["schmal", "normal", "weit"]).default("normal"),
  fontScale: z.number().min(0.8).max(1.6).default(1),
  /** Datei überwachen und bei Änderung neu laden. */
  autoReload: z.boolean().default(true),
  showToc: z.boolean().default(true),
  /** Linke Seitenleiste sichtbar (⌘1) — sie zeigt Verlauf **oder** Ordnerbaum. */
  showHistory: z.boolean().default(true),
  /** Welcher der beiden Bereiche in der linken Leiste steht. */
  sidebar: z.enum(["history", "tree"]).default("history"),
  /**
   * Der geöffnete Ordner. Er überlebt den Neustart — ein Arbeitsordner ist
   * nichts, was man jeden Morgen neu heraussucht. Leer heißt: keiner offen.
   */
  workspaceDir: z.string().default(""),
  windowBounds: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    x: z.number().int(),
    y: z.number().int(),
  }).nullable().default(null),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<typeof SETTINGS[K]>;
export type Settings = { [K in SettingKey]: SettingValue<K> };
export const SettingKeyEnum = z.enum(Object.keys(SETTINGS) as [SettingKey, ...SettingKey[]]);

// ── App ─────────────────────────────────────────────────────────────────────

export const AppInfo = z.object({
  name: z.string(),
  version: z.string(),
  buildDate: z.string(),
  commit: z.string(),
  databasePath: z.string(),
  logPath: z.string(),
  deno: z.string(),
  /**
   * Ob der Server einen nativen Öffnen-Dialog anbieten kann. Im Browser-Lauf
   * erschiene der Dialog auf dem falschen Rechner — die Oberfläche fragt
   * deshalb, statt es anzunehmen.
   */
  canPickFiles: z.boolean(),
  /** Pfad aus `Deno.args` („Öffnen mit …") — beim Start einmal auszuwerten. */
  startupPath: z.string().nullable(),
});
export type AppInfo = z.infer<typeof AppInfo>;
