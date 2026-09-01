# UI-Konventionen dieser App

Destillat der laepple-Design-Guidelines, reduziert auf das, was **ohne** Tailwind, DaisyUI, i18n und die
`@laepple/*`-Komponenten gilt. Die Regeln stecken bereits in `ui/src/styles.css` und
`ui/src/components/atoms.tsx` — das hier ist die Begründung dazu.

## Die zehn Regeln

1. **Nur Tokens, keine Literalfarben.** Jede Farbe kommt aus einer CSS-Variable (`var(--brand)`,
   `var(--muted)`, `var(--red)`). Wer `#3b82f6` in eine Komponente schreibt, bricht Dark Mode und Theming.
2. **Radien nur aus der Leiter.** `--r-xs` 6 · `--r-sm` 9 · `--r` 12 · `--r-lg` 16 · `--r-xl` 22 · `--r-pill`.
   Ein neuer Wert daneben ist fast immer ein Denkfehler — eine der sechs Stufen passt.
3. **Tiefe statt Trennstriche, Rahmen nach innen.** Container tragen eine Stufe `--e1` … `--e4`; der Rahmen
   sitzt als `inset 0 0 0 1px var(--border)` **im** Schatten. Grund: Ein echter `border` liegt außerhalb des
   Radius und ragt an runden Ecken als Zacke heraus. Aus demselben Grund sind Trennlinien in Listen
   Geschwister-`inset`s (`.side-item`, `.tree-row`, `.toc-item`) und Statusstreifen `inset 3px 0 0 <Farbe>`.
   Echter `border` bleibt nur, wo er inhaltlich gebraucht wird: gestrichelt (`.dropzone`) und wo eine
   Komponente die Farbe per Inline-Style setzt.
4. **Glas nur an der Anwendung, nicht am Dokument.** `backdrop-filter` steht auf Kopfzeile, Seitenleisten,
   Dialogen, Menüs, Karten und der Suchleiste. **Nicht** auf Listenzeilen — Baum und Verzeichnis haben schnell
   dreistellig viele, und das wären genauso viele Unschärfeebenen pro Bild; die bekommen eine durchsichtige
   Füllung ohne Filter. Und **nicht** auf dem Dokumentblatt: siehe unten, „Die eine Ausnahme". Glas braucht
   außerdem immer etwas Farbiges dahinter — der Verlauf auf dem `body` ist Voraussetzung, nicht Zierde, und
   `.shell` darf deshalb keinen eigenen Hintergrund setzen.
5. **Drei Flächenreihen, klar getrennt.** `--panel` … `--panel-3` sind deckend (Dokumentblatt, hinter Häkchen,
   Bildflächen, `color: var(--panel)` in Toasts). `--glass*` sind durchsichtig und wollen einen `--blur`.
   `--well` ist die _vertiefte_ Fläche (Rinne des Umschalters, Codeblock, Vorspann) — eigene Reihe, weil
   `--glass-soft` aufhellt und eine Wanne abdunkeln muss.
6. **Status über Farbe, konsistent.** Grün = erledigt/erfolgreich · Blau = Info/Anzahl · Amber = offen/Warnung
   · Rot = destruktiv/überfällig · Grau = inaktiv.
7. **Icons: nur Lucide, keine Emojis.** Größen 12 px (in `btn.icon`), 14–15 px (Zeilen, Buttons), 16–20 px
   (Kartenköpfe, Leerzustände). Icon-only-Buttons brauchen `title`.
8. **Dark Mode ist abgeleitet, nicht parallel.** Nur die Tokens unter `:root[data-theme="dark"]` werden neu
   belegt — keine zweite Regelmenge, keine `.dark`-Varianten in Komponenten.
9. **Typografie sparsam.** Systemschrift (`-apple-system` …), 14 px Standard (dichte UI), 11–12 px für
   Meta/Badges, 24 px für die Seitenüberschrift. Zahlen mit `font-variant-numeric: tabular-nums` (Klasse
   `.num`), damit Werte nicht springen. Versalien mit Sperrung bleiben den **kleinsten** Etiketten
   (`.side-head strong`, `.side-label`, `.field > label`, `.stat .label`, `.menu-label`) — Überschriften
   tragen sie nicht mehr, das war der Hauptgrund für den altbackenen Eindruck.
10. **Jedes Fenster ist schmal genug.** Ein Desktop-Fenster lässt sich auf 400 px ziehen — das ist kein
    Sonderfall, sondern der Normalfall. Nichts darf horizontal überlaufen; wo es eng wird, wird gestapelt.

## Was das Template mitbringt

