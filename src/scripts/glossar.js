// Glossar: markiert Fachbegriffe im Artikeltext und zeigt die Erklärung in einem kleinen Fenster.
// Ohne JavaScript bleibt der Text einfach normal lesbar (die Seite /glossar/ gibt es trotzdem).
//
// Bedienung:
//   Maus        – Hover öffnet nach kurzer Verzögerung, Klick hält das Fenster offen
//   Touch       – Tippen öffnet, Tippen daneben oder „Schließen“ schließt
//   Tastatur    – Tab zum Begriff, Enter oder Leertaste öffnet, Esc schließt

const bereiche = document.querySelectorAll('[data-glossar]');
if (bereiche.length && HTMLElement.prototype.showPopover) start();

async function start() {
  let eintraege;
  try {
    const antwort = await fetch(document.body.dataset.glossarPfad);
    if (!antwort.ok) return;
    eintraege = await antwort.json();
  } catch {
    return;
  }
  if (!Array.isArray(eintraege) || eintraege.length === 0) return;

  // ---- 1. Begriffe im Text finden und als Schaltfläche markieren ----
  const nachForm = new Map(); // genaue Schreibweise -> Eintrag (bei Doppelungen gewinnt der erste)
  for (const e of eintraege) for (const f of e.forms) if (!nachForm.has(f)) nachForm.set(f, e);
  const byId = new Map(eintraege.map((e) => [e.id, e]));

  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const muster = [...nachForm.keys()]
    .sort((a, b) => b.length - a.length) // längste Form zuerst („Sohn des Menschen“ vor „Sohn“)
    .map((f) => f.trim().split(/\s+/).map(escape).join('\\s+'))
    .join('|');
  // Ganze Wörter, Groß-/Kleinschreibung wird beachtet
  const regex = new RegExp(`(?<![\\p{L}\\p{N}])(?:${muster})(?![\\p{L}\\p{N}])`, 'gu');

  const AUSGENOMMEN = 'a, h1, h2, h3, h4, h5, h6, button, code, pre, script, style, mark, sup, .footnotes, [data-footnotes]';
  const schmal = window.matchMedia('(max-width: 40rem)');

  const fenster = baueFenster();
  let aktuell = null; // Schaltfläche, deren Erklärung gerade offen ist
  let angeheftet = false; // true = per Klick/Tippen/Tastatur geöffnet (bleibt offen)
  let timer = null;

  for (const bereich of bereiche) {
    const walker = document.createTreeWalker(bereich, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest(AUSGENOMMEN) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const knoten = [];
    while (walker.nextNode()) knoten.push(walker.currentNode);
    for (const k of knoten) markiere(k);
  }

  function markiere(textKnoten) {
    const text = textKnoten.nodeValue;
    regex.lastIndex = 0;
    const vorhanden = regex.test(text);
    regex.lastIndex = 0; // test() schiebt den Suchzeiger weiter, matchAll() soll aber von vorn beginnen
    if (!vorhanden) return;
    const teile = document.createDocumentFragment();
    let ende = 0;
    for (const m of text.matchAll(regex)) {
      const eintrag = nachForm.get(m[0].replace(/\s+/g, ' '));
      if (!eintrag) continue;
      if (m.index > ende) teile.append(text.slice(ende, m.index));
      teile.append(baueBegriff(m[0], eintrag));
      ende = m.index + m[0].length;
    }
    if (ende === 0) return;
    if (ende < text.length) teile.append(text.slice(ende));
    textKnoten.replaceWith(teile);
  }

  function baueBegriff(text, eintrag) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gl-term';
    b.textContent = text;
    b.dataset.glId = eintrag.id;
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => {
      if (aktuell === b && angeheftet) schliessen(true);
      else oeffnen(b, true);
    });
    b.addEventListener('pointerenter', (ev) => {
      if (ev.pointerType !== 'mouse') return; // Touch kennt kein Hover
      clearTimeout(timer);
      timer = setTimeout(() => { if (!angeheftet) oeffnen(b, false); }, 250);
    });
    b.addEventListener('pointerleave', (ev) => {
      if (ev.pointerType === 'mouse') verzoegertSchliessen();
    });
    return b;
  }

  // ---- 2. Das Fenster (ein einziges, wird wiederverwendet) ----
  function baueFenster() {
    const f = document.createElement('div');
    f.id = 'glossar-fenster';
    f.className = 'gl-pop';
    f.setAttribute('popover', 'manual'); // Schließen steuern wir selbst (Esc, Klick daneben, Hover)
    f.setAttribute('role', 'dialog');
    f.setAttribute('aria-labelledby', 'glossar-titel');
    f.tabIndex = -1;
    f.innerHTML =
      '<p class="gl-titel" id="glossar-titel"></p><div class="gl-text"></div>' +
      '<p class="gl-fuss"><a class="gl-link" href="#">Im Glossar ansehen</a>' +
      '<button type="button" class="gl-zu">Schließen</button></p>';
    f.querySelector('.gl-zu').addEventListener('click', () => schliessen(true));
    f.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse') clearTimeout(timer); });
    f.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') verzoegertSchliessen(); });
    // Wer per Tab aus dem Fenster hinauswandert, schließt es damit
    f.addEventListener('focusout', (ev) => {
      const ziel = ev.relatedTarget;
      if (angeheftet && ziel && !f.contains(ziel) && ziel !== aktuell) schliessen(false);
    });
    return f;
  }

  function oeffnen(b, anheften) {
    clearTimeout(timer);
    const e = byId.get(b.dataset.glId);
    if (aktuell && aktuell !== b) aktuell.setAttribute('aria-expanded', 'false');
    if (fenster.matches(':popover-open')) fenster.hidePopover();
    aktuell = b;
    angeheftet = anheften;

    fenster.querySelector('.gl-titel').textContent = e.term;
    const textBox = fenster.querySelector('.gl-text');
    textBox.replaceChildren(...e.text.split(/\n{2,}/).filter(Boolean).map((t) => {
      const p = document.createElement('p');
      p.textContent = t.trim();
      return p;
    }));
    fenster.querySelector('.gl-link').href = e.url;

    // Direkt hinter den Begriff setzen: so passt die Tab-Reihenfolge für Tastaturnutzer
    b.after(fenster);
    fenster.showPopover();
    b.setAttribute('aria-expanded', 'true');
    platzieren();
    if (anheften) fenster.focus({ preventScroll: true });
  }

  function schliessen(fokusZurueck) {
    clearTimeout(timer);
    if (fenster.matches(':popover-open')) fenster.hidePopover();
    if (aktuell) {
      aktuell.setAttribute('aria-expanded', 'false');
      if (fokusZurueck) aktuell.focus({ preventScroll: true });
    }
    aktuell = null;
    angeheftet = false;
  }

  function verzoegertSchliessen() {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!angeheftet) schliessen(false); }, 250);
  }

  // Am Computer: unter (oder über) dem Begriff; auf schmalen Bildschirmen regelt das CSS (Karte unten)
  function platzieren() {
    if (!aktuell) return;
    if (schmal.matches) { fenster.style.left = ''; fenster.style.top = ''; return; }
    const r = aktuell.getBoundingClientRect();
    const breite = fenster.offsetWidth;
    const hoehe = fenster.offsetHeight;
    const links = Math.min(Math.max(8, r.left), window.innerWidth - breite - 8);
    let oben = r.bottom + 6;
    if (oben + hoehe > window.innerHeight - 8 && r.top - hoehe - 6 > 8) oben = r.top - hoehe - 6;
    fenster.style.left = `${links}px`;
    fenster.style.top = `${oben}px`;
  }

  window.addEventListener('scroll', platzieren, { passive: true });
  window.addEventListener('resize', platzieren);

  // Klick/Tippen außerhalb schließt
  document.addEventListener('pointerdown', (ev) => {
    if (!aktuell) return;
    if (fenster.contains(ev.target) || ev.target.closest?.('.gl-term')) return;
    schliessen(false);
  });
  // Esc schließt; der Fokus geht nur zurück, wenn er im Fenster oder auf dem Begriff lag
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !aktuell) return;
    const a = document.activeElement;
    schliessen(fenster.contains(a) || a === aktuell);
  });
}
