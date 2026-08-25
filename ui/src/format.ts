/**
 * Formatierung an genau einer Stelle.
 *
 * Zwei Gründe: `Intl`-Instanzen sind teuer (deshalb einmal anlegen und
 * wiederverwenden), und wenn jede Komponente selbst formatiert, stehen am Ende
 * drei verschiedene Schreibweisen für dasselbe Datum auf einer Seite.
 */
import { formatDistanceToNowStrict, isValid, parseISO } from "date-fns";
import { de } from "date-fns/locale";

const LOCALE = "de-DE";

const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: "short", timeStyle: "short" });

export const fmt = {
  int: (value: number) => integer.format(value),

  dateTime: (value: string | Date | null | undefined) => {
    if (!value) return "–";
    const date = typeof value === "string" ? new Date(value) : value;
    return Number.isNaN(date.getTime()) ? String(value) : dateTime.format(date);
  },

  /**
   * Abstand in Worten („vor 2 Monaten") über date-fns mit deutschem Locale.
   * `Intl.RelativeTimeFormat` allein kann das nicht: Es formatiert eine
   * *vorgegebene* Einheit, sucht sie aber nicht aus.
   */
  relative: (isoDate: string) => {
    const target = parseISO(isoDate);
    if (!isValid(target)) return isoDate;
    return formatDistanceToNowStrict(target, { addSuffix: true, locale: de });
  },

  bytes: (value: number) => {
    const units = ["B", "kB", "MB", "GB"];
    let size = value;
    let unit = 0;
    while (size >= 1000 && unit < units.length - 1) {
      size /= 1000;
      unit++;
    }
    return `${unit === 0 ? integer.format(size) : decimal.format(size)} ${units[unit]}`;
  },

  /**
   * Pfad fürs Auge kürzen: `~/Projekte/…/notizen` statt der vollen Zeile. Der
   * vollständige Pfad steht im `title`-Attribut daneben.
   */
  shortPath: (path: string, maxParts = 3) => {
    const parts = path.split("/").filter(Boolean);
    const tail = parts.slice(-maxParts).join("/");
    return parts.length > maxParts ? `…/${tail}` : `/${tail}`;
  },
};
