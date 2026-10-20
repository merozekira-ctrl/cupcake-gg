// Noyau partagé : état, appels API, formatage, icônes, stockage local.

export const S = {
  cfg: null, // régions, présence de la clé
  st: null, // données statiques Data Dragon
  platform: 'euw1',
  nav: 0,
  meta: {}, // échantillons tier list par région
};

/* ---------- API ---------- */

export async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch {
    throw new Error('Serveur cupcake.gg injoignable. Vérifie que « node server.js » tourne toujours.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* réponse vide */
  }
  if (!res.ok) {
    const e = new Error((data && data.error) || `Erreur ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

/* ---------- Stockage local (tolérant aux navigateurs qui le bloquent) ---------- */

export const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('rs-' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('rs-' + k, JSON.stringify(v));
    } catch {
      /* stockage indisponible */
    }
  },
};

const sameId = (a, b) =>
  a.p === b.p && a.name.toLowerCase() === b.name.toLowerCase() && a.tag.toLowerCase() === b.tag.toLowerCase();

export function pushRecent(entry) {
  const list = store.get('recent', []).filter((x) => !sameId(x, entry));
  list.unshift(entry);
  store.set('recent', list.slice(0, 8));
}
export function removeRecent(entry) {
  store.set(
    'recent',
    store.get('recent', []).filter((x) => !sameId(x, entry))
  );
}
export function isFav(entry) {
  return store.get('favs', []).some((x) => sameId(x, entry));
}
export function toggleFav(entry) {
  const list = store.get('favs', []);
  const on = list.some((x) => sameId(x, entry));
  store.set('favs', on ? list.filter((x) => !sameId(x, entry)) : [entry, ...list].slice(0, 20));
  return !on;
}

/* ---------- Texte ---------- */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Texte Data Dragon nettoyé par le serveur : \u0001…\u0002 = gras.
export function rich(s) {
  return esc(s)
    .replace(/\u0001([^\u0001\u0002]*)\u0002/g, '<strong>$1</strong>')
    .replace(/[\u0001\u0002]/g, '')
    .replace(/\n/g, '<br>');
}

const nf = new Intl.NumberFormat('fr-FR');
export const num = (n) => nf.format(Math.round(n || 0));
export const dec = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d).replace('.', ',') : '–');
export const kNum = (n) => (n >= 1000 ? dec(n / 1000, 1) + ' k' : String(Math.round(n || 0)));
export const pct = (a, b, d = 0) => (b ? dec((a / b) * 100, d) + ' %' : '–');
export const kdaRatio = (k, d, a) => (d ? (k + a) / d : k + a ? Infinity : 0);
export const kdaText = (r) => (r === Infinity ? 'Parfait' : dec(r, 2));

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
export function ago(ts) {
  const s = (ts - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 60) return 'à l’instant';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 30 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  if (a < 365 * 86400) return rtf.format(Math.round(s / (30 * 86400)), 'month');
  return rtf.format(Math.round(s / (365 * 86400)), 'year');
}
const dtf = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
export const fullDate = (ts) => dtf.format(new Date(ts));
export const clock = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

/* ---------- Référentiels ---------- */

export const QUEUES = {
  0: 'Personnalisée',
  400: 'Normale Draft',
  420: 'Classée Solo/Duo',
  430: 'Normale Aveugle',
  440: 'Classée Flex',
  450: 'ARAM',
  480: 'Partie rapide',
  490: 'Partie rapide',
  700: 'Clash',
  720: 'Clash ARAM',
  830: 'Coop vs IA',
  840: 'Coop vs IA',
  850: 'Coop vs IA',
  870: 'Coop vs IA',
  880: 'Coop vs IA',
  890: 'Coop vs IA',
  900: 'URF',
  1010: 'URF des neiges',
  1020: 'Un pour tous',
  1300: 'Nexus Blitz',
  1400: 'Grimoire ultime',
  1700: 'Arena',
  1710: 'Arena',
  1900: 'URF',
  2400: 'ARAM Mayhem',
};
export const queueName = (q) => QUEUES[q] || 'Mode spécial';
export const isArena = (q) => q === 1700 || q === 1710;

export const TIERS = {
  IRON: 'Fer',
  BRONZE: 'Bronze',
  SILVER: 'Argent',
  GOLD: 'Or',
  PLATINUM: 'Platine',
  EMERALD: 'Émeraude',
  DIAMOND: 'Diamant',
  MASTER: 'Maître',
  GRANDMASTER: 'Grand Maître',
  CHALLENGER: 'Challenger',
};
const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const SHORT = { IRON: 'Fe', BRONZE: 'Br', SILVER: 'Ag', GOLD: 'Or', PLATINUM: 'Pt', EMERALD: 'Em', DIAMOND: 'Di', MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'C' };
const DIV = { I: 1, II: 2, III: 3, IV: 4 };

export const rankText = (r) => (!r ? 'Non classé' : APEX.includes(r.tier) ? TIERS[r.tier] : `${TIERS[r.tier] || r.tier} ${DIV[r.rank] || r.rank}`);

// Écusson dessiné en CSS : affiché pour « non classé » ou si l'emblème officiel ne charge pas.
export function fallbackCrest(tier, div, size = 'md') {
  const t = SHORT[tier] ? tier : 'NONE';
  return `<span class="crest crest-${size}" data-tier="${t}" aria-hidden="true"><span>${SHORT[t] || '–'}${div ? `<small>${div}</small>` : ''}</span></span>`;
}

// Emblème de rang officiel (servi par /rank/<palier>.png), avec la division en surimpression.
export function crest(r, size = 'md') {
  const tier = r?.tier;
  const div = r && !APEX.includes(tier) ? DIV[r.rank] || '' : '';
  if (!tier || !SHORT[tier]) return fallbackCrest('NONE', '', size);
  const roman = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }[div] || '';
  return `<span class="emb emb-${size}" data-tier="${tier}" data-div="${div}" aria-hidden="true"><img class="rank-img" src="/ranks/${tier.toLowerCase()}.png" alt="" decoding="async">${roman ? `<b class="emb-div">${roman}</b>` : ''}</span>`;
}

export const ROLES = { TOP: 'Haut', JUNGLE: 'Jungle', MIDDLE: 'Milieu', BOTTOM: 'Tireur', UTILITY: 'Support' };
export const ROLE_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

export function roleIcon(pos, label = true) {
  const frame = '<rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="1.2"/>';
  const paths = {
    TOP: '<path d="M3.5 12.5v-9h9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    JUNGLE: '<path d="M8 3.2 11.2 8 8 12.8 4.8 8Z" fill="currentColor"/>',
    MIDDLE: '<path d="m3.8 12.2 8.4-8.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    BOTTOM: '<path d="M3.5 12.5h9v-9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    UTILITY: '<path d="M8 3.2 12 4.8v3c0 2.4-1.7 4-4 5-2.3-1-4-2.6-4-5v-3Z" fill="currentColor"/>',
  };
  if (!paths[pos]) return '';
  const a11y = label ? `role="img" aria-label="${ROLES[pos]}"` : 'aria-hidden="true"';
  return `<svg class="role-ic" viewBox="0 0 16 16" ${a11y}>${frame}${paths[pos]}</svg>`;
}

// Tag attribué par défaut à la création du compte, selon la région.
export const DEFAULT_TAG = {
  euw1: 'EUW', eun1: 'EUNE', tr1: 'TR1', ru: 'RU1', me1: 'ME1', na1: 'NA1', br1: 'BR1', la1: 'LAN',
  la2: 'LAS', kr: 'KR1', jp1: 'JP1', oc1: 'OCE', sg2: 'SG2', tw2: 'TW2', vn2: 'VN2',
};

export const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();

export const CLASSES = { Fighter: 'Combattant', Tank: 'Tank', Mage: 'Mage', Assassin: 'Assassin', Marksman: 'Tireur', Support: 'Support' };

/* ---------- Images Data Dragon ---------- */

const imgBase = () => `${S.st.cdn}/${S.st.version}/img`;
export const champOf = (id) => S.st.champions[id] || null;
export const champByKey = (id) => Object.values(S.st.champions).find((c) => c.id.toLowerCase() === String(id).toLowerCase()) || null;

function img(cls, size, src, alt, title) {
  return `<img class="ic ic-${size} ${cls}" src="${esc(src)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} width="${size}" height="${size}" loading="lazy" decoding="async">`;
}
const empty = (size, cls = 'ic-empty') => `<span class="ic ic-${size} ${cls}" aria-hidden="true"></span>`;

export function champImg(id, size = 32) {
  const c = champOf(id);
  return c ? img('', size, `${imgBase()}/champion/${c.img}`, c.name, c.name) : empty(size);
}
export function champImgById(ddId, size = 32, alt = '') {
  return img('', size, `${imgBase()}/champion/${ddId}.png`, alt, alt);
}
export function itemImg(id, size = 24) {
  if (!id) return empty(size, 'ic-slot');
  const it = S.st.items[id];
  const name = it ? it.name : `Objet ${id}`;
  return img('', size, `${imgBase()}/item/${it ? it.img : id + '.png'}`, name, it?.gold ? `${name} · ${num(it.gold)} po` : name);
}
export function spellImg(id, size = 22) {
  const s = S.st.spells[id];
  return s ? img('', size, `${imgBase()}/spell/${s.img}`, s.name, s.name) : empty(size);
}
export function runeImg(id, size = 22, sub = false) {
  const r = S.st.runes[id];
  return r ? img(`rune-ic${sub ? ' rune-sub' : ''}`, size, `${S.st.cdn}/img/${r.icon}`, r.name, r.name) : empty(size);
}
export const profileImg = (id, size = 64, round = false) =>
  img(round ? 'round' : '', size, `${imgBase()}/profileicon/${id}.png`, 'Icône d’invocateur');
export const abilityImg = (file, size = 48, alt = '') => img('', size, `${imgBase()}/spell/${file}`, alt);
export const passiveImg = (file, size = 48, alt = '') => img('', size, `${imgBase()}/passive/${file}`, alt);
export const splashUrl = (id, num = 0) => `${S.st.cdn}/img/champion/splash/${id}_${num}.jpg`;
export const loadingUrl = (id, num = 0) => `${S.st.cdn}/img/champion/loading/${id}_${num}.jpg`;

/* ---------- Liens ---------- */

export const playerHref = (p, name, tag, tab) =>
  `#/joueur/${p}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}${tab ? '/' + tab : ''}`;
export const champHref = (c, role) => `#/champion/${c.id}${role ? '?role=' + role : ''}`;

export function parseRiotId(raw, fallbackTag = '') {
  const s = String(raw || '').trim();
  const i = s.lastIndexOf('#');
  if (i > 0) return { name: s.slice(0, i).trim(), tag: s.slice(i + 1).trim() };
  return { name: s, tag: fallbackTag };
}

/* ---------- Interface ---------- */

export function toast(msg, kind = 'info') {
  const box = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), 6500);
}

