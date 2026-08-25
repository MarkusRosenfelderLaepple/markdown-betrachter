# Markdown-Betrachter

Ein schneller Betrachter für Markdown-Dateien: öffnen, lesen, weiterklicken. Kein Editor, keine Cloud, keine
Anmeldung — eine lokale Desktop-App auf dem [Deno Desktop Stack](../desktop-apps-stack/README.md) (Deno 2.9
`deno desktop`, React 19, Vite 7, SQLite über `node:sqlite`).

```bash
deno task install:all   # Abhängigkeiten in allen drei Projekten
deno task api           # Terminal 1: API auf :8777
deno task ui:dev        # Terminal 2: Vite mit HMR auf :5273  → im Browser entwickeln
deno task check         # fmt + lint + check in allen drei Projekten
deno task test          # Repository- und API-Tests
deno task start         # Bundle bauen und Fenster öffnen
```

## Was er kann

- **Markdown vollständig:** GFM (Tabellen, Aufgabenlisten, Durchstreichung), Fußnoten, YAML-Vorspann als
  Kopftabelle, Syntaxhervorhebung mit Kopierknopf an jedem Codeblock.
- **Mermaid-Diagramme** und **KaTeX-Formeln** (`$…$` im Text, `$$…$$` abgesetzt).
- **Bilder, PDFs, Videos** relativ zum Dokument (`![](bilder/plan.png)`).
- **Verlauf** in der linken Seitenleiste: durchsuchbar, anheftbar, mit „im Finder zeigen" und „entfernen".
- **Inhaltsverzeichnis** rechts, das beim Scrollen mitläuft.
- **Live-Aktualisierung:** Speichern im Editor aktualisiert die Vorschau, ohne die Leseposition zu verlieren.
- **Verweise zwischen Dokumenten:** ein Klick auf `[Anhang](./anhang.md)` öffnet die Datei im Betrachter, ⌘←
  führt zurück. Externe Links gehen in den Standardbrowser.
- Hell/Dunkel, Lesebreite, Schriftgröße, Suchen im Dokument, Drucken bzw. als PDF sichern.
- **„Öffnen mit …":** `open -a Markdown-Betrachter.app --args datei.md` — läuft die App schon, zeigt das
  vorhandene Fenster die Datei.

## Tastenkürzel

| Kürzel             | Wirkung                                          |
| ------------------ | ------------------------------------------------ |
| `⌘O`               | Datei öffnen                                     |
| `⌘R`               | Neu laden                                        |
| `⌘F`               | Im Dokument suchen                               |
| `⌘1` / `⌘2`        | Verlauf / Inhaltsverzeichnis ein- und ausblenden |
| `⌘←` / `⌘→`        | Zurück / vorwärts zwischen Dokumenten            |
| `⌘+` / `⌘-` / `⌘0` | Schrift größer / kleiner / normal                |
| `⌘⇧L`              | Hell / Dunkel                                    |
| `⌘⌥R`              | Im Finder zeigen                                 |
| `⌘P`               | Drucken oder als PDF sichern                     |

Alle Kürzel stehen auch im nativen Menü — dort ist die Liste die Wahrheit (`src/window.ts`), die Oberfläche
spiegelt sie nur (`ui/src/menu.ts`).

## Aufbau

Der Stack ist im Kochbuch beschrieben; hier steht nur, was für **diese** App entschieden wurde.

```
shared/schema.ts        Doc, HistoryEntry, Einstellungen — ein Schema, beide Seiten
src/documents.ts        Datei lesen: Kodierung, Titel, Beigaben auflösen
src/repo/documents.ts   Verlauf in SQLite (eine parse()-Stelle)
src/watch.ts            Deno.watchFs auf den *Ordner* (siehe unten)
src/api.ts              Hono-Router + AppType für den typisierten Client
ui/src/markdown.ts      marked → eigene Renderer → DOMPurify; Mermaid nachgeladen
ui/src/components/Viewer.tsx   besitzt den Markdown-Teilbaum im DOM (siehe unten)
ui/src/store/viewer.ts  offenes Dokument, Zurück-/Vorwärts-Stapel
```

**Kein Router.** Die App hat eine Ansicht. Was wie Navigation aussieht, ist Navigation zwischen _Dokumenten_ —
die stehen als Pfade auf einem Stapel (`store/viewer.ts`), nicht als URLs. Damit tut ⌘← das, was man in einem
Betrachter erwartet, statt eine Route zurückzugehen.

**Gerendert wird im Webview**, nicht auf dem Server: Mermaid und KaTeX brauchen ein DOM, und beim Blättern
durch den Verlauf soll die Vorschau nicht auf eine Antwort warten. Der Server liefert Text und Pfade.

### Vier Stellen, an denen es beim Bauen klemmte

Alle vier sind im Code kommentiert; hier die Kurzfassung, damit sie beim nächsten Umbau nicht neu gefunden
werden müssen.

