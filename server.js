'use strict';
/*
 * cupcake.gg — serveur local (Node.js >= 18, aucune dépendance npm).
 *
 * - Sert le site (dossier public/).
 * - Relaie l'API Riot : la clé reste côté serveur, jamais envoyée au navigateur.
 * - Respecte les limites de débit Riot (file d'attente par région) et met en cache.
 * - Construit une tier list à partir d'un échantillon de parties Challenger/Grandmaster.
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

if (typeof fetch !== 'function') {
  console.error('cupcake.gg a besoin de Node.js 18 ou plus récent (fetch natif).');
  process.exit(1);
}

// Variables lues dans .env (les variables déjà définies dans le système restent prioritaires).
const ENV_FROM_FILE = new Set();
loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
// Sur un hébergeur (Render, Railway…), on écoute sur toutes les interfaces.
const HOST = process.env.HOST || (process.env.RENDER || process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : '127.0.0.1');
const KEY = (process.env.RIOT_API_KEY || '').trim();
const LANG = process.env.DDRAGON_LANG || 'fr_FR';
const DEFAULT_PLATFORM = (process.env.DEFAULT_PLATFORM || 'euw1').toLowerCase();
// RIOT_BASE / DDRAGON_BASE : uniquement pour pointer vers un faux serveur de test.
const RIOT_BASE = (process.env.RIOT_BASE || '').replace(/\/$/, '');
const DDRAGON = (process.env.DDRAGON_BASE || 'https://ddragon.leagueoflegends.com').replace(/\/$/, '');
const PUBLIC_DIR = path.join(__dirname, 'public');
// Début de la saison en cours (patch 26.1, 8 janvier 2026). Modifiable dans .env : SEASON_START=AAAA-MM-JJ
// Version de démonstration (message + analyses bloquées) : active par défaut, DEMO=0 dans .env pour la couper.
const DEMO_ON = process.env.DEMO !== '0';
const SEASON_START = process.env.SEASON_START || '2026-01-08';
// DATA_DIR : dossier des données persistantes (sur Render, le chemin du disque, ex. /var/data).
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
// Limites d'une clé de développement : 20 requêtes / 1 s et 100 requêtes / 120 s.
const LIMITS = (process.env.RIOT_RATE_LIMITS || '20:1,100:120')
  .split(',')
  .map((s) => {
    const [n, sec] = s.split(':').map(Number);
    return { n, ms: sec * 1000 };
  })
  .filter((l) => l.n > 0 && l.ms > 0);

/* ------------------------------------------------------------------ */
/* Régions                                                             */
/* ------------------------------------------------------------------ */

const PLATFORMS = {
  euw1: { label: 'EUW', name: 'Europe Ouest', region: 'europe' },
  eun1: { label: 'EUNE', name: 'Europe Nord & Est', region: 'europe' },
  tr1: { label: 'TR', name: 'Turquie', region: 'europe' },
  ru: { label: 'RU', name: 'Russie', region: 'europe' },
  me1: { label: 'ME', name: 'Moyen-Orient', region: 'europe' },
  na1: { label: 'NA', name: 'Amérique du Nord', region: 'americas' },
  br1: { label: 'BR', name: 'Brésil', region: 'americas' },
  la1: { label: 'LAN', name: 'Amérique latine Nord', region: 'americas' },
  la2: { label: 'LAS', name: 'Amérique latine Sud', region: 'americas' },
  kr: { label: 'KR', name: 'Corée', region: 'asia' },
  jp1: { label: 'JP', name: 'Japon', region: 'asia' },
  oc1: { label: 'OCE', name: 'Océanie', region: 'sea' },
  sg2: { label: 'SEA', name: 'Asie du Sud-Est', region: 'sea' },
  tw2: { label: 'TW', name: 'Taïwan', region: 'sea' },
  vn2: { label: 'VN', name: 'Viêt Nam', region: 'sea' },
};
// account-v1 n'existe que sur americas / asia / europe (données globales).
const accountHost = (p) => (PLATFORMS[p].region === 'sea' ? 'asia' : PLATFORMS[p].region);
const matchHost = (p) => PLATFORMS[p].region;

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function loadEnv(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return;
  }
  // Le Bloc-notes de Windows peut enregistrer en UTF-16 ou ajouter un BOM.
  let txt = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
  txt = txt.replace(/^﻿/, '');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    ENV_FROM_FILE.add(m[1]);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;
const clampInt = (v, min, max, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const isPuuid = (s) => /^[A-Za-z0-9_-]{30,100}$/.test(s || '');

function plat(p) {
  if (!PLATFORMS[p]) throw new ApiError(400, `Région inconnue : ${p}`);
  return p;
}
function puuidParam(p) {
  if (!isPuuid(p)) throw new ApiError(400, 'Identifiant joueur invalide.');
  return p;
}
function dec(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new ApiError(400, 'Adresse mal formée.');
  }
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function splitRiotId(id) {
  const s = String(id || '');
  const i = s.lastIndexOf('#');
  return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, ''];
}

// Textes Data Dragon : on garde les retours à la ligne et les mises en avant
// (\u0001 ... \u0002 = gras), tout le reste du balisage est retiré.
const BOLD = 'attention|passive|active|keywordMajor|rarityMythic|rarityLegendary|b|strong';
function rich(s = '') {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '\n• ')
    .replace(new RegExp(`<(${BOLD})(\\s[^>]*)?>`, 'gi'), '\u0001')
    .replace(new RegExp(`</(${BOLD})>`, 'gi'), '\u0002')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Cache mémoire avec durée de vie                                     */
/* ------------------------------------------------------------------ */

class TTLCache {
  constructor(max) {
    this.max = max;
    this.map = new Map();
  }
  get(k) {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) {
      this.map.delete(k);
      return undefined;
    }
    this.map.delete(k);
    this.map.set(k, e);
    return e.v;
  }
  set(k, v, ttlSec) {
    this.map.delete(k);
    this.map.set(k, { v, exp: Date.now() + ttlSec * 1000 });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return v;
  }
}
const cache = new TTLCache(5000);
const names = new TTLCache(50000);

function rememberName(puuid, name, tag) {
  return names.set(puuid, { name, tag }, 86400);
}

/* ---------- Annuaire des joueurs connus (suggestions pendant la saisie) ---------- */
// Riot ne permet pas de chercher un joueur par début de nom : on indexe tous les
// joueurs croisés (profils, parties, classement, partie en direct) pour les proposer.
const players = new Map(); // clé « plateforme|nom#tag » en minuscules
const normName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
let playersDirty = false;
function indexPlayer(p, name, tag, extra = {}) {
  if (!p || !name || !tag || !PLATFORMS[p]) return;
  const k = `${p}|${name}#${tag}`.toLowerCase();
  const prev = players.get(k);
  players.set(k, { p, name, tag, n: normName(name), icon: extra.icon ?? prev?.icon ?? null, tier: extra.tier || prev?.tier || '', lp: extra.lp ?? prev?.lp ?? null, seen: Date.now() });
  playersDirty = true;
  if (players.size > 80000) {
    const old = [...players.entries()].sort((a, b) => a[1].seen - b[1].seen).slice(0, 10000);
    for (const [key] of old) players.delete(key);
  }
}
function searchPlayers(q, p, limit = 8) {
  const raw = String(q || '');
  const [namePart, tagPart = null] = raw.includes('#') ? [raw.slice(0, raw.lastIndexOf('#')), raw.slice(raw.lastIndexOf('#') + 1)] : [raw, null];
  const n = normName(namePart);
  const t = tagPart == null ? null : tagPart.toLowerCase().trim();
  if (!n || n.length < 2) return [];
  const out = [];
  for (const x of players.values()) {
    if (t != null && !x.tag.toLowerCase().startsWith(t)) continue;
    const i = x.n.indexOf(n);
    if (i < 0) continue;
    out.push({ x, score: (i === 0 ? 0 : 2) + (x.p === p ? 0 : 1) + (x.n === n ? -1 : 0) });
  }
  out.sort((a, b) => a.score - b.score || (b.x.lp ?? -1) - (a.x.lp ?? -1) || a.x.n.length - b.x.n.length);
  return out.slice(0, limit).map(({ x }) => ({ p: x.p, name: x.name, tag: x.tag, icon: x.icon, tier: x.tier, lp: x.lp }));
}

/* ------------------------------------------------------------------ */
/* Limiteur de débit (une file par hôte Riot, priorité utilisateur)    */
/* ------------------------------------------------------------------ */

class Limiter {
  constructor(limits) {
    this.limits = limits;
    this.stamps = [];
    this.q = [[], []]; // 0 = utilisateur, 1 = tâche de fond (tier list)
    this.blockedUntil = 0;
    this.timer = null;
  }
  schedule(fn, prio = 0) {
    return new Promise((res, rej) => {
      this.q[prio ? 1 : 0].push({ fn, res, rej });
      if (!prio && this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.pump();
    });
  }
  waitFor(prio, now) {
    let wait = Math.max(0, this.blockedUntil - now);
    for (const { n, ms } of this.limits) {
      // La tâche de fond laisse toujours 30 % de marge aux recherches.
      const cap = prio ? Math.max(1, Math.floor(n * 0.7)) : n;
      const recent = this.stamps.filter((t) => now - t < ms);
      if (recent.length >= cap) wait = Math.max(wait, recent[recent.length - cap] + ms - now + 15);
    }
    return wait;
  }
  pump() {
    if (this.timer) return;
    for (;;) {
      const prio = this.q[0].length ? 0 : this.q[1].length ? 1 : -1;
      if (prio < 0) return;
      const now = Date.now();
      const maxMs = Math.max(1000, ...this.limits.map((l) => l.ms));
      while (this.stamps.length && now - this.stamps[0] >= maxMs) this.stamps.shift();
      const wait = this.waitFor(prio, now);
      if (wait > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.pump();
        }, wait);
        return;
      }
      const job = this.q[prio].shift();
      this.stamps.push(now);
      Promise.resolve().then(job.fn).then(job.res, job.rej);
    }
  }
}
const limiters = new Map();
function limiterFor(host) {
  if (!limiters.has(host)) limiters.set(host, new Limiter(LIMITS));
  return limiters.get(host);
}

/* ------------------------------------------------------------------ */
/* Appels Riot                                                         */
/* ------------------------------------------------------------------ */

const RIOT_ERRORS = {
  400: 'Requête refusée par Riot (paramètre invalide).',
  401: 'Clé API Riot refusée (401) : Riot ne reconnaît pas cette clé. Elle a expiré (une clé de développement dure 24 h), a été régénérée ou est mal copiée. Génère-en une nouvelle sur developer.riotgames.com, colle-la dans .env, puis relance le serveur.',
  403: 'Clé API Riot refusée (403) : clé expirée ou sans accès à cette donnée. Génère-en une nouvelle sur developer.riotgames.com, colle-la dans .env, puis relance le serveur.',
  429: 'Trop de requêtes vers Riot pour le moment. Réessaie dans quelques secondes.',
  500: 'Erreur interne chez Riot. Réessaie plus tard.',
  502: 'Passerelle Riot indisponible. Réessaie plus tard.',
  503: 'Service Riot indisponible (maintenance probable).',
  504: 'Riot ne répond pas. Réessaie plus tard.',
};
const inflight = new Map();

async function riot(host, apiPath, opts = {}) {
  const { prio = 0, ttl = 60, force = false, store = true } = opts;
  if (!KEY) {
    throw new ApiError(500, 'Aucune clé API : ajoute RIOT_API_KEY=... dans le fichier .env puis relance le serveur.');
  }
  const key = host + apiPath;
  if (!force && store) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
  }
  if (inflight.has(key)) return inflight.get(key);

  const url = RIOT_BASE ? `${RIOT_BASE}/${host}${apiPath}` : `https://${host}.api.riotgames.com${apiPath}`;
  const lim = limiterFor(host);
  const job = (async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      let res;
      try {
        res = await lim.schedule(
          () => fetch(url, { headers: { 'X-Riot-Token': KEY }, signal: AbortSignal.timeout(15000) }),
          prio
        );
      } catch {
        if (attempt < 2) {
          await sleep(700);
          continue;
        }
        throw new ApiError(502, "Impossible de joindre l'API Riot. Vérifie ta connexion internet.");
      }
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after')) || 2;
        lim.blockedUntil = Math.max(lim.blockedUntil, Date.now() + ra * 1000);
        await res.arrayBuffer().catch(() => {});
        continue;
      }
      if (res.status >= 500 && attempt < 2) {
        await res.arrayBuffer().catch(() => {});
        await sleep(800 * (attempt + 1));
        continue;
      }
      if (res.status === 404) {
        await res.arrayBuffer().catch(() => {});
        if (store) cache.set(key, null, Math.min(ttl, 60));
        return null;
      }
      if (!res.ok) {
        await res.arrayBuffer().catch(() => {});
        throw new ApiError(res.status, RIOT_ERRORS[res.status] || `Erreur Riot ${res.status}.`);
      }
      const data = await res.json();
      if (store) cache.set(key, data, ttl);
      return data;
    }
    throw new ApiError(429, RIOT_ERRORS[429]);
  })();
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

/* ------------------------------------------------------------------ */
/* Data Dragon (données statiques : champions, objets, runes, sorts)   */
/* ------------------------------------------------------------------ */

async function dd(p, ttl = 21600) {
  const key = 'dd:' + p;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let res;
  try {
    res = await fetch(DDRAGON + p, { signal: AbortSignal.timeout(20000) });
  } catch {
    res = null;
  }
  if (!res || !res.ok) throw new ApiError(502, `Data Dragon indisponible (${p}).`);
  return cache.set(key, await res.json(), ttl);
}

// Données du jeu en français (par défaut) ou en anglais pour la version anglaise du site.
const STATIC_LANGS = ['fr_FR', 'en_US'];
const langOf = (l) => (STATIC_LANGS.includes(l) ? l : LANG);
const staticMemByLang = {};

async function latestStaticFile(lang = LANG) {
  try {
    const files = (await fsp.readdir(DATA_DIR)).filter((f) => f.startsWith('static-') && f.endsWith(`-${lang}.json`));
    const stats = await Promise.all(files.map(async (f) => ({ f, t: (await fsp.stat(path.join(DATA_DIR, f))).mtimeMs })));
    stats.sort((a, b) => b.t - a.t);
    return stats.length ? JSON.parse(await fsp.readFile(path.join(DATA_DIR, stats[0].f), 'utf8')) : null;
  } catch {
    return null;
  }
}

async function getStatic(lang = LANG) {
  lang = langOf(lang);
  const staticMem = staticMemByLang[lang];
  if (staticMem && Date.now() - staticMem.at < 3 * 3600e3) return staticMem.data;
  let version;
  try {
    version = (await dd('/api/versions.json', 3600))[0];
  } catch (e) {
    const fallback = await latestStaticFile(lang);
    if (fallback) {
      staticMemByLang[lang] = { at: Date.now(), data: fallback };
      return fallback;
    }
    throw e;
  }
  const file = path.join(DATA_DIR, `static-${version}-${lang}.json`);
  try {
    const data = JSON.parse(await fsp.readFile(file, 'utf8'));
    staticMemByLang[lang] = { at: Date.now(), data };
    return data;
  } catch {
    /* pas encore en cache disque */
  }
  const base = `/cdn/${version}/data/${lang}`;
  const [champ, item, summ, runes] = await Promise.all(
    ['champion', 'item', 'summoner', 'runesReforged'].map((n) => dd(`${base}/${n}.json`))
  );
  const data = buildStatic(version, champ, item, summ, runes, lang);
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(file, JSON.stringify(data));
  staticMemByLang[lang] = { at: Date.now(), data };
  return data;
}

function buildStatic(version, champ, item, summ, runes, lang = LANG) {
  const champions = {};
  for (const c of Object.values(champ.data)) {
    champions[c.key] = {
      id: c.id,
      key: Number(c.key),
      name: c.name,
      title: c.title,
      tags: c.tags,
      info: c.info,
      partype: c.partype,
      img: c.image?.full || `${c.id}.png`,
    };
  }
  const items = {};
  for (const [id, it] of Object.entries(item.data)) {
    items[id] = {
      name: it.name,
      desc: rich(it.description),
      plain: it.plaintext || '',
      gold: it.gold?.total || 0,
      base: it.gold?.base || 0,
      sell: it.gold?.sell || 0,
      tags: it.tags || [],
      from: it.from || [],
      into: it.into || [],
      depth: it.depth || 1,
      sr:
        !!(it.maps && it.maps['11']) &&
        it.gold?.purchasable !== false &&
        it.inStore !== false &&
        !it.hideFromAll &&
        !it.requiredChampion &&
        !it.requiredAlly,
      img: it.image?.full || `${id}.png`,
    };
  }
  const spells = {};
  for (const s of Object.values(summ.data)) {
    spells[s.key] = {
      id: s.id,
      name: s.name,
      desc: rich(s.description),
      cd: s.cooldownBurn,
      modes: s.modes || [],
      level: Number(s.summonerLevel) || 1,
      img: s.image?.full || `${s.id}.png`,
    };
  }
  const runeMap = {};
  const trees = [];
  for (const t of runes) {
    trees.push({ id: t.id, key: t.key, name: t.name, icon: t.icon, slots: t.slots.map((s) => s.runes.map((r) => r.id)) });
    runeMap[t.id] = { name: t.name, icon: t.icon, tree: t.id, isTree: true };
    for (const s of t.slots) {
      for (const r of s.runes) {
        runeMap[r.id] = { name: r.name, icon: r.icon, tree: t.id, short: rich(r.shortDesc), long: rich(r.longDesc) };
      }
    }
  }
  return { version, lang, cdn: `${DDRAGON}/cdn`, champions, items, spells, runes: runeMap, trees };
}

/* ---------- Skins : rareté (Community Dragon) et prix ---------- */

let skinMem = null;
async function getSkinData() {
  if (skinMem && Date.now() - skinMem.at < 12 * 3600e3) return skinMem.data;
  const file = path.join(DATA_DIR, 'skins.json');
  const loc = LANG.toLowerCase();
  let data = null;
  try {
    const r = await fetch(`${process.env.CDRAGON_BASE || 'https://raw.communitydragon.org'}/latest/plugins/rcp-be-lol-game-data/global/${loc === 'en_us' ? 'default' : loc}/v1/skins.json`, {
      signal: AbortSignal.timeout(20000),
    });
    if (r.ok) {
      const raw = await r.json();
      data = {};
      for (const sk of Object.values(raw)) {
        data[sk.id] = { r: sk.rarity || 'kNoRarity', legacy: !!sk.isLegacy, line: sk.skinLines?.[0]?.id || 0 };
      }
      await writeJson(file, data).catch(() => {});
    }
  } catch {
    /* réseau indisponible */
  }
  if (!data) data = await readJson(file, {});
  skinMem = { at: Date.now(), data };
  return data;
}