| Baustein       | Klassen / Komponenten                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Shell          | `.shell`, `.sidebar`, `.nav-item`, `.main`, `.topbar`, `.content`                                              |
| Container      | `.card` (+ `.tight`), `.card-head`, `.grid`                                                                    |
| Steuerelemente | `.btn` (+ `.primary` `.ghost` `.danger` `.icon`), `.input`, `.textarea`, `.select`, `.field`, `.seg`, `.check` |
| Statusanzeige  | `.badge`, `.dot`, `.progress` (+ `.green` `.accent` `.violet` `.thin`), `.stat`                                |
| Layout         | `.grid` (+ `.auto` `.auto-sm` `.auto-lg`), `.split` (+ `.even`), `.two-col`                                    |
| Hilfsklassen   | `.row` (+ `.nowrap`), `.grow`, `.muted`, `.tiny`, `.num`, `.empty`, `.kbd`, `.toast`, `.spin`                  |
| React-Atome    | `Card`, `Modal`, `Segmented`, `Empty`, `ProgressBar`, `ProgressRing`                                           |

Buttons sind Pillen, die beim Hover einen Pixel steigen (`translateY(-1px)`) und beim `:active` zurückkommen.
Der Hauptknopf bleibt dabei **gefüllt und wird heller** — vorher klappte er auf weiß mit blauem Text um, und
damit sah die wichtigste Aktion im Moment der Berührung schwächer aus als im Ruhezustand. `:disabled` bedeutet
45 % Deckkraft und `cursor: not-allowed`.

## Bewusst nicht übernommen

Diese Punkte der Original-Guidelines gelten hier **nicht** — sie hängen an der laepple-Plattform und würden im
Template nur in die Irre führen:

- Tailwind-/DaisyUI-Klassen und der ganze `btn-primary`-Disabled-Sonderfall
- `GlassSelect`/`GlassSelectString` statt `<select>`, `DataTable`, `CardGrid`, `SearchBar`
- i18n-Pflicht (`t("namespace.key")`) — lokale Ein-Nutzer-App, Strings stehen direkt im JSX
- Atomic-Design-Pods mit Barrel-Exports (für ~15 Komponenten Overhead; flaches `components/`-Verzeichnis
  genügt)
- Generierte API-Typen und typisierter Client — hier reicht `shared/types.ts` plus `fetch`

Farbwerte der Corporate-Palette (`#0052a3` Blau, `#f46610` Orange) sind als `--brand` und `--accent`
übernommen, damit Eigenbau-Apps optisch zur restlichen Werkzeugkiste passen. Für ein neutrales Projekt einfach
die zwei Variablen in `:root` austauschen.

## Responsive ohne Media-Query-Wildwuchs

Vier Bausteine reichen für praktisch jedes Layout in einer Desktop-App:

| Situation                                  | Lösung                                                     |
| ------------------------------------------ | ---------------------------------------------------------- |
| Gleichrangige Karten (Kennzahlen, Kacheln) | `.grid auto` / `.auto-sm` (150 px) / `.auto-lg` (320 px)   |
| Haupt- + Nebenspalte (Liste + Fortschritt) | `.split` — stapelt unter 900 px, Verhältnis über `--split` |
| Zwei gleich breite Spalten                 | `.split even`                                              |
| Element soll den Restplatz nehmen          | `.grow` (`flex: 1 1 0` + `min-width: 0`)                   |

Dazu die vier Regeln, die die eigentliche Arbeit machen:

1. **`minmax(0, 1fr)` statt `1fr`** in jedem Grid, das Inhalt mit eigener Mindestbreite enthält. `1fr` ist
   `minmax(auto, 1fr)` — die Spalte wächst auf die `min-content`-Breite ihres Inhalts und schiebt das Layout
   auseinander. Genau das erzeugte in `.shell` die App-weite horizontale Scrollbar.
2. **`min-width: 0` auf alles, was schrumpfen soll.** Flex- und Grid-Kinder haben `min-width: auto`, also
   verhindert langer Text jedes Schrumpfen. Steckt im Template in `.card`, `.row`, `.field`, `.grow`,
   `.input`, `.seg`.
3. **`auto-fit` + `minmax(min(100%, X), 1fr)` statt Media Query.** Die Spaltenzahl folgt der Containerbreite,
   und `min(100%, X)` erlaubt auch unterhalb von X px noch eine einzelne Spalte (ohne das Konstrukt entsteht
   dort Überlauf).
4. **Umbrechen statt abschneiden.** `.row` hat `flex-wrap: wrap`, langer Text `overflow-wrap: anywhere`. Wo
   ein Paar zusammenbleiben muss (Label + Wert), gibt es `.row.nowrap`.

Media Queries bleiben für die Dinge, die sich strukturell ändern: Seitenleiste 232 → 196 → 56 px
(Icon-Schiene, Labels via `.nav-text` ausgeblendet) und Innenabstände 28 → 18 → 12 px.

## Charts

ECharts erst bei Bedarf dazunehmen (`"echarts": "npm:echarts@^6.0.0"`). Farben nie hart codieren, sondern die
Tokens zur Laufzeit lesen:

```ts
const style = getComputedStyle(document.documentElement);
const brand = style.getPropertyValue("--brand").trim();
```

