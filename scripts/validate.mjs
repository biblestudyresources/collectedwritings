// Prüft die Artikeldateien, bevor die Website gebaut wird.
// Jeder Fehler bricht den Build ab. Geprüft wird nur, was freigegeben ist:
// Entwürfe und unfertige Einträge dürfen den Build nicht blockieren.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ID_RE = /^(\d+)_([A-Za-z]+)_(\d+)$/;
const REQUIRED = ['id', 'title', 'volume', 'volumeTitle', 'position', 'status'];
const withoutCode = (s) => s.replace(/```[\s\S]*?```/g, '');

/** Liest Kopfdaten (Zeilen der Form `schluessel: JSON-Wert`) und Text einer Artikeldatei. */
export function parseArticle(text) {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    try { data[key] = JSON.parse(raw); } catch { data[key] = raw; }
  }
  return { data, body: m[2] };
}

function footnoteProblems(body) {
  const clean = withoutCode(body);
  const refs = new Set([...clean.matchAll(/\[\^([^\]\s]+)\](?!:)/g)].map((m) => m[1]));
  const defList = [...clean.matchAll(/^\[\^([^\]\s]+)\]:/gm)].map((m) => m[1]);
  const defs = new Set(defList);
  const out = [];
  for (const r of refs) if (!defs.has(r)) out.push(`Fußnote [^${r}] steht im Text, aber der Fußnotentext fehlt`);
  for (const d of defs) if (!refs.has(d)) out.push(`Fußnotentext [^${d}] hat keine Markierung im Text`);
  if (defList.length !== defs.size) out.push('Eine Fußnotennummer ist doppelt vergeben');
  return out;
}

export function validate(dir) {
  const errors = [];
  const warnings = [];
  const approved = [];

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const err = (msg) => errors.push(`${file}: ${msg}`);
    const parsed = parseArticle(readFileSync(join(dir, file), 'utf8'));
    if (!parsed) { err('Kopfdaten (zwischen den ---) fehlen'); continue; }
    const { data, body } = parsed;

    if (data.status !== 'freigegeben') {
      warnings.push(`${file}: Status „${data.status ?? 'leer'}“, wird nicht veröffentlicht`);
      continue;
    }
    for (const k of REQUIRED) if (data[k] === undefined || data[k] === '') err(`Pflichtfeld „${k}“ fehlt`);

    const m = typeof data.id === 'string' ? data.id.match(ID_RE) : null;
    if (data.id && !m) err(`ID „${data.id}“ hat nicht das Format <Band>_<Kürzel>_<Position>`);
    if (m) {
      if (Number(m[1]) !== data.volume) err(`Bandnummer in der ID (${m[1]}) passt nicht zum Band (${data.volume})`);
      if (Number(m[3]) !== data.position) err(`Position in der ID (${m[3]}) passt nicht zur Position (${data.position})`);
    }
    if (!body.trim()) err('Der Artikeltext ist leer');
    if (/^# /m.test(withoutCode(body))) err('Überschrift der Ebene 1 im Artikeltext (erlaubt sind H2 bis H4)');
    footnoteProblems(body).forEach(err);
    approved.push({ file, data, m });
  }

  // Prüfungen über mehrere Artikel hinweg
  const groups = (keyFn) => {
    const map = new Map();
    for (const a of approved) {
      const k = keyFn(a);
      if (k !== null) map.set(k, [...(map.get(k) ?? []), a]);
    }
    return map;
  };
  for (const [id, list] of groups((a) => a.data.id ?? null))
    if (list.length > 1) errors.push(`ID „${id}“ kommt doppelt vor: ${list.map((a) => a.file).join(', ')}`);
  for (const [key, list] of groups((a) => (a.data.volume && a.data.position ? `${a.data.volume}/${a.data.position}` : null)))
    if (list.length > 1) errors.push(`Position ${key.split('/')[1]} in Band ${key.split('/')[0]} ist doppelt vergeben: ${list.map((a) => a.file).join(', ')}`);
  for (const [vol, list] of groups((a) => a.data.volume ?? null)) {
    const abbrevs = new Set(list.map((a) => a.m?.[2]?.toLowerCase()).filter(Boolean));
    if (abbrevs.size > 1) errors.push(`Band ${vol}: uneinheitliche Kürzel in den IDs (${[...abbrevs].join(', ')})`);
    const titles = new Set(list.map((a) => a.data.volumeTitle).filter(Boolean));
    if (titles.size > 1) errors.push(`Band ${vol}: uneinheitliche Bandbezeichnung (${[...titles].join(' / ')})`);
  }
  return { errors, warnings, approved: approved.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { errors, warnings, approved } = validate(process.argv[2] ?? 'content-test');
  warnings.forEach((w) => console.warn('Hinweis: ' + w));
  errors.forEach((e) => console.error('FEHLER:  ' + e));
  if (errors.length) {
    console.error(`\n${errors.length} Fehler. Die Veröffentlichung wird abgebrochen.`);
    process.exit(1);
  }
  console.log(`OK: ${approved} freigegebene Artikel geprüft.`);
}
