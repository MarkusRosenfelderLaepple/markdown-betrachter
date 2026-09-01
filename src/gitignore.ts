/**
 * Ein kleiner `.gitignore`-Abgleich für den Ordnerbaum.
 *
 * Warum überhaupt: Ein Projektordner enthält neben den paar Dokumenten
 * zehntausende Dateien, die niemand sehen will — und die Liste dessen, was
 * „Müll" ist, steht bereits im Projekt. Sie erneut in der App zu pflegen wäre
 * eine zweite Wahrheit.
 *
 * **Was diese Datei kann:** die Regelformen, die in echten `.gitignore`-Dateien
 * vorkommen — `dir/` (nur Ordner), führendes `/` (an das Verzeichnis der
 * jeweiligen `.gitignore` gebunden), `*`, `?`, `[abc]`, `**`, Kommentare,
 * `\`-Maskierung und `!`-Ausnahmen mit „die letzte passende Regel gewinnt".
 * Verschachtelte `.gitignore`-Dateien gelten für ihren Unterbaum.
 *
 * **Was sie bewusst nicht kann:** `.git/info/exclude`, `core.excludesFile`,
 * `.gitattributes`, und die Feinheit, dass Git eine Ausnahme *innerhalb* eines
 * ausgeschlossenen Ordners ignoriert. Letzteres fällt hier nicht auf, weil der
 * Baumlauf in einen ausgeschlossenen Ordner gar nicht erst absteigt — das
 * Ergebnis stimmt also, nur aus einem anderen Grund.
 *
 * Ziel ist nicht Git-Treue bis in die Ecken, sondern eine aufgeräumte Liste.
 * Im Zweifel wird **angezeigt** statt versteckt: eine Datei zu viel im Baum
 * ist ein Schönheitsfehler, eine fehlende Datei ein Fehler.
 */

export interface IgnoreRule {
  /** Verzeichnis der `.gitignore`, relativ zur Wurzel — `""` für die oberste. */
  base: string;
  /** `!`-Regel: Sie nimmt wieder auf, statt auszuschließen. */
  negate: boolean;
  /** Muster endete auf `/` — es trifft nur Ordner. */
  dirOnly: boolean;
  pattern: RegExp;
}

const SPECIAL = /[.+^${}()|[\]\\]/g;

function escape(text: string): string {
  return text.replace(SPECIAL, "\\$&");
}

/** Ein Pfadsegment (`*.md`, `bild?.png`, `[abc]`) in Regex-Text übersetzen. */
function segment(source: string): string {
  let out = "";
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "*") {
      // Ein einzelner Stern bleibt innerhalb eines Segments — `a*b` trifft
      // nicht über einen Schrägstrich hinweg.
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else if (char === "[") {
      const end = source.indexOf("]", index + 1);
      if (end === -1) {
        out += "\\[";
      } else {
        const body = source.slice(index + 1, end);
        out += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`;
        index = end;
      }
    } else if (char === "\\") {
      out += escape(source[++index] ?? "\\");
    } else {
      out += escape(char);
    }
  }
  return out;
}

/**
 * Muster → Regex. `**` wird über einen Platzhalter zusammengesetzt, weil es
 * als einziges Segment über Schrägstriche hinweg trifft und deshalb den
 * Trenner *mit* verschluckt (`a/**\/b` trifft auch `a/b`).
 */
function compile(pattern: string, anchored: boolean): RegExp {
  const parts = pattern.split("/").filter((part) => part.length > 0);
  // Der Platzhalter ist ein NUL-Zeichen: Es steht in keinem Muster und kann
  // sich deshalb nicht mit maskiertem Text aus `segment()` überschneiden.
  const joined = parts.map((part) => (part === "**" ? "\0" : segment(part))).join("/");
  let body = joined
    // `**/` am Anfang oder in der Mitte: beliebig viele Segmente, auch keines.
    .replaceAll("\0/", "(?:.*/)?")
    // `/**` am Ende: alles darunter.
    .replace(/\/\0$/, "/.*");
  if (body === "\0") body = ".*";
  return new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`);
}

/**
 * Eine `.gitignore` einlesen. `base` ist ihr Verzeichnis relativ zur Wurzel des
 * Baums — die Regeln gelten nur für Pfade darunter.
 */
export function parseGitignore(text: string, base: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // Nachlaufende Leerzeichen zählen nicht, es sei denn, sie sind maskiert.
    let line = raw.replace(/(?<!\\)\s+$/, "");
    if (!line || line.startsWith("#")) continue;

    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith("\\#") || line.startsWith("\\!")) {
      line = line.slice(1);
    }
    if (!line) continue;

    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (!line) continue;

    // Ein Schrägstrich *innerhalb* des Musters bindet es an das Verzeichnis der
    // `.gitignore`; ein Muster ohne Schrägstrich trifft in jeder Tiefe.
    const anchored = line.includes("/") && !(line.startsWith("**/") && line.indexOf("/", 3) === -1);
    if (line.startsWith("/")) line = line.slice(1);
    if (!line) continue;

    rules.push({ base, negate, dirOnly, pattern: compile(line, anchored) });
  }
  return rules;
}

/**
 * Gilt der Pfad als ignoriert? `path` ist relativ zur Wurzel des Baums, ohne
 * führenden Schrägstrich. Die letzte passende Regel entscheidet — deshalb wird
 * von hinten gelesen und beim ersten Treffer abgebrochen.
 */
export function isIgnored(rules: readonly IgnoreRule[], path: string, isDirectory: boolean): boolean {
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index];
    if (rule.dirOnly && !isDirectory) continue;
    let candidate = path;
    if (rule.base) {
      if (!path.startsWith(`${rule.base}/`)) continue;
      candidate = path.slice(rule.base.length + 1);
    }
    if (rule.pattern.test(candidate)) return !rule.negate;
  }
  return false;
}
