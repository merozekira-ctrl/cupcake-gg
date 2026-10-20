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

let staticMem = null;

async function latestStaticFile() {
  try {
    const files = (await fsp.readdir(DATA_DIR)).filter((f) => f.startsWith('static-') && f.endsWith(`-${LANG}.json`));
    const stats = await Promise.all(files.map(async (f) => ({ f, t: (await fsp.stat(path.join(DATA_DIR, f))).mtimeMs })));
    stats.sort((a, b) => b.t - a.t);
    return stats.length ? JSON.parse(await fsp.readFile(path.join(DATA_DIR, stats[0].f), 'utf8')) : null;
  } catch {
    return null;
  }
}

async function getStatic() {
  if (staticMem && Date.now() - staticMem.at < 3 * 3600e3) return staticMem.data;
  let version;
  try {
    version = (await dd('/api/versions.json', 3600))[0];
  } catch (e) {
    const fallback = await latestStaticFile();
    if (fallback) {
      staticMem = { at: Date.now(), data: fallback };
      return fallback;
    }
    throw e;
  }
  const file = path.join(DATA_DIR, `static-${version}-${LANG}.json`);
  try {
    const data = JSON.parse(await fsp.readFile(file, 'utf8'));
    staticMem = { at: Date.now(), data };
    return data;
  } catch {
    /* pas encore en cache disque */
  }
  const base = `/cdn/${version}/data/${LANG}`;
  const [champ, item, summ, runes] = await Promise.all(
    ['champion', 'item', 'summoner', 'runesReforged'].map((n) => dd(`${base}/${n}.json`))
  );
  const data = buildStatic(version, champ, item, summ, runes);
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(file, JSON.stringify(data));
  staticMem = { at: Date.now(), data };
  return data;
}

