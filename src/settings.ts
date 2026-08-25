/**
 * Key-Value-Einstellungen, schemavalidiert.
 *
 * Jede zweite App braucht „letztes Verzeichnis", „Theme", „API-Endpunkt".
 * Der Wert liegt als JSON in einer Textspalte und wird beim Lesen durch das
 * Schema aus `shared/schema.ts` geschickt: Ein kaputter oder veralteter
 * Eintrag ergibt den Vorgabewert, nie einen Laufzeitfehler.
 */
import { type SettingKey, SETTINGS, type SettingValue } from "../shared/schema.ts";
import { getDb } from "./db.ts";
import { log } from "./log.ts";

export function readSetting<K extends SettingKey>(key: K): SettingValue<K> {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  const schema = SETTINGS[key];
  if (!row) return schema.parse(undefined) as SettingValue<K>;
  try {
    const parsed = schema.safeParse(JSON.parse(row.value));
    if (parsed.success) return parsed.data as SettingValue<K>;
    log.warn(`Einstellung "${key}" ungültig, Vorgabe wird verwendet`, parsed.error.issues);
  } catch (error) {
    log.warn(`Einstellung "${key}" ist kein JSON, Vorgabe wird verwendet`, String(error));
  }
  return schema.parse(undefined) as SettingValue<K>;
}

export function writeSetting<K extends SettingKey>(key: K, value: SettingValue<K>): SettingValue<K> {
  const checked = SETTINGS[key].parse(value) as SettingValue<K>;
  getDb()
    .prepare(
      "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, JSON.stringify(checked));
  return checked;
}

/**
 * Für den generischen Endpunkt `PUT /api/settings/:key`: Schlüssel und Wert
 * sind dort erst zur Laufzeit bekannt, das Typsystem kann die Verbindung
 * zwischen beiden nicht führen. Die Prüfung übernimmt das Schema.
 */
export function writeSettingChecked(key: SettingKey, value: unknown): unknown {
  const checked = SETTINGS[key].parse(value);
  getDb()
    .prepare(
      "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, JSON.stringify(checked));
  return checked;
}

export function allSettings(): { [K in SettingKey]: SettingValue<K> } {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    out[key] = readSetting(key);
  }
  return out as { [K in SettingKey]: SettingValue<K> };
}
