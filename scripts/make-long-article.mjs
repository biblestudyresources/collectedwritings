// Erzeugt einen langen Testartikel (ca. 35.000 Wörter, etwa 100 Buchseiten)
// mit Überschriften, Fußnoten, Listen und Zitaten, um Darstellung,
// Buildzeit und später Suche und PDF zu testen. Alle Texte sind Blindtext.
import { writeFileSync } from 'node:fs';

let seed = 42;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const subjects = ['Der Verfasser', 'Die Betrachtung', 'Der Leser', 'Der Abschnitt', 'Das Beispiel', 'Die Frage', 'Der Gedanke', 'Das Zeugnis des Textes', 'Jede Beobachtung'];
const predicates = ['wird im Zusammenhang gelesen', 'verdient sorgfältige Aufmerksamkeit', 'führt zu einer klaren Unterscheidung', 'bleibt von den Umständen unberührt', 'zeigt sich in der Ordnung des Ganzen', 'setzt eine ruhige Prüfung voraus', 'lässt sich nicht auf einen Satz verkürzen', 'wird an späterer Stelle weiter entfaltet'];
const extras = ['im Blick auf das Ganze', 'ohne Eile und ohne Nachlässigkeit', 'wie es die Sache verlangt', 'in der gebotenen Ruhe', 'nach dem Maß der Aufgabe', 'wie schon gesagt wurde'];
const special = ['ἀγάπη (agápē)', 'יהוה', '„ein erfundenes Zitat“', '‚eine Einzelheit‘', 'Äpfel, Öfen, Übung, Straße', '1. Kor. 15,51'];

const sentence = () => `${pick(subjects)} ${pick(predicates)}, ${pick(extras)}.`;
const TARGET_WORDS = 35000;
const out = [];
const notes = [];
let words = 0, p = 0;

while (words < TARGET_WORDS) {
  p++;
  if (p % 60 === 1) out.push(`## Abschnitt ${Math.ceil(p / 60)}`);
  else if (p % 20 === 1) out.push(`### Unterabschnitt ${p}`);
  else if (p % 10 === 6) out.push(`#### Einzelfrage ${p}`);

  const sentences = Array.from({ length: 6 }, sentence);
  if (p % 7 === 0) sentences[2] += ` Zum Vergleich: ${pick(special)}.`;
  if (p % 4 === 0) {
    notes.push(`[^${notes.length + 1}]: Testfußnote ${notes.length + 1}: ein erfundener Hinweis zu Absatz ${p}.`);
    sentences[0] += `[^${notes.length}]`;
  }
  const para = sentences.join(' ');
  out.push(para);
  words += para.split(/\s+/).length;

  if (p % 25 === 0) out.push(`> ${sentence()} ${sentence()}`);
  if (p % 30 === 0) out.push(`- ${sentence()}\n- ${sentence()}\n- ${sentence()}`);
}

const head = `---
id: "30_Exp_12"
title: "Langer Testartikel (ca. 100 Seiten)"
volume: 30
volumeTitle: "Expository (2)"
position: 12
tags: ["test", "lang"]
status: "freigegeben"
---
`;
writeFileSync('content-test/30_exp_12.md', head + out.join('\n\n') + '\n\n' + notes.join('\n') + '\n');
console.log(`content-test/30_exp_12.md: ${words} Wörter, ${notes.length} Fußnoten`);