// Prix exacts : module Lua « SkinData » du wiki League of Legends (lu et mis en cache 24 h).
function parseLuaTable(src) {
  let i = src.indexOf('{');
  const ws = () => {
    for (;;) {
      while (i < src.length && /\s|,|;/.test(src[i])) i++;
      if (src.startsWith('--', i)) {
        const nl = src.indexOf('\n', i);
        i = nl < 0 ? src.length : nl;
      } else return;
    }
  };
  const str = () => {
    const q = src[i++];
    let out = '';
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') i++;
      out += src[i++];
    }
    i++;
    return out;
  };
  const val = () => {
    ws();
    const ch = src[i];
    if (ch === '{') return table();
    if (ch === '"' || ch === "'") return str();
    const m = /^(-?\d+(?:\.\d+)?|true|false|nil)/.exec(src.slice(i, i + 40));
    if (m) {
      i += m[0].length;
      return m[0] === 'true' ? true : m[0] === 'false' ? false : m[0] === 'nil' ? null : Number(m[0]);
    }
    // valeur inconnue : on saute jusqu'au prochain séparateur
    while (i < src.length && !/[,}\n]/.test(src[i])) i++;
    return null;
  };
  const table = () => {
    i++;
    const obj = {};
    let n = 1;
    for (;;) {
      ws();
      if (i >= src.length) return obj;
      if (src[i] === '}') {
        i++;
        return obj;
      }
      let key;
      if (src[i] === '[') {
        i++;
        ws();
        key = src[i] === '"' || src[i] === "'" ? str() : val();
        ws();
        i++; // ]
        ws();
        i++; // =
      } else {
        const m = /^([A-Za-z_]\w*)\s*=/.exec(src.slice(i, i + 80));
        if (m) {
          key = m[1];
          i += m[0].length;
        } else key = n++;
      }
      obj[key] = val();
    }
  };
  return table();
}

let priceMem = null;
async function getSkinPrices() {
  if (priceMem && Date.now() - priceMem.at < 24 * 3600e3) return priceMem.data;
  const file = path.join(DATA_DIR, 'skin-prices.json');
  let data = null;
  const urls = [
    process.env.SKINDATA_URL,
    'https://wiki.leagueoflegends.com/en-us/Module:SkinData/data?action=raw',
    'https://leagueoflegends.fandom.com/wiki/Module:SkinData/data?action=raw',
  ].filter(Boolean);
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'cupcake.gg (local)' } });
      if (!r.ok) continue;
      const lua = parseLuaTable(await r.text());
      const out = {};
      for (const champ of Object.values(lua || {})) {
        if (!champ || typeof champ !== 'object' || typeof champ.id !== 'number') continue;
        for (const sk of Object.values(champ.skins || {})) {
          if (!sk || typeof sk.id !== 'number') continue;
          out[champ.id * 1000 + sk.id] = sk.cost ?? null;
        }
      }
      if (Object.keys(out).length > 500) {
        data = out;
        break;
      }
    } catch {
      /* source suivante */
    }
  }
  if (data) await writeJson(file, data).catch(() => {});
  else data = await readJson(file, {});
  priceMem = { at: Date.now(), data };
  return data;
}

