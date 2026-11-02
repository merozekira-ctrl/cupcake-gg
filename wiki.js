// Encyclopédie : objets, runes, sorts d'invocateur (Data Dragon, sans clé API).
import { S, esc, num, rich, itemImg, runeImg, spellImg, setTitle } from '../core.js';

const TABS = [
  ['objets', 'Objets'],
  ['runes', 'Runes'],
  ['sorts', 'Sorts d’invocateur'],
];

const STAT_TAGS = [
  ['Damage', 'Dégâts d’attaque'],
  ['CriticalStrike', 'Coup critique'],
  ['AttackSpeed', 'Vitesse d’attaque'],
  ['OnHit', 'Effets à l’impact'],
  ['ArmorPenetration', 'Pénétration d’armure'],
  ['SpellDamage', 'Puissance'],
  ['MagicPenetration', 'Pénétration magique'],
  ['Mana', 'Mana'],
  ['AbilityHaste', 'Accélération'],
  ['Health', 'PV'],
  ['Armor', 'Armure'],
  ['SpellBlock', 'Résistance magique'],
  ['LifeSteal', 'Vol de vie'],
  ['NonbootsMovement', 'Vitesse de déplacement'],
];

export async function render(el, { tab }) {
  const t = TABS.some(([id]) => id === tab) ? tab : 'objets';
  setTitle(TABS.find(([id]) => id === t)[1]);
  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Encyclopédie</h1>
        <p>Données officielles du patch ${esc(S.st.version)}.</p>
      </div>
    </div>
    <nav class="tabs" aria-label="Sections de l’encyclopédie">${TABS.map(([id, label]) => `<a href="#/wiki/${id}"${id === t ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    <div id="wikiBody"></div>`;
  const body = el.querySelector('#wikiBody');
  if (t === 'runes') drawRunes(body);
  else if (t === 'sorts') drawSpells(body);
  else drawItems(body);
}

/* ---------- Objets ---------- */

function itemCatalog() {
  const items = S.st.items;
  const byName = new Map();
  for (const [id, it] of Object.entries(items)) {
    if (!it.sr) continue;
    if (!it.gold && !it.tags.includes('Trinket')) continue;
    const prev = byName.get(it.name);
    if (!prev || Number(id) < Number(prev)) byName.set(it.name, id);
  }
  const ids = [...byName.values()];
  const srInto = (it) => it.into.filter((x) => items[x]?.sr);
  const groups = { legend: [], boots: [], epic: [], basic: [], start: [], cons: [], trinket: [] };
  for (const id of ids) {
    const it = items[id];
    const into = srInto(it);
    if (it.tags.includes('Trinket')) groups.trinket.push(id);
    else if (it.tags.includes('Consumable')) groups.cons.push(id);
    else if (it.tags.includes('Boots')) groups.boots.push(id);
    else if (!into.length && it.gold >= 2000) groups.legend.push(id);
    else if (!into.length) groups.start.push(id);
    else if (it.from.length) groups.epic.push(id);
    else groups.basic.push(id);
  }
  const byGold = (a, b) => items[a].gold - items[b].gold || items[a].name.localeCompare(items[b].name, LOC);
  Object.values(groups).forEach((g) => g.sort(byGold));
  return [
    ['Objets légendaires', groups.legend],
    ['Bottes', groups.boots],
    ['Objets épiques', groups.epic],
    ['Objets de base', groups.basic],
    ['Objets de départ', groups.start],
    ['Consommables', groups.cons],
    ['Bijoux', groups.trinket],
  ];
}

function drawItems(body) {
  const items = S.st.items;
  const catalog = itemCatalog();
  let tag = '';
  let q = '';
  let selected = catalog[0][1][0];
  body.innerHTML = `
    <div class="toolbar">
      <label class="sr" for="iSearch">Rechercher un objet</label>
      <input class="field" id="iSearch" type="search" placeholder="Rechercher un objet" style="width:240px">
      <label class="sr" for="iTag">Statistique</label>
      <select class="select" id="iTag"><option value="">Toutes les statistiques</option>${STAT_TAGS.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    </div>
    <div class="wiki-layout">
      <div id="iGroups"></div>
      <aside class="panel item-detail" id="iDetail" aria-live="polite"></aside>
    </div>`;
  const groupsEl = body.querySelector('#iGroups');
  const detail = body.querySelector('#iDetail');

  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const paintGroups = () => {
    const html = catalog
      .map(([label, ids]) => {
        const list = ids.filter((id) => (!tag || items[id].tags.includes(tag)) && (!q || norm(items[id].name).includes(q)));
        if (!list.length) return '';
        return `<section class="item-group"><h3>${label} <span class="muted">${list.length}</span></h3><div class="item-grid">${list
          .map((id) => `<button type="button" data-id="${id}" aria-pressed="${id === selected}" aria-label="${esc(items[id].name)}">${itemImg(id, 40)}</button>`)
          .join('')}</div></section>`;
      })
      .join('');
    groupsEl.innerHTML = html || '<p class="muted">Aucun objet ne correspond.</p>';
  };
  const chip = (id) => `<button type="button" class="chip" data-id="${id}" style="padding:0 8px 0 4px">${itemImg(id, 24)}${esc(items[id]?.name || id)}</button>`;
  const paintDetail = () => {
    const it = items[selected];
    if (!it) {
      detail.innerHTML = '<p class="muted">Choisis un objet.</p>';
      return;
    }
    const from = it.from.filter((x) => items[x]);
    const into = it.into.filter((x) => items[x]?.sr);
    detail.innerHTML = `
      <div class="head">${itemImg(selected, 56)}<div><h2>${esc(it.name)}</h2><div class="gold">${num(it.gold)} po${it.base && it.base !== it.gold ? ` <span class="muted small">(${num(it.base)} po pour l’assembler)</span>` : ''}</div></div></div>
      ${it.plain ? `<p class="muted small" style="margin-bottom:8px">${esc(it.plain)}</p>` : ''}
      <div class="desc">${rich(it.desc)}</div>
      ${from.length ? `<h4>Se construit avec</h4><div class="chips">${from.map(chip).join('')}</div>` : ''}
      ${into.length ? `<h4>Permet de construire</h4><div class="chips">${into.map(chip).join('')}</div>` : ''}
      <p class="muted small" style="margin-top:14px">Revente : ${num(it.sell)} po</p>`;
  };

  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    selected = b.dataset.id;
    groupsEl.querySelectorAll('[data-id]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.id === selected)));
    paintDetail();
    if (window.matchMedia('(max-width: 900px)').matches) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  body.querySelector('#iSearch').addEventListener('input', (e) => {
    q = norm(e.target.value.trim());
    paintGroups();
  });
  body.querySelector('#iTag').addEventListener('change', (e) => {
    tag = e.target.value;
    paintGroups();
  });
  paintGroups();
  paintDetail();
}

/* ---------- Runes ---------- */

function drawRunes(body) {
  const R = S.st.runes;
  body.innerHTML = `<div class="tree-grid">${S.st.trees
    .map(
      (t) => `<section class="panel" aria-labelledby="tree-${t.id}">
        <div class="tree-head">${runeImg(t.id, 32)}<h2 id="tree-${t.id}">${esc(t.name)}</h2></div>
        ${t.slots
          .map(
            (slot, i) => `<div class="rune-row">${i === 0 ? '<div class="small muted">Rune principale</div>' : ''}${slot
              .map((id) => `<div class="rune">${runeImg(id, 32)}<div><strong>${esc(R[id]?.name || '')}</strong><p>${rich(R[id]?.short || '')}</p></div></div>`)
              .join('')}</div>`
          )
          .join('')}
      </section>`
    )
    .join('')}</div>`;
}

/* ---------- Sorts d'invocateur ---------- */

const MODE_NAMES = { CLASSIC: 'Faille de l’invocateur', ARAM: 'ARAM', CHERRY: 'Arena', URF: 'URF', NEXUSBLITZ: 'Nexus Blitz', ONEFORALL: 'Un pour tous', ULTBOOK: 'Grimoire ultime' };

function drawSpells(body) {
  const list = Object.values(S.st.spells)
    .filter((s) => s.modes.includes('CLASSIC') || s.modes.includes('ARAM'))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, LOC));
  body.innerHTML = `<div class="spell-grid">${list
    .map(
      (s) => `<article class="panel spell-card">
        ${spellImg(Object.keys(S.st.spells).find((k) => S.st.spells[k] === s), 48)}
        <div>
          <h2 style="font-size:16px">${esc(s.name)}</h2>
          <div class="meta muted">Délai de récupération : ${esc(s.cd)} s. Disponible au niveau ${s.level}.</div>
          <p>${rich(s.desc)}</p>
          <div class="meta muted">${s.modes.map((m) => MODE_NAMES[m]).filter(Boolean).join(', ')}</div>
        </div>
      </article>`
    )
    .join('')}</div>`;
}
