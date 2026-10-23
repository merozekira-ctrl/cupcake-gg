// Profil joueur : aperçu + historique, champions, maîtrise, partie en direct.
import {
  S, api, esc, num, dec, pct, kdaRatio, kdaText, ago, clock, queueName, isArena, champImg, champOf,
  champHref, spellImg, runeImg, profileImg, crest, rankText, playerHref, roleIcon, ROLES, ROLE_ORDER,
  pushRecent, isFav, toggleFav, toast, errorState, loading, setTitle, setPlatform, TIERS, proBadge, wrBadge,
} from '../core.js';
import { matchCard, bindMatchList, resultOf } from './match.js';
import { gameStats, chartPanel, rankIa, summaryBlock, allyPanel, dayHeader, groupByDay, champHighlights } from './profile-extra.js';
import { roleBar, scoreMatch, levelRing, allyLevel } from '../core.js';

const cache = new Map();
const MATE_IC = new Map();
let liveTimer = null;

const TABS = [
  ['apercu', 'Aperçu'],
  ['champions', 'Champions'],
  ['maitrise', 'Maîtrise'],
  ['saisons', 'Saisons'],
  ['direct', 'Partie en direct'],
];
const FILTERS = [
  ['all', 'Toutes', ''],
  ['solo', 'Solo/Duo', '&queue=420'],
  ['flex', 'Flex', '&queue=440'],
  ['normal', 'Normales', '&type=normal'],
  ['aram', 'ARAM', '&queue=450'],
  ['arena', 'Arena', '&queue=1700'],
];

const keyOf = (p, name, tag) => `${p}/${name.toLowerCase()}/${tag.toLowerCase()}`;

export async function render(el, { p, name, tag, tab }, ctx) {
  clearInterval(liveTimer);
  if (!S.cfg.platforms[p] || !name || !tag) {
    el.innerHTML = errorState(new Error('Adresse de profil incomplète : il manque la région, le nom ou le tag.'));
    return;
  }
  setPlatform(p);
  const key = keyOf(p, name, tag);
  let st = cache.get(key);
  if (!st || Date.now() - st.at > 10 * 60e3) {
    el.innerHTML = skeleton();
    try {
      st = await loadProfile(p, name, tag, false);
    } catch (e) {
      if (ctx.alive()) el.innerHTML = notFound(e, p, name, tag);
      return;
    }
    if (!ctx.alive()) return;
    cache.set(key, st);
  }
  setTitle(`${st.sum.name}#${st.sum.tag}`);
  draw(el, st, TABS.some(([t]) => t === tab) ? tab : 'apercu', ctx);
  return () => clearInterval(liveTimer);
}

async function loadProfile(p, name, tag, force) {
  const sum = await api(`/summoner/${p}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}${force ? '?force=1' : ''}`);
  pushRecent({ p, name: sum.name, tag: sum.tag, icon: sum.icon, rank: sum.ranked.solo ? { tier: sum.ranked.solo.tier, rank: sum.ranked.solo.rank } : null });
  return { sum, at: Date.now(), filter: 'all', lists: {}, live: undefined, champSort: 'n' };
}

function skeleton() {
  return `<div class="profile-head"><div class="skel" style="width:88px;height:88px"></div><div class="grow stack" style="gap:8px"><div class="skel" style="width:260px;height:30px"></div><div class="skel" style="width:180px;height:16px"></div></div></div>
  <div class="skel" style="height:44px;margin:18px 0"></div>
  <div class="profile-grid"><div class="skel" style="height:320px"></div><div class="stack">${'<div class="skel" style="height:96px"></div>'.repeat(4)}</div></div>`;
}

function notFound(e, p, name, tag) {
  const others = Object.entries(S.cfg.platforms)
    .filter(([k]) => k !== p)
    .slice(0, 6)
    .map(([k, v]) => `<a class="chip" href="${playerHref(k, name, tag)}">${esc(v.label)}</a>`)
    .join('');
  return `<div class="panel state state-error" role="alert">
    <p class="state-title">${e.status === 404 ? 'Joueur introuvable' : 'Profil indisponible'}</p>
    <p>${esc(e.message)}</p>
    ${e.status === 404 ? `<p class="small">Chercher ${esc(name)}#${esc(tag)} dans une autre région :</p><div class="chips" style="justify-content:center">${others}</div>` : ''}
  </div>`;
}

/* ---------- Structure ---------- */

function draw(el, st, tab, ctx) {
  const s = st.sum;
  const fav = isFav({ p: s.platform, name: s.name, tag: s.tag });
  el.innerHTML = `
    <section class="profile-head">
      <div class="avatar">${profileImg(s.icon, 88)}<span class="avatar-lvl" title="Niveau d’invocateur">${s.level}</span></div>
      <div class="grow">
        <h1 class="p-name">${esc(s.name)} <span>#${esc(s.tag)}</span>${proBadge(s.pro)}${s.pro && s.pro.kind === 'pro' && s.pro.label && s.pro.label.toLowerCase() !== s.name.toLowerCase() ? `<small class="pro-alias" title="Nom de joueur pro">alias pro <b>${esc(s.pro.label)}</b></small>` : ''}</h1>
        <div class="p-meta">
          <span>${esc(S.cfg.platforms[s.platform].name)}</span>
          <span>Niveau ${s.level}</span>
          <span>Mis à jour ${esc(ago(st.at))}</span>
          <span class="season-pill" id="seasonPill"><span class="spinner"></span>Saison 2026…</span>
          <span id="livePill"></span>
        </div>
        ${peakPill(s)}
      </div>
      <div class="p-actions">
        <button class="btn" id="favBtn" type="button" aria-pressed="${fav}">${starIcon(fav)}<span>${fav ? 'Favori' : 'Ajouter aux favoris'}</span></button>
        <button class="btn btn-primary" id="refreshBtn" type="button">Mettre à jour</button>
      </div>
    </section>
    <nav class="tabs" aria-label="Sections du profil">
      ${TABS.map(([id, label]) => `<a href="${playerHref(s.platform, s.name, s.tag, id === 'apercu' ? '' : id)}"${id === tab ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
    </nav>
    <div id="tabBody"></div>`;

  el.querySelector('#favBtn').addEventListener('click', (e) => {
    const on = toggleFav({ p: s.platform, name: s.name, tag: s.tag, icon: s.icon, rank: s.ranked.solo ? { tier: s.ranked.solo.tier, rank: s.ranked.solo.rank } : null });
    const b = e.currentTarget;
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = `${starIcon(on)}<span>${on ? 'Favori' : 'Ajouter aux favoris'}</span>`;
    toast(on ? `${s.name} ajouté aux favoris.` : `${s.name} retiré des favoris.`);
  });
  el.querySelector('#refreshBtn').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.innerHTML = '<span class="spinner"></span>Mise à jour…';
    try {
      const fresh = await loadProfile(s.platform, s.name, s.tag, true);
      const f = fresh.filter;
      fresh.lists[f] = await fetchPage(fresh, f, 0, true);
      fresh.season = await api(`/season/${s.platform}/${fresh.sum.puuid}?force=1`).catch(() => undefined);
      cache.set(keyOf(s.platform, s.name, s.tag), fresh);
      if (!ctx.alive()) return;
      toast('Profil mis à jour.');
      draw(el, fresh, tab, ctx);
    } catch (err) {
      toast(err.message, 'error');
      b.disabled = false;
      b.textContent = 'Mettre à jour';
    }
  });

  const body = el.querySelector('#tabBody');
  if (tab === 'champions') drawChampions(body, st, ctx);
  else if (tab === 'maitrise') drawMastery(body, st);
  else if (tab === 'saisons') drawSeasons(body, st);
  else if (tab === 'direct') drawLive(body, st, ctx, el);
  else drawOverview(body, st, ctx);
  if (tab !== 'direct') checkLive(el, st, ctx);
  loadSeason(el, st, ctx);
}

