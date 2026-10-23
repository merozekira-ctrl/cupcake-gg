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

export const LANG = document.documentElement.lang === 'en' ? 'en' : 'fr';
export const EN = LANG === 'en';
const LOCALE = EN ? 'en-US' : 'fr-FR';
const nf = new Intl.NumberFormat(LOCALE);
export const num = (n) => nf.format(Math.round(n || 0));
export const dec = (n, d = 1) => (Number.isFinite(n) ? (EN ? n.toFixed(d) : n.toFixed(d).replace('.', ',')) : '–');
export const kNum = (n) => (n >= 1000 ? dec(n / 1000, 1) + ' k' : String(Math.round(n || 0)));
export const pct = (a, b, d = 0) => (b ? dec((a / b) * 100, d) + ' %' : '–');
export const kdaRatio = (k, d, a) => (d ? (k + a) / d : k + a ? Infinity : 0);
export const kdaText = (r) => (r === Infinity ? (EN ? 'Perfect' : 'Parfait') : dec(r, 2));

const rtf = new Intl.RelativeTimeFormat(LANG, { numeric: 'auto' });
export function ago(ts) {
  const s = (ts - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 60) return EN ? 'just now' : 'à l’instant';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 30 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  if (a < 365 * 86400) return rtf.format(Math.round(s / (30 * 86400)), 'month');
  return rtf.format(Math.round(s / (365 * 86400)), 'year');
}
const dtf = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
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
// Noms officiels du client anglais.
if (EN)
  Object.assign(QUEUES, {
    0: 'Custom', 400: 'Normal Draft', 420: 'Ranked Solo/Duo', 430: 'Normal Blind', 440: 'Ranked Flex', 480: 'Swiftplay', 490: 'Swiftplay',
    830: 'Co-op vs. AI', 840: 'Co-op vs. AI', 850: 'Co-op vs. AI', 870: 'Co-op vs. AI', 880: 'Co-op vs. AI', 890: 'Co-op vs. AI',
    1010: 'Snow ARURF', 1020: 'One for All', 1400: 'Ultimate Spellbook',
  });
export const queueName = (q) => QUEUES[q] || (EN ? 'Special mode' : 'Mode spécial');
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
if (EN) Object.assign(TIERS, { IRON: 'Iron', SILVER: 'Silver', GOLD: 'Gold', PLATINUM: 'Platinum', EMERALD: 'Emerald', DIAMOND: 'Diamond', MASTER: 'Master', GRANDMASTER: 'Grandmaster' });
const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const SHORT = { IRON: EN ? 'I' : 'Fe', BRONZE: 'Br', SILVER: EN ? 'S' : 'Ag', GOLD: EN ? 'G' : 'Or', PLATINUM: 'Pt', EMERALD: 'Em', DIAMOND: 'Di', MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'C' };
const DIV = { I: 1, II: 2, III: 3, IV: 4 };

export const rankText = (r) => (!r ? (EN ? 'Unranked' : 'Non classé') : APEX.includes(r.tier) ? TIERS[r.tier] : `${TIERS[r.tier] || r.tier} ${DIV[r.rank] || r.rank}`);

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