1. **React darf den Markdown-Teilbaum nicht besitzen.** Mit `dangerouslySetInnerHTML` verschwanden fertig
   gezeichnete Diagramme wieder — gemessen: 31 Knoten raus, 31 rein, keine Fehlermeldung. React wendet die
   Eigenschaft erneut an und ersetzt dabei alles, was Mermaid und die Kopierknöpfe nachträglich eingefügt
   haben. Deshalb setzt **ein** Effekt in `Viewer.tsx` das HTML, hängt an, beobachtet und räumt auf.
2. **Mermaid ohne HTML-Beschriftungen** (`htmlLabels: false`). Standardmäßig setzt Mermaid Beschriftungen als
   HTML in ein `<foreignObject>`; DOMPurify wirft diesen Inhalt weg, und im Fenster stehen Kästchen und Pfeile
   **ohne Text** — ohne Fehler, was den Fall besonders unangenehm macht.
3. **Theme nicht aus dem DOM lesen.** Effekte der Kinder laufen vor denen der Eltern: Ein Kind, das
   `document.documentElement.dataset.theme` liest, sieht beim Umschalten noch den alten Wert.
   `resolveDark(theme)` in `store/ui.ts` löst stattdessen den Zustand auf.
4. **Überwacht wird der Ordner, nicht die Datei.** Editoren speichern atomar (temporäre Datei schreiben,
   umbenennen). Ein Beobachter auf dem alten Inode sieht danach nie wieder etwas, und die Vorschau steht
   still.

Dazu ein Fund, der auch den Stack betrifft: Die Kodierungserkennung des Templates kürzt bis zu drei Bytes am
Ende der Stichprobe, um abgeschnittene UTF-8-Sequenzen abzufangen. Liegt die **ganze** Datei vor, ist das
falsch — eine kurze cp1252-Datei gilt dann als UTF-8, weil nach dem Kürzen nur ASCII übrig bleibt.
`detectEncoding(bytes, partial)` unterscheidet beides (`tests/repo_test.ts` deckt es ab).

## Sicherheit

Der Betrachter zeigt **fremde Dateien** an — entsprechend sind die Grenzen gezogen:

- Jedes gerenderte Dokument geht durch **DOMPurify**; die CSP im Antwortkopf ist die zweite Schicht.
- `/api/asset` liefert nur Dateien mit einer Endung aus der Positivliste (Bilder, PDF, Audio, Video) und nur
  aus dem Ordner des Dokuments, dessen Elternordner oder dem Benutzerverzeichnis.
- Externe Links werden **nie** im Fenster geöffnet, sondern an den Standardbrowser übergeben — und nur `http`,
  `https`, `mailto`.
- Die lokale API hört auf 127.0.0.1 und verlangt das App-Token aus der ausgelieferten `index.html`.

## Als Standardprogramm für Markdown einrichten

```bash
deno task install:macos
```

Das legt die App nach `/Applications`, meldet sie bei Launch Services an und trägt sie als Standard für
Markdown ein. Danach öffnet ein Doppelklick auf eine `.md`-Datei den Betrachter — kalt gestartet wie auch in
ein bereits offenes Fenster hinein.

**Warum dabei ein zweites, winziges Programm entsteht:** Der Finder übergibt eine geöffnete Datei nicht als
Argument, sondern als Apple-Event (`kAEOpenDocuments`). `deno desktop` (2.9) wertet das nicht aus —
`Deno.args` bleibt leer, und `Deno.BrowserWindow` kennt dafür kein Ereignis (nachgemessen:
`open -a Markdown-Betrachter.app datei.md` kam ohne Pfad an). Der Öffner unter
`~/Library/Application Support/Markdown-Betrachter/` nimmt das Ereignis entgegen und startet die App mit
`open -n -a … --args <pfad>`. Er hat kein eigenes Fenster und beendet sich sofort wieder. Das `-n` ist nötig:
Ohne das ignoriert `open` die `--args`, sobald die App schon läuft.

In „Öffnen mit" heißt der Eintrag deshalb **Markdown-Betrachter (Öffnen mit)**. Fällt die Zuordnung einmal
aus, im Finder: Datei auswählen, ⌘I, unter „Öffnen mit" diesen Eintrag wählen, dann „Alle ändern …".

Standard wird damit `net.daringfireball.markdown` (`.md`, `.markdown`). Die selteneren Endungen `.mdown`,
`.mkd` und `.mdx` erscheinen in „Öffnen mit", sind aber nicht vorbelegt — macOS kennt für sie keinen
gemeinsamen Typ. `.txt` beansprucht der Betrachter bewusst nicht.

## Grenzen

- **Kein Ziehen & Ablegen.** Das Webview liefert beim Ablegen ein `File`-Objekt, **keinen Pfad** — ohne Pfad
  ließen sich weder Bilder auflösen noch die Datei überwachen. Öffnen läuft deshalb über ⌘O, den Verlauf oder
  „Öffnen mit".
- **Dateien bis 16 MB.** Darüber kommt eine Meldung statt eines blockierten Fensters.
- **Syntaxhervorhebung für ~40 Sprachen** (`highlight.js/lib/common`). Unbekannte Sprachen werden nicht
  eingefärbt, der Block sieht trotzdem richtig aus.
- **Kein Bearbeiten.** Das ist Absicht — dafür gibt es Editoren.