/* ---------- Peak et saisons ---------- */
// Riot ne fournit ni le peak ni les saisons passées : ces rangs sont ceux que cupcake.gg
// a enregistrés lui-même (profil consulté, joueur croisé en partie ou en direct).
const rankLine = (r) => (r ? `${esc(rankText(r))} · ${num(r.lp)} LP` : '–');
function peakPill(s) {
  const p = s.peak;
  if (!p) return '';
  return `<a class="peak-pill" href="${playerHref(s.platform, s.name, s.tag, 'saisons')}" title="Rang le plus haut atteint cette saison">${crest(p, 'xs')}<span><small>Peak</small><b>${rankLine(p)}</b></span><em>${p.q === 'flex' ? 'Flex · ' : ''}Saison ${esc(p.season)}</em></a>`;
}
function seasonCell(box, label) {
  if (!box) return `<div class="ss-q ss-empty"><small>${label}</small><span class="muted">Aucune donnée</span></div>`;
  const pk = box.peak;
  const last = box.last;
  const games = last && last.w != null ? last.w + last.l : null;
  return `<div class="ss-q"><small>${label}</small>
    <div class="ss-rows">
      <div class="ss-r">${crest(pk, 'sm')}<span><em>Peak</em><b>${rankLine(pk)}</b></span></div>
      <div class="ss-r">${crest(last, 'sm')}<span><em>Dernier rang connu</em><b>${rankLine(last)}</b>${games ? `<small>${last.w} V · ${last.l} D · ${pct(last.w, games)}</small>` : ''}</span></div>
    </div></div>`;
}
function drawSeasons(body, st) {
  const s = st.sum;
  const list = s.seasons || [];
  body.innerHTML = `<section class="panel seasons">
    <div class="panel-title"><h2>Saisons</h2>${s.peak ? `<span class="muted small">Peak : ${rankLine(s.peak)} (saison ${esc(s.peak.season)})</span>` : ''}</div>
    ${list.length
      ? `<div class="ss-list">${list
          .map((x) => `<article class="ss-card${x.season === s.current ? ' cur' : ''}"><header><b>Saison ${esc(x.season)}</b>${x.season === s.current ? '<span class="ss-now">en cours</span>' : ''}</header><div class="ss-grid">${seasonCell(x.solo, 'Classée Solo/Duo')}${seasonCell(x.flex, 'Classée Flex')}</div></article>`)
          .join('')}</div>`
      : '<p class="empty-hint">Aucun rang enregistré pour ce joueur.</p>'}
    <p class="muted small ss-note">Riot ne communique pas les rangs des saisons passées. cupcake.gg enregistre lui-même le meilleur rang et le dernier rang connu de chaque saison, à chaque fois que ce joueur est consulté ou croisé dans une partie : l’historique se complète au fil du temps.</p>
  </section>`;
}

/* ---------- Parties jouées cette saison ---------- */

function seasonHtml(st) {
  const s = st.sum;
  const sv = st.season;
  const solo = s.ranked.solo ? s.ranked.solo.w + s.ranked.solo.l : 0;
  const flex = s.ranked.flex ? s.ranked.flex.w + s.ranked.flex.l : 0;
  const total = sv ? sv.total : null;
  return `<div class="season-box">
    <div class="season-main"><small>Parties cette saison</small><b class="count-up" data-to="${total ?? ''}">${total == null ? '–' : num(total)}${sv?.capped ? '+' : ''}</b></div>
    <div class="season-split">
      <div><small>Solo/Duo</small><b>${num(solo)}</b></div>
      <div><small>Flex</small><b>${num(flex)}</b></div>
      <div><small>Autres files</small><b>${total == null ? '–' : num(Math.max(0, total - solo - flex))}</b></div>
    </div>
    <p class="muted small">Depuis le début de la saison (patch 26.1, 8 janvier 2026), toutes files confondues.</p>
  </div>`;
}