export function errorState(e, title = 'Chargement impossible') {
  return `<div class="state state-error" role="alert"><p class="state-title">${esc(title)}</p><p>${esc(e?.message || e)}</p></div>`;
}
export const loading = (txt = 'Chargement…') => `<div class="loading-line" role="status"><span class="spinner"></span>${esc(txt)}</div>`;

export function setTitle(t) {
  document.title = t ? `${t} · cupcake.gg` : 'cupcake.gg · statistiques League of Legends';
}

export function regionOptions(selected) {
  return Object.entries(S.cfg.platforms)
    .map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${esc(v.label)}</option>`)
    .join('');
}

export function setPlatform(p) {
  if (!S.cfg.platforms[p]) return;
  S.platform = p;
  store.set('platform', p);
  const q = document.getElementById('quickRegion');
  if (q) q.value = p;
}

/* ---------- Score de performance (0 à 10) ---------- */
// Compare chaque joueur au reste de la partie : KDA, participation, dégâts,
// or, farm, vision, objectifs et encaissement, pondérés puis ramenés sur 10.

const W = { kda: 0.22, kp: 0.16, dmg: 0.15, share: 0.07, gold: 0.1, cs: 0.08, vis: 0.1, obj: 0.06, tank: 0.06 };

export function scoreMatch(m) {
  if (m._score) return m._score;
  const arena = isArena(m.q);
  const min = Math.max(1, m.dur / 60);
  const groupOf = (p) => (arena ? p.sub : p.team);
  const kills = {};
  const dmg = {};
  for (const p of m.parts) {
    const g = groupOf(p);
    kills[g] = (kills[g] || 0) + p.k;
    dmg[g] = (dmg[g] || 0) + p.dmg;
  }
  const metrics = m.parts.map((p) => {
    const g = groupOf(p);
    return {
      kda: (p.k + p.a * 0.75) / Math.max(1, p.d),
      kp: kills[g] ? (p.k + p.a) / kills[g] : 0,
      dmg: p.dmg / min,
      share: dmg[g] ? p.dmg / dmg[g] : 0,
      gold: p.gold / min,
      cs: p.cs / min,
      vis: p.vis / min,
      obj: (p.obj + p.bld) / min,
      tank: (p.taken + p.mitig) / min,
    };
  });
  const max = {};
  for (const k in W) max[k] = Math.max(1e-9, ...metrics.map((x) => x[k]));
  const scores = metrics.map((x, i) => {
    let s = 0;
    for (const k in W) s += W[k] * Math.min(1, x[k] / max[k]);
    const p = m.parts[i];
    const bonus = arena ? (p.place && p.place <= 2 ? 0.4 : 0) : p.win ? 0.5 : 0;
    return Math.max(0, Math.min(10, s * 12.5 + bonus));
  });
  const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  const rank = [];
  order.forEach((idx, r) => {
    rank[idx] = r + 1;
  });
  let mvp = -1;
  let ace = -1;
  if (!arena && !m.remake) {
    mvp = order.find((i) => m.parts[i].win) ?? -1;
    ace = order.find((i) => !m.parts[i].win) ?? -1;
  }
  m._score = { scores, rank, mvp, ace };
  return m._score;
}