export const ROLES = EN ? { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support' } : { TOP: 'Haut', JUNGLE: 'Jungle', MIDDLE: 'Milieu', BOTTOM: 'Tireur', UTILITY: 'Support' };
export const ROLE_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

// Icônes de position (deux tons : .ri-a = partie mise en avant, .ri-b = cadre).
const ROLE_PATHS = {
  TOP: '<path class="ri-b" d="M22 4.6V22H4.6l3.8-3.8h9.8V8.4Z"/><path class="ri-b" d="M9.6 9.6h4.8v4.8H9.6z"/><path class="ri-a" d="M2 2h18.4l-3.8 3.8H5.8v10.8L2 20.4Z"/>',
  JUNGLE: '<path class="ri-a" d="M10.6 22.4C7 19 3.4 14.6 1.6 9.6c3.2 2 6.8 5 9.6 9Z"/><path class="ri-a" d="M11 22C10.6 15.4 9 8 6.2 1.4c4.2 4.2 6.4 10.2 6.6 17Z"/><path class="ri-a" d="M12.2 19.6c.2-6.4 1.6-12.4 4.2-17.8.6 5.8-.4 11.8-3 17Z"/><path class="ri-a" d="M12.6 21.6c2-5.2 5.4-9.6 9.8-12.4-1.4 5.2-5 9.4-9 12.8Z"/>',
  MIDDLE: '<path class="ri-b" d="M2 2h14.6l-3.8 3.8H5.8v7L2 16.6Z"/><path class="ri-b" d="M22 22H7.4l3.8-3.8h7v-7L22 7.4Z"/><path class="ri-a" d="M2 18.6 18.6 2H22v3.4L5.4 22H2Z"/>',
  BOTTOM: '<path class="ri-b" d="M2 19.4V2h17.4l-3.8 3.8H5.8v9.8Z"/><path class="ri-b" d="M9.6 9.6h4.8v4.8H9.6z"/><path class="ri-a" d="M22 22H3.6l3.8-3.8h10.8V7.4L22 3.6Z"/>',
  UTILITY: '<path class="ri-a" d="M7.4 1.8h9.2L15 5.4l-3 2.8-3-2.8Z"/><path class="ri-a" d="M10.2 9.4h3.6l1.6 3.6-1.2 5.6-2.2 4-2.2-4-1.2-5.6Z"/><path class="ri-a" d="M9.2 8.6C6.6 7.6 3.6 7.2.6 7.6c1 1.6 2.6 2.6 4.4 3l-.8 2c1.6 0 3.2-.8 4.4-1.8Z"/><path class="ri-a" d="M14.8 8.6c2.6-1 5.6-1.4 8.6-1-1 1.6-2.6 2.6-4.4 3l.8 2c-1.6 0-3.2-.8-4.4-1.8Z"/>',
  ALL: '<path class="ri-all" d="M12 1.5c.8 4.6 2.4 8 7.4 9.2v2.6c-5 1.2-6.6 4.6-7.4 9.2h-.1C11.1 17.9 9.5 14.5 4.5 13.3v-2.6c5-1.2 6.6-4.6 7.4-9.2Z"/>',
};
export function roleIcon(pos, label = true, cls = '') {
  if (!ROLE_PATHS[pos]) return '';
  const a11y = label ? `role="img" aria-label="${pos === 'ALL' ? 'Tous les rôles' : ROLES[pos]}"` : 'aria-hidden="true"';
  return `<svg class="role-ic ${cls}" viewBox="0 0 24 24" ${a11y}>${ROLE_PATHS[pos]}</svg>`;
}
// Barre de filtres : icônes seules (Tous + 5 rôles).
export function roleBar(current, { all = true, mini = false, attr = 'data-role' } = {}) {
  const keys = [...(all ? ['ALL'] : []), ...ROLE_ORDER];
  return `<div class="rolebar${mini ? ' mini' : ''}" role="group" aria-label="Rôle">${keys
    .map((r) => `<button type="button" ${attr}="${r}" aria-pressed="${(current || 'ALL') === r}" title="${r === 'ALL' ? 'Tous les rôles' : ROLES[r]}">${roleIcon(r, false)}<span class="sr">${r === 'ALL' ? 'Tous les rôles' : ROLES[r]}</span></button>`)
    .join('')}</div>`;
}

/* ---------- Winrate, pros, régions ---------- */

// Échelle cupcake : <46 % rouge, <50 % orange, <53 % neutre, <57 % menthe, <62 % cyan, sinon rose.
export function wrTier(ratio) {
  const p = ratio * 100;
  return p < 46 ? 0 : p < 50 ? 1 : p < 53 ? 2 : p < 57 ? 3 : p < 62 ? 4 : 5;
}
export function wrBadge(w, n, { text = false, lg = false, d = 0 } = {}) {
  if (!n) return '<span class="muted">–</span>';
  const r = w / n;
  return `<b class="wr wr-t${wrTier(r)}${text ? ' wr-text' : ''}${lg ? ' wr-lg' : ''}" title="${w} victoire${w > 1 ? 's' : ''} sur ${n}">${dec(r * 100, d)} %</b>`;
}
export function wlBar(w, l) {
  const n = w + l;
  const r = n ? w / n : 0;
  return `<span class="wlbar" style="--c:var(--wr${wrTier(r)})"><i style="width:${(r * 100).toFixed(1)}%"></i><span><b class="w">${w} V</b><b class="l">${l} D</b></span></span>`;
}
const TWITCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4.3 2 3 5.3v13.4h4.6V21h2.6l2.3-2.3h3.6l4.9-4.9V2Zm15 11-2.8 2.8H12l-2.4 2.4v-2.4H5.8V3.8h13.5Zm-3.3-6.4v4.8h-1.8V6.6Zm-4.8 0v4.8H9.4V6.6Z"/></svg>';
const LAUREL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 9.5 7.6 3.4 8.2l4.6 4.1L6.7 18.3 12 15.2l5.3 3.1-1.3-6 4.6-4.1-6.1-.6Z"/></svg>';
// Badge pro (sigle d'équipe) ou streamer (lien Twitch quand la chaîne est connue).
export function proBadge(pro, { link = true } = {}) {
  if (!pro) return '';
  if (pro.kind === 'streamer') {
    const t = pro.twitch && link ? ` href="https://www.twitch.tv/${esc(pro.twitch)}" target="_blank" rel="noopener noreferrer"` : '';
    const title = pro.twitch ? `Chaîne Twitch : ${pro.twitch}${pro.guess ? ' (déduite du pseudo)' : ''}` : 'Streamer';
    return `<${t ? 'a' : 'span'} class="who who-stream"${t} title="${esc(title)}">${TWITCH}Streamer</${t ? 'a' : 'span'}>`;
  }
  // Badge pro : lien vers la fiche wiki du joueur (palmarès, équipe, infos).
  const page = String(pro.page || pro.label || '').trim();
  const href = link && page && S.cfg?.proWiki ? `${S.cfg.proWiki}${encodeURIComponent(page.replace(/\s+/g, '_'))}` : '';
  const title = `${pro.label || 'Joueur professionnel'}${pro.team ? ' · ' + pro.team : ''}${href ? ' · voir sa fiche joueur' : ''}`;
  const inner = `${pro.team ? `<b>${esc(pro.team)}</b>` : LAUREL}Pro`;
  return href
    ? `<a class="who who-pro" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">${inner}</a>`
    : `<span class="who who-pro" title="${esc(title)}">${inner}</span>`;
}
export const regionBadge = (p) => `<span class="rg rg-${esc(p)}">${esc(S.cfg.platforms[p]?.label || p)}</span>`;

// Data Dragon 16.21 = patch officiel 26.21.
export function patchLabel(v) {
  const [a, b] = String(v || '').split('.').map(Number);
  if (!Number.isFinite(a)) return '';
  return a >= 16 ? `${a + 10}.${b}` : `${a}.${b}`;
}

// Note sur 100 en anneau.
export function scoreRing(v) {
  const n = Math.max(0, Math.min(100, Math.round(v || 0)));
  const c = n >= 80 ? '' : n >= 65 ? 'var(--wr4)' : n >= 50 ? 'var(--wr3)' : n >= 35 ? 'var(--wr1)' : 'var(--wr0)';
  return `<span class="score${n >= 80 ? ' s-hi' : ''}" style="--p:${n};${c ? `--c:${c}` : ''}" title="Note de la partie sur 100"><b>${n}</b></span>`;
}

// Tag attribué par défaut à la création du compte, selon la région.
export const DEFAULT_TAG = {
  euw1: 'EUW', eun1: 'EUNE', tr1: 'TR1', ru: 'RU1', me1: 'ME1', na1: 'NA1', br1: 'BR1', la1: 'LAN',
  la2: 'LAS', kr: 'KR1', jp1: 'JP1', oc1: 'OCE', sg2: 'SG2', tw2: 'TW2', vn2: 'VN2',
};

export const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();

// Message affiché sur la version de démonstration (hébergement gratuit en attendant l'accord de Riot).
export const DEMO_NOTE =
  'Version de démonstration : seules 150 parties classées (Faille de l’invocateur, EUW) sont répertoriées, et les builds ARAM, ARAM du chaos et Arena ne sont pas encore disponibles. Analyser plus de parties demande un serveur payant ; je le mettrai en place dès que Riot aura validé le projet.';

export const CLASSES = EN ? { Fighter: 'Fighter', Tank: 'Tank', Mage: 'Mage', Assassin: 'Assassin', Marksman: 'Marksman', Support: 'Support' } : { Fighter: 'Combattant', Tank: 'Tank', Mage: 'Mage', Assassin: 'Assassin', Marksman: 'Tireur', Support: 'Support' };

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
  // Référence = meilleur de la partie, mais jamais sous un plancher absolu :
  // dans une partie où tout le monde joue mal, personne n'atteint le maximum.
  const FLOOR = { kda: 5, kp: 0.65, dmg: 900, share: 0.3, gold: 480, cs: 8, vis: 1.6, obj: 400, tank: 1500 };
  const max = {};
  for (const k in W) max[k] = Math.max(FLOOR[k] || 1e-9, ...metrics.map((x) => x[k]));
  const scores = metrics.map((x, i) => {
    let rel = 0;
    for (const k in W) rel += W[k] * Math.min(1, x[k] / max[k]);
    const p = m.parts[i];
    // Barème exigeant : 0,24 de « relatif » = 0, 0,86 = 100. Une partie moyenne tourne autour de 45-50.
    let v = (rel - 0.24) / 0.62;
    // Morts : au-delà de 5, chaque mort coûte 3 points (15 max).
    if (!arena) v -= Math.min(0.15, Math.max(0, p.d - 5) * 0.03);
    v += arena ? (p.place && p.place <= 2 ? 0.04 : 0) : p.win ? 0.04 : 0;
    return Math.max(0, Math.min(10, v * 10));
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

// Niveau d'un joueur sur 100 (score cupcake) : un palier tous les 10 %.
const LEVELS = EN ? ['Fallen', 'Demon', 'Devil', 'Imp', 'Horned', 'Human', 'Valiant', 'Blessed', 'Seraph', 'Archangel', 'GOAT'] : ['Déchu', 'Démon', 'Diable', 'Diablotin', 'Cornu', 'Humain', 'Valeureux', 'Béni', 'Séraphin', 'Archange', 'GOAT'];
export function levelOf(v) {
  const x = Math.max(0, Math.min(100, Math.round(v)));
  return { v: x, step: levelStep(x), label: LEVELS[levelStep(x)] };
}
export function levelChip(v, { pctSign = true } = {}) {
  const L = levelOf(v);
  return `<span class="lv lv-${L.step}" title="Niveau selon les stats : ${L.v} % (${L.label})">${pctSign ? `<b>${L.v} %</b>` : ''}${L.label}</span>`;
}
const LV_COLOR = ['#ff5468', '#ff5468', '#ff9a5c', '#ff9a5c', 'var(--wr2)', 'var(--wr2)', 'var(--wr3)', 'var(--wr3)', 'var(--wr5)', 'var(--wr5)', 'var(--wr5)'];
// Cercle de niveau : pourcentage au centre, palier en dessous (ou en infobulle si compact).
export function levelRing(v, { size = 'md', label = true, avatar = false } = {}) {
  const L = levelOf(v);
  if (avatar) {
    const px = size === 'lg' ? 64 : 34;
    return `<span class="lvr lvr-${size} lvr-av${L.step === 10 ? ' goat' : ''}" title="${L.v} % · ${L.label}"><span class="score" style="--p:${L.v};--c:${LV_COLOR[L.step]}">${levelAvatar(L.step, px)}</span><span class="lvr-txt"><b>${L.v} %</b>${label ? `<small class="lv lv-${L.step}">${L.label}</small>` : ''}</span></span>`;
  }
  return `<span class="lvr lvr-${size}${L.step === 10 ? ' goat' : ''}" title="${L.v} % · ${L.label}"><span class="score" style="--p:${L.v};--c:${LV_COLOR[L.step]}"><b>${L.v}</b></span>${label ? `<small class="lv lv-${L.step}">${L.label}</small>` : ''}</span>`;
}

// Avatar du niveau : démon à 0 %, démon de moins en moins menaçant, humain cornu (40 %),
// humain (50 %), puis de plus en plus angélique jusqu'à l'ange ultime (100 %).
const AV = [
  // [fond haut, fond bas, peau, cornes (0-1), yeux, ailes (0-1), auréole (0-2), cheveux]
  ['#3a0610', '#12030a', '#b3202f', 1.0, 'demon', 0, 0, ''],
  ['#3d0914', '#14040c', '#c0303c', 0.85, 'demon', 0, 0, ''],
  ['#3a0c22', '#140512', '#c4434f', 0.7, 'demon', 0, 0, ''],
  ['#34102e', '#130718', '#c95c6c', 0.55, 'imp', 0, 0, '#3a1a1a'],
  ['#2a1530', '#100a1a', '#e7b08f', 0.35, 'human', 0, 0, '#4a2a1c'],
  ['#1b2236', '#0b0f1c', '#efc19d', 0, 'human', 0, 0, '#5a3a24'],
  ['#1b2a40', '#0b121e', '#f2c9a6', 0, 'human', 0, 0.5, '#7a5530'],
  ['#1d3350', '#0c1626', '#f5d0b0', 0, 'calm', 0.35, 1, '#a07a40'],
  ['#21406a', '#0d1a30', '#f8d8bb', 0, 'calm', 0.6, 1, '#d7b25a'],
  ['#2a4f84', '#0f1f3a', '#fbe1c6', 0, 'calm', 0.85, 1.5, '#f0cf6a'],
  ['#3b5fa0', '#122648', '#fff0dc', 0, 'calm', 1.0, 2, '#ffe28a'],
];
export function levelStep(v) {
  const x = Math.max(0, Math.min(100, v));
  return x >= 95 ? 10 : Math.floor(x / 10);
}
export function levelAvatar(step, size = 48) {
  const [c1, c2, skin, horn, eyes, wing, halo, hair] = AV[Math.max(0, Math.min(10, step))];
  const id = `lva${step}`;
  const BAT = step <= 1
    ? `<g fill="#1a0306" stroke="#ff3b3b" stroke-width="0.7" opacity="${step === 0 ? 1 : 0.75}"><path d="M22 42 L4 26 L9 36 L2 38 L10 42 L6 48 L18 46Z"/><path d="M42 42 L60 26 L55 36 L62 38 L54 42 L58 48 L46 46Z"/></g>`
    : '';
  const W = wing
    ? `<g fill="#fff" opacity="${0.55 + wing * 0.4}">
        <path d="M24 40 C${14 - wing * 8} ${36 - wing * 6} ${6 - wing * 4} ${24 - wing * 6} ${10 - wing * 6} ${14 - wing * 4} C14 22 20 30 26 34Z"/>
        <path d="M40 40 C${50 + wing * 8} ${36 - wing * 6} ${58 + wing * 4} ${24 - wing * 6} ${54 + wing * 6} ${14 - wing * 4} C50 22 44 30 38 34Z"/>
      </g>`
    : '';
  const H = horn
    ? `<g fill="${step <= 2 ? '#1c0306' : '#efe3cf'}" stroke="${step <= 2 ? '#ff4d4d' : '#b8a888'}" stroke-width="${step <= 2 ? 0.8 : 0.6}">
        <path d="M${24 - horn * 2} ${24} C${20 - horn * 8} ${18 - horn * 6} ${18 - horn * 6} ${10 - horn * 6} ${22 - horn * 2} ${8 - horn * 4} C${23} ${15 - horn * 2} ${26} ${19} ${28} ${21}Z"/>
        <path d="M${40 + horn * 2} ${24} C${44 + horn * 8} ${18 - horn * 6} ${46 + horn * 6} ${10 - horn * 6} ${42 + horn * 2} ${8 - horn * 4} C${41} ${15 - horn * 2} ${38} ${19} ${36} ${21}Z"/>
      </g>`
    : '';
  const HA = halo
    ? `<ellipse cx="32" cy="${12}" rx="${9 + halo * 1.5}" ry="${2.6 + halo * 0.4}" fill="none" stroke="#ffd96a" stroke-width="${1.6 + halo * 0.5}" opacity="${0.55 + halo * 0.2}"${halo >= 2 ? ' filter="url(#g' + id + ')"' : ''}/>`
    : '';
  const EY = {
    demon: `<path d="M24 31 l6 2 -6 1Z M40 31 l-6 2 6 1Z" fill="#ffd23f"/><circle cx="32" cy="34" r="0" />`,
    imp: `<path d="M24.5 31.5 q3 -1.5 5.5 1 M34 32.5 q2.5 -2.5 5.5 -1" stroke="#2a0a0a" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="27" cy="33.4" r="1.4" fill="#ffd23f"/><circle cx="37" cy="33.4" r="1.4" fill="#ffd23f"/>`,
    human: `<circle cx="27" cy="33" r="1.7" fill="#2a1a14"/><circle cx="37" cy="33" r="1.7" fill="#2a1a14"/>`,
    calm: `<path d="M24.5 33 q2.5 2 5 0 M34.5 33 q2.5 2 5 0" stroke="#5a3a24" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  }[eyes];
  const MO =
    eyes === 'demon'
      ? `<path d="M25 40 q7 5 14 0" stroke="#3a0508" stroke-width="1.6" fill="#3a0508"/><path d="M27.5 40.8 l1 2.4 1-2 M34.5 41 l1 2.2 1-2.4" fill="#fff"/>`
      : eyes === 'imp'
        ? `<path d="M26 40 q6 3.5 12 -1" stroke="#3a0a0a" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
        : `<path d="M27.5 40 q4.5 3 9 0" stroke="#7a3a2a" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
  const HR = hair ? `<path d="M17.5 32 C16 20 24 15 32 15 C40 15 48 20 46.5 32 C45 25 40 22 32 22.5 C25 22 20 25 17.5 32Z" fill="${hair}"/>` : '';
  const BODY = `<path d="M14 64 C16 52 24 48 32 48 C40 48 48 52 50 64Z" fill="${step <= 3 ? '#2a0b12' : step >= 7 ? '#f3f0ff' : '#33415c'}"/>`;
  const glow = step >= 9 ? `<circle cx="32" cy="32" r="30" fill="url(#r${id})"/>` : step <= 1 ? `<circle cx="32" cy="34" r="24" fill="url(#d${id})"/>` : '';
  return `<svg class="lv-av" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <defs>
      <linearGradient id="b${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
      <radialGradient id="r${id}"><stop offset="0" stop-color="#fff6c8" stop-opacity=".55"/><stop offset="1" stop-color="#fff6c8" stop-opacity="0"/></radialGradient>
      <radialGradient id="d${id}"><stop offset=".55" stop-color="#ff2a2a" stop-opacity=".0"/><stop offset="1" stop-color="#ff2a2a" stop-opacity=".45"/></radialGradient>
      <filter id="g${id}"><feGaussianBlur stdDeviation="1.2"/></filter>
      <clipPath id="c${id}"><circle cx="32" cy="32" r="32"/></clipPath>
    </defs>
    <g clip-path="url(#c${id})">
      <rect width="64" height="64" fill="url(#b${id})"/>${glow}${BAT}${W}${BODY}
      <circle cx="32" cy="33" r="14.5" fill="${skin}"/>${HR}${H}${EY}${MO}${HA}
    </g>
  </svg>`;
}

// Niveau des alliés : comparé à un coéquipier moyen (score moyen ≈ 48 → 50 % « Humain »).
// Un allié à 60 de score moyen donne ~75 %, à 30 ~28 %.
export const ALLY_AVG = 48;
export const allyLevel = (avgScore) => Math.max(0, Math.min(100, 50 + (avgScore - ALLY_AVG) * 1.6));