Damit folgen Diagramme automatisch dem Theme. Wrapper-Muster (init, `ResizeObserver`, `dispose`) siehe README,
Abschnitt „UI-Hinweise".

## Nachträglich dazugekommene Klassen

Diese Klassen stehen in `ui/src/styles.css` und gehören zu den Bausteinen aus Stufe 1 (siehe README-Kapitel zu
Dateien, Jobs und Fehlerbehandlung):

| Klasse                                   | Wofür                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `.toasts` + `.toast.success`/`.error`    | Toast-Stapel unten mittig; verwaltet vom Store, nicht von Komponenten                                           |
| `.toast-detail`                          | kopierbarer Fehlertext im Toast (monospace, scrollbar)                                                          |
| `.dropzone`, `.over`, `.busy`            | Ablegefläche für Dateien inklusive Ziehen-Zustand                                                               |
| `.table-wrap` + `.table`                 | schlichte Datentabelle mit klebender Kopfzeile für Vorschauen                                                   |
| `.jobs`, `.job`, `.job-state`            | Vorgangsliste mit Zustandsfarbe (grün/rot/amber/brand)                                                          |
| `.log`                                   | Protokoll- und Stacktrace-Blöcke                                                                                |
| `.kv`                                    | Schlüssel-Wert-Liste („Über"-Block)                                                                             |
| `.search`                                | Eingabefeld mit Lupe im Feld (Icon absolut, `padding-left` am Input)                                            |
| `.side-tabs`, `.side-body`               | Umschaltung Verlauf ↔ Ordner oben in der linken Leiste, Inhalt darunter                                         |
| `.tree-row`, `.tree-name`, `.tree-twist` | Zeile des Ordnerbaums; die Einrückung hängt an der Variablen `--depth`, nicht an einer Klasse pro Ebene         |
| `.side-empty-state`                      | Leerzustand einer Seitenleiste, bei dem der Knopf der Hauptinhalt ist                                           |
| `a.nav-item`                             | Navigationseinträge sind mit TanStack Router `<Link>`-Elemente (`<a>`) — Unterstreichung und Farbe zurücksetzen |

Neue Tabellenanforderungen (Sortieren, Spaltenwahl, Gruppieren) nicht in dieses CSS hineinschrauben, sondern
`@tanstack/react-table` dazunehmen: kopflos, das CSS hier bleibt gültig.

## Die eine Ausnahme: der Dokumentbereich

Alles oben Genannte gilt für die **Anwendung** — Kopfzeile, Seitenleisten, Dialoge. Der gerenderte
Markdown-Text (`.markdown` in `ui/src/styles.css`) folgt bewusst anderen Regeln: großzügige Zeilenhöhe,
begrenzte Zeilenlänge (`--doc-width`, umschaltbar), Überschriftenhierarchie mit Trennlinien. Ein Dokument ist
kein Werkzeugfenster, und dichte Tool-Typografie macht längere Texte unlesbar.

**Das Blatt ist Papier, kein Glas.** `.doc` ist eine **deckende** `--panel`-Fläche mit `--r-xl` und `--e2`,
die über dem Verlauf liegt. Das ist die eine Stelle, an der der Effekt bewusst aufhört: Ein langer Fließtext
über einer verwischten Fläche liest sich schlechter, und Lesen ist der einzige Zweck dieser Spalte. In der
Leseansicht „weit" fällt das Blatt weg (`margin`, Radius und Schatten auf 0) — bei voller Fensterbreite wäre
es nur noch ein Kasten um das Fenster, und dann zählt die Fläche statt der Metapher. Beim Drucken fällt es aus
demselben Grund weg.

Was auch dort gilt: **nur Tokens** (auch die Syntaxhervorhebung hängt an `--brand`, `--green`, `--accent` —
deshalb kein fertiges highlight.js-Theme) und **Rahmen nach innen** statt außen. Die Schriftgröße hängt an
einer einzigen Variablen `--doc-scale`, die das Menü setzt.

Zwei Dinge im Dokument folgen absichtlich **nicht** Regel 3:

- Die Linien unter `h1`/`h2` bleiben. In einem Dokument ordnen sie die Hierarchie, anders als in der
  Anwendung, wo Trennstriche durch Tiefe ersetzt wurden. Sie laufen über `border-image` nach rechts aus, statt
  hart an der Spaltenkante zu enden.
- Tabellen im Dokument stehen auf `border-collapse: separate` mit `border-spacing: 0`. Bei `collapse` teilen
  sich die Zellen die Kanten und der Radius am Tabellenrahmen greift nicht; die Zellenlinien sind deshalb
  einseitig (`inset -1px -1px 0`), und letzte Spalte und letzte Zeile nehmen ihre Linie wieder heraus, damit
  dort nicht zwei auf einem Pixel liegen.

Die Treffermarkierung der Suche bleibt rechteckig: `::highlight()` nimmt nur Farbe, Hintergrund,
Unterstreichung und Textschatten an — ein `border-radius` würde stillschweigend verworfen.