function buildStatic(version, champ, item, summ, runes) {
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
  return { version, lang: LANG, cdn: `${DDRAGON}/cdn`, champions, items, spells, runes: runeMap, trees };
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

async function getChampion(id) {
  if (!/^[A-Za-z0-9]+$/.test(id)) throw new ApiError(400, 'Champion invalide.');
  const st = await getStatic();
  let d;
  try {
    d = await dd(`/cdn/${st.version}/data/${LANG}/champion/${id}.json`);
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
  return {
    platform,
    puuid: acc.puuid,
    name: acc.gameName,
    tag: acc.tagLine,
    icon: sum.profileIconId,
    level: sum.summonerLevel,
    fetchedAt: Date.now(),
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
  return cache.set(ck, compactMatch(raw), 3 * 86400);
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
  return { start, count, more: ids.length === count, matches: matches.filter(Boolean) };
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

async function getLive(platform, puuid) {
  const g = await riot(platform, `/lol/spectator/v5/active-games/by-summoner/${puuid}`, { ttl: 30 });
  if (!g) return { live: false };
  const parts = await Promise.all(
    (g.participants || []).map(async (p) => {
      let ranked = {};
      if (p.puuid) {
        const l = await riot(platform, `/lol/league/v4/entries/by-puuid/${p.puuid}`, { ttl: 600 }).catch(() => null);
        ranked = compactLeague(l);
      }
      const [name, tag] = splitRiotId(p.riotId);
      if (p.puuid && name) rememberName(p.puuid, name, tag);
      return {
        puuid: p.puuid || null,
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

async function getRotation(platform) {
  const r = await riot(platform, '/lol/platform/v3/champion-rotations', { ttl: 3600 });
  return { free: r?.freeChampionIds || [], newbie: r?.freeChampionIdsForNewPlayers || [], newbieLevel: r?.maxNewPlayerLevel || 0 };
}

async function getStatus(platform) {
  const s = await riot(platform, '/lol/status/v4/platform-data', { ttl: 300 });
  const tr = (arr) =>
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

async function getLadder(platform, queue, page) {
  const qk = queue === 'flex' ? 'RANKED_FLEX_SR' : 'RANKED_SOLO_5x5';
  const ck = `ladder:${platform}:${qk}`;
  let rows = cache.get(ck);
  if (!rows) {
    const lists = await Promise.all(
      ['challengerleagues', 'grandmasterleagues', 'masterleagues'].map((l) =>
        riot(platform, `/lol/league/v4/${l}/by-queue/${qk}`, { store: false })
      )
    );
    rows = [];
    for (const l of lists) {
      if (!l) continue;
      for (const e of l.entries || []) {
        rows.push({ puuid: e.puuid || null, tier: l.tier, lp: e.leaguePoints, w: e.wins, l: e.losses, hot: !!e.hotStreak, vet: !!e.veteran, fresh: !!e.freshBlood });
      }
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
  const slice = rows.slice((p - 1) * size, p * size).map((r) => ({ ...r, ...(r.puuid ? names.get(r.puuid) || {} : {}) }));
  return { queue: qk, page: p, pages, total: rows.length, size, rows: slice };
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

function aggregate(meta, m, tl, st, ladder, mode = 'sr') {
  const i = m.info;
  const patch = patchOf(i.gameVersion);
  const P = meta.patches[patch] || (meta.patches[patch] = { games: 0, bans: {}, champs: {} });
  P.games++;
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

    const d = dig[p.puuid];
    if (d) {
      c.tl++;
      if (d.start.length) bump(c.start, d.start.join(','), w);
      if (d.order.length >= 3) bump(c.core, d.order.slice(0, 3).join('-'), w);
      d.order.slice(0, 6).forEach((id, n) => bump(c.slot[n], id, w));
      if (d.prio) bump(c.skills, d.prio, w);
    }
    const lad = ladder[p.puuid];
    c.recent.push({
      m: m.metadata.matchId,
      t: start,
      dur: i.gameDuration,
      pu: p.puuid,
      n: p.riotIdGameName || '',
      tg: p.riotIdTagline || '',
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
    });
    c.recent.sort((a, b) => b.t - a.t);
    if (c.recent.length > 40) c.recent.length = 40;
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
      if (Number(id) === key) roles[role] = c;
    }
  }
  return { mode, job: jobView(metaJobs[mk]), patch: ver || null, current: cur, available, games: P?.games || 0, bans: P?.bans?.[key] || 0, roles, pros: await readPros(), updated: m.updated };
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
  if (!name || !tag) throw new ApiError(400, 'Riot ID incomplet : utilise le format Nom#TAG.');
  const acc = await riot(accountHost(platform), `/riot/account/v1/accounts/by-riot-id/${enc(name)}/${enc(tag)}`, { ttl: 3600 });
  if (!acc) throw new ApiError(404, `Aucun compte « ${name}#${tag} ».`);
  const list = (await readPros()).filter((x) => x.puuid !== acc.puuid);
  list.push({ puuid: acc.puuid, platform, riotId: `${acc.gameName}#${acc.tagLine}`, label: label || acc.gameName, team });
  await writeJson(prosFile, list);
  return list;
}

async function removePro(puuid) {
  const list = (await readPros()).filter((x) => x.puuid !== puuid);
  await writeJson(prosFile, list);
  return list;
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

route('GET', /^\/api\/config$/, () => ({ platforms: PLATFORMS, hasKey: !!KEY, demo: DEMO_ON, defaultPlatform: PLATFORMS[DEFAULT_PLATFORM] ? DEFAULT_PLATFORM : 'euw1' }));
route('GET', /^\/api\/static$/, () => getStatic());
route('GET', /^\/api\/champion\/([A-Za-z0-9]+)$/, (m) => getChampion(m[1]));
route('GET', new RegExp(`^/api/summoner/${P}/([^/]+)/([^/]+)$`), (m, q) => getSummoner(plat(m[1]), dec(m[2]), dec(m[3]), q.force === '1'));
route('GET', new RegExp(`^/api/matches/${P}/([\\w-]+)$`), (m, q) => getMatches(plat(m[1]), puuidParam(m[2]), q));
route('GET', new RegExp(`^/api/match/${P}/([A-Z0-9]+_\\d+)$`), async (m) => {
  const match = await getMatch(plat(m[1]), m[2]);
  if (!match) throw new ApiError(404, 'Partie introuvable.');
  return match;
});
route('GET', new RegExp(`^/api/season/${P}/([\\w-]+)$`), (m, q) => getSeasonCount(plat(m[1]), puuidParam(m[2]), q.force === '1'));
route('GET', new RegExp(`^/api/timeline/${P}/([A-Z0-9]+_\\d+)$`), (m) => getTimeline(plat(m[1]), m[2]));
route('GET', new RegExp(`^/api/live/${P}/([\\w-]+)$`), (m) => getLive(plat(m[1]), puuidParam(m[2])));
route('GET', new RegExp(`^/api/rotation/${P}$`), (m) => getRotation(plat(m[1])));
route('GET', new RegExp(`^/api/status/${P}$`), (m) => getStatus(plat(m[1])));
route('GET', new RegExp(`^/api/ladder/${P}$`), (m, q) => getLadder(plat(m[1]), q.queue, q.page));
route('GET', new RegExp(`^/api/accounts/${P}$`), (m, q) => getAccounts(plat(m[1]), q.puuids));
route('GET', new RegExp(`^/api/meta/${P}$`), (m, q) => metaSummary(plat(m[1]), modeOf(q.mode)));
route('GET', new RegExp(`^/api/meta/${P}/champion/(\\d+)$`), (m, q) => metaChampion(plat(m[1]), Number(m[2]), q.patch, modeOf(q.mode)));
route('GET', /^\/api\/augments$/, () => getAugments());
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
route('POST', /^\/api\/pros$/, (m, q, body) => addPro(body));
route('DELETE', /^\/api\/pros\/([\w-]+)$/, (m) => removePro(m[1]));

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
  `img-src 'self' data: ${IMG_SRC} https://raw.communitydragon.org`,
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
});
})();