function loadSeason(el, st, ctx) {
  const paint = () => {
    const pill = el.querySelector('#seasonPill');
    if (pill) pill.innerHTML = st.season ? `<b>${num(st.season.total)}${st.season.capped ? '+' : ''}</b> parties cette saison` : 'Saison indisponible';
    const box = el.querySelector('#seasonBox');
    if (box) {
      box.innerHTML = seasonHtml(st);
      countUp(box);
    }
  };
  if (st.season !== undefined) return paint();
  st.season = null;
  api(`/season/${st.sum.platform}/${st.sum.puuid}`)
    .then((r) => {
      st.season = r;
      if (ctx.alive()) paint();
    })
    .catch(() => {
      st.season = undefined;
      const pill = el.querySelector('#seasonPill');
      if (pill && ctx.alive()) pill.textContent = 'Saison indisponible';
    });
}

// Compteur animé de 0 à la valeur (désactivé si l'utilisateur réduit les animations).
export function countUp(root) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.querySelectorAll('.count-up[data-to]').forEach((el) => {
    const to = Number(el.dataset.to);
    if (!Number.isFinite(to) || !to || reduce) return;
    const suffix = el.textContent.endsWith('+') ? '+' : '';
    const t0 = performance.now();
    const dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = num(Math.round(to * (1 - Math.pow(1 - k, 3)))) + (k === 1 ? suffix : '');
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function starIcon(on) {
  return `<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="m10 2.2 2.4 5 5.4.6-4 3.7 1.1 5.4L10 14.2 5.1 16.9l1.1-5.4-4-3.7 5.4-.6Z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

function livePill(el, st) {
  const box = el.querySelector('#livePill');
  if (!box) return;
  const s = st.sum;
  box.innerHTML = st.live?.live
    ? `<a class="live-pill" href="${playerHref(s.platform, s.name, s.tag, 'direct')}">En partie : ${esc(queueName(st.live.q))}</a>`
    : '';
}

function checkLive(el, st, ctx) {
  if (st.live !== undefined || !S.cfg.hasKey) return livePill(el, st);
  st.live = null;
  api(`/live/${st.sum.platform}/${st.sum.puuid}`)
    .then((g) => {
      st.live = g;
      if (ctx.alive()) livePill(el, st);
    })
    .catch(() => {
      st.live = undefined;
    });
}

/* ---------- Chargement des parties ---------- */

async function fetchPage(st, f, start, force) {
  const qs = FILTERS.find(([id]) => id === f)[2];
  const r = await api(`/matches/${st.sum.platform}/${st.sum.puuid}?start=${start}&count=10${qs}${force ? '&force=1' : ''}`);
  const prev = start ? st.lists[f]?.items || [] : [];
  return { items: [...prev, ...r.matches], more: r.more, busy: false, error: null };
}

async function loadMore(st, f) {
  const L = st.lists[f] || (st.lists[f] = { items: [], more: true, busy: false, error: null });
  if (L.busy || !L.more) return;
  L.busy = true;
  L.error = null;
  try {
    const next = await fetchPage(st, f, L.items.length, false);
    Object.assign(L, next);
  } catch (e) {
    L.error = e;
    L.busy = false;
  }
}

/* ---------- Statistiques sur les parties chargées ---------- */

function summarize(items, puuid) {
  const games = [];
  for (const m of items) {
    if (m.remake) continue;
    const me = m.parts.find((p) => p.puuid === puuid);
    if (me) games.push({ m, me });
  }
  const out = { n: games.length, w: 0, k: 0, d: 0, a: 0, kp: 0, champs: {}, roles: {}, mates: {} };
  for (const { m, me } of games) {
    const won = resultOf(m, me).cls === 'win';
    const arena = isArena(m.q);
    const group = m.parts.filter((p) => (arena ? p.sub === me.sub : p.team === me.team));
    const tk = group.reduce((s, p) => s + p.k, 0);
    out.w += won;
    out.k += me.k;
    out.d += me.d;
    out.a += me.a;
    out.kp += tk ? (me.k + me.a) / tk : 0;
    const min = Math.max(1, m.dur / 60);
    const c = out.champs[me.champ] || (out.champs[me.champ] = { id: me.champ, n: 0, w: 0, k: 0, d: 0, a: 0, cs: 0, dmg: 0, gold: 0, vis: 0, kp: 0 });
    c.n++;
    c.w += won;
    c.k += me.k;
    c.d += me.d;
    c.a += me.a;
    c.cs += me.cs / min;
    c.dmg += me.dmg / min;
    c.gold += me.gold / min;
    c.vis += me.vis / min;
    c.kp += tk ? (me.k + me.a) / tk : 0;
    if (me.pos && !arena) out.roles[me.pos] = (out.roles[me.pos] || 0) + 1;
    const scm = scoreMatch(m);
    for (const p of group) {
      if (p === me || !p.puuid || !p.tag) continue;
      const x = out.mates[p.puuid] || (out.mates[p.puuid] = { puuid: p.puuid, name: p.name, tag: p.tag, n: 0, w: 0, sc: 0 });
      x.n++;
      x.w += won;
      x.sc += (scm.scores[m.parts.indexOf(p)] || 0) * 10;
    }
  }
  out.champList = Object.values(out.champs).sort((a, b) => b.n - a.n || b.w - a.w);
  out.mateList = Object.values(out.mates)
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);
  return out;
}

function ring(w, n) {
  const p = n ? (w / n) * 100 : 0;
  return `<div class="ring" role="img" aria-label="${pct(w, n)} de victoires"><svg viewBox="0 0 36 36" aria-hidden="true">
    <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--surface-3)" stroke-width="4"/>
    <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--win)" stroke-width="4" stroke-dasharray="${p.toFixed(1)} ${(100 - p).toFixed(1)}"/>
  </svg><b>${n ? Math.round(p) + '%' : '–'}</b></div>`;
}

function summaryHtml(sm) {
  if (!sm.n) return '<div class="state"><p>Aucune partie terminée à analyser pour ce filtre.</p></div>';
  const ratio = kdaRatio(sm.k, sm.d, sm.a);
  const maxRole = Math.max(1, ...Object.values(sm.roles));
  return `
    ${ring(sm.w, sm.n)}
    <div class="stack" style="gap:6px">
      <div class="muted small">${sm.n} dernières parties</div>
      <div class="sum-kda"><span class="big">${sm.w}V ${sm.n - sm.w}D</span></div>
      <div class="sum-kda"><span class="big">${dec(sm.k / sm.n)} / <span class="bad">${dec(sm.d / sm.n)}</span> / ${dec(sm.a / sm.n)}</span></div>
      <div class="muted small">${kdaText(ratio)} KDA, P/Kill ${pct(sm.kp, sm.n)}</div>
    </div>
    <div class="sum-champs" aria-label="Champions les plus joués">
      ${sm.champList
        .slice(0, 3)
        .map((c) => `<div>${champImg(c.id, 28)}<span class="grow"><b>${esc(champOf(c.id)?.name || '?')}</b><br><span class="muted">${pct(c.w, c.n)} sur ${c.n} partie${c.n > 1 ? 's' : ''}, ${kdaText(kdaRatio(c.k, c.d, c.a))} KDA</span></span></div>`)
        .join('')}
    </div>
    <div class="roles" aria-label="Répartition des rôles">
      ${ROLE_ORDER.map((r) => {
        const n = sm.roles[r] || 0;
        return `<div title="${ROLES[r]} : ${n} partie${n > 1 ? 's' : ''}"><span class="col"><i style="height:${(n / maxRole) * 100}%"></i></span>${roleIcon(r)}</div>`;
      }).join('')}
    </div>`;
}

function rankCard(label, r) {
  if (!r) {
    return `<div class="rank-card">${crest(null, 'md')}<div><div class="rank-q">${label}</div><div class="rank-t">Non classé</div></div></div>`;
  }
  const n = r.w + r.l;
  const flags = [
    r.hot ? '<span class="flag hot">En série</span>' : '',
    r.vet ? '<span class="flag">Vétéran</span>' : '',
    r.fresh ? '<span class="flag">Promu récemment</span>' : '',
  ].join('');
  return `<div class="rank-card">
    ${crest(r, 'lg')}
    <div class="grow">
      <div class="rank-q">${label}</div>
      <div class="rank-t">${rankText(r)}</div>
      <div class="rank-lp">${num(r.lp)} LP</div>
      ${flags ? `<div style="margin-top:5px">${flags}</div>` : ''}
    </div>
    <div class="rank-wr">${wrBadge(r.w, n)}<span>${r.w} V · ${r.l} D</span></div>
  </div>`;
}

/* ---------- Onglet Aperçu ---------- */

function drawOverview(body, st, ctx) {
  const s = st.sum;
  body.innerHTML = `
    <div class="profile-grid">
      <aside class="stack">
        <section class="panel" aria-label="Rangs classés">${rankCard('Classée Solo/Duo', s.ranked.solo)}${rankCard('Classée Flex', s.ranked.flex)}</section>
        <section class="panel ally-panel" id="allyBox" hidden></section>
        <section class="panel chart-panel" id="chartBox" aria-label="Graphique">${loading()}</section>
        <section class="panel card-accent" id="iaBox" aria-label="Rank IA">${loading()}</section>
        <section class="panel card-accent" id="seasonBox" aria-label="Saison en cours">${seasonHtml(st)}</section>
        <section class="panel" aria-labelledby="h-rc">
          <div class="panel-title"><h2 id="h-rc">Champions récents</h2><span class="muted small" id="rcCount"></span></div>
          <div id="recentChamps"></div>
        </section>
        <section class="panel" aria-labelledby="h-duo">
          <div class="panel-title"><h2 id="h-duo">Joué avec</h2></div>
          <div id="duos"></div>
        </section>
      </aside>
      <div>
        <section class="panel summary" id="summary" aria-label="Résumé des parties chargées">${loading()}</section>
        <div class="filters">
          ${roleBar(st.role || 'ALL')}
          <div class="chips" role="group" aria-label="Filtrer par file">
            ${FILTERS.map(([id, label]) => `<button class="chip" type="button" data-f="${id}" aria-pressed="${id === st.filter}">${label}</button>`).join('')}
          </div>
        </div>
        <div class="match-list" id="matches" aria-live="polite"></div>
        <div class="more" id="more"></div>
      </div>
    </div>`;

  const list = body.querySelector('#matches');
  bindMatchList(list, () => ({ puuid: s.puuid, platform: s.platform }));

  body.querySelectorAll('[data-f]').forEach((b) =>
    b.addEventListener('click', () => {
      st.filter = b.dataset.f;
      body.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      paint(true);
    })
  );

  body.querySelectorAll('.filters [data-role]').forEach((b) =>
    b.addEventListener('click', () => {
      st.role = b.dataset.role;
      body.querySelectorAll('.filters [data-role]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      paint(true);
    })
  );
  const roleOk = (m) => !st.role || st.role === 'ALL' || m.parts.find((p) => p.puuid === s.puuid)?.pos === st.role;

  const paint = async (reset) => {
    const f = st.filter;
    if (reset) list.innerHTML = '';
    let L = st.lists[f];
    if (!L || (!L.items.length && L.more && !L.error)) {
      body.querySelector('#more').innerHTML = loading('Chargement des parties…');
      if (L && L.busy) return; // le chargement en cours dessinera la liste
      await loadMore(st, f);
      L = st.lists[f];
      if (!ctx.alive() || st.filter !== f) return;
    }
    const items = L.items.filter(roleOk);
    // Historique groupé par jour (les détails ouverts restent ouverts : seules les nouvelles parties sont ajoutées).
    const open = new Set([...list.querySelectorAll('.m-toggle[aria-expanded="true"]')].map((t) => t.closest('.match-wrap').dataset.id));
    // Badge pro du joueur suivi aussi dans ses parties (même s'il a été reconnu après leur chargement).
    if (s.pro) for (const m of items) for (const p of m.parts) if (p.puuid === s.puuid && !p.pro) p.pro = s.pro;
    list.innerHTML = groupByDay(items)
      .map((g) => `<section class="day">${dayHeader(g.items, s.puuid)}${g.items.map((m) => matchCard(m, s.puuid, s.platform)).join('')}</section>`)
      .join('');
    open.forEach((id) => list.querySelector(`.match-wrap[data-id="${CSS.escape(id)}"] .m-toggle`)?.click());
    if (!items.length && !L.error) {
      list.innerHTML = `<div class="panel state"><p class="state-title">Aucune partie</p><p>Aucune partie récente pour ce filtre${st.role && st.role !== 'ALL' ? ' et ce rôle' : ''}.</p></div>`;
    }
    const sm = summarize(items, s.puuid);
    const games = gameStats(items, s.puuid);
    body.querySelector('#summary').innerHTML = summaryBlock(sm, games);
    const allGames = gameStats(L.items, s.puuid);
    body.querySelector('#chartBox').innerHTML = chartPanel(s, allGames);
    const ab = body.querySelector('#allyBox');
    ab.innerHTML = allyPanel(allGames);
    ab.hidden = !ab.innerHTML;
    body.querySelector('#iaBox').innerHTML = rankIa(s, allGames);
    body.querySelector('#rcCount').textContent = sm.n ? `${sm.n} parties` : '';
    body.querySelector('#recentChamps').innerHTML = sm.champList.length
      ? `<ul class="mini-list">${sm.champList
          .slice(0, 7)
          .map((c) => {
            const ch = champOf(c.id);
            return `<li>${champImg(c.id, 32)}<div class="nm">${ch ? `<a href="${champHref(ch)}">${esc(ch.name)}</a>` : '?'}<div class="sub">${kdaText(kdaRatio(c.k, c.d, c.a))} KDA</div></div><div class="val">${wrBadge(c.w, c.n)}<div class="sub">${c.n} partie${c.n > 1 ? 's' : ''}</div></div></li>`;
          })
          .join('')}</ul>`
      : '<p class="muted small" style="padding:0 16px 16px">Pas encore de parties chargées.</p>';
    body.querySelector('#duos').innerHTML = sm.mateList.length
      ? `<ul class="mini-list">${sm.mateList
          .map((x) => `<li>${MATE_IC.has(x.puuid) && MATE_IC.get(x.puuid) != null ? profileImg(MATE_IC.get(x.puuid), 34, true) : `<span class="mate-ic skel" data-mate="${esc(x.puuid)}"></span>`}<div class="nm"><a href="${playerHref(s.platform, x.name, x.tag)}">${esc(x.name)}</a><div class="sub">#${esc(x.tag)}</div></div><div class="val"><b>${x.w}V ${x.n - x.w}D</b><div class="sub">${pct(x.w, x.n)}</div></div>${levelRing(allyLevel(x.sc / x.n), { size: 'sm', avatar: true })}</li>`)
          .join('')}</ul>`
      : '<p class="muted small" style="padding:0 16px 16px">Aucun joueur croisé au moins deux fois dans les parties chargées.</p>';
    const missing = sm.mateList.filter((x) => !MATE_IC.has(x.puuid));
    if (missing.length) {
      missing.forEach((x) => MATE_IC.set(x.puuid, null));
      api(`/ladder-id?ids=${missing.map((x) => `${s.platform}:${x.puuid}`).join(',')}`)
        .then((ids) => {
          for (const x of missing) {
            const icon = ids[x.puuid]?.icon;
            MATE_IC.set(x.puuid, icon ?? null);
            const el2 = body.querySelector(`[data-mate="${CSS.escape(x.puuid)}"]`);
            if (el2 && icon != null) el2.outerHTML = profileImg(icon, 34, true);
            else if (el2) el2.classList.remove('skel');
          }
        })
        .catch(() => {});
    }

    const more = body.querySelector('#more');
    if (L.error) {
      more.innerHTML = `<div class="panel state state-error" role="alert"><p>${esc(L.error.message)}</p><button class="btn" type="button" id="retryMore">Réessayer</button></div>`;
      more.querySelector('#retryMore').addEventListener('click', async () => {
        L.error = null;
        more.innerHTML = loading('Chargement des parties…');
        await loadMore(st, f);
        if (ctx.alive() && st.filter === f) paint(false);
      });
    } else if (L.more) {
      more.innerHTML = '<button class="btn btn-block" type="button" id="loadMore">Charger 10 parties de plus</button>';
      more.querySelector('#loadMore').addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        e.currentTarget.innerHTML = '<span class="spinner"></span>Chargement…';
        await loadMore(st, f);
        if (ctx.alive() && st.filter === f) paint(false);
      });
    } else {
      more.innerHTML = L.items.length ? '<p class="muted small" style="text-align:center">Fin de l’historique disponible.</p>' : '';
    }
  };
  paint(true);
}

/* ---------- Onglet Champions ---------- */

const COLS = [
  ['n', 'Parties'],
  ['wr', 'Victoires'],
  ['kda', 'KDA'],
  ['kp', 'P/Kill'],
  ['cs', 'CS/min'],
  ['dmg', 'Dégâts/min'],
  ['gold', 'Or/min'],
  ['vis', 'Vision/min'],
];

async function drawChampions(body, st, ctx) {
  const s = st.sum;
  const L = st.lists.all;
  if (!L || !L.items.length) {
    body.innerHTML = loading('Chargement des parties…');
    await loadMore(st, 'all');
    if (!ctx.alive()) return;
  }
  const items = st.lists.all.items;
  const sm = summarize(items, s.puuid);
  const val = (c, k) =>
    k === 'n' ? c.n : k === 'wr' ? c.w / c.n : k === 'kda' ? kdaRatio(c.k, c.d, c.a) : c[k] / c.n;
  const rows = [...sm.champList].sort((a, b) => val(b, st.champSort) - val(a, st.champSort) || b.n - a.n);
  body.innerHTML = `
    ${champHighlights(items, s.puuid, s.mastery)}
    <div class="toolbar">
      <p class="muted grow">Statistiques calculées sur les ${sm.n} parties chargées, toutes files confondues.</p>
      ${st.lists.all.more ? '<button class="btn" type="button" id="moreChamps">Charger 10 parties de plus</button>' : ''}
    </div>
    ${rows.length ? `<div class="panel scroll-x"><table class="table">
      <thead><tr><th scope="col">Champion</th>${COLS.map(([k, l]) => `<th scope="col" class="num"${st.champSort === k ? ' aria-sort="descending"' : ''}><button type="button" data-sort="${k}">${l}</button></th>`).join('')}</tr></thead>
      <tbody>${rows
        .map((c) => {
          const ch = champOf(c.id);
          return `<tr>
            <td><div class="cell-player">${champImg(c.id, 32)}<div class="pn">${ch ? `<a href="${champHref(ch)}">${esc(ch.name)}</a>` : '?'}</div></div></td>
            <td class="num">${c.n}</td>
            <td class="num" style="min-width:130px">${wrBadge(c.w, c.n)} <span class="muted">${c.w}V ${c.n - c.w}D</span><div class="wr-split" style="margin-top:5px"><i style="width:${(c.w / c.n) * 100}%"></i></div></td>
            <td class="num"><b>${kdaText(kdaRatio(c.k, c.d, c.a))}</b><br><span class="muted">${dec(c.k / c.n)}/${dec(c.d / c.n)}/${dec(c.a / c.n)}</span></td>
            <td class="num">${pct(c.kp, c.n)}</td>
            <td class="num">${dec(c.cs / c.n)}</td>
            <td class="num">${num(c.dmg / c.n)}</td>
            <td class="num">${num(c.gold / c.n)}</td>
            <td class="num">${dec(c.vis / c.n, 2)}</td>
          </tr>`;
        })
        .join('')}</tbody></table></div>` : '<div class="panel state"><p>Aucune partie terminée à analyser.</p></div>'}`;
  body.querySelectorAll('[data-sort]').forEach((b) =>
    b.addEventListener('click', () => {
      st.champSort = b.dataset.sort;
      drawChampions(body, st, ctx);
    })
  );
  body.querySelector('#moreChamps')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.innerHTML = '<span class="spinner"></span>Chargement…';
    await loadMore(st, 'all');
    if (ctx.alive()) drawChampions(body, st, ctx);
  });
}

/* ---------- Onglet Maîtrise ---------- */

// Un palier tous les 10 niveaux ; au-delà de 100, un palier par centaine.
const MASTERY_TIERS = ['Novice', 'Bronze', 'Argent', 'Or', 'Platine', 'Émeraude', 'Diamant', 'Maître', 'Grand Maître', 'Challenger', 'Légende', 'Mythique', 'Transcendant'];
function masteryTier(lvl) {
  if (lvl >= 300) return 12;
  if (lvl >= 200) return 11;
  if (lvl >= 100) return 10;
  return Math.floor(lvl / 10);
}

function drawMastery(body, st, all = false) {
  const list = [...st.sum.mastery].sort((a, b) => b.pts - a.pts);
  if (!list.length) {
    body.innerHTML = '<div class="panel state"><p class="state-title">Aucune maîtrise</p><p>Ce joueur n’a encore gagné de points de maîtrise sur aucun champion.</p></div>';
    return;
  }
  const total = list.reduce((s, m) => s + m.pts, 0);
  const shown = all ? list : list.slice(0, 48);
  const tiers = {};
  for (const m of list) tiers[masteryTier(m.lvl)] = (tiers[masteryTier(m.lvl)] || 0) + 1;
  body.innerHTML = `
    ${champHighlights(st.lists.all?.items || [], st.sum.puuid, st.sum.mastery)}
    <div class="toolbar"><p class="muted grow">${list.length} champions, ${num(total)} points de maîtrise au total.</p></div>
    <div class="m-legend" aria-label="Paliers de maîtrise">${MASTERY_TIERS.map((name, t) =>
      `<span class="m-leg${tiers[t] ? '' : ' off'}" data-t="${t}"><i aria-hidden="true"></i>${name}<small>${t === 0 ? 'niv. 1 à 9' : t < 10 ? `niv. ${t * 10} à ${t * 10 + 9}` : t === 10 ? 'niv. 100 à 199' : t === 11 ? 'niv. 200 à 299' : 'niv. 300 et plus'}</small><b>${tiers[t] || 0}</b></span>`).join('')}</div>
    <div class="mastery-grid">${shown
      .map((m) => {
        const ch = champOf(m.c);
        const t = masteryTier(m.lvl);
        return `<a class="panel m-card" data-t="${t}" href="${ch ? champHref(ch) : '#/champions'}">
          <span class="mframe" data-t="${t}" title="Palier ${MASTERY_TIERS[t]}">${t === 10 ? '<i class="mf-rays" aria-hidden="true"></i>' : ''}${t === 11 ? '<i class="mf-embers" aria-hidden="true"><b></b><b></b><b></b><b></b><b></b><b></b></i>' : ''}${t >= 12 ? '<i class="mf-flame" aria-hidden="true"><b></b></i>' : ''}${champImg(m.c, 64)}${t >= 7 ? '<i class="mf-gem" aria-hidden="true"></i>' : ''}${t >= 12 ? '<i class="mf-spark" aria-hidden="true"></i>' : ''}</span>
          <strong>${esc(ch?.name || '?')}</strong>
          <span class="lvl">Niv. ${m.lvl}</span>
          <span class="m-tier">${MASTERY_TIERS[t]}</span>
          <span class="pts">${num(m.pts)}</span>
          <small>${m.last ? 'Joué ' + esc(ago(m.last)) : ''}</small>
        </a>`;
      })
      .join('')}</div>
    ${!all && list.length > shown.length ? `<div class="more"><button class="btn btn-block" type="button" id="allMastery">Afficher les ${list.length} champions</button></div>` : ''}`;
  body.querySelector('#allMastery')?.addEventListener('click', () => drawMastery(body, st, true));
}

/* ---------- Onglet Partie en direct (cartes par joueur, façon tracker) ---------- */

const ROLE_SHORT = { TOP: 'Haut', JUNGLE: 'Jungle', MIDDLE: 'Milieu', BOTTOM: 'Tireur', UTILITY: 'Support' };

const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 8.6 3.6 10 7-.6 1.4-1.5 2.8-2.7 4M6.4 6.4C4.5 7.7 3 9.7 2 12c1.4 3.4 5 7 10 7 1.9 0 3.6-.5 5.1-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const hiddenBlock = (why) => `<div class="lc-hidden">${EYE_OFF}<b>Stats cachées</b><small>${why}</small></div>`;

function liveCard(p, s, g) {
  if (p.hidden) {
    const ch = champOf(p.champ);
    return `<article class="lc hidden-stats ${p.team === 100 ? 'blue' : 'red'}" data-puuid="">
      <header class="lc-head"><span class="lc-hidden-tag">Mode streamer</span></header>
      <section class="lc-row lc-champ">
        <a class="lc-portrait" href="${ch ? champHref(ch, p.role) : '#/champions'}" title="Builds de ${esc(ch?.name || '')}">${champImg(p.champ, 52)}</a>
        <div class="lc-txt"><b>${esc(ch?.name || 'Champion')}</b><small>${esc(ROLE_SHORT[p.role] || 'Rôle inconnu')}</small></div>
        <div class="lc-spells">${spellImg(p.s1, 20)}${spellImg(p.s2, 20)}${runeImg(p.ks, 20)}${runeImg(p.ss, 16, true)}</div>
      </section>
      ${hiddenBlock('Ce joueur masque son identité (mode streamer) : rang et historique inaccessibles.')}
    </article>`;
  }
  const r = p.ranked?.solo;
  const n = r ? r.w + r.l : 0;
  const ch = champOf(p.champ);
  const name = p.tag ? `<a href="${playerHref(s.platform, p.name, p.tag)}">${esc(p.name)}<span>#${esc(p.tag)}</span></a>` : `<span>${esc(p.name)}</span>`;
  const duo = p.duo ? `<span class="lc-duo" data-duo="${p.duo}" title="${esc('Joue avec ' + (p.with || []).map((w) => w.name).join(', '))}"><svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="3" fill="currentColor"/><circle cx="14" cy="8" r="2.5" fill="currentColor"/><path d="M1.5 17c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5M12 12.2c3 0 6.5 1.6 6.5 4.8" fill="none" stroke="currentColor" stroke-width="2"/></svg>${p.duo}</span>` : '';
  return `<article class="lc ${p.team === 100 ? 'blue' : 'red'}${p.puuid === s.puuid ? ' me' : ''}" data-puuid="${esc(p.puuid || '')}">
    <header class="lc-head">${duo}${name}${proBadge(p.pro)}</header>
    <section class="lc-row lc-champ">
      <a class="lc-portrait" href="${ch ? champHref(ch, p.role) : '#/champions'}" title="Builds de ${esc(ch?.name || '')}">${champImg(p.champ, 52)}<b class="lc-mlvl" data-slot="mlvl"></b></a>
      <div class="lc-txt" data-slot="champ"><span class="skel stat-skel" style="width:90px"></span><span class="skel stat-skel" style="width:70px;margin-top:6px"></span></div>
      <div class="lc-spells">${spellImg(p.s1, 20)}${spellImg(p.s2, 20)}${runeImg(p.ks, 20)}${runeImg(p.ss, 16, true)}</div>
    </section>
    <section class="lc-row lc-rank">
      ${crest(r || null, 'md')}
      <div class="lc-txt">
        <b>${r ? `${rankText(r)} <span class="muted">${num(r.lp)} LP</span>` : 'Non classé'}</b>
        <small>Solo/Duo</small>
        ${r ? `<small>${wrBadge(r.w, n, { text: true })} sur ${num(n)} parties</small>` : ''}
      </div>
    </section>
    <section class="lc-row lc-role">
      <span class="lc-role-ic">${p.role ? roleIcon(p.role) : ''}</span>
      <div class="lc-txt"><b>${esc(ROLE_SHORT[p.role] || 'Rôle inconnu')} <span class="muted">(en cours)</span></b><small data-slot="mains">Rôles principaux : …</small></div>
    </section>
    <section class="lc-row lc-activity" data-slot="activity">
      <div><b class="lc-big">12<sup>H</sup></b><small><span class="skel stat-skel"></span></small></div>
      <div><b class="lc-big">30<sup>J</sup></b><small><span class="skel stat-skel"></span></small></div>
    </section>
    <section class="lc-form" data-slot="form"></section>
    <footer class="lc-tags" data-slot="tags"><span class="skel" style="width:80px;height:22px;border-radius:6px"></span><span class="skel" style="width:110px;height:22px;border-radius:6px"></span></footer>
  </article>`;
}

