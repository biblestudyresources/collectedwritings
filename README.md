# Bibliothek der Schriften von J. N. Darby (Prototyp)

Statische Website mit [Astro](https://astro.build). Dieser Stand ist ein **Prototyp mit erfundenen Testtexten**
und noch ohne Notion-Anbindung, Suche, Glossar und PDF-Schaltfläche (nur Druckansicht).

## Voraussetzungen

- Node.js **22.23.4 oder neuer** (empfohlen: aktuelle LTS-Version, siehe `.nvmrc`)
- Git

## Lokal arbeiten

```bash
npm install          # einmalig: Abhängigkeiten laden
npm run dev          # Entwicklungsserver auf http://localhost:4321
npm run check        # Artikeldaten prüfen
npm test             # Tests der Prüfregeln
npm run build        # prüfen und bauen (Ergebnis im Ordner dist/)
npm run preview      # fertigen Build ansehen
npm run long         # langen Testartikel (ca. 35.000 Wörter) neu erzeugen
```

## Aufbau

| Pfad | Inhalt |
|---|---|
| `content-test/` | Testartikel als Markdown. Später entstehen die Artikel beim Build aus Notion. |
| `scripts/validate.mjs` | Prüft freigegebene Artikel. Jeder Fehler bricht den Build ab. |
| `tests/` | Tests für die Prüfregeln |
| `src/pages/` | Startseite, Bandseiten, Artikelseiten |
| `src/layouts/Base.astro` | Gemeinsames Seitengerüst mit aufklappbarer Navigation |
| `src/styles/global.css` | Alle Gestaltungsvariablen (Farben, Schrift, Zeilenbreite) am Anfang |
| `src/lib/library.ts` | Nur freigegebene Artikel laden, nach Band gruppieren, URLs bilden |

## Artikeldateien

Kopfdaten stehen zwischen `---`, eine Zeile pro Feld, Werte im JSON-Format:
`id`, `title`, `volume`, `volumeTitle`, `position`, `tags`, `status`.
Veröffentlicht wird nur `status: "freigegeben"`. Die URL entsteht allein aus der ID
(`30_Exp_10` wird zu `/artikel/30-exp-10/`). Im Text sind H2 bis H4 erlaubt, H1 nicht.
Fußnoten: `[^1]` im Text, `[^1]: Text` am Ende.

## GitHub Pages

Beim Build unter `https://name.github.io/repo-name/` die Umgebungsvariablen
`SITE_URL=https://name.github.io` und `BASE_PATH=/repo-name` setzen (später im Workflow).