async function getChampion(id, lang = LANG) {
  if (!/^[A-Za-z0-9]+$/.test(id)) throw new ApiError(400, 'Champion invalide.');
  lang = langOf(lang);
  const st = await getStatic(lang);
  let d;
  try {
    d = await dd(`/cdn/${st.version}/data/${lang}/champion/${id}.json`);
  } catch {
    throw new ApiError(404, 'Champion introuvable.');
  }
  const c = d?.data?.[id];
  if (!c) throw new ApiError(404, 'Champion introuvable.');
  const [skinInfo, prices] = await Promise.all([getSkinData().catch(() => ({})), getSkinPrices().catch(() => ({}))]);
  return {
    id: c.id,
    key: Number(c.key),
    name: c.name,
    title: c.title,
    lore: c.lore,
    tags: c.tags,
    partype: c.partype,
    info: c.info,
    stats: c.stats,
    allytips: c.allytips || [],
    enemytips: c.enemytips || [],
    // Les chromas et variantes (« Nom du skin (couleur) ») ne sont pas des skins à part entière.
    skins: (c.skins || [])
      .filter((s) => {
        if (s.parentSkin !== undefined) return false;
        const base = s.name.replace(/\s*\([^)]*\)\s*$/, '');
        return base === s.name || !(c.skins || []).some((o) => o !== s && o.name === base);
      })
      .map((s) => {
        const info = skinInfo[Number(c.key) * 1000 + s.num] || {};
        const cost = prices[Number(c.key) * 1000 + s.num];
        return { num: s.num, name: s.name, rarity: info.r || null, legacy: !!info.legacy, cost: cost ?? null };
      }),
    passive: { name: c.passive.name, desc: rich(c.passive.description), img: c.passive.image.full },
    spells: c.spells.map((s, i) => ({
      key: 'QWER'[i],
      name: s.name,
      desc: rich(s.description),
      cd: s.cooldownBurn,
      cost: s.costBurn,
      range: s.rangeBurn,
      max: s.maxrank,
      img: s.image.full,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Joueurs, parties, partie en direct                                  */
/* ------------------------------------------------------------------ */

function compactLeague(entries) {
  const out = {};
  for (const e of entries || []) {
    const k = e.queueType === 'RANKED_SOLO_5x5' ? 'solo' : e.queueType === 'RANKED_FLEX_SR' ? 'flex' : null;
    if (!k) continue;
    out[k] = {
      tier: e.tier,
      rank: e.rank,
      lp: e.leaguePoints,
      w: e.wins,
      l: e.losses,
      hot: !!e.hotStreak,
      vet: !!e.veteran,
      fresh: !!e.freshBlood,
      series: e.miniSeries ? e.miniSeries.progress : null,
    };
  }
  return out;
}

/* ---------- Historique de LP (un point à chaque consultation du profil) ---------- */
// Riot ne fournit pas l'historique des LP : on enregistre le rang à chaque visite (1 point par heure max).
const lpFile = path.join(DATA_DIR, 'lp-history.json');
let lpMem = null;
let lpTimer = null;
const TIER_IDX = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIV_IDX = { IV: 0, III: 1, II: 2, I: 3 };
// Valeur continue : 400 points par palier (100 par division), LP au-delà de Maître ajoutés tels quels.
const lpValue = (r) => {
  const t = TIER_IDX.indexOf(r.tier);
  if (t < 0) return null;
  return t >= 7 ? 2800 + r.lp : t * 400 + (DIV_IDX[r.rank] ?? 0) * 100 + r.lp;
};
async function recordLp(puuid, solo) {
  if (!lpMem) lpMem = await readJson(lpFile, {});
  const list = lpMem[puuid] || (lpMem[puuid] = []);
  if (solo) {
    const v = lpValue(solo);
    const last = list[list.length - 1];
    const now = Date.now();
    if (v != null && (!last || last.v !== v || now - last.t > 24 * 3600e3) && (!last || now - last.t > 3600e3 || last.v !== v)) {
      list.push({ t: now, v, tier: solo.tier, rank: solo.rank, lp: solo.lp });
      if (list.length > 200) list.splice(0, list.length - 200);
      clearTimeout(lpTimer);
      lpTimer = setTimeout(() => writeJson(lpFile, lpMem).catch(() => {}), 5000);
    }
  }
  return list.slice(-60);
}

/* ---------- Peak et rangs par saison ---------- */
// Riot ne donne ni le peak ni les rangs des saisons passées (league-v4 = rang actuel seulement).
// cupcake.gg enregistre donc lui-même, pour chaque joueur croisé (profil, partie, classement),
// le meilleur rang et le dernier rang connus de chaque saison, en Solo/Duo et en Flex.
// Fichier : data/peaks.json. Une saison commence vers le 8 janvier (patch xx.1).
const peaksFile = path.join(DATA_DIR, 'peaks.json');
let peaksMem = null;
let peaksTimer = null;
function seasonOf(t) {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const [, mm, dd] = SEASON_START.split('-').map(Number);
  const start = Date.UTC(y, (mm || 1) - 1, dd || 8);
  return String(t < start ? y - 1 : y);
}
async function recordPeaks(puuid, ranked) {
  if (!puuid || !ranked) return null;
  if (!peaksMem) peaksMem = await readJson(peaksFile, {});
  const now = Date.now();
  const season = seasonOf(now);
  const P = peaksMem[puuid] || (peaksMem[puuid] = {});
  const S = P[season] || (P[season] = {});
  let changed = false;
  for (const q of ['solo', 'flex']) {
    const r = ranked[q];
    if (!r?.tier) continue;
    const v = lpValue(r);
    if (v == null) continue;
    const cur = { tier: r.tier, rank: r.rank, lp: r.lp, v, t: now, w: r.w, l: r.l };
    const box = S[q] || (S[q] = {});
    if (!box.peak || v > box.peak.v) {
      box.peak = cur;
      changed = true;
    }
    if (!box.last || box.last.v !== v || now - box.last.t > 6 * 3600e3) {
      box.last = cur;
      changed = true;
    }
  }
  if (changed) {
    clearTimeout(peaksTimer);
    peaksTimer = setTimeout(() => writeJson(peaksFile, peaksMem).catch(() => {}), 5000);
  }
  return P;
}
// Saisons triées (plus récente d'abord) et meilleur rang Solo/Duo jamais enregistré.
function seasonsView(P) {
  const seasons = Object.entries(P || {})
    .map(([season, x]) => ({ season, solo: x.solo || null, flex: x.flex || null }))
    .sort((a, b) => b.season.localeCompare(a.season));
  let peak = null;
  for (const s of seasons) {
    const p = s.solo?.peak;
    if (p && (!peak || p.v > peak.v)) peak = { ...p, season: s.season, q: 'solo' };
  }
  return { seasons, peak, current: seasonOf(Date.now()) };
}

async function getSummoner(platform, name, tag, force) {
  name = name.trim();
  tag = tag.trim().replace(/^#/, '');
  if (!name || !tag) throw new ApiError(400, 'Saisis un Riot ID complet, par exemple Nom#EUW.');
  const acc = await riot(accountHost(platform), `/riot/account/v1/accounts/by-riot-id/${enc(name)}/${enc(tag)}`, {
    ttl: 3600,
    force,
  });
  if (!acc) {
    throw new ApiError(404, `Aucun joueur « ${name}#${tag} ». Vérifie l'orthographe du nom et du tag.`);
  }
  const [sum, league, mastery] = await Promise.all([
    riot(platform, `/lol/summoner/v4/summoners/by-puuid/${acc.puuid}`, { ttl: 300, force }),
    riot(platform, `/lol/league/v4/entries/by-puuid/${acc.puuid}`, { ttl: 300, force }),
    riot(platform, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${acc.puuid}`, { ttl: 900, force }).catch(() => []),
  ]);
  if (!sum) {
    throw new ApiError(
      404,
      `« ${acc.gameName}#${acc.tagLine} » existe, mais n'a pas de compte League of Legends sur ${PLATFORMS[platform].label}. Essaie une autre région.`
    );
  }
  rememberName(acc.puuid, acc.gameName, acc.tagLine);
  {
    const solo = compactLeague(league).solo;
    indexPlayer(platform, acc.gameName, acc.tagLine, { icon: sum.profileIconId, tier: solo?.tier, lp: solo?.lp });
  }
  const [known] = await tagKnown([{ puuid: acc.puuid, name: acc.gameName, tag: acc.tagLine }]);
  // Pas reconnu : recherche ponctuelle dans les sources publiques (3 s max, résultat mémorisé).
  if (!known.pro) {
    const found = await Promise.race([discoverPro(acc.puuid, acc.gameName, acc.tagLine), sleep(3000).then(() => null)]).catch(() => null);
    if (found) known.pro = found;
  }
  return {
    platform,
    puuid: acc.puuid,
    name: acc.gameName,
    tag: acc.tagLine,
    pro: known.pro || null,
    icon: sum.profileIconId,
    level: sum.summonerLevel,
    fetchedAt: Date.now(),
    lpHistory: await recordLp(acc.puuid, compactLeague(league).solo).catch(() => []),
    ...seasonsView(await recordPeaks(acc.puuid, compactLeague(league)).catch(() => null)),
    ranked: compactLeague(league),
    mastery: (mastery || []).map((m) => ({
      c: m.championId,
      lvl: m.championLevel,
      pts: m.championPoints,
      last: m.lastPlayTime,
      marks: m.tokensEarned || 0,
    })),
  };
}

function compactMatch(raw) {
  const i = raw.info;
  // gameDuration est en secondes depuis la 11.20 (avant : millisecondes, sans gameEndTimestamp).
  const dur = i.gameEndTimestamp ? i.gameDuration : Math.round(i.gameDuration / 1000);
  const start = i.gameStartTimestamp || i.gameCreation;
  const parts = i.participants.map((p) => {
    const styles = p.perks?.styles || [];
    const ch = p.challenges || {};
    return {
      puuid: p.puuid,
      name: p.riotIdGameName || p.summonerName || 'Joueur',
      tag: p.riotIdTagline || '',
      champ: p.championId,
      lvl: p.champLevel,
      team: p.teamId,
      pos: p.teamPosition || '',
      win: !!p.win,
      k: p.kills,
      d: p.deaths,
      a: p.assists,
      cs: (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0),
      gold: p.goldEarned || 0,
      dmg: p.totalDamageDealtToChampions || 0,
      taken: p.totalDamageTaken || 0,
      mitig: p.damageSelfMitigated || 0,
      heal: (p.totalHealsOnTeammates || 0) + (p.totalDamageShieldedOnTeammates || 0),
      vis: p.visionScore || 0,
      wp: p.wardsPlaced || 0,
      wk: p.wardsKilled || 0,
      pink: p.visionWardsBoughtInGame || 0,
      obj: p.damageDealtToObjectives || 0,
      bld: p.damageDealtToBuildings || 0,
      cc: p.timeCCingOthers || 0,
      items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6].map((x) => x || 0),
      s1: p.summoner1Id,
      s2: p.summoner2Id,
      ks: styles[0]?.selections?.[0]?.perk || 0,
      ps: styles[0]?.style || 0,
      ss: styles[1]?.style || 0,
      perks: styles.flatMap((s) => (s.selections || []).map((x) => x.perk)),
      shards: p.perks?.statPerks ? [p.perks.statPerks.offense, p.perks.statPerks.flex, p.perks.statPerks.defense] : [],
      multi: p.largestMultiKill || 0,
      penta: p.pentaKills || 0,
      quadra: p.quadraKills || 0,
      triple: p.tripleKills || 0,
      double: p.doubleKills || 0,
      fb: !!p.firstBloodKill,
      place: p.placement || 0,
      sub: p.playerSubteamId || 0,
      solo: ch.soloKills || 0,
      cs10: ch.laneMinionsFirst10Minutes || 0,
    };
  });
  const teams = (i.teams || []).map((t) => {
    const o = t.objectives || {};
    return {
      id: t.teamId,
      win: !!t.win,
      bans: (t.bans || []).map((b) => b.championId).filter((c) => c > 0),
      kills: o.champion?.kills || 0,
      baron: o.baron?.kills || 0,
      dragon: o.dragon?.kills || 0,
      herald: o.riftHerald?.kills || 0,
      grubs: o.horde?.kills || 0,
      atakhan: o.atakhan?.kills || 0,
      tower: o.tower?.kills || 0,
      inhib: o.inhibitor?.kills || 0,
    };
  });
  return {
    id: raw.metadata.matchId,
    q: i.queueId,
    mode: i.gameMode,
    map: i.mapId,
    start,
    end: i.gameEndTimestamp || start + dur * 1000,
    dur,
    ver: (i.gameVersion || '').split('.').slice(0, 2).join('.'),
    remake: i.participants.some((p) => p.gameEndedInEarlySurrender),
    teams,
    parts,
  };
}

async function getMatch(platform, id) {
  const ck = 'm:' + id;
  const hit = cache.get(ck);
  if (hit) return hit;
  const raw = await riot(matchHost(platform), `/lol/match/v5/matches/${id}`, { store: false });
  if (!raw || !raw.info) return null;
  const m = compactMatch(raw);
  for (const pp of m.parts) if (pp.tag) indexPlayer(platform, pp.name, pp.tag);
  return cache.set(ck, m, 3 * 86400);
}

async function getMatches(platform, puuid, q) {
  const start = clampInt(q.start, 0, 900, 0);
  const count = clampInt(q.count, 1, 20, 10);
  let qs = `start=${start}&count=${count}`;
  if (/^\d+$/.test(q.queue || '')) qs += `&queue=${q.queue}`;
  if (q.type === 'ranked' || q.type === 'normal') qs += `&type=${q.type}`;
  const ids =
    (await riot(matchHost(platform), `/lol/match/v5/matches/by-puuid/${puuid}/ids?${qs}`, {
      ttl: 90,
      force: q.force === '1',
    })) || [];
  const matches = await Promise.all(ids.map((id) => getMatch(platform, id).catch(() => null)));
  const ok = matches.filter(Boolean);
  // Badge pro ou streamer des joueurs croisés (copie : le cache garde la partie brute).
  const out = ok.map((mm) => ({ ...mm, parts: mm.parts.map((pp) => ({ ...pp })) }));
  for (const pp of out.flatMap((mm) => mm.parts)) if (pp.puuid && pp.tag) rememberName(pp.puuid, pp.name, pp.tag);
  await tagKnown(out.flatMap((mm) => mm.parts));
  return { start, count, more: ids.length === count, matches: out };
}

// Nombre de parties jouées depuis le début de la saison (toutes files), 100 identifiants par requête.
async function getSeasonCount(platform, puuid, force) {
  const ck = `season:${platform}:${puuid}`;
  if (!force) {
    const hit = cache.get(ck);
    if (hit) return hit;
  }
  const since = Math.floor(new Date(SEASON_START + 'T00:00:00Z').getTime() / 1000);
  const host = matchHost(platform);
  let total = 0;
  let capped = false;
  for (let page = 0; page < 15; page++) {
    const ids =
      (await riot(host, `/lol/match/v5/matches/by-puuid/${puuid}/ids?startTime=${since}&start=${page * 100}&count=100`, {
        store: false,
      })) || [];
    total += ids.length;
    if (ids.length < 100) break;
    if (page === 14) capped = true;
  }
  return cache.set(ck, { total, capped, since: SEASON_START }, 3600);
}

function compactTimeline(raw) {
  const info = raw.info;
  const pmap = {};
  for (const p of info.participants || []) pmap[p.participantId] = p.puuid;
  const frames = info.frames.map((f) => {
    const pf = {};
    for (const [pid, v] of Object.entries(f.participantFrames || {})) {
      pf[pid] = { g: v.totalGold, cs: (v.minionsKilled || 0) + (v.jungleMinionsKilled || 0), xp: v.xp, lvl: v.level };
    }
    return { t: f.timestamp, pf };
  });
  const ev = [];
  for (const f of info.frames) {
    for (const e of f.events || []) {
      const t = e.timestamp;
      switch (e.type) {
        case 'ITEM_PURCHASED':
          ev.push({ ty: 'buy', t, p: e.participantId, i: e.itemId });
          break;
        case 'ITEM_UNDO':
          ev.push({ ty: 'undo', t, p: e.participantId, i: e.beforeId });
          break;
        case 'ITEM_SOLD':
          ev.push({ ty: 'sell', t, p: e.participantId, i: e.itemId });
          break;
        case 'SKILL_LEVEL_UP':
          if (e.levelUpType !== 'EVOLVE') ev.push({ ty: 'skill', t, p: e.participantId, s: e.skillSlot });
          break;
        case 'CHAMPION_KILL':
          ev.push({ ty: 'kill', t, k: e.killerId, v: e.victimId, a: e.assistingParticipantIds || [] });
          break;
        case 'ELITE_MONSTER_KILL':
          ev.push({ ty: 'monster', t, team: e.killerTeamId, m: e.monsterType, sub: e.monsterSubType || '' });
          break;
        case 'BUILDING_KILL':
          ev.push({ ty: 'building', t, team: e.teamId, b: e.buildingType, tower: e.towerType || '' });
          break;
        default:
      }
    }
  }
  return { pmap, frames, ev };
}

async function getTimeline(platform, id) {
  const ck = 't:' + id;
  const hit = cache.get(ck);
  if (hit) return hit;
  const raw = await riot(matchHost(platform), `/lol/match/v5/matches/${id}/timeline`, { store: false });
  if (!raw || !raw.info) throw new ApiError(404, "La chronologie de cette partie n'est pas disponible.");
  return cache.set(ck, compactTimeline(raw), 86400);
}

/* ---------- Partie en direct : rôles déduits et duos ---------- */

// Rôles habituels par champion (identifiants Data Dragon). Un champion peut figurer dans plusieurs rôles.
const ROLE_TABLE = {
  TOP: 'Aatrox Ambessa Camille Chogath Darius DrMundo Fiora Gangplank Garen Gnar Gragas Gwen Heimerdinger Illaoi Irelia Jax Jayce KSante Kayle Kennen Kled Malphite Mordekaiser Nasus Olaf Ornn Pantheon Poppy Quinn Renekton Riven Rumble Ryze Sett Shen Singed Sion Teemo Trundle Tryndamere Urgot Vayne Vladimir Volibear Warwick Yorick Yone Zac Akali Aurora Smolder',
  JUNGLE: 'Amumu Belveth Briar Diana Ekko Elise Evelynn Fiddlesticks Gragas Graves Hecarim Ivern JarvanIV Jax Karthus Kayn Khazix Kindred LeeSin Lillia MasterYi MonkeyKing Naafiri Nidalee Nocturne Nunu Poppy Rammus RekSai Rengar Sejuani Shaco Shyvana Skarner Taliyah Talon Trundle Udyr Vi Viego Volibear Warwick XinZhao Zac Zyra Brand',
  MIDDLE: 'Ahri Akali Akshan Anivia Annie AurelionSol Aurora Azir Cassiopeia Corki Diana Ekko Fizz Galio Hwei Irelia Kassadin Katarina Leblanc Lissandra Lux Malzahar Mel Naafiri Neeko Orianna Qiyana Ryze Smolder Sylas Syndra Taliyah Talon TwistedFate Veigar Velkoz Vex Viktor Vladimir Xerath Yasuo Yone Zed Ziggs Zoe Tristana Swain',
  BOTTOM: 'Aphelios Ashe Caitlyn Draven Ezreal Jhin Jinx Kaisa Kalista KogMaw Lucian MissFortune Nilah Samira Senna Sivir Smolder Tristana Twitch Varus Vayne Xayah Zeri Ziggs Swain Seraphine Karthus Yunara',
  UTILITY: 'Alistar Bard Blitzcrank Brand Braum Janna Karma Leona Lulu Lux Maokai Milio Morgana Nami Nautilus Neeko Pyke Rakan Rell Renata Senna Seraphine Sona Soraka Swain Taric Thresh Velkoz Xerath Yuumi Zilean Zyra Poppy Camille Shaco Galio Hwei Annie Mel',
};
const ROLE_KEYS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const ROLE_SETS = Object.fromEntries(Object.entries(ROLE_TABLE).map(([r, list]) => [r, new Set(list.split(' '))]));
const TAG_ROLES = {
  Marksman: { BOTTOM: 1 },
  Support: { UTILITY: 1 },
  Mage: { MIDDLE: 0.7, UTILITY: 0.3 },
  Assassin: { MIDDLE: 0.6, JUNGLE: 0.4 },
  Fighter: { TOP: 0.6, JUNGLE: 0.4 },
  Tank: { TOP: 0.4, UTILITY: 0.35, JUNGLE: 0.25 },
};

function roleScores(p, st, metaP) {
  const c = st.champions[p.champ];
  const score = Object.fromEntries(ROLE_KEYS.map((r) => [r, 0]));
  if (c) {
    for (const r of ROLE_KEYS) if (ROLE_SETS[r].has(c.id)) score[r] += 1;
    for (const t of c.tags || []) for (const [r, v] of Object.entries(TAG_ROLES[t] || {})) score[r] += v * 0.3;
  }
  if (metaP) {
    const counts = ROLE_KEYS.map((r) => metaP.champs[`${p.champ}|${r}`]?.g || 0);
    const total = counts.reduce((a, b) => a + b, 0);
    if (total >= 5) ROLE_KEYS.forEach((r, i) => (score[r] += (counts[i] / total) * 3));
  }
  const spells = [p.s1, p.s2];
  if (spells.includes(11)) score.JUNGLE += 10;
  else score.JUNGLE -= 3;
  if (spells.includes(12)) {
    score.TOP += 0.8;
    score.MIDDLE += 0.3;
  }
  if (spells.includes(7) || spells.includes(21)) score.BOTTOM += 0.8;
  if (spells.includes(3)) score.UTILITY += 0.6;
  return score;
}

// Meilleure répartition des 5 rôles dans une équipe (5! = 120 possibilités).
function assignRoles(team, st, metaP) {
  if (team.length !== 5) return;
  const scores = team.map((p) => roleScores(p, st, metaP));
  let best = null;
  let bestSum = -Infinity;
  const perm = (arr, used, acc) => {
    if (acc.length === 5) {
      const sum = acc.reduce((t, r, i) => t + scores[i][r], 0);
      if (sum > bestSum) {
        bestSum = sum;
        best = acc.slice();
      }
      return;
    }
    for (const r of arr) if (!used.has(r)) {
      used.add(r);
      acc.push(r);
      perm(arr, used, acc);
      acc.pop();
      used.delete(r);
    }
  };
  perm(ROLE_KEYS, new Set(), []);
  team.forEach((p, i) => {
    p.role = best[i];
  });
}

// Duos : coéquipiers qui partagent au moins 2 des 20 dernières parties.
async function findDuos(platform, parts) {
  const host = matchHost(platform);
  const ids = await Promise.all(
    parts.map((p) =>
      p.puuid ? riot(host, `/lol/match/v5/matches/by-puuid/${p.puuid}/ids?start=0&count=20`, { ttl: 900 }).catch(() => []) : []
    )
  );
  const sets = ids.map((x) => new Set(x || []));
  const parent = parts.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const links = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (parts[i].team !== parts[j].team || !sets[i].size || !sets[j].size) continue;
      let shared = 0;
      for (const id of sets[i]) if (sets[j].has(id)) shared++;
      if (shared >= 2) {
        links.push([i, j, shared]);
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = {};
  links.forEach(([i]) => {
    const r = find(i);
    groups[r] = groups[r] || [];
  });
  let n = 0;
  const label = {};
  for (const r of Object.keys(groups)) label[r] = ++n;
  for (const [i, j, shared] of links) {
    for (const [a, b] of [
      [i, j],
      [j, i],
    ]) {
      const p = parts[a];
      p.duo = label[find(a)];
      p.with = p.with || [];
      p.with.push({ name: parts[b].name, tag: parts[b].tag, champ: parts[b].champ, shared });
    }
  }
}

// Rang classé (Solo/Duo, sinon Flex) et badge pro des joueurs d'une partie (10 max).
async function getRanks(platform, ids) {
  const list = String(ids || '').split(',').map((x) => x.trim()).filter((x) => /^[\w-]{20,90}$/.test(x)).slice(0, 10);
  const out = {};
  await Promise.all(
    list.map(async (id) => {
      const l = await riot(platform, `/lol/league/v4/entries/by-puuid/${id}`, { ttl: 900 }).catch(() => null);
      const c = compactLeague(l);
      recordPeaks(id, c).catch(() => null);
      const r = c.solo || c.flex;
      out[id] = r ? { tier: r.tier, rank: r.rank, lp: r.lp, q: c.solo ? 'solo' : 'flex' } : {};
    })
  );
  await proFoundMap().catch(() => null);
  const K = await knownList().catch(() => null);
  if (K) for (const id of list) {
    const nm = names.get(id);
    const w = whoIs(K, id, nm?.name, nm?.tag);
    if (w) out[id].pro = w;
  }
  // Joueurs pas encore connus : recherche dans la source « comptes » (3 s max en tout).
  const todo = list.filter((id) => !out[id].pro && names.get(id)?.name);
  if (todo.length) {
    await Promise.race([
      Promise.all(todo.map((id) => discoverPro(id, names.get(id).name, names.get(id).tag).then((p) => p && (out[id].pro = p)).catch(() => null))),
      sleep(3000),
    ]);
  }
  return out;
}

async function getLive(platform, puuid) {
  const g = await riot(platform, `/lol/spectator/v5/active-games/by-summoner/${puuid}`, { ttl: 30 });
  if (!g) return { live: false };
  const parts = await Promise.all(
    (g.participants || []).map(async (p) => {
      let ranked = {};
      if (p.puuid) {
        const l = await riot(platform, `/lol/league/v4/entries/by-puuid/${p.puuid}`, { ttl: 600 }).catch(() => null);
        ranked = compactLeague(l);
        recordPeaks(p.puuid, ranked).catch(() => null);
      }
      const [name, tag] = splitRiotId(p.riotId);
      if (p.puuid && name) rememberName(p.puuid, name, tag);
      return {
        puuid: p.puuid || null,
        // Mode streamer ou identité masquée : Riot ne renvoie ni puuid ni Riot ID.
        hidden: !p.puuid,
        name: name || 'Joueur masqué',
        tag,
        champ: p.championId,
        team: p.teamId,
        s1: p.spell1Id,
        s2: p.spell2Id,
        ks: p.perks?.perkIds?.[0] || 0,
        ps: p.perks?.perkStyle || 0,
        ss: p.perks?.perkSubStyle || 0,
        perks: p.perks?.perkIds || [],
        bot: !!p.bot,
        ranked,
      };
    })
  );
  try {
    const st = await getStatic();
    const meta = await readMeta(platform);
    const cur = patchOf(st.version);
    const metaP = meta.patches[cur] || Object.values(meta.patches)[0] || null;
    for (const t of new Set(parts.map((p) => p.team))) assignRoles(parts.filter((p) => p.team === t), st, metaP);
  } catch {
    /* rôles non déduits : l'ordre de Riot est conservé */
  }
  await findDuos(platform, parts).catch(() => {});
  await tagKnown(parts.filter((p) => !p.hidden));
  const todo = parts.filter((p) => !p.hidden && !p.pro && p.puuid && p.name);
  if (todo.length) {
    await Promise.race([
      Promise.all(todo.map((p) => discoverPro(p.puuid, p.name, p.tag).then((x) => x && (p.pro = x)).catch(() => null))),
      sleep(3000),
    ]);
  }
  return {
    live: true,
    id: g.gameId,
    q: g.gameQueueConfigId,
    mode: g.gameMode,
    start: g.gameStartTime,
    length: g.gameLength,
    bans: (g.bannedChampions || []).map((b) => ({ c: b.championId, team: b.teamId, turn: b.pickTurn })),
    parts,
    at: Date.now(),
  };
}

/* ---------- Partie en direct : fiche détaillée d'un joueur (chargée carte par carte) ---------- */

const ROLES_OK = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const LIVE_GAMES = clampInt(process.env.LIVE_GAMES, 3, 20, 8);
async function getLivePlayer(platform, puuid, champ, role) {
  const ck = `lp:${puuid}:${champ}:${role}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const host = matchHost(platform);
  const now = Math.floor(Date.now() / 1000);
  const [mast, ids12, ids30, idsRanked] = await Promise.all([
    riot(platform, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/by-champion/${champ}`, { prio: 1, ttl: 3600 }).catch(() => null),
    riot(host, `/lol/match/v5/matches/by-puuid/${puuid}/ids?startTime=${now - 12 * 3600}&count=100`, { prio: 1, ttl: 600 }).catch(() => []),
    riot(host, `/lol/match/v5/matches/by-puuid/${puuid}/ids?startTime=${now - 30 * 86400}&count=100`, { prio: 1, ttl: 1800 }).catch(() => []),
    riot(host, `/lol/match/v5/matches/by-puuid/${puuid}/ids?type=ranked&start=0&count=${LIVE_GAMES}`, { prio: 1, ttl: 600 }).catch(() => []),
  ]);
  const games = (await Promise.all((idsRanked || []).map((id) => getMatch(platform, id).catch(() => null)))).filter(Boolean);
  const rec = [];
  for (const m of games) {
    const me = m.parts.find((x) => x.puuid === puuid);
    if (!me || m.remake) continue;
    const team = m.parts.filter((x) => x.team === me.team);
    const tk = team.reduce((s, x) => s + x.k, 0);
    rec.push({ m, me, min: Math.max(1, m.dur / 60), kp: tk ? (me.k + me.a) / tk : 0, start: m.start });
  }
  const n = rec.length;
  const avg = (f) => (n ? rec.reduce((s, r) => s + f(r), 0) / n : 0);
  const onChamp = rec.filter((r) => r.me.champ === champ);
  const roles = {};
  for (const r of rec) if (r.me.pos) roles[r.me.pos] = (roles[r.me.pos] || 0) + 1;
  const mainRoles = Object.entries(roles).sort((a, b) => b[1] - a[1]).map(([r]) => r);
  let streak = 0;
  for (const r of rec) {
    if (!streak) streak = r.me.win ? 1 : -1;
    else if ((streak > 0) === r.me.win) streak += streak > 0 ? 1 : -1;
    else break;
  }
  const champCounts = {};
  for (const r of rec) champCounts[r.me.champ] = (champCounts[r.me.champ] || 0) + 1;
  const stats = {
    n,
    w: rec.filter((r) => r.me.win).length,
    k: avg((r) => r.me.k),
    d: avg((r) => r.me.d),
    a: avg((r) => r.me.a),
    kp: avg((r) => r.kp),
    vis: avg((r) => r.me.vis / r.min),
    cs: avg((r) => r.me.cs / r.min),
    bld: avg((r) => r.me.bld),
    dmg: avg((r) => r.me.dmg / r.min),
    solo: avg((r) => r.me.solo || 0),
  };
  const champ1 = {
    n: onChamp.length,
    w: onChamp.filter((r) => r.me.win).length,
    k: onChamp.length ? onChamp.reduce((s, r) => s + r.me.k, 0) / onChamp.length : 0,
    d: onChamp.length ? onChamp.reduce((s, r) => s + r.me.d, 0) / onChamp.length : 0,
    a: onChamp.length ? onChamp.reduce((s, r) => s + r.me.a, 0) / onChamp.length : 0,
  };
  // Étiquettes : g = positif, b = négatif, n = neutre
  const tags = [];
  const t = (kind, label, hint) => tags.push({ kind, label, hint });
  const lvl = mast?.championLevel || 0;
  const pts = mast?.championPoints || 0;
  if (!mast || pts < 1000) t('n', '1ère partie', 'Aucune maîtrise ou presque sur ce champion');
  else if (pts >= 200000) t('g', 'Main champion', `${pts.toLocaleString('fr-FR')} points de maîtrise`);
  else if (lvl >= 10) t('g', 'Main champion', `Maîtrise niveau ${lvl}`);
  if (onChamp.length >= 3 && onChamp.length >= n * 0.6) t('g', 'One trick', 'Joue presque uniquement ce champion');
  if (n >= 3 && mainRoles.length && role && !mainRoles.slice(0, 2).includes(role)) t('n', 'Fill ?', 'N’est pas sur son rôle habituel');
  if (streak >= 3) t('g', `Série de ${streak} victoires`, 'Sur ses dernières parties classées');
  if (streak <= -3) t('b', `Série de ${-streak} défaites`, 'Sur ses dernières parties classées');
  if (n >= 3) {
    if (stats.kp >= 0.62) t('g', 'Haute participation', `${Math.round(stats.kp * 100)}% de participation aux kills`);
    if (stats.kp > 0 && stats.kp < 0.4 && role !== 'TOP') t('b', 'Joue seul', `${Math.round(stats.kp * 100)}% de participation aux kills`);
    const visGood = role === 'UTILITY' ? 2.2 : role === 'JUNGLE' ? 1.3 : 1;
    const visBad = role === 'UTILITY' ? 1.3 : role === 'JUNGLE' ? 0.7 : 0.45;
    if (stats.vis >= visGood) t('g', 'Bonne vision', `${stats.vis.toFixed(2)} vision/min`);
    else if (stats.vis < visBad) t('b', 'Mauvaise vision', `${stats.vis.toFixed(2)} vision/min`);
    if (stats.d >= 7.5) t('b', 'Meurt souvent', `${stats.d.toFixed(1)} morts/partie`);
    else if (stats.d <= 3.5) t('g', 'Joue safe', `${stats.d.toFixed(1)} morts/partie`);
    if (['TOP', 'MIDDLE', 'BOTTOM'].includes(role) && stats.solo >= 1.2) t('g', 'Laner agressif', `${stats.solo.toFixed(1)} solo kills/partie`);
    if (['TOP', 'MIDDLE', 'BOTTOM'].includes(role) && stats.cs >= 8) t('g', 'Bon farm', `${stats.cs.toFixed(1)} CS/min`);
    if (['TOP', 'MIDDLE', 'BOTTOM'].includes(role) && stats.cs > 0 && stats.cs < 5.5) t('b', 'Farm faible', `${stats.cs.toFixed(1)} CS/min`);
    if (role !== 'UTILITY' && stats.bld >= 6000) t('g', 'Split pusher', `${Math.round(stats.bld)} dégâts aux bâtiments/partie`);
    if (role !== 'UTILITY' && stats.bld > 0 && stats.bld < 1200) t('b', 'Oublie les tours', `${Math.round(stats.bld)} dégâts aux bâtiments/partie`);
  }
  const out = {
    // Aucune donnée accessible (profil masqué, compte récent ou mode streamer) : la carte affiche « Stats cachées ».
    hidden: !mast && !n && !(ids30 || []).length && !(ids12 || []).length,
    mastery: { lvl, pts, last: mast?.lastPlayTime || null },
    h12: (ids12 || []).length,
    d30: (ids30 || []).length,
    d30cap: (ids30 || []).length >= 100,
    stats,
    champ: champ1,
    mainRoles: mainRoles.slice(0, 2),
    form: rec.slice(0, 10).map((r) => (r.me.win ? 1 : 0)),
    tags,
  };
  return cache.set(ck, out, 900);
}

async function getRotation(platform) {
  const r = await riot(platform, '/lol/platform/v3/champion-rotations', { ttl: 3600 });
  return { free: r?.freeChampionIds || [], newbie: r?.freeChampionIdsForNewPlayers || [], newbieLevel: r?.maxNewPlayerLevel || 0 };
}

async function getStatus(platform, lang = LANG) {
  const want = langOf(lang);
  const s = await riot(platform, '/lol/status/v4/platform-data', { ttl: 300 });
  const tr = (arr) =>
    (arr || []).find((x) => x.locale === want)?.content ||
    (arr || []).find((x) => x.locale === 'fr_FR')?.content ||
    (arr || []).find((x) => x.locale === 'en_US')?.content ||
    arr?.[0]?.content ||
    '';
  const mapIssue = (x, kind) => ({
    id: x.id,
    kind,
    severity: x.incident_severity || x.maintenance_status || '',
    title: tr(x.titles),
    text: tr(x.updates?.[x.updates.length - 1]?.translations) || tr(x.updates?.[0]?.translations),
    at: x.updated_at || x.created_at,
  });
  return {
    name: s?.name || PLATFORMS[platform].label,
    issues: [...(s?.maintenances || []).map((x) => mapIssue(x, 'maintenance')), ...(s?.incidents || []).map((x) => mapIssue(x, 'incident'))],
  };
}

/* ------------------------------------------------------------------ */
/* Classement (Challenger, Grandmaster, Master)                        */
/* ------------------------------------------------------------------ */

const APEX = ['CHALLENGER', 'GRANDMASTER', 'MASTER'];

async function apexRows(platform, qk, tiers) {
  const lists = await Promise.all(
    tiers.map((l) => riot(platform, `/lol/league/v4/${l}/by-queue/${qk}`, { store: false, ttl: 600 }).catch(() => null))
  );
  const rows = [];
  for (const l of lists) {
    if (!l) continue;
    for (const e of l.entries || []) {
      rows.push({ p: platform, puuid: e.puuid || null, tier: l.tier, lp: e.leaguePoints, w: e.wins, l: e.losses, hot: !!e.hotStreak, vet: !!e.veteran, fresh: !!e.freshBlood });
    }
  }
  return rows;
}

// platform = 'world' : Challenger de toutes les régions, fusionnés par LP.
async function getLadder(platform, queue, page) {
  const qk = queue === 'flex' ? 'RANKED_FLEX_SR' : 'RANKED_SOLO_5x5';
  const ck = `ladder:${platform}:${qk}`;
  let rows = cache.get(ck);
  if (!rows) {
    if (platform === 'world') {
      const all = await Promise.all(Object.keys(PLATFORMS).map((p) => apexRows(p, qk, ['challengerleagues'])));
      rows = all.flat();
    } else {
      rows = await apexRows(platform, qk, ['challengerleagues', 'grandmasterleagues', 'masterleagues']);
    }
    rows.sort((a, b) => APEX.indexOf(a.tier) - APEX.indexOf(b.tier) || b.lp - a.lp || b.w - a.w);
    rows.forEach((r, i) => {
      r.rank = i + 1;
    });
    cache.set(ck, rows, 600);
  }
  const size = 25;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = clampInt(page, 1, pages, 1);
  const slice = rows.slice((p - 1) * size, p * size).map((r) => ({ ...r, ...(r.puuid ? ladderId.get(r.puuid) || names.get(r.puuid) || {} : {}) }));
  await tagKnown(slice);
  return { queue: qk, page: p, pages, total: rows.length, size, rows: slice };
}

const ladderId = new TTLCache(20000);
const parseItems = (list, max) =>
  String(list || '')
    .split(',')
    .map((x) => x.split(':'))
    .filter(([p, id]) => PLATFORMS[p] && isPuuid(id))
    .slice(0, max);

// Identité : nom, icône, niveau, meilleures maîtrises (3 requêtes par joueur, mises en cache 24 h).
async function getLadderIdentity(list) {
  const out = {};
  await Promise.all(
    parseItems(list, 25).map(async ([p, id]) => {
      const hit = ladderId.get(id);
      if (hit) return (out[id] = hit);
      const [acc, sum, mast] = await Promise.all([
        names.get(id) ||
          riot(accountHost(p), `/riot/account/v1/accounts/by-puuid/${id}`, { ttl: 86400 })
            .then((a) => (a ? rememberName(id, a.gameName, a.tagLine) : null))
            .catch(() => null),
        riot(p, `/lol/summoner/v4/summoners/by-puuid/${id}`, { ttl: 86400 }).catch(() => null),
        riot(p, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${id}/top?count=4`, { ttl: 86400 }).catch(() => null),
      ]);
      if (!acc && !sum) return;
      const v = { ...(acc || {}), icon: sum?.profileIconId ?? null, level: sum?.summonerLevel ?? null, mastery: (mast || []).map((m) => m.championId) };
      await tagKnown([{ v, id }], (x) => [x.id, x.v.name, x.v.tag]).then(([x]) => x.pro && (v.pro = x.pro));
      if (acc) indexPlayer(p, acc.name, acc.tag, { icon: v.icon });
      out[id] = ladderId.set(id, v, 86400);
    })
  );
  return out;
}

// Forme récente : rôle principal, KDA et champions sur les dernières parties classées (tâche de fond).
const LADDER_GAMES = clampInt(process.env.LADDER_GAMES, 1, 20, 5);
async function getLadderStats(list) {
  const out = {};
  for (const [p, id] of parseItems(list, 5)) {
    const ck = 'lstats:' + id;
    const hit = cache.get(ck);
    if (hit) {
      out[id] = hit;
      continue;
    }
    const ids =
      (await riot(matchHost(p), `/lol/match/v5/matches/by-puuid/${id}/ids?queue=420&type=ranked&start=0&count=${LADDER_GAMES}`, { prio: 1, ttl: 1800 }).catch(() => null)) || [];
    const games = (await Promise.all(ids.map((mid) => getMatch(p, mid).catch(() => null)))).filter(Boolean);
    const roles = {};
    const champs = {};
    let k = 0;
    let d = 0;
    let a = 0;
    let n = 0;
    for (const m of games) {
      const me = m.parts.find((x) => x.puuid === id);
      if (!me || m.remake) continue;
      n++;
      k += me.k;
      d += me.d;
      a += me.a;
      if (me.pos) roles[me.pos] = (roles[me.pos] || 0) + 1;
      champs[me.champ] = (champs[me.champ] || 0) + 1;
    }
    const role = Object.entries(roles).sort((x, y) => y[1] - x[1])[0];
    out[id] = cache.set(
      ck,
      {
        n,
        kda: n ? (k + a) / Math.max(1, d) : null,
        role: role ? role[0] : null,
        rolePct: role && n ? role[1] / n : null,
        champs: Object.entries(champs)
          .sort((x, y) => y[1] - x[1])
          .map(([c]) => Number(c))
          .slice(0, 4),
      },
      3600
    );
  }
  return out;
}

async function getAccounts(platform, list) {
  const ids = String(list || '')
    .split(',')
    .filter(isPuuid)
    .slice(0, 25);
  const out = {};
  await Promise.all(
    ids.map(async (id) => {
      const [acc, sum] = await Promise.all([
        names.get(id) ||
          riot(accountHost(platform), `/riot/account/v1/accounts/by-puuid/${id}`, { ttl: 86400 })
            .then((a) => (a ? rememberName(id, a.gameName, a.tagLine) : null))
            .catch(() => null),
        riot(platform, `/lol/summoner/v4/summoners/by-puuid/${id}`, { ttl: 86400 }).catch(() => null),
      ]);
      if (acc || sum) out[id] = { ...(acc || {}), icon: sum?.profileIconId ?? null, level: sum?.summonerLevel ?? null };
    })
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* Builds et tier list : échantillon de parties classées haut niveau   */
/* (Challenger, Grand Maître et pros suivis), patch par patch.         */
/* ------------------------------------------------------------------ */

const metaJobs = {};
// Modes analysés : Faille classée, ARAM, ARAM du chaos (Mayhem), Arena.
const MODES = { sr: { q: 420, label: 'Faille' }, aram: { q: 450, label: 'ARAM' }, chaos: { q: 2400, label: 'ARAM du chaos' }, arena: { q: 1700, label: 'Arena' } };
const modeOf = (m) => (MODES[m] ? m : 'sr');
const metaKey = (platform, mode) => (mode === 'sr' ? platform : `${platform}-${mode}`);
const metaFile = (p) => path.join(DATA_DIR, `meta2-${p}.json`);
const prosFile = path.join(DATA_DIR, 'pros.json');
const TRINKETS = new Set([3340, 3363, 3364, 3330, 3513]);
const cmpPatch = (a, b) => {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
};
const patchOf = (v) => String(v || '0.0').split('.').slice(0, 2).join('.');
const bump = (o, k, w) => {
  const e = o[k] || (o[k] = [0, 0]);
  e[0]++;
  e[1] += w;
};

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}
async function writeJson(file, data) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, file);
  remoteSave(file);
}

const metaCache = {};
async function readMeta(p) {
  if (metaCache[p]) return metaCache[p];
  const m = await readJson(metaFile(p), null);
  metaCache[p] = m && m.v === 2 ? m : { v: 2, patches: {}, seen: [], updated: 0 };
  return metaCache[p];
}
async function writeMeta(p, m) {
  m.updated = Date.now();
  metaCache[p] = m;
  await writeJson(metaFile(p), m);
}

function itemKind(st, id) {
  const it = id && st.items[id];
  if (!it) return null;
  const finalItem = !it.into.length || it.into.every((x) => !st.items[x] || !st.items[x].sr);
  if (!finalItem) return null;
  if (it.tags.includes('Boots') && it.gold >= 900) return 'boots';
  if (it.gold >= 2200 && !it.tags.includes('Consumable') && !it.tags.includes('Trinket')) return 'core';
  return null;
}

function skillPrio(order) {
  const keys = { 1: 'Q', 2: 'W', 3: 'E' };
  const counts = { 1: 0, 2: 0, 3: 0 };
  const maxedAt = {};
  order.forEach((s, i) => {
    if (!(s in counts)) return;
    counts[s]++;
    if (counts[s] === 5 && maxedAt[s] === undefined) maxedAt[s] = i;
  });
  if (counts[1] + counts[2] + counts[3] < 6) return '';
  return [1, 2, 3]
    .sort((a, b) => (maxedAt[a] ?? 100 - counts[a]) - (maxedAt[b] ?? 100 - counts[b]))
    .map((s) => keys[s])
    .join('>');
}

// Résume la chronologie : objets de départ, ordre des objets, bottes, compétences.
function digestTimeline(tl, st) {
  const out = {};
  const get = (pid) => out[pid] || (out[pid] = { buys: [], skills: [] });
  for (const f of tl.info.frames || []) {
    for (const e of f.events || []) {
      if (e.type === 'ITEM_PURCHASED') get(e.participantId).buys.push({ t: e.timestamp, i: e.itemId });
      else if (e.type === 'ITEM_UNDO') {
        const b = get(e.participantId).buys;
        for (let k = b.length - 1; k >= 0; k--) {
          if (b[k].i === e.beforeId) {
            b.splice(k, 1);
            break;
          }
        }
      } else if (e.type === 'SKILL_LEVEL_UP' && e.levelUpType !== 'EVOLVE') get(e.participantId).skills.push(e.skillSlot);
    }
  }
  const byPuuid = {};
  for (const x of tl.info.participants || []) {
    const d = out[x.participantId];
    if (!d) continue;
    const seen = new Set();
    const order = [];
    let boots = 0;
    for (const b of d.buys) {
      const kind = itemKind(st, b.i);
      if (kind === 'core' && !seen.has(b.i)) {
        seen.add(b.i);
        order.push(b.i);
      } else if (kind === 'boots' && !boots) boots = b.i;
    }
    byPuuid[x.puuid] = {
      start: d.buys.filter((b) => b.t < 75000 && !TRINKETS.has(b.i)).map((b) => b.i).sort((a, b) => a - b),
      order,
      boots,
      skills: d.skills.slice(0, 18),
      prio: skillPrio(d.skills),
    };
  }
  return byPuuid;
}

const newEntry = () => ({
  g: 0, w: 0, k: 0, d: 0, a: 0, cs: 0, dmg: 0, gold: 0, sec: 0, tl: 0,
  runes: {}, pages: {}, spells: {}, items: {}, boots: {}, start: {}, core: {}, slot: [{}, {}, {}, {}, {}, {}],
  skills: {}, vs: {}, recent: [],
});

// Écarts en lane à 15 minutes (or, farm, expérience) entre chaque joueur et son vis-à-vis.
function laneDiffs(tl, info) {
  const frames = tl?.info?.frames || [];
  const f = frames[15] || frames[frames.length - 1];
  if (!f || frames.length < 15) return {};
  const pid = {};
  for (const x of tl.info.participants || []) pid[x.puuid] = x.participantId;
  const at = (puuid) => f.participantFrames?.[pid[puuid]];
  const out = {};
  for (const p of info.participants) {
    const opp = info.participants.find((q) => q.teamPosition && q.teamPosition === p.teamPosition && q.teamId !== p.teamId);
    const a = at(p.puuid);
    const b = opp && at(opp.puuid);
    if (!a || !b) continue;
    const cs = (v) => (v.minionsKilled || 0) + (v.jungleMinionsKilled || 0);
    out[p.puuid] = { gd: (a.totalGold || 0) - (b.totalGold || 0), csd: cs(a) - cs(b), xpd: (a.xp || 0) - (b.xp || 0) };
  }
  return out;
}

// Statistiques par joueur et par champion (classement OTP). Reconstruites depuis les parties
// récentes pour les échantillons créés avant l'ajout de ce suivi.
function derivePlayers(P) {
  const out = {};
  for (const [k, c] of Object.entries(P.champs || {})) {
    const [id, role] = k.split('|');
    for (const r of c.recent || []) addPlayerGame(out, r.pu, { n: r.n, tg: r.tg, tier: r.tier, lp: r.lp, t: r.t }, Number(id), role, r);
  }
  return out;
}
function addPlayerGame(players, pu, who, champ, role, g) {
  if (!pu) return;
  const x = players[pu] || (players[pu] = { n: '', tg: '', tier: '', lp: null, t: 0, g: 0, champs: {}, roles: {}, items: {} });
  if (who.t >= x.t) {
    x.n = who.n || x.n;
    x.tg = who.tg || x.tg;
    x.tier = who.tier || x.tier;
    x.lp = who.lp ?? x.lp;
    x.t = who.t;
  }
  x.g++;
  const c = x.champs[champ] || (x.champs[champ] = [0, 0, 0, 0, 0]);
  c[0]++;
  c[1] += g.w ? 1 : 0;
  c[2] += g.k;
  c[3] += g.d;
  c[4] += g.a;
  if (role && role !== 'ALL') x.roles[role] = (x.roles[role] || 0) + 1;
  const it = x.items[champ] || (x.items[champ] = {});
  for (const id of (g.ord && g.ord.length ? g.ord : g.it || []).slice(0, 6)) if (id) it[id] = (it[id] || 0) + 1;
}

function aggregate(meta, m, tl, st, ladder, mode = 'sr') {
  const i = m.info;
  const patch = patchOf(i.gameVersion);
  const P = meta.patches[patch] || (meta.patches[patch] = { games: 0, bans: {}, champs: {} });
  P.games++;
  if (mode === 'sr' && !P.players) P.players = derivePlayers(P);
  const lane = mode === 'sr' && tl ? laneDiffs(tl, i) : {};
  const banned = new Set();
  for (const t of i.teams || []) for (const b of t.bans || []) if (b.championId > 0) banned.add(b.championId);
  banned.forEach((c) => {
    P.bans[c] = (P.bans[c] || 0) + 1;
  });
  const dig = tl ? digestTimeline(tl, st) : {};
  const start = i.gameStartTimestamp || i.gameCreation;
  for (const p of i.participants) {
    const role = mode === 'sr' ? p.teamPosition : 'ALL';
    if (!role) continue;
    const key = `${p.championId}|${role}`;
    const c = P.champs[key] || (P.champs[key] = newEntry());
    const w = mode === 'arena' ? (p.placement && p.placement <= 4 ? 1 : 0) : p.win ? 1 : 0;
    // Augments (Arena, ARAM du chaos) : jusqu'à 6 par joueur.
    for (let n = 1; n <= 6; n++) {
      const aug = p['playerAugment' + n];
      if (aug) bump((c.aug = c.aug || {}), aug, w);
    }
    if (mode === 'arena' && p.placement) {
      c.top1 = (c.top1 || 0) + (p.placement === 1 ? 1 : 0);
      c.place = (c.place || 0) + p.placement;
    }
    c.g++;
    c.w += w;
    c.k += p.kills;
    c.d += p.deaths;
    c.a += p.assists;
    c.cs += (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0);
    c.dmg += p.totalDamageDealtToChampions || 0;
    c.gold += p.goldEarned || 0;
    c.sec += i.gameDuration || 0;

    const s0 = p.perks?.styles?.[0];
    const s1 = p.perks?.styles?.[1];
    const sp = p.perks?.statPerks || {};
    const ks = s0?.selections?.[0]?.perk || 0;
    if (ks) {
      bump(c.runes, `${ks}-${s1?.style || 0}`, w);
      const page = [
        `${s0.style}:${(s0.selections || []).map((x) => x.perk).join('.')}`,
        `${s1?.style || 0}:${(s1?.selections || []).map((x) => x.perk).join('.')}`,
        [sp.offense, sp.flex, sp.defense].filter(Boolean).join('.'),
      ].join('|');
      bump(c.pages, page, w);
    }
    const spells = [p.summoner1Id, p.summoner2Id].sort((a, b) => a - b).join('-');
    bump(c.spells, spells, w);
    const inv = [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5];
    for (const id of inv) {
      const kind = itemKind(st, id);
      if (kind === 'core') bump(c.items, id, w);
      else if (kind === 'boots') bump(c.boots, id, w);
    }
    const opp = i.participants.find((q) => q.teamPosition === role && q.teamId !== p.teamId);
    if (opp) bump(c.vs, opp.championId, w);
    // Tous les adversaires (vsr) et tous les alliés (syn), par champion et rôle.
    if (mode === 'sr') {
      for (const q of i.participants) {
        if (q === p || !q.teamPosition) continue;
        bump(q.teamId === p.teamId ? (c.syn = c.syn || {}) : (c.vsr = c.vsr || {}), `${q.championId}|${q.teamPosition}`, w);
      }
    }
    const ld = lane[p.puuid];
    if (opp && ld) {
      // vd[adversaire] = [parties avec chronologie, somme écart d'or, somme écart de CS, somme écart d'XP] à 15 min
      const e = (c.vd = c.vd || {})[opp.championId] || (c.vd[opp.championId] = [0, 0, 0, 0]);
      e[0]++;
      e[1] += ld.gd;
      e[2] += ld.csd;
      e[3] += ld.xpd;
    }

    const d = dig[p.puuid];
    if (d) {
      c.tl++;
      if (d.start.length) bump(c.start, d.start.join(','), w);
      if (d.order.length >= 3) bump(c.core, d.order.slice(0, 3).join('-'), w);
      d.order.slice(0, 6).forEach((id, n) => bump(c.slot[n], id, w));
      if (d.prio) bump(c.skills, d.prio, w);
    }
    const lad = ladder[p.puuid];
    const rec = {
      m: m.metadata.matchId,
      t: start,
      dur: i.gameDuration,
      pu: p.puuid,
      n: p.riotIdGameName || '',
      tg: p.riotIdTagline || '',
      ic: p.profileIcon ?? null,
      tier: lad?.tier || '',
      lp: lad?.lp ?? null,
      w,
      k: p.kills,
      d: p.deaths,
      a: p.assists,
      cs: (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0),
      it: [...inv, p.item6],
      ord: d ? d.order.slice(0, 6) : [],
      bt: d ? d.boots : 0,
      st: d ? d.start : [],
      sk: d ? d.skills : [],
      ks,
      ss: s1?.style || 0,
      s1: p.summoner1Id,
      s2: p.summoner2Id,
      vs: opp?.championId || 0,
      ...(ld ? { gd: ld.gd, csd: ld.csd } : {}),
    };
    c.recent.push(rec);
    c.recent.sort((a, b) => b.t - a.t);
    if (c.recent.length > 40) c.recent.length = 40;
    if (mode === 'sr') addPlayerGame(P.players, p.puuid, { n: rec.n, tg: rec.tg, tier: rec.tier, lp: rec.lp, t: start }, p.championId, role, rec);
  }
  const keep = Object.keys(meta.patches).sort(cmpPatch).slice(-2);
  for (const k of Object.keys(meta.patches)) if (!keep.includes(k)) delete meta.patches[k];
}

function jobView(job) {
  return job ? { running: job.running, done: job.done, target: job.target, phase: job.phase, error: job.error } : null;
}

async function currentPatch() {
  try {
    return patchOf((await getStatic()).version);
  } catch {
    return null;
  }
}

// Vue légère pour la tier list (sans les listes de builds).
async function metaSummary(platform, mode = 'sr') {
  const mk = metaKey(platform, mode);
  const m = await readMeta(mk);
  const patches = {};
  for (const [ver, P] of Object.entries(m.patches)) {
    const champs = {};
    for (const [k, c] of Object.entries(P.champs)) champs[k] = { g: c.g, w: c.w, k: c.k, d: c.d, a: c.a, cs: c.cs, dmg: c.dmg, sec: c.sec };
    patches[ver] = { games: P.games, bans: P.bans, champs };
  }
  return { job: jobView(metaJobs[mk]), updated: m.updated, current: await currentPatch(), patches, pros: await readPros() };
}

// Détail complet d'un champion (tous ses rôles) pour un patch.
// Échantillons enregistrés avant l'ajout de vsr/syn : alliés et adversaires reconstitués
// à partir des parties récentes (même partie = même identifiant, même équipe = même résultat).
const relMemo = new WeakMap();
function derivedRelations(P) {
  let R = relMemo.get(P);
  if (R) return R;
  R = new Map();
  const byMatch = new Map();
  for (const [k, c] of Object.entries(P.champs)) {
    for (const g of c.recent || []) {
      const arr = byMatch.get(g.m) || [];
      if (!arr.some((x) => x.k === k)) arr.push({ k, w: g.w ? 1 : 0 });
      byMatch.set(g.m, arr);
    }
  }
  for (const arr of byMatch.values()) {
    for (const a of arr) {
      const e = R.get(a.k) || { vsr: {}, syn: {} };
      for (const b of arr) {
        if (a === b) continue;
        bump(b.w === a.w ? e.syn : e.vsr, b.k, a.w);
      }
      R.set(a.k, e);
    }
  }
  relMemo.set(P, R);
  return R;
}

async function metaChampion(platform, key, patch, mode = 'sr') {
  const mk = metaKey(platform, mode);
  const m = await readMeta(mk);
  const available = Object.keys(m.patches).filter((v) => m.patches[v].games > 0).sort(cmpPatch).reverse();
  const cur = await currentPatch();
  const ver = available.includes(patch) ? patch : available.includes(cur) ? cur : available[0];
  const P = ver ? m.patches[ver] : null;
  const roles = {};
  if (P) {
    for (const [k, c] of Object.entries(P.champs)) {
      const [id, role] = k.split('|');
      // Copie : les étiquettes pro/streamer ne doivent pas finir dans le fichier d'échantillon.
      if (Number(id) !== key) continue;
      roles[role] = { ...c, recent: (c.recent || []).map((g) => ({ ...g })) };
      if (mode === 'sr' && !c.vsr) {
        const d = derivedRelations(P).get(k);
        if (d) Object.assign(roles[role], { vsr: d.vsr, syn: d.syn, relDerived: true });
      }
    }
  }
  for (const c of Object.values(roles)) await tagKnown(c.recent, (g) => [g.pu, g.n, g.tg]);
  return { mode, job: jobView(metaJobs[mk]), patch: ver || null, current: cur, available, games: P?.games || 0, bans: P?.bans?.[key] || 0, roles, pros: await readPros(), updated: m.updated };
}

/* ---------- Classement OTP (one trick) ---------- */
// Joueurs Challenger / Grand Maître de l'échantillon qui jouent surtout un champion.

const TIER_ORDER = ['CHALLENGER', 'GRANDMASTER', 'MASTER'];
async function ladderMap(platform) {
  let rows = cache.get(`ladder:${platform}:RANKED_SOLO_5x5`);
  if (!rows && KEY) await getLadder(platform, 'solo', 1).catch(() => null);
  rows = cache.get(`ladder:${platform}:RANKED_SOLO_5x5`) || [];
  return new Map(rows.filter((r) => r.puuid).map((r) => [r.puuid, r]));
}

async function getOtp(platform, q) {
  const m = await readMeta(platform);
  const champF = Number(q.champ) || 0;
  const roleF = ROLES_OK.includes(q.role) ? q.role : '';
  const sort = q.sort === 'score' ? 'score' : 'lp';
  const agg = {};
  for (const P of Object.values(m.patches)) {
    const pl = P.players || derivePlayers(P);
    for (const [pu, x] of Object.entries(pl)) {
      const a = agg[pu] || (agg[pu] = { n: x.n, tg: x.tg, tier: x.tier, lp: x.lp, t: x.t, g: 0, champs: {}, roles: {}, items: {} });
      if (x.t >= a.t) Object.assign(a, { n: x.n || a.n, tg: x.tg || a.tg, tier: x.tier || a.tier, lp: x.lp ?? a.lp, t: x.t });
      a.g += x.g;
      for (const [c, v] of Object.entries(x.champs)) {
        const e = a.champs[c] || (a.champs[c] = [0, 0, 0, 0, 0]);
        v.forEach((n, i) => (e[i] += n));
      }
      for (const [r, n] of Object.entries(x.roles)) a.roles[r] = (a.roles[r] || 0) + n;
      for (const [c, it] of Object.entries(x.items || {})) {
        const e = a.items[c] || (a.items[c] = {});
        for (const [id, n] of Object.entries(it)) e[id] = (e[id] || 0) + n;
      }
    }
  }
  const lad = await ladderMap(platform);
  const rows = [];
  const champCount = {};
  for (const [pu, a] of Object.entries(agg)) {
    if (a.g < 4) continue;
    const list = Object.entries(a.champs).sort((x, y) => y[1][0] - x[1][0]);
    const [cid, v] = champF ? [String(champF), a.champs[champF]] : list[0];
    if (!v) continue;
    const share = v[0] / a.g;
    const isOtp = champF ? v[0] >= 3 && share >= 0.35 : v[0] >= 4 && share >= 0.55;
    if (!isOtp) continue;
    const role = Object.entries(a.roles).sort((x, y) => y[1] - x[1])[0]?.[0] || '';
    if (roleF && role !== roleF) continue;
    if (!champF) champCount[cid] = (champCount[cid] || 0) + 1;
    const L = lad.get(pu);
    const items = Object.entries(a.items[cid] || {})
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([id]) => Number(id));
    rows.push({
      p: platform,
      puuid: pu,
      name: a.n,
      tag: a.tg,
      tier: L?.tier || a.tier || '',
      lp: L?.lp ?? a.lp ?? null,
      w: L?.w ?? null,
      l: L?.l ?? null,
      champ: Number(cid),
      g: v[0],
      cw: v[1],
      kda: (v[2] + v[4]) / Math.max(1, v[3]),
      n: a.g,
      share,
      score: Math.round(share * 70 + Math.min(1, v[0] / 12) * 30),
      items,
      role,
    });
  }
  const tierIdx = (t) => (TIER_ORDER.indexOf(t) + 1 || 9);
  rows.sort((a, b) => (sort === 'score' ? b.score - a.score : 0) || tierIdx(a.tier) - tierIdx(b.tier) || (b.lp ?? -1) - (a.lp ?? -1) || b.share - a.share);
  rows.forEach((r, i) => (r.rank = i + 1));
  const out = rows.slice(0, 100);
  await tagKnown(out);
  return { platform, updated: m.updated, patches: Object.keys(m.patches).sort(cmpPatch).reverse(), total: rows.length, rows: out, champs: champCount };
}

/* ---------- Matchups ---------- */

const laneScore = (g) => {
  // Note sur 100 : KDA, farm par minute, participation, victoire.
  const min = Math.max(1, (g.dur || 1800) / 60);
  const kda = (g.k + g.a) / Math.max(1, g.d);
  return Math.round(Math.min(1, kda / 6) * 38 + Math.min(1, g.cs / min / 9) * 22 + Math.min(1, (g.k + g.a) / 22) * 15 + (g.w ? 25 : 0));
};

async function getMatchup(platform, q) {
  const m = await readMeta(platform);
  const champ = Number(q.champ) || 0;
  const vs = Number(q.vs) || 0;
  const side = q.side === 'against' ? 'against' : 'with';
  const available = Object.keys(m.patches).filter((v) => m.patches[v].games > 0).sort(cmpPatch).reverse();
  const cur = await currentPatch();
  const ver = available.includes(q.patch) ? q.patch : available.includes(cur) ? cur : available[0];
  const P = ver ? m.patches[ver] : null;
  const base = { platform, patch: ver || null, available, champ, vs, side, games: P?.games || 0 };
  if (!P) return { ...base, role: null, roles: {}, rows: [], opponents: [], summary: null };

  // Rôles possibles pour le champion choisi (ou l'adversaire seul).
  const focus = champ || vs;
  const roles = {};
  for (const [k, c] of Object.entries(P.champs)) {
    const [id, r] = k.split('|');
    if (Number(id) === focus) roles[r] = c.g;
  }
  const role = ROLES_OK.includes(q.role) ? q.role : Object.entries(roles).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const entries = Object.entries(P.champs).filter(([k]) => !role || k.endsWith('|' + role));
  let games = [];
  if (champ) {
    if (side === 'with') {
      const E = P.champs[`${champ}|${role}`];
      games = (E?.recent || []).filter((g) => !vs || g.vs === vs).map((g) => ({ ...g, champ }));
    } else {
      for (const [k, c] of entries) {
        const id = Number(k.split('|')[0]);
        if (vs && id !== vs) continue;
        for (const g of c.recent || []) if (g.vs === champ) games.push({ ...g, champ: id });
      }
    }
  } else {
    for (const [k, c] of entries) {
      const id = Number(k.split('|')[0]);
      for (const g of c.recent || []) if (!vs || g.vs === vs) games.push({ ...g, champ: id });
    }
  }
  games.sort((a, b) => b.t - a.t);
  games = games.slice(0, 60).map((g) => ({ ...g, score: laneScore(g), patch: ver, p: platform }));
  await tagKnown(games, (g) => [g.pu, g.n, g.tg]);

  // Adversaires du champion dans ce rôle (victoires du point de vue du champion).
  const E = champ && role ? P.champs[`${champ}|${role}`] : null;
  const opponents = Object.entries(E?.vs || {})
    .map(([id, [g, w]]) => {
      const d = E.vd?.[id];
      return { id: Number(id), g, w, gd: d && d[0] ? Math.round(d[1] / d[0]) : null };
    })
    .sort((a, b) => b.g - a.g);

  let summary = null;
  if (champ && vs && E) {
    const [g, w] = E.vs?.[vs] || [0, 0];
    const d = E.vd?.[vs];
    const mine = (E.recent || []).filter((x) => x.vs === vs);
    const n = mine.length;
    const sum = (f) => mine.reduce((s, x) => s + f(x), 0);
    const count = (f) => {
      const o = {};
      for (const x of mine) for (const k of f(x)) if (k) o[k] = (o[k] || 0) + 1;
      return Object.entries(o).sort((a, b) => b[1] - a[1]);
    };
    summary = {
      g,
      w,
      gd15: d && d[0] ? Math.round(d[1] / d[0]) : null,
      csd15: d && d[0] ? Math.round((d[2] / d[0]) * 10) / 10 : null,
      xpd15: d && d[0] ? Math.round(d[3] / d[0]) : null,
      n,
      k: n ? sum((x) => x.k) / n : 0,
      d: n ? sum((x) => x.d) / n : 0,
      a: n ? sum((x) => x.a) / n : 0,
      cs: n ? sum((x) => x.cs / Math.max(1, x.dur / 60)) / n : 0,
      items: count((x) => (x.ord?.length ? x.ord : x.it).slice(0, 6)).slice(0, 6).map(([id, c]) => [Number(id), c]),
      keystones: count((x) => [x.ks]).slice(0, 3).map(([id, c]) => [Number(id), c]),
      spells: count((x) => [[x.s1, x.s2].sort((a, b) => a - b).join('-')]).slice(0, 2),
    };
  }
  // Duels les plus joués (page d'accueil des matchups, sans champion choisi).
  let popular = [];
  if (!champ) {
    const seen = new Map();
    for (const [k, c] of entries) {
      const [id, r] = k.split('|');
      for (const [o, [g, w]] of Object.entries(c.vs || {})) {
        const a = Number(id);
        const b = Number(o);
        const key = a < b ? `${a}-${b}-${r}` : `${b}-${a}-${r}`;
        if (!seen.has(key)) seen.set(key, { a, b, role: r, g, w });
      }
    }
    popular = [...seen.values()].sort((x, y) => y.g - x.g).slice(0, 12);
  }
  return { ...base, role, roles, rows: games, opponents, summary, popular };
}

/* ---------- Patch notes ---------- */
// Trois sources : l'article officiel (lu et découpé quand le site Riot répond), les notes
// fournies dans seed/ (version de démonstration) et la comparaison automatique de deux
// versions de Data Dragon (statistiques, délais de récupération, objets).

const RIOT_LOCALE = { fr_FR: 'fr-fr', en_US: 'en-us', en_GB: 'en-gb', de_DE: 'de-de', es_ES: 'es-es', it_IT: 'it-it', pl_PL: 'pl-pl', pt_BR: 'pt-br' }[LANG] || 'fr-fr';
const NEWS_BASE = (process.env.NEWS_BASE || 'https://www.leagueoflegends.com').replace(/\/$/, '');
// Data Dragon 16.21 = patch 26.21 (numérotation officielle par année depuis 2026).
const patchLabel = (v) => {
  const [a, b] = String(v || '').split('.').map(Number);
  return a >= 16 ? `${a + 10}.${b}` : `${a}.${b}`;
};
const ddOfLabel = (label) => {
  const [a, b] = String(label).split('.').map(Number);
  return a >= 26 ? `${a - 10}.${b}` : `${a}.${b}`;
};
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rarr: '→', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };
const decodeHtml = (s) =>
  String(s || '').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
const htmlText = (s) =>
  decodeHtml(String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s*[⇒⟹]\s*/g, ' → ')
    .replace(/\s+/g, ' ')
    .trim();

async function fetchText(url, ms = 15000) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(ms),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cupcake.gg)', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6' },
  });
  if (!r.ok) throw new ApiError(r.status, `HTTP ${r.status}`);
  return r.text();
}

const guessUrls = (label) => {
  const [a, b] = label.split('.');
  return [
    `${NEWS_BASE}/${RIOT_LOCALE}/news/game-updates/league-of-legends-patch-${a}-${b}-notes/`,
    `${NEWS_BASE}/${RIOT_LOCALE}/news/game-updates/patch-${a}-${b}-notes/`,
  ];
};

// Index des articles « notes de patch » publiés (lien officiel par patch), mis à jour toutes les 3 h.
let notesIdx = null;
async function notesIndex() {
  if (notesIdx && Date.now() - notesIdx.at < 3 * 3600e3) return notesIdx.map;
  const file = path.join(DATA_DIR, 'patchnotes-index.json');
  const map = await readJson(file, {});
  try {
    const html = await fetchText(`${NEWS_BASE}/${RIOT_LOCALE}/news/tags/patch-notes/`, 12000);
    let found = 0;
    for (const mm of html.matchAll(/href="((?:https?:\/\/[^"/]+)?\/[a-z]{2}-[a-z]{2}\/news\/game-updates\/[a-z0-9-]*?patch-(\d{2})-(\d{1,2})-notes[a-z0-9-]*\/?)"/gi)) {
      const label = `${mm[2]}.${Number(mm[3])}`;
      map[label] = { ...(map[label] || {}), url: mm[1].startsWith('http') ? mm[1] : NEWS_BASE + mm[1] };
      found++;
    }
    if (found) await writeJson(file, map).catch(() => {});
  } catch {
    /* site Riot injoignable : index précédent */
  }
  notesIdx = { at: Date.now(), map };
  return map;
}

// Découpe d'un article officiel : sections (h2), éléments modifiés (h3), sous-titres (h4), lignes (li).
function parseRiotNotes(html) {
  const meta = (prop) =>
    (html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]*content="([^"]*)"`, 'i')) ||
      html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]*(?:property|name)="${prop}"`, 'i')) ||
      [])[1];
  const out = {
    title: htmlText(meta('og:title') || (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || ''),
    image: decodeHtml(meta('og:image') || '') || null,
    description: htmlText(meta('og:description') || ''),
    date: meta('article:published_time') || (html.match(/"(?:datePublished|publishedAt|date)"\s*:\s*"(\d{4}-\d{2}-\d{2}T[^"]+)"/) || [])[1] || null,
    banner: null,
    sections: [],
  };
  const start = html.search(/<h2\b/i);
  const body = start >= 0 ? html.slice(start) : '';
  const re = /<(h2|h3|h4)\b([^>]*)>([\s\S]*?)<\/\1>|<li\b[^>]*>([\s\S]*?)<\/li>|<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>|<p\b[^>]*class="[^"]*summary[^"]*"[^>]*>([\s\S]*?)<\/p>|<img\b[^>]*src="([^"]+)"[^>]*>/gi;
  let sec = null;
  let ent = null;
  let grp = null;
  let lines = 0;
  for (const t of body.matchAll(re)) {
    if (t[1]) {
      const txt = htmlText(t[3]);
      if (!txt) continue;
      if (t[1].toLowerCase() === 'h2') {
        sec = { title: txt, entries: [], lines: [] };
        out.sections.push(sec);
        ent = grp = null;
      } else if (t[1].toLowerCase() === 'h3') {
        if (!sec) out.sections.push((sec = { title: 'Changements', entries: [], lines: [] }));
        ent = { name: txt, summary: '', context: '', groups: [] };
        sec.entries.push(ent);
        grp = null;
      } else {
        if (!sec) continue;
        if (!ent) sec.entries.push((ent = { name: txt, summary: '', context: '', groups: [] }));
        else ent.groups.push((grp = { title: txt, lines: [] }));
      }
    } else if (t[4] !== undefined) {
      const txt = htmlText(t[4]);
      if (!txt || !sec || txt.length > 600) continue;
      lines++;
      if (ent) {
        if (!grp) ent.groups.push((grp = { title: '', lines: [] }));
        grp.lines.push(txt);
      } else sec.lines.push(txt);
    } else if (t[5] !== undefined) {
      if (ent && !ent.context) ent.context = htmlText(t[5]).slice(0, 600);
    } else if (t[6] !== undefined) {
      if (ent && !ent.summary) ent.summary = htmlText(t[6]).slice(0, 300);
    } else if (t[7] && sec && !out.banner && /aperçu|highlights|faits marquants|points forts/i.test(sec.title)) {
      out.banner = decodeHtml(t[7]);
    }
  }
  out.sections = out.sections.filter((s) => s.entries.length || s.lines.length);
  const entries = out.sections.reduce((n, s) => n + s.entries.length, 0);
  out.ok = entries >= 3 && lines >= 6;
  return out;
}

// Buff / nerf / ajustement, déduit des valeurs « avant → après » (délai et coût : plus bas = buff).
function classifyLines(lines) {
  let up = 0;
  let down = 0;
  for (const l of lines) {
    const m = l.match(/^(.*?)(?::|\s)\s*([^→]*?)\s*→\s*(.+)$/);
    if (!m) continue;
    const nums = (s) => (s.match(/-?\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(',', '.')));
    const a = nums(m[2]);
    const b = nums(m[3]);
    if (!a.length || !b.length) continue;
    const sa = a.reduce((s, x) => s + x, 0) / a.length;
    const sb = b.reduce((s, x) => s + x, 0) / b.length;
    if (sa === sb) continue;
    const lowerIsBetter = /délai|récupération|cooldown|coût|cost|temps d'incantation|délai de|mana/i.test(m[1] + ' ' + l.split('→')[0]);
    const better = lowerIsBetter ? sb < sa : sb > sa;
    if (better) up++;
    else down++;
  }
  if (!up && !down) return 'adjust';
  if (up && !down) return 'buff';
  if (down && !up) return 'nerf';
  return up >= down * 2 ? 'buff' : down >= up * 2 ? 'nerf' : 'adjust';
}

// Relie chaque élément aux données du jeu (icône de champion ou d'objet) et complète buff / nerf.
function linkNotes(notes, st) {
  const champs = Object.values(st?.champions || {});
  const items = Object.entries(st?.items || {});
  const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const byChamp = new Map();
  for (const c of champs) {
    byChamp.set(n(c.name), c);
    byChamp.set(n(c.id), c);
  }
  const byItem = new Map();
  for (const [id, it] of items) if (!byItem.has(n(it.name)) || it.sr) byItem.set(n(it.name), Number(id));
  for (const s of notes.sections || []) {
    for (const e of s.entries || []) {
      const key = n(e.name);
      if (!e.champ && !e.item) {
        const c = byChamp.get(key) || (key.length > 3 && champs.find((x) => key.startsWith(n(x.name)) && n(x.name).length > 3));
        if (c && !/objet|item|rune|systeme|system/i.test(s.title)) e.champ = c.id;
        else if (byItem.has(key)) e.item = byItem.get(key);
      }
      if (e.champ && !e.key) e.key = Object.values(st?.champions || {}).find((c) => c.id === e.champ)?.key || null;
      if (!e.kind && (e.champ || e.item)) e.kind = classifyLines((e.groups || []).flatMap((g) => g.lines));
    }
  }
  return notes;
}

const notesTried = new Map();
async function getPatchNotes(label) {
  if (!/^\d{2}\.\d{1,2}$/.test(label)) throw new ApiError(400, 'Patch invalide.');
  const file = path.join(DATA_DIR, `patchnotes-${label}.json`);
  const st = await getStatic().catch(() => null);
  const saved = await readJson(file, null);
  const recent = Date.now() - (notesTried.get(label) || 0) < 6 * 3600e3;
  if (saved && (saved.source === 'riot' || recent)) return linkNotes(saved, st);
  if (!saved && recent) {
    const idx = notesIdx?.map || {};
    return { patch: label, url: idx[label]?.url || guessUrls(label)[0], title: `Patch ${label}`, image: null, date: null, sections: [], source: 'none' };
  }
  notesTried.set(label, Date.now());
  const idx = await notesIndex();
  let found = null;
  for (const u of [...new Set([idx[label]?.url, ...guessUrls(label)].filter(Boolean))]) {
    try {
      const html = await fetchText(u);
      const parsed = parseRiotNotes(html);
      found = { url: u, title: parsed.title, image: parsed.image, date: parsed.date };
      if (parsed.ok) {
        const out = { patch: label, url: u, title: parsed.title || `Patch ${label}`, image: parsed.image, banner: parsed.banner, date: parsed.date, description: parsed.description, sections: parsed.sections, source: 'riot', fetched: Date.now() };
        await writeJson(file, out).catch(() => {});
        return linkNotes(out, st);
      }
      break;
    } catch {
      /* adresse suivante */
    }
  }
  if (saved) return linkNotes({ ...saved, url: found?.url || saved.url, image: saved.image || found?.image || null }, st);
  return { patch: label, url: found?.url || idx[label]?.url || guessUrls(label)[0], title: found?.title || `Patch ${label}`, image: found?.image || null, date: found?.date || null, sections: [], source: 'none' };
}

// Version anglaise : article officiel en-us ; à défaut, notes françaises (signalées par lang: 'fr').
async function getPatchNotesEn(label) {
  if (!/^\d{2}\.\d{1,2}$/.test(label)) throw new ApiError(400, 'Patch invalide.');
  const file = path.join(DATA_DIR, `patchnotes-${label}-en.json`);
  const st = await getStatic('en_US').catch(() => getStatic().catch(() => null));
  const saved = await readJson(file, null);
  if (saved?.source === 'riot') return { ...linkNotes(saved, st), lang: 'en' };
  const key = `${label}-en`;
  if (Date.now() - (notesTried.get(key) || 0) > 6 * 3600e3) {
    notesTried.set(key, Date.now());
    const idx = await notesIndex().catch(() => ({}));
    const urls = [idx[label]?.url, ...guessUrls(label)].filter(Boolean).map((u) => u.replace(`/${RIOT_LOCALE}/`, '/en-us/'));
    for (const u of [...new Set(urls)]) {
      try {
        const parsed = parseRiotNotes(await fetchText(u));
        if (parsed.ok) {
          const out = { patch: label, url: u, title: parsed.title || `Patch ${label}`, image: parsed.image, banner: parsed.banner, date: parsed.date, description: parsed.description, sections: parsed.sections, source: 'riot', fetched: Date.now() };
          await writeJson(file, out).catch(() => {});
          return { ...linkNotes(out, st), lang: 'en' };
        }
      } catch {
        /* adresse suivante */
      }
    }
  }
  return { ...(await getPatchNotes(label)), lang: 'fr' };
}

async function getPatches() {
  let versions = await dd('/api/versions.json', 3600).catch(() => null);
  if (!versions) {
    const st = await getStatic().catch(() => null);
    versions = st ? [st.version] : [];
  }
  const files = await fsp.readdir(DATA_DIR).catch(() => []);
  const labels = new Map();
  for (const v of versions) {
    if (!/^\d+\.\d+/.test(v)) continue;
    const label = patchLabel(patchOf(v));
    if (!labels.has(label)) labels.set(label, { patch: label, dd: v });
    if (labels.size >= 12) break;
  }
  for (const f of files) {
    const m = f.match(/^patchnotes-(\d{2}\.\d{1,2})\.json$/);
    if (m && !labels.has(m[1])) labels.set(m[1], { patch: m[1], dd: null });
  }
  const idx = await notesIndex();
  const list = [...labels.values()].sort((a, b) => cmpPatch(b.patch, a.patch)).slice(0, 12);
  for (const x of list) {
    x.url = idx[x.patch]?.url || guessUrls(x.patch)[0];
    const n = await readJson(path.join(DATA_DIR, `patchnotes-${x.patch}.json`), null);
    if (n) {
      x.date = n.date || null;
      x.image = n.image || null;
      x.title = n.title || null;
      const count = (re) => (n.sections || []).filter((s) => re.test(s.title)).reduce((t, s) => t + (s.entries || []).length, 0);
      x.counts = { champs: count(/champion/i), items: count(/objet|item/i) };
    }
  }
  return { current: list[0]?.patch || null, list };
}

// Comparaison de deux versions de Data Dragon.
const STAT_FR = {
  hp: 'PV', hpperlevel: 'PV par niveau', mp: 'Mana', mpperlevel: 'Mana par niveau', movespeed: 'Vitesse de déplacement',
  armor: 'Armure', armorperlevel: 'Armure par niveau', spellblock: 'Résistance magique', spellblockperlevel: 'Résistance magique par niveau',
  attackrange: 'Portée d’attaque', hpregen: 'Régénération des PV', hpregenperlevel: 'Régénération des PV par niveau',
  mpregen: 'Régénération du mana', mpregenperlevel: 'Régénération du mana par niveau', attackdamage: 'Dégâts d’attaque',
  attackdamageperlevel: 'Dégâts d’attaque par niveau', attackspeedperlevel: 'Vitesse d’attaque par niveau', attackspeed: 'Vitesse d’attaque',
};
const ITEM_STAT_FR = {
  FlatHPPoolMod: 'PV', FlatMPPoolMod: 'Mana', FlatArmorMod: 'Armure', FlatSpellBlockMod: 'Résistance magique', FlatPhysicalDamageMod: 'Dégâts d’attaque',
  FlatMagicDamageMod: 'Puissance', PercentAttackSpeedMod: 'Vitesse d’attaque', FlatCritChanceMod: 'Coups critiques', PercentMovementSpeedMod: 'Vitesse de déplacement',
  FlatMovementSpeedMod: 'Vitesse de déplacement', PercentLifeStealMod: 'Vol de vie', FlatHPRegenMod: 'Régénération des PV', FlatMPRegenMod: 'Régénération du mana',
};
const arr = (a) => (Array.isArray(a) ? a.map((x) => Math.round(x * 100) / 100).join(' / ') : String(a ?? ''));

async function getPatchDiff(label) {
  if (!/^\d{2}\.\d{1,2}$/.test(label)) throw new ApiError(400, 'Patch invalide.');
  const file = path.join(DATA_DIR, `ddiff-${label}.json`);
  const saved = await readJson(file, null);
  if (saved) return saved;
  const versions = await dd('/api/versions.json', 3600);
  const target = ddOfLabel(label);
  const i = versions.findIndex((v) => patchOf(v) === target);
  if (i < 0) throw new ApiError(404, 'Version inconnue de Data Dragon.');
  const prev = versions.slice(i + 1).find((v) => patchOf(v) !== target);
  if (!prev) throw new ApiError(404, 'Pas de version précédente à comparer.');
  const cur = versions[i];
  const get = (v, f) => dd(`/cdn/${v}/data/${LANG}/${f}.json`, 300);
  const [A, B, IA, IB] = await Promise.all([get(prev, 'championFull'), get(cur, 'championFull'), get(prev, 'item'), get(cur, 'item')]);
  const champions = [];
  const newChamps = [];
  for (const [id, c] of Object.entries(B.data || {})) {
    const o = A.data?.[id];
    if (!o) {
      newChamps.push({ id, key: Number(c.key), name: c.name });
      continue;
    }
    const lines = [];
    let up = 0;
    let down = 0;
    for (const [k, label2] of Object.entries(STAT_FR)) {
      if (o.stats?.[k] === undefined || c.stats?.[k] === undefined || o.stats[k] === c.stats[k]) continue;
      lines.push({ g: 'Statistiques de base', t: `${label2} : ${arr(o.stats[k])} → ${arr(c.stats[k])}` });
      if (c.stats[k] > o.stats[k]) up++;
      else down++;
    }
    (c.spells || []).forEach((s, n) => {
      const os = o.spells?.[n];
      if (!os) return;
      const head = `${'QWER'[n]} – ${s.name}`;
      for (const [f, lab, lower] of [['cooldown', 'Délai de récupération', true], ['cost', 'Coût', true], ['range', 'Portée', false]]) {
        const x = JSON.stringify(os[f]);
        const y = JSON.stringify(s[f]);
        if (x === y || s[f] === undefined) continue;
        if (f === 'range' && (s.range || []).some((r) => r >= 25000)) continue;
        lines.push({ g: head, t: `${lab} : ${arr(os[f])} → ${arr(s[f])}` });
        const sa = (os[f] || []).reduce((t, v) => t + v, 0);
        const sb = (s[f] || []).reduce((t, v) => t + v, 0);
        if (sb !== sa) (lower ? sb < sa : sb > sa) ? up++ : down++;
      }
    });
    if (lines.length) champions.push({ id, key: Number(c.key), name: c.name, kind: up && !down ? 'buff' : down && !up ? 'nerf' : 'adjust', lines });
  }
  const items = [];
  const newItems = [];
  const sr = (it) => it?.maps?.['11'] && it.gold?.purchasable !== false && it.inStore !== false && !it.hideFromAll;
  for (const [id, it] of Object.entries(IB.data || {})) {
    if (!sr(it)) continue;
    const o = IA.data?.[id];
    if (!o || !sr(o)) {
      newItems.push({ id: Number(id), name: it.name });
      continue;
    }
    const lines = [];
    let up = 0;
    let down = 0;
    if (o.gold?.total !== it.gold?.total) {
      lines.push(`Coût total : ${o.gold?.total} → ${it.gold?.total} po`);
      it.gold.total < o.gold.total ? up++ : down++;
    }
    const keys = new Set([...Object.keys(o.stats || {}), ...Object.keys(it.stats || {})]);
    for (const k of keys) {
      const a = o.stats?.[k] || 0;
      const b = it.stats?.[k] || 0;
      if (a === b) continue;
      const pctStat = /^Percent/.test(k);
      const f = (v) => (pctStat ? `${Math.round(v * 1000) / 10} %` : String(Math.round(v * 100) / 100));
      lines.push(`${ITEM_STAT_FR[k] || k} : ${f(a)} → ${f(b)}`);
      b > a ? up++ : down++;
    }
    if (lines.length) items.push({ id: Number(id), name: it.name, kind: up && !down ? 'buff' : down && !up ? 'nerf' : 'adjust', lines });
  }
  const removedItems = Object.entries(IA.data || {})
    .filter(([id, it]) => sr(it) && !sr(IB.data?.[id]))
    .map(([id, it]) => ({ id: Number(id), name: it.name }));
  const out = { patch: label, from: prev, to: cur, champions, newChamps, items, newItems, removedItems, at: Date.now() };
  await writeJson(file, out).catch(() => {});
  return out;
}

/* ---------- Augments (Arena et ARAM du chaos), noms via Community Dragon ---------- */

const CDRAGON = (process.env.CDRAGON_BASE || 'https://raw.communitydragon.org').replace(/\/$/, '');
let augMem = null;
async function getAugments() {
  if (augMem && Date.now() - augMem.at < 6 * 3600e3) return augMem.data;
  const file = path.join(DATA_DIR, 'augments.json');
  const loc = LANG.toLowerCase();
  const out = {};
  const add = (list, src) => {
    for (const a of list || []) {
      if (!a || !a.id || out[a.id]) continue;
      const icon = a.iconLarge || a.iconSmall || a.augmentSmallIconPath || '';
      out[a.id] = {
        name: a.name || a.nameTRA || `Augment ${a.id}`,
        desc: rich(a.desc || a.description || a.tooltip || ''),
        rarity: a.rarity ?? 0,
        icon: icon ? `${CDRAGON}/latest/game/${icon.replace(/^\/?(lol-game-data\/assets\/)?/i, '').toLowerCase()}` : '',
        src,
      };
    }
  };
  try {
    const r = await fetch(`${CDRAGON}/latest/cdragon/arena/${loc}.json`, { signal: AbortSignal.timeout(15000) });
    if (r.ok) add((await r.json()).augments, 'arena');
  } catch {
    /* réseau indisponible */
  }
  try {
    const r = await fetch(`${CDRAGON}/latest/plugins/rcp-be-lol-game-data/global/${loc === 'en_us' ? 'default' : loc}/v1/cherry-augments.json`, { signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const list = await r.json();
      add(list.map((a) => ({ id: a.id, name: a.nameTRA, desc: '', iconLarge: a.augmentSmallIconPath, rarity: a.rarity })), 'cherry');
    }
  } catch {
    /* réseau indisponible */
  }
  if (Object.keys(out).length) {
    await writeJson(file, out).catch(() => {});
  } else {
    Object.assign(out, await readJson(file, {}));
  }
  augMem = { at: Date.now(), data: out };
  return out;
}

/* ---------- Pros suivis ---------- */

async function readPros() {
  return readJson(prosFile, []);
}

async function addPro(body) {
  const platform = plat(String(body?.platform || ''));
  const [name, tag] = splitRiotId(String(body?.riotId || '').trim());
  const label = String(body?.label || '').trim().slice(0, 24);
  const team = String(body?.team || '').trim().slice(0, 12);
  const kind = body?.kind === 'streamer' ? 'streamer' : 'pro';
  const twitch = String(body?.twitch || '').trim().replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').replace(/[^\w]/g, '').slice(0, 25);
  if (!name || !tag) throw new ApiError(400, 'Riot ID incomplet : utilise le format Nom#TAG.');
  const acc = await riot(accountHost(platform), `/riot/account/v1/accounts/by-riot-id/${enc(name)}/${enc(tag)}`, { ttl: 3600 });
  if (!acc) throw new ApiError(404, `Aucun compte « ${name}#${tag} ».`);
  const list = (await readPros()).filter((x) => x.puuid !== acc.puuid);
  list.push({ puuid: acc.puuid, platform, riotId: `${acc.gameName}#${acc.tagLine}`, label: label || acc.gameName, team, kind, twitch });
  await writeJson(prosFile, list);
  knownMem = null;
  return list;
}

async function removePro(puuid) {
  const list = (await readPros()).filter((x) => x.puuid !== puuid);
  await writeJson(prosFile, list);
  knownMem = null;
  return list;
}

/* ---------- Annuaire automatique des joueurs pros ---------- */
// Riot ne dit pas qui est pro. L'annuaire est construit à partir de deux sources publiques,
// configurables par variables d'environnement (PRO_SOURCE_ACCOUNTS, PRO_SOURCE_WIKI) :
// - la source « comptes » relie chaque pro à ses comptes classés (Riot ID), ce qui permet
//   de le reconnaître dans une partie, en direct ou sur son profil ;
// - la source « wiki » complète l'équipe actuelle d'un pro à partir de sa page joueur.
// Résultat : data/pros-auto.json, rafraîchi toutes les PRO_DIR_HOURS heures (0 = désactivé).
const PRODIR_FILE = path.join(DATA_DIR, 'pros-auto.json');
const PRODIR_HOURS = clampInt(process.env.PRO_DIR_HOURS ?? 24, 0, 720, 24);
const PRO_ACC_API = (process.env.PRO_SOURCE_ACCOUNTS || 'https://api.lolpros.gg/es').replace(/\/$/, '');
const PRO_WIKI_API = process.env.PRO_SOURCE_WIKI || 'https://liquipedia.net/leagueoflegends/api.php';
const PRO_PAGES = clampInt(process.env.PRO_DIR_PAGES, 1, 2000, 1000);
const PRO_MAX = clampInt(process.env.PRO_DIR_MAX, 10, 50000, 20000);
const PRO_UA = `cupcake.gg/1.0 (statistiques LoL; ${process.env.CONTACT_EMAIL || 'contact via le site'})`;
const proDirJob = { running: false, at: 0, count: 0, error: null };

async function fetchJson(url, ms = 15000) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(ms),
    headers: { 'User-Agent': PRO_UA, Accept: 'application/json', 'Accept-Encoding': 'gzip' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const asList = (j) => (Array.isArray(j) ? j : j?.items || j?.data || j?.results || j?.players || j?.['hydra:member'] || []);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Parcourt un profil (forme libre) et relève les comptes : Riot ID (nom + tag), puuid, ancien pseudo.
function accountsIn(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return out;
  if (Array.isArray(node)) {
    for (const x of node) accountsIn(x, out, depth + 1);
    return out;
  }
  const name = str(node.gamename) || str(node.game_name) || str(node.gameName) || str(node.riot_id?.split?.('#')[0]) || str(node.summoner_name) || str(node.summonerName);
  const tag = str(node.tagline) || str(node.tag_line) || str(node.tagLine) || str(node.riot_id?.split?.('#')[1]);
  const puuid = str(node.puuid);
  const looksAccount = 'summoner_name' in node || 'summonerName' in node || 'gamename' in node || 'game_name' in node || 'gameName' in node || 'riot_id' in node || 'puuid' in node;
  if (looksAccount && (puuid || name)) out.push({ name, tag, puuid });
  for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object' && k !== 'team' && k !== 'teams') accountsIn(v, out, depth + 1);
  return out;
}
function teamOf(p) {
  const t = p?.team || p?.league_player?.team || p?.current_team || p?.staff?.team;
  if (!t) return '';
  if (typeof t === 'string') return t;
  return str(t.tag) || str(t.abbreviation) || str(t.short_name) || str(t.name);
}
const roleOf = (p) => (str(p?.position) || str(p?.league_player?.position) || str(p?.role)).replace(/^\d+_/, '');

// Parcourt tout le classement de la source (toutes les pages) : les pros des ligues
// mineures (Turquie, ERL, académies…) sont loin dans la liste mais doivent y être.
// Les fiches complètes (tous les comptes, smurfs compris) sont relues par lots :
// PRO_DIR_PROFILES par passage, en commençant par les plus anciennes.
const PRO_PROFILES = clampInt(process.env.PRO_DIR_PROFILES, 50, 20000, 1500);
async function crawlProAccounts(prev) {
  const old = new Map((prev?.list || []).map((p) => [p.slug, p]));
  const players = new Map();
  for (let page = 1; page <= PRO_PAGES && players.size < PRO_MAX; page++) {
    const j = await fetchJson(`${PRO_ACC_API}/ladder?page=${page}&sort=rank&order=desc`).catch(() => null);
    const list = asList(j);
    if (!list.length) break;
    for (const p of list) {
      const slug = str(p.slug) || str(p.uuid);
      const label = str(p.name) || str(p.player_name);
      if (!slug || !label || players.has(slug)) continue;
      const o = old.get(slug);
      const accounts = accountsIn(p.account || p.accounts || p.primary_account || p.league_player || {});
      for (const a of o?.accounts || []) accounts.push(a);
      players.set(slug, { slug, label, team: teamOf(p) || '', role: roleOf(p) || o?.role || '', accounts, at: o?.at || 0 });
    }
    await sleep(600);
  }
  // Fiches complètes : les plus anciennes d'abord, PRO_PROFILES par passage.
  const todo = [...players.values()].sort((x, y) => x.at - y.at).slice(0, PRO_PROFILES);
  for (const P of todo) {
    const j = await fetchJson(`${PRO_ACC_API}/profiles/${encodeURIComponent(P.slug)}`).catch(() => null);
    if (j) {
      P.accounts.push(...accountsIn(j.league_player || j.accounts || j));
      P.team = P.team || teamOf(j);
      P.role = P.role || roleOf(j);
      P.at = Date.now();
    }
    await sleep(600);
  }
  for (const P of players.values()) {
    const seen = new Set();
    P.accounts = P.accounts.filter((a) => {
      const k = a.puuid || `${a.name}#${a.tag}`.toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return [...players.values()];
}

// Équipe actuelle depuis la page joueur du wiki (lots de 50 pages, une requête toutes les 2,5 s).
async function wikiTeams(labels) {
  const out = new Map();
  const uniq = [...new Set(labels.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 50) {
    const titles = uniq.slice(i, i + 50).join('|');
    const u = `${PRO_WIKI_API}?action=query&format=json&redirects=1&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(titles)}`;
    const j = await fetchJson(u, 20000).catch(() => null);
    const norm = new Map();
    for (const r of j?.query?.redirects || []) norm.set(r.to, r.from);
    for (const r of j?.query?.normalized || []) norm.set(r.to, r.from);
    for (const pg of Object.values(j?.query?.pages || {})) {
      const txt = pg?.revisions?.[0]?.slots?.main?.['*'] || pg?.revisions?.[0]?.['*'] || '';
      const m = txt.match(/\|\s*team\s*=\s*([^\n|}]+)/i);
      if (!m) continue;
      const team = m[1].replace(/\[\[|\]\]|''+/g, '').replace(/<[^>]+>/g, '').trim();
      if (team) out.set((norm.get(pg.title) || pg.title).toLowerCase(), team);
    }
    await sleep(2500);
  }
  return out;
}
const shortTeam = (t) => {
  const s = String(t || '').trim();
  if (s.length <= 12) return s;
  const caps = s.split(/\s+/).map((w) => w[0]).join('').toUpperCase();
  return caps.slice(0, 5);
};

async function refreshProDirectory() {
  if (proDirJob.running) return;
  proDirJob.running = true;
  proDirJob.error = null;
  try {
    const prev = await readJson(PRODIR_FILE, null);
    const players = await crawlProAccounts(prev);
    if (!players.length) throw new Error('source comptes vide ou injoignable');
    const teams = await wikiTeams(players.filter((p) => !p.team).map((p) => p.label)).catch(() => new Map());
    const rows = [];
    for (const p of players) {
      // Joueur inscrit dans la source : pro, avec ou sans équipe en ce moment
      // (un pro entre deux contrats reste un pro). Le badge affiche l'équipe si elle est connue.
      const team = shortTeam(p.team || teams.get(p.label.toLowerCase()) || '');
      for (const a of p.accounts) {
        // Seulement des comptes identifiés sans ambiguïté : puuid, ou nom + tag.
        if (!a.puuid && !(a.name && a.tag)) continue;
        rows.push({ name: a.name || '', tag: a.tag || '', puuid: a.puuid || '', kind: 'pro', label: p.label, team, role: p.role, page: p.label, src: 'auto' });
      }
    }
    await writeJson(PRODIR_FILE, { at: Date.now(), players: players.length, rows, list: players });
    proDirJob.count = rows.length;
    proDirJob.at = Date.now();
    knownMem = null;
    console.log(`  Annuaire des pros : ${players.length} joueurs, ${rows.length} comptes.`);
  } catch (e) {
    proDirJob.error = e.message;
    console.log(`  Annuaire des pros indisponible : ${e.message}`);
  } finally {
    proDirJob.running = false;
  }
}

/* ---------- Photos des joueurs pros (données esport officielles de Riot) ---------- */
// Une seule requête par jour : toutes les équipes et leurs joueurs (pseudo, photo, équipe).
// Variables : PRO_PHOTOS_API, PRO_PHOTOS_KEY (clé publique du site esport de Riot), PRO_PHOTOS=0 pour couper.
const PHOTO_API = process.env.PRO_PHOTOS_API || 'https://esports-api.lolesports.com/persisted/gw/getTeams?hl=en-US';
const PHOTO_KEY = process.env.PRO_PHOTOS_KEY || '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
let photoMem = null;
async function proPhotoMap() {
  if (process.env.PRO_PHOTOS === '0') return new Map();
  if (photoMem && Date.now() - photoMem.at < 24 * 3600e3) return photoMem.map;
  const file = path.join(DATA_DIR, 'pro-photos.json');
  let saved = await readJson(file, null);
  const map = new Map(Object.entries(saved?.map || {}));
  if (!saved || Date.now() - (saved.at || 0) > 24 * 3600e3) {
    try {
      const r = await fetch(PHOTO_API, { headers: { 'x-api-key': PHOTO_KEY, 'User-Agent': PRO_UA }, signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const j = await r.json();
        map.clear();
        for (const t of j?.data?.teams || []) {
          if (/^(tbd|tbd2)$/i.test(t.slug || '')) continue;
          for (const pl of t.players || []) {
            const k = String(pl.summonerName || '').trim().toLowerCase();
            if (!k || !pl.image || /default|silhouette/i.test(pl.image)) continue;
            map.set(k, { img: String(pl.image).replace(/^http:/, 'https:'), team: t.code || '', role: pl.role || '' });
          }
        }
        await writeJson(file, { at: Date.now(), map: Object.fromEntries(map) }).catch(() => {});
      }
    } catch {
      /* source injoignable : dernière liste connue */
    }
  }
  photoMem = { at: Date.now(), map };
  return map;
}
async function getProPhotos(names) {
  const map = await proPhotoMap();
  const out = {};
  for (const n of String(names || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 60)) {
    const hit = map.get(n.toLowerCase());
    if (hit) out[n.toLowerCase()] = hit;
  }
  return out;
}

/* ---------- Reconnaissance d'un pro à la demande ---------- */
// Un badge pro n'est donné que sur une preuve solide : le compte (puuid, ou nom + tag exacts)
// est relié à un joueur inscrit dans la source « comptes ». Pas de devinette sur le pseudo ni le rang.
// Les résultats (positifs 7 jours, négatifs 2 jours) sont gardés dans data/pros-found-v4.json.
const proFoundFile = path.join(DATA_DIR, 'pros-found-v4.json');
let proFound = null;
async function proFoundMap() {
  if (!proFound) proFound = new Map(Object.entries(await readJson(proFoundFile, {})));
  return proFound;
}
let proFoundSave = null;
function saveProFound() {
  clearTimeout(proFoundSave);
  proFoundSave = setTimeout(() => writeJson(proFoundFile, Object.fromEntries(proFound)).catch(() => {}), 2000);
}
async function discoverPro(puuid, name, tag) {
  const map = await proFoundMap();
  const hit = map.get(puuid);
  if (hit && Date.now() - hit.at < (hit.pro ? 7 : 2) * 86400e3) return hit.pro;
  let pro = null;
  const n = String(name || '').trim();
  if (n.length >= 2) {
    // Source « comptes » : le compte doit appartenir au joueur (puuid, ou nom + tag identiques)
    // et le joueur doit avoir une équipe actuelle. Sinon : pas de badge.
    const j = await fetchJson(`${PRO_ACC_API}/search?query=${encodeURIComponent(n)}`, 4000).catch(() => null);
    for (const p of asList(j)) {
      const team = shortTeam(teamOf(p));
      const accs = accountsIn(p);
      const ok = accs.some((a) => (a.puuid && a.puuid === puuid) || (a.name && a.tag && tag && a.name.toLowerCase() === n.toLowerCase() && a.tag.toLowerCase() === String(tag).toLowerCase()));
      if (ok) {
        pro = { kind: 'pro', label: (str(p.name) || n).slice(0, 24), team, twitch: '', src: 'accounts', page: str(p.name) || n };
        break;
      }
    }
  }
  if (!pro && n.length >= 3) pro = await twitchStreamer(n).catch(() => null);
  map.set(puuid, { pro, at: Date.now() });
  saveProFound();
  return pro;
}

/* ---------- Streamers sans « ttv » dans le pseudo ---------- */
// Optionnel : nécessite TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET (application gratuite sur le
// portail développeur Twitch). Un joueur est reconnu streamer seulement si les trois sont vrais :
// - une chaîne porte exactement son pseudo (espaces et ponctuation retirés) ;
// - la chaîne est partenaire ou affiliée (pas un compte vide au même nom) ;
// - sa dernière catégorie diffusée est League of Legends.
const TW_ID = process.env.TWITCH_CLIENT_ID || '';
const TW_SECRET = process.env.TWITCH_CLIENT_SECRET || '';
const TW_AUTH = (process.env.TWITCH_AUTH_BASE || 'https://id.twitch.tv').replace(/\/$/, '');
const TW_API = (process.env.TWITCH_API_BASE || 'https://api.twitch.tv/helix').replace(/\/$/, '');
const LOL_GAME_ID = '21779';
let twTok = null;
async function twitchToken() {
  if (twTok && twTok.exp > Date.now() + 60e3) return twTok.v;
  const r = await fetch(`${TW_AUTH}/oauth2/token?client_id=${encodeURIComponent(TW_ID)}&client_secret=${encodeURIComponent(TW_SECRET)}&grant_type=client_credentials`, { method: 'POST', signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Twitch auth ${r.status}`);
  const j = await r.json();
  twTok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return twTok.v;
}
async function twitchGet(pathq) {
  const tok = await twitchToken();
  const r = await fetch(`${TW_API}${pathq}`, { headers: { 'Client-Id': TW_ID, Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(4000) });
  if (r.status === 401) twTok = null;
  if (!r.ok) throw new Error(`Twitch ${r.status}`);
  return r.json();
}
async function twitchStreamer(name) {
  if (!TW_ID || !TW_SECRET) return null;
  const login = String(name).toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (login.length < 4 || login.length > 25) return null;
  const u = (await twitchGet(`/users?login=${login}`))?.data?.[0];
  if (!u || !['partner', 'affiliate'].includes(u.broadcaster_type)) return null;
  const ch = (await twitchGet(`/channels?broadcaster_id=${u.id}`))?.data?.[0];
  if (!ch || String(ch.game_id) !== LOL_GAME_ID) return null;
  return { kind: 'streamer', label: String(u.display_name || name).slice(0, 24), team: '', twitch: u.login, src: 'twitch' };
}

/* ---------- Pros et streamers reconnus ---------- */
// Riot ne dit pas qui est pro ou streamer. Trois sources, dans l'ordre :
// 1. les pros et streamers suivis (ajoutés depuis la tier list, fichier pros.json) ;
// 2. la liste pros-list.json (seed/ puis data/), modifiable à la main ;
// 3. l'annuaire automatique pros-auto.json (voir plus haut) ;
// 4. la détection par le pseudo : « ttv », « twtv », « twitch »… (streamers) ;
// 5. à la demande : source « comptes » (pros) puis Twitch (streamers, si les clés sont fournies).
const knownFile = path.join(DATA_DIR, 'pros-list.json');
let knownMem = null;
async function knownList() {
  if (knownMem && Date.now() - knownMem.at < 60e3) return knownMem.list;
  const [list, followed, auto] = await Promise.all([readJson(knownFile, []), readPros(), readJson(PRODIR_FILE, null)]);
  const byId = new Map();
  const byName = new Map();
  const entry = (x) => ({
    kind: x.kind === 'streamer' ? 'streamer' : 'pro',
    label: String(x.label || '').slice(0, 24),
    team: String(x.team || '').slice(0, 12),
    twitch: /^\w{3,25}$/.test(x.twitch || '') ? x.twitch : '',
    ...(x.role ? { role: String(x.role).slice(0, 12) } : {}),
    ...(x.page ? { page: String(x.page).slice(0, 60) } : {}),
  });
  // L'annuaire automatique passe en premier : la liste manuelle et les suivis le corrigent.
  for (const x of auto?.rows || []) {
    if (!x || (!x.name && !x.puuid) || (!x.puuid && (!x.tag || x.tag === '*'))) continue;
    const e = entry(x);
    if (x.puuid) byId.set(x.puuid, e);
    if (x.name) byName.set(`${x.name}#${x.tag || '*'}`.toLowerCase(), e);
  }
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || (!x.name && !x.puuid)) continue;
    const e = entry(x);
    if (x.puuid) byId.set(x.puuid, e);
    if (x.name) byName.set(`${x.name}#${x.tag || '*'}`.toLowerCase(), e);
  }
  for (const x of followed) {
    const e = entry(x);
    if (x.puuid) byId.set(x.puuid, e);
    if (x.riotId) byName.set(String(x.riotId).toLowerCase(), e);
  }
  knownMem = { at: Date.now(), list: { byId, byName } };
  return knownMem.list;
}
const STREAM_PREFIX = /^(?:ttv|twtv|twitch(?=[\s._-])|kick(?=[\s._-])|tv(?=[\s._-]))[\s._-]*(.{2,})$/i;
const STREAM_SUFFIX = /^(.{2,}?)[\s._-]+(?:ttv|twtv|twitch)$/i;
function whoIs(K, puuid, name, tag) {
  const n = String(name || '').trim();
  const hit = (puuid && K.byId.get(puuid)) || (n && (K.byName.get(`${n}#${tag || ''}`.toLowerCase()) || K.byName.get(`${n}#*`.toLowerCase())));
  if (hit) return hit;
  const found = puuid && proFound?.get(puuid)?.pro;
  if (found) return found;
  if (!n) return null;
  const m = n.match(STREAM_PREFIX) || n.match(STREAM_SUFFIX) || (/^(ttv|twtv|twitch|kick)$/i.test(tag || '') ? [n, n] : null);
  if (!m) return null;
  const handle = m[1].replace(/[\s.-]+/g, '').toLowerCase();
  return { kind: 'streamer', label: '', team: '', twitch: /^\w{3,25}$/.test(handle) ? handle : '', guess: true };
}
// Ajoute r.pro aux lignes reconnues. f(r) renvoie [puuid, nom, tag].
async function tagKnown(rows, f = (r) => [r.puuid, r.name, r.tag]) {
  await proFoundMap().catch(() => null);
  const K = await knownList().catch(() => ({ byId: new Map(), byName: new Map() }));
  for (const r of rows || []) {
    if (!r) continue;
    const [pu, n, t] = f(r);
    const w = whoIs(K, pu, n, t);
    if (w) r.pro = w;
  }
  return rows;
}

/* ---------- Collecte ---------- */

function startMeta(platform, target, mode = 'sr') {
  const mk = metaKey(platform, mode);
  const Q = MODES[mode].q;
  if (metaJobs[mk]?.running) return;
  const job = (metaJobs[mk] = { running: true, done: 0, target, phase: 'Recherche des meilleurs joueurs', error: null, cancel: false });
  (async () => {
    try {
      const st = await getStatic();
      const cur = patchOf(st.version);
      const meta = await readMeta(mk);
      const seen = new Set(meta.seen || []);
      const lists = await Promise.all(
        ['challengerleagues', 'grandmasterleagues'].map((l) =>
          riot(platform, `/lol/league/v4/${l}/by-queue/RANKED_SOLO_5x5`, { prio: 1, store: false }).catch(() => null)
        )
      );
      const ladder = {};
      for (const l of lists) for (const e of l?.entries || []) if (e.puuid) ladder[e.puuid] = { tier: l.tier, lp: e.leaguePoints };
      const pros = (await readPros()).filter((x) => x.platform === platform).map((x) => x.puuid);
      const players = [...pros, ...shuffle(Object.keys(ladder).filter((x) => !pros.includes(x)))];
      if (!players.length) throw new ApiError(502, 'Aucun joueur Challenger ou Grand Maître récupéré.');
      job.phase = 'Lecture des parties et des chronologies';
      const since = Math.floor(Date.now() / 1000) - 14 * 86400;
      const host = matchHost(platform);
      let unsaved = 0;
      for (const puuid of players) {
        if (job.done >= target || job.cancel) break;
        const ids =
          (await riot(host, `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${Q}${mode === 'sr' ? '&type=ranked' : ''}&start=0&count=10&startTime=${since}`, {
            prio: 1,
            store: false,
          }).catch(() => null)) || [];
        // Les parties arrivent de la plus récente à la plus ancienne : on s'arrête au premier ancien patch.
        for (const id of ids) {
          if (job.done >= target || job.cancel) break;
          if (seen.has(id)) continue;
          seen.add(id);
          const m = await riot(host, `/lol/match/v5/matches/${id}`, { prio: 1, store: false }).catch(() => null);
          if (!m?.info || m.info.queueId !== Q) continue;
          if (cmpPatch(patchOf(m.info.gameVersion), cur) < 0) break;
          if (m.info.participants.some((p) => p.gameEndedInEarlySurrender)) continue;
          const tl = await riot(host, `/lol/match/v5/matches/${id}/timeline`, { prio: 1, store: false }).catch(() => null);
          aggregate(meta, m, tl?.info ? tl : null, st, ladder, mode);
          job.done++;
          if (++unsaved >= 10) {
            meta.seen = [...seen].slice(-15000);
            await writeMeta(mk, meta);
            unsaved = 0;
          }
        }
      }
      meta.seen = [...seen].slice(-15000);
      await writeMeta(mk, meta);
      job.phase = job.cancel ? 'Arrêtée' : 'Terminée';
    } catch (e) {
      job.error = e.message || String(e);
      job.phase = 'Erreur';
    } finally {
      job.running = false;
    }
  })();
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

const routes = [];
const route = (method, re, fn) => routes.push({ method, re, fn });
const P = '([a-z0-9]+)';

route('GET', /^\/api\/config$/, () => ({ platforms: PLATFORMS, hasKey: !!KEY, demo: DEMO_ON, proWiki: PRO_WIKI_API.replace(/api\.php.*$/, ''), defaultPlatform: PLATFORMS[DEFAULT_PLATFORM] ? DEFAULT_PLATFORM : 'euw1' }));
route('GET', /^\/api\/static$/, (m, q) => getStatic(q.lang).catch((e) => (langOf(q.lang) !== LANG ? getStatic(LANG) : Promise.reject(e))));
route('GET', /^\/api\/champion\/([A-Za-z0-9]+)$/, (m, q) => getChampion(m[1], q.lang).catch((e) => (langOf(q.lang) !== LANG && !(e instanceof ApiError && e.status === 400) ? getChampion(m[1]) : Promise.reject(e))));
route('GET', new RegExp(`^/api/summoner/${P}/([^/]+)/([^/]+)$`), (m, q) => getSummoner(plat(m[1]), dec(m[2]), dec(m[3]), q.force === '1'));
route('GET', new RegExp(`^/api/matches/${P}/([\\w-]+)$`), (m, q) => getMatches(plat(m[1]), puuidParam(m[2]), q));
route('GET', new RegExp(`^/api/match/${P}/([A-Z0-9]+_\\d+)$`), async (m) => {
  const match = await getMatch(plat(m[1]), m[2]);
  if (!match) throw new ApiError(404, 'Partie introuvable.');
  const out = { ...match, parts: match.parts.map((pp) => ({ ...pp })) };
  await tagKnown(out.parts);
  return out;
});
route('GET', new RegExp(`^/api/season/${P}/([\\w-]+)$`), (m, q) => getSeasonCount(plat(m[1]), puuidParam(m[2]), q.force === '1'));
route('GET', new RegExp(`^/api/timeline/${P}/([A-Z0-9]+_\\d+)$`), (m) => getTimeline(plat(m[1]), m[2]));
route('GET', new RegExp(`^/api/live-player/${P}/([\\w-]+)$`), (m, q) => getLivePlayer(plat(m[1]), puuidParam(m[2]), Number(q.champ) || 0, ROLES_OK.includes(q.role) ? q.role : ''));
route('GET', new RegExp(`^/api/live/${P}/([\\w-]+)$`), (m) => getLive(plat(m[1]), puuidParam(m[2])));
route('GET', new RegExp(`^/api/rotation/${P}$`), (m) => getRotation(plat(m[1])));
route('GET', new RegExp(`^/api/status/${P}$`), (m, q) => getStatus(plat(m[1]), q.lang));
route('GET', new RegExp(`^/api/ladder/${P}$`), (m, q) => getLadder(m[1] === 'world' ? 'world' : plat(m[1]), q.queue, q.page));
route('GET', new RegExp(`^/api/ranks/${P}$`), (m, q) => getRanks(plat(m[1]), q.ids));
route('GET', /^\/api\/pro-photos$/, (m, q) => getProPhotos(q.names));
route('GET', /^\/api\/pro-directory$/, async () => {
  const cur = await readJson(PRODIR_FILE, null);
  return { at: cur?.at || 0, players: cur?.players || 0, accounts: cur?.rows?.length || 0, running: proDirJob.running, error: proDirJob.error };
});
route('GET', /^\/api\/ladder-id$/, (m, q) => getLadderIdentity(q.ids));
route('GET', /^\/api\/ladder-stats$/, (m, q) => getLadderStats(q.ids));
route('GET', /^\/api\/players$/, (m, q) => tagKnown(searchPlayers(q.q, q.p)));
route('GET', new RegExp(`^/api/accounts/${P}$`), (m, q) => getAccounts(plat(m[1]), q.puuids));
route('GET', new RegExp(`^/api/meta/${P}$`), (m, q) => metaSummary(plat(m[1]), modeOf(q.mode)));
route('GET', new RegExp(`^/api/meta/${P}/champion/(\\d+)$`), (m, q) => metaChampion(plat(m[1]), Number(m[2]), q.patch, modeOf(q.mode)));
route('GET', /^\/api\/augments$/, () => getAugments());
route('GET', new RegExp(`^/api/otp/${P}$`), (m, q) => getOtp(plat(m[1]), q));
route('GET', new RegExp(`^/api/matchup/${P}$`), (m, q) => getMatchup(plat(m[1]), q));
route('GET', /^\/api\/patches$/, () => getPatches());
route('GET', /^\/api\/patch-notes\/(\d{2}\.\d{1,2})$/, (m, q) => (q.lang === 'en_US' ? getPatchNotesEn(m[1]) : getPatchNotes(m[1])));
route('GET', /^\/api\/patch-diff\/(\d{2}\.\d{1,2})$/, (m) => getPatchDiff(m[1]));
route('POST', new RegExp(`^/api/meta/${P}/start$`), (m, q) => {
  const p = plat(m[1]);
  if (!KEY) throw new ApiError(500, 'Aucune clé API : ajoute RIOT_API_KEY=... dans le fichier .env puis relance le serveur.');
  if (DEMO_ON) throw new ApiError(403, 'Analyse désactivée sur la version de démonstration.');
  startMeta(p, clampInt(q.target, 20, 2000, 150), modeOf(q.mode));
  return metaSummary(p, modeOf(q.mode));
});
route('POST', new RegExp(`^/api/meta/${P}/stop$`), (m, q) => {
  const p = plat(m[1]);
  const mk = metaKey(p, modeOf(q.mode));
  if (metaJobs[mk]?.running) metaJobs[mk].cancel = true;
  return metaSummary(p, modeOf(q.mode));
});
route('GET', /^\/api\/pros$/, () => readPros());
const noDemo = () => {
  if (DEMO_ON) throw new ApiError(403, 'Modification désactivée sur la version de démonstration.');
};
route('POST', /^\/api\/pros$/, (m, q, body) => (noDemo(), addPro(body)));
route('DELETE', /^\/api\/pros\/([\w-]+)$/, (m) => (noDemo(), removePro(m[1])));

/* ------------------------------------------------------------------ */
/* Serveur HTTP                                                        */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const IMG_SRC = ['https://ddragon.leagueoflegends.com', DDRAGON].filter((v, i, a) => a.indexOf(v) === i).join(' ');
const CSP = [
  "default-src 'self'",
  `img-src 'self' data: ${IMG_SRC} https://raw.communitydragon.org https://cmsassets.rgpub.io https://static.lolesports.com https://am-a.akamaihd.net`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 16384) {
        reject(new ApiError(413, 'Requête trop volumineuse.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new ApiError(400, 'Corps de requête JSON invalide.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(req, res, status, data) {
  let body = Buffer.from(JSON.stringify(data === undefined ? null : data));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    body = zlib.gzipSync(body);
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (rel === '/') rel = '/index.html';
  let file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  let data;
  try {
    data = await fsp.readFile(file);
  } catch {
    if (path.extname(rel)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Introuvable');
    }
    file = path.join(PUBLIC_DIR, 'index.html');
    data = await fsp.readFile(file);
  }
  const ext = path.extname(file);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  if (ext === '.html') headers['Content-Security-Policy'] = CSP;
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && /\.(html|css|js|json|svg)$/.test(ext)) {
    data = zlib.gzipSync(data);
    headers['Content-Encoding'] = 'gzip';
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : data);
}

const server = http.createServer(async (req, res) => {
  // « //riot.txt » serait lu comme un nom d'hôte : on fusionne les barres obliques en tête.
  const url = new URL(req.url.replace(/^\/+/, '/'), 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) return sendJson(req, res, 404, { error: 'Route inconnue.' });
    try {
      const body = req.method === 'POST' ? await readBody(req) : null;
      const data = await r.fn(url.pathname.match(r.re), Object.fromEntries(url.searchParams), body);
      sendJson(req, res, 200, data);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      if (!(e instanceof ApiError)) console.error(e);
      sendJson(req, res, status, { error: e.message || 'Erreur serveur.' });
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  serveStatic(req, res, url.pathname).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Le port ${PORT} est déjà utilisé. Change PORT dans .env.`);
  else console.error(e);
  process.exit(1);
});

// Mise à jour automatique des builds : au démarrage puis toutes les AUTO_META_HOURS heures.
// Les données s'ajoutent aux précédentes dans data/ ; rien n'est perdu au redémarrage.
function scheduleAutoMeta() {
  const hours = Number(process.env.AUTO_META_HOURS ?? 6);
  const games = clampInt(process.env.AUTO_META_GAMES, 20, 2000, 100);
  const plats = String(process.env.AUTO_META_PLATFORMS || DEFAULT_PLATFORM)
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter((x) => PLATFORMS[x]);
  const modes = String(process.env.AUTO_META_MODES || 'sr')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => MODES[x]);
  if (!KEY || !hours || !plats.length || DEMO_ON) return;
  // Un seul job à la fois pour ne pas épuiser la limite de la clé.
  const queue = [];
  const run = () => {
    for (const p of plats) for (const m of modes) queue.push([p, m]);
    next();
  };
  const next = () => {
    if (Object.values(metaJobs).some((j) => j.running)) return setTimeout(next, 30e3);
    const job = queue.shift();
    if (!job) return;
    startMeta(job[0], games, job[1]);
    setTimeout(next, 30e3);
  };
  setTimeout(run, 20e3);
  setInterval(run, hours * 3600e3);
  console.log(`  Analyse auto : ${games} parties toutes les ${hours} h (${plats.join(', ')} ; ${modes.join(', ')}).`);
}

// Annuaire des pros : au démarrage (si absent ou périmé) puis toutes les PRO_DIR_HOURS heures.
function scheduleProDirectory() {
  if (!PRODIR_HOURS) return;
  const tick = async () => {
    const cur = await readJson(PRODIR_FILE, null);
    if (!cur || Date.now() - (cur.at || 0) > PRODIR_HOURS * 3600e3) refreshProDirectory();
  };
  setTimeout(tick, 15e3);
  setInterval(tick, 3600e3);
  console.log(`  Annuaire des pros : mise à jour toutes les ${PRODIR_HOURS} h.`);
}

/* ------------------------------------------------------------------ */
/* Sauvegarde distante sur Cloudflare R2 (API S3, signature AWS v4)    */
/* Pour les hébergeurs sans disque persistant (Render gratuit…).       */
/* ------------------------------------------------------------------ */

const R2 = {
  account: process.env.R2_ACCOUNT_ID || '',
  key: process.env.R2_ACCESS_KEY_ID || '',
  secret: process.env.R2_SECRET_ACCESS_KEY || '',
  bucket: process.env.R2_BUCKET || '',
  prefix: (process.env.R2_PREFIX || 'cupcake/').replace(/^\/+/, ''),
};
const r2On = () => !!(R2.account && R2.key && R2.secret && R2.bucket);
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

async function r2(method, key = '', body = null, query = {}) {
  const host = `${R2.account}.r2.cloudflarestorage.com`;
  const pathName = '/' + [R2.bucket, ...key.split('/').filter(Boolean)].map(rfc3986).join('/');
  const qs = Object.keys(query)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`)
    .join('&');
  const now = new Date();
  const amz = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amz.slice(0, 8);
  const payload = sha(body || '');
  const headers = { host, 'x-amz-content-sha256': payload, 'x-amz-date': amz };
  const signed = Object.keys(headers).sort();
  const canon = [method, pathName, qs, signed.map((h) => `${h}:${headers[h]}\n`).join(''), signed.join(';'), payload].join('\n');
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha(canon)].join('\n');
  const kSign = hmac(hmac(hmac(hmac('AWS4' + R2.secret, day), 'auto'), 's3'), 'aws4_request');
  const sig = crypto.createHmac('sha256', kSign).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${R2.key}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${sig}`;
  delete headers.host;
  const res = await fetch(`https://${host}${pathName}${qs ? '?' + qs : ''}`, { method, headers, body: body || undefined, signal: AbortSignal.timeout(30000) });
  if (!res.ok && res.status !== 404) throw new Error(`R2 ${method} ${key} : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

const pendingUploads = new Map();
function remoteSave(file) {
  if (!r2On() || !file.startsWith(DATA_DIR)) return;
  clearTimeout(pendingUploads.get(file));
  // Regroupe les écritures rapprochées : un envoi au plus toutes les 20 s par fichier.
  pendingUploads.set(file, setTimeout(() => uploadFile(file), 20000));
}
async function uploadFile(file) {
  pendingUploads.delete(file);
  try {
    const body = await fsp.readFile(file);
    await r2('PUT', R2.prefix + path.relative(DATA_DIR, file).split(path.sep).join('/'), body);
  } catch (e) {
    console.warn(`  Sauvegarde R2 : ${e.message}`);
  }
}
async function flushUploads() {
  const files = [...pendingUploads.keys()];
  files.forEach((f) => clearTimeout(pendingUploads.get(f)));
  await Promise.all(files.map(uploadFile));
}

async function restoreFromR2() {
  if (!r2On()) return;
  let n = 0;
  let token = null;
  try {
    do {
      const q = { 'list-type': '2', prefix: R2.prefix };
      if (token) q['continuation-token'] = token;
      const xml = await (await r2('GET', '', null, q)).text();
      const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
      for (const k of keys) {
        const rel = k.slice(R2.prefix.length);
        if (!rel || rel.includes('..')) continue;
        const res = await r2('GET', k);
        if (!res.ok) continue;
        const dest = path.join(DATA_DIR, rel);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, Buffer.from(await res.arrayBuffer()));
        n++;
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (xml.match(/<NextContinuationToken>([^<]+)</) || [])[1] : null;
    } while (token);
    console.log(`  Données restaurées depuis Cloudflare R2 : ${n} fichier(s).`);
  } catch (e) {
    console.warn(`  Restauration R2 impossible : ${e.message}`);
  }
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    if (pendingUploads.size) {
      console.log('  Envoi des dernières données vers R2…');
      await flushUploads().catch(() => {});
    }
    process.exit(0);
  });
}

async function loadPlayers() {
  const file = path.join(DATA_DIR, 'players.json');
  for (const x of await readJson(file, [])) indexPlayer(x.p, x.name, x.tag, x);
  // Joueurs vus dans les échantillons de builds.
  try {
    for (const f of (await fsp.readdir(DATA_DIR)).filter((f) => /^meta2-[a-z0-9]+(-\w+)?\.json$/.test(f))) {
      const plat = f.slice(6, -5).split('-')[0];
      const m = await readJson(path.join(DATA_DIR, f), null);
      for (const P of Object.values(m?.patches || {}))
        for (const c of Object.values(P.champs || {})) for (const g of c.recent || []) if (g.n && g.tg) indexPlayer(plat, g.n, g.tg, { tier: g.tier, lp: g.lp });
    }
  } catch {
    /* pas de données */
  }
  playersDirty = false;
  console.log(`  Annuaire de joueurs : ${players.size} joueurs connus.`);
  setInterval(async () => {
    if (!playersDirty) return;
    playersDirty = false;
    const list = [...players.values()].map(({ p, name, tag, icon, tier, lp, seen }) => ({ p, name, tag, icon, tier, lp, seen }));
    await writeJson(file, list).catch(() => {});
  }, 60e3);
}

// Données de départ versionnées dans seed/ (copiées si data/ est vide, ex. Render gratuit).
async function restoreSeed() {
  const seed = path.join(__dirname, 'seed');
  let files = [];
  try {
    files = (await fsp.readdir(seed)).filter((f) => f.endsWith('.json'));
  } catch {
    return;
  }
  await fsp.mkdir(DATA_DIR, { recursive: true });
  let n = 0;
  for (const f of files) {
    const dest = path.join(DATA_DIR, f);
    if (await fsp.stat(dest).then(() => true, () => false)) continue;
    await fsp.copyFile(path.join(seed, f), dest);
    n++;
  }
  if (n) console.log(`  Données de départ chargées depuis seed/ : ${n} fichier(s).`);
}

(async () => {
await restoreFromR2();
await restoreSeed();
await loadPlayers();
server.listen(PORT, HOST, async () => {
  console.log(`\n  cupcake.gg prêt : http://localhost:${PORT}\n`);
  if (!KEY) {
    console.warn('  Attention : aucune clé RIOT_API_KEY dans .env, les recherches de joueurs échoueront.\n');
    return;
  }
  const source = ENV_FROM_FILE.has('RIOT_API_KEY') ? 'fichier .env' : 'variable d’environnement du système (prioritaire sur .env)';
  console.log(`  Clé utilisée : ${KEY.slice(0, 10)}…${KEY.slice(-4)} (${source})`);
  if (!/^RGAPI-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(KEY)) {
    console.warn('  Attention : la clé n’a pas le format RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.');
  }
  try {
    await riot(DEFAULT_PLATFORM in PLATFORMS ? DEFAULT_PLATFORM : 'euw1', '/lol/status/v4/platform-data', { ttl: 300 });
    console.log('  Clé API Riot acceptée.\n');
  } catch (e) {
    console.warn(`  Clé API Riot : ${e.message}\n`);
  }
  getStatic().catch((e) => console.warn(`  Data Dragon : ${e.message}`));
  if (r2On()) console.log(`  Sauvegarde Cloudflare R2 active (bucket ${R2.bucket}).`);
  scheduleAutoMeta();
  scheduleProDirectory();
});
})();