function fillCard(card, p, d) {
  if (d.hidden) {
    card.classList.add('hidden-stats');
    card.querySelectorAll('.lc-activity, .lc-form, .lc-tags').forEach((x) => x.remove());
    card.querySelector('[data-slot="champ"]').innerHTML = '<b>Stats cachées</b><small class="muted">Historique inaccessible</small>';
    card.querySelector('[data-slot="mains"]').textContent = 'Rôles principaux : inconnus';
    card.insertAdjacentHTML('beforeend', hiddenBlock('Profil privé ou historique masqué : Riot ne renvoie aucune partie pour ce joueur.'));
    return;
  }
  const m = d.mastery;
  card.querySelector('[data-slot="mlvl"]').textContent = m.lvl ? m.lvl : '';
  const c = d.champ;
  const wr = c.n ? Math.round((c.w / c.n) * 100) : null;
  card.querySelector('[data-slot="champ"]').innerHTML = c.n
    ? `<b>${wrBadge(c.w, c.n, { text: true })} <span class="muted">(${c.n} jouée${c.n > 1 ? 's' : ''})</span></b>
       <small class="lc-kda"><span class="good">${dec(c.k, 1)}</span> / <span class="bad">${dec(c.d, 1)}</span> / <span class="mid">${dec(c.a, 1)}</span></small>
       <small class="muted">${num(m.pts)} pts de maîtrise</small>`
    : `<b>${m.pts ? `${num(m.pts)} pts` : 'Jamais joué'}</b><small class="muted">${m.pts ? 'de maîtrise' : 'Aucune maîtrise sur ce champion'}</small><small class="muted">Pas de partie classée récente dessus</small>`;
  const mains = (d.mainRoles || []).map((r) => `<span class="${r === p.role ? '' : 'warn'}">${ROLE_SHORT[r]}</span>`).join(', ');
  card.querySelector('[data-slot="mains"]').innerHTML = `Rôles principaux : ${mains || '–'}`;
  card.querySelector('[data-slot="activity"]').innerHTML = `
    <div title="Parties jouées ces 12 dernières heures (toutes files)"><b class="lc-big">12<sup>H</sup></b><small>${d.h12} jouée${d.h12 > 1 ? 's' : ''}</small></div>
    <div title="Parties jouées ces 30 derniers jours (toutes files)"><b class="lc-big">30<sup>J</sup></b><small>${d.d30}${d.d30cap ? '+' : ''} jouée${d.d30 > 1 ? 's' : ''}</small></div>`;
  card.querySelector('[data-slot="form"]').innerHTML = d.form.length
    ? `<span class="muted small">Forme</span>${d.form.map((w) => `<i class="${w ? 'w' : 'l'}" title="${w ? 'Victoire' : 'Défaite'}"></i>`).join('')}`
    : '';
  card.querySelector('[data-slot="tags"]').innerHTML = d.tags.length
    ? d.tags.map((t) => `<span class="lc-tag ${t.kind}" title="${esc(t.hint)}">${esc(t.label)}</span>`).join('')
    : '<span class="muted small">Pas assez de parties récentes pour un profil.</span>';
}

async function drawLive(body, st, ctx, el) {
  clearInterval(liveTimer);
  const s = st.sum;
  body.innerHTML = loading('Recherche d’une partie en cours…');
  let g;
  try {
    g = await api(`/live/${s.platform}/${s.puuid}`);
  } catch (e) {
    if (ctx.alive()) body.innerHTML = errorState(e);
    return;
  }
  if (!ctx.alive()) return;
  st.live = g;
  livePill(el, st);
  if (!g.live) {
    body.innerHTML = `<div class="panel state">
      <p class="state-title">${esc(s.name)} n’est pas en partie</p>
      <p>Riot met à jour cette information toutes les 30 secondes environ. Les parties personnalisées et l’entraînement ne sont pas visibles.</p>
      <button class="btn" type="button" id="liveRetry">Vérifier à nouveau</button>
    </div>`;
    body.querySelector('#liveRetry').addEventListener('click', () => drawLive(body, st, ctx, el));
    return;
  }
  const elapsed = () => (g.start ? (Date.now() - g.start) / 1000 : g.length + (Date.now() - g.at) / 1000);
  const order = (a, b) => (ROLE_ORDER.indexOf(a.role) + 1 || 9) - (ROLE_ORDER.indexOf(b.role) + 1 || 9);
  const teams = [...new Set(g.parts.map((p) => p.team))].sort();
  const me = g.parts.find((p) => p.puuid === s.puuid);
  const myChamp = me && champOf(me.champ);
  body.innerHTML = `
    <div class="lv-head">
      <div>
        <h2 class="lv-title">${esc(queueName(g.q))} <span class="muted" id="liveClock">(${g.start ? clock(elapsed()) : 'chargement'})</span></h2>
        <p class="muted small">Rôles déduits des champions et des sorts. Étiquettes et stats calculées sur les dernières parties classées de chaque joueur.</p>
      </div>
      <div class="lv-actions">
        <div class="lv-bans">${teams
          .map((t) => `<span class="lv-ban-team ${t === 100 ? 'blue' : 'red'}">${g.bans.filter((b) => b.team === t && b.c > 0).map((b) => champImg(b.c, 26)).join('')}</span>`)
          .join('')}</div>
        ${myChamp ? `<a class="btn btn-primary lv-build" href="${champHref(myChamp, me.role)}">Meilleurs builds pour ${champImg(me.champ, 24)} ${esc(myChamp.name)}</a>` : ''}
        <button class="btn btn-sm" type="button" id="liveRefresh">Actualiser</button>
      </div>
    </div>
    ${teams
      .map((t) => `<section class="lv-team" aria-label="${t === 100 ? 'Équipe bleue' : 'Équipe rouge'}">
        <h3 class="lv-team-title ${t === 100 ? 'blue' : 'red'}">${t === 100 ? 'Équipe bleue' : 'Équipe rouge'}</h3>
        <div class="lv-grid">${g.parts.filter((p) => p.team === t).sort(order).map((p) => liveCard(p, s, g)).join('')}</div>
      </section>`)
      .join('')}`;
  body.querySelector('#liveRefresh').addEventListener('click', () => drawLive(body, st, ctx, el));
  if (g.start) {
    const clockEl = body.querySelector('#liveClock');
    liveTimer = setInterval(() => {
      if (!document.body.contains(clockEl)) return clearInterval(liveTimer);
      clockEl.textContent = `(${clock(elapsed())})`;
    }, 1000);
  }
  // Détails par joueur : le joueur suivi d'abord, puis les autres, deux à la fois.
  const queue = [...g.parts].filter((p) => p.puuid).sort((a, b) => (b.puuid === s.puuid) - (a.puuid === s.puuid));
  const worker = async () => {
    while (queue.length && ctx.alive()) {
      const p = queue.shift();
      const card = body.querySelector(`.lc[data-puuid="${CSS.escape(p.puuid)}"]`);
      try {
        const d = await api(`/live-player/${s.platform}/${p.puuid}?champ=${p.champ}&role=${p.role || ''}`);
        if (ctx.alive() && card) fillCard(card, p, d);
      } catch {
        if (card) card.querySelector('[data-slot="tags"]').innerHTML = '<span class="muted small">Stats indisponibles.</span>';
      }
    }
  };
  worker();
  worker();
}
