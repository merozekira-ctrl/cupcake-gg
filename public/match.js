// Ligne de partie, détail (tableau, comparaison, chronologie).
import {
  S, api, esc, num, dec, pct, kNum, kdaRatio, kdaText, ago, fullDate, clock, queueName, isArena,
  champImg, champOf, itemImg, spellImg, runeImg, playerHref, scoreMatch, loading, errorState, ROLES, crest, rankText, proBadge,
} from '../core.js';

const MATCHES = new Map();

const ordinal = (n) => (n === 1 ? '1re' : `${n}e`);

function multiBadge(p) {
  if (p.penta) return 'Penta';
  if (p.quadra) return 'Quadra';
  if (p.triple) return 'Triple';
  if (p.double) return 'Double';
  return '';
}

function groupKills(m, me) {
  const arena = isArena(m.q);
  return m.parts.filter((p) => (arena ? p.sub === me.sub : p.team === me.team)).reduce((s, p) => s + p.k, 0);
}

function playerLink(platform, p, cls = '') {
  const label = esc(p.name);
  if (!p.tag) return `<span class="${cls}">${label}</span>`;
  return `<a class="${cls}" href="${playerHref(platform, p.name, p.tag)}" title="${label}#${esc(p.tag)}">${label}</a>`;
}

export function resultOf(m, me) {
  if (m.remake) return { cls: 'remake', text: 'Remake' };
  if (isArena(m.q)) return { cls: me.place && me.place <= 4 ? 'win' : 'loss', text: me.place ? `${ordinal(me.place)} place` : 'Arena' };
  return me.win ? { cls: 'win', text: 'Victoire' } : { cls: 'loss', text: 'Défaite' };
}

export function matchCard(m, puuid, platform) {
  MATCHES.set(m.id, m);
  const me = m.parts.find((p) => p.puuid === puuid) || m.parts[0];
  const idx = m.parts.indexOf(me);
  const sc = scoreMatch(m);
  const res = resultOf(m, me);
  const min = Math.max(1, m.dur / 60);
  const tk = groupKills(m, me);
  const ratio = kdaRatio(me.k, me.d, me.a);
  const champ = champOf(me.champ);
  // Partie légendaire : victoire, MVP et score de 85 ou plus.
  const legend = !m.remake && res.cls === 'win' && idx === sc.mvp && sc.scores[idx] * 10 >= 85;

  const badges = [];
  if (legend) badges.push(`<span class="badge gold" title="MVP avec un score de ${Math.round(sc.scores[idx] * 10)} sur 100">MVP</span>`);
  else if (idx === sc.mvp) badges.push('<span class="badge gold" title="Meilleur score de l’équipe gagnante">MVP</span>');
  else if (idx === sc.ace) badges.push('<span class="badge ace" title="Meilleur score de l’équipe perdante">ACE</span>');
  const mk = multiBadge(me);
  if (mk) badges.push(`<span class="badge multi">${mk}</span>`);
  if (me.fb) badges.push('<span class="badge">Premier sang</span>');

  let teams = '';
  if (!isArena(m.q)) {
    const li = (p) =>
      `<li class="${p.puuid === puuid ? 'me' : ''}${p.pro && p.pro.kind === 'pro' ? ' pro' : ''}">${champImg(p.champ, 16)}${playerLink(platform, p)}</li>`;
    teams = `<div class="m-teams" aria-label="Joueurs de la partie">
      <ul>${m.parts.filter((p) => p.team === 100).map(li).join('')}</ul>
      <ul>${m.parts.filter((p) => p.team === 200).map(li).join('')}</ul>
    </div>`;
  } else {
    const mates = m.parts.filter((p) => p.sub === me.sub && p !== me);
    teams = `<div class="m-teams" style="grid-template-columns:1fr"><ul><li class="muted">Avec</li>${mates
      .map((p) => `<li>${champImg(p.champ, 16)}${playerLink(platform, p)}</li>`)
      .join('')}</ul></div>`;
  }

  return `<div class="match-wrap" data-id="${esc(m.id)}">
    <article class="match ${res.cls}${legend ? ' is-legendary' : ''}" aria-label="${esc(res.text)} avec ${esc(champ?.name || 'champion')}, ${me.k} sur ${me.d} sur ${me.a}">
      <div class="m-meta">
        <span class="m-queue">${esc(queueName(m.q))}</span>
        <span title="${esc(fullDate(m.start))}">${esc(ago(m.end))}</span>
        <span class="m-result">${esc(res.text)}</span>
        <span>${clock(m.dur)}</span>
      </div>
      <div class="m-champ">
        <div class="m-portrait">${champImg(me.champ, 48)}<span class="lvl" title="Niveau du champion">${me.lvl}</span></div>
        <div class="m-col">${spellImg(me.s1, 22)}${spellImg(me.s2, 22)}</div>
        ${me.ks ? `<div class="m-col">${runeImg(me.ks, 22)}${runeImg(me.ss, 22, true)}</div>` : ''}
      </div>
      <div class="m-kda">
        <div class="kda-line">${me.k} / <span class="d">${me.d}</span> / ${me.a}</div>
        <div class="ratio">${kdaText(ratio)} KDA</div>
        <div class="m-badges">${badges.join('')}</div>
      </div>
      <div class="m-stats">
        <span>P/Kill <b>${pct(me.k + me.a, tk)}</b></span>
        ${isArena(m.q)
          ? `<span>Dégâts <b>${kNum(me.dmg)}</b></span>`
          : `<span>CS <b>${me.cs}</b> (${dec(me.cs / min)})</span><span>Vision <b>${me.vis}</b></span>`}
        <span>Score <b>${m.remake ? '–' : dec(sc.scores[idx])}</b>${m.remake ? '' : ` <span class="muted">${ordinal(sc.rank[idx])}</span>`}</span>
      </div>
      <div class="m-items" aria-label="Objets">${me.items.map((i) => itemImg(i, 24)).join('')}</div>
      ${teams}
      <button class="m-toggle" type="button" aria-expanded="false" aria-controls="d-${esc(m.id)}" aria-label="Afficher le détail de la partie">
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </article>
    <div class="m-detail" id="d-${esc(m.id)}" hidden></div>
  </div>`;
}

/* ---------- Gestion des clics (délégation) ---------- */

export function bindMatchList(container, getCtx) {
  container.addEventListener('click', (e) => {
    const toggle = e.target.closest('.m-toggle');
    if (toggle && container.contains(toggle)) {
      const wrap = toggle.closest('.match-wrap');
      const det = wrap.querySelector('.m-detail');
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.setAttribute('aria-label', open ? 'Afficher le détail de la partie' : 'Masquer le détail de la partie');
      det.hidden = open;
      if (!open && !det.dataset.ready) {
        det.dataset.ready = '1';
        drawDetail(det, MATCHES.get(wrap.dataset.id), 'table', getCtx());
      }
      return;
    }
    const tab = e.target.closest('[data-dtab]');
    if (tab && container.contains(tab)) {
      const det = tab.closest('.m-detail');
      const wrap = det.closest('.match-wrap');
      drawDetail(det, MATCHES.get(wrap.dataset.id), tab.dataset.dtab, getCtx());
    }
  });
}

function drawDetail(det, m, tab, { puuid, platform }) {
  const tabs = [
    ['table', 'Tableau'],
    ['charts', 'Comparaison'],
    ['timeline', 'Chronologie'],
  ];
  det.innerHTML = `<div class="tabs" role="tablist" aria-label="Vues du détail">${tabs
    .map(([id, label]) => `<button type="button" role="tab" data-dtab="${id}" aria-selected="${id === tab}">${label}</button>`)
    .join('')}</div><div class="d-body" role="tabpanel"></div>`;
  const body = det.querySelector('.d-body');
  if (tab === 'table') {
    body.innerHTML = tableView(m, puuid, platform);
    fillRanks(body, m, platform);
  }
  else if (tab === 'charts') body.innerHTML = chartsView(m, puuid);
  else {
    body.innerHTML = loading('Chargement de la chronologie…');
    const done = (tl) => {
      if (det.querySelector('[data-dtab="timeline"]')?.getAttribute('aria-selected') === 'true') body.innerHTML = timelineView(m, tl, puuid);
    };
    if (m._tl) done(m._tl);
    else
      api(`/timeline/${platform}/${m.id}`)
        .then((tl) => {
          m._tl = tl;
          done(tl);
        })
        .catch((e) => {
          body.innerHTML = errorState(e, 'Chronologie indisponible');
        });
  }
}

/* ---------- Tableau ---------- */

function teamTotals(parts) {
  return parts.reduce((s, p) => ({ k: s.k + p.k, gold: s.gold + p.gold }), { k: 0, gold: 0 });
}

// Icônes des objectifs (dessin simple, une couleur).
const OBJ_IC = {
  tower: '<path d="M7 21h10l-1.5-9H17V5h-2v2h-2V5h-2v2H9V5H7v7h1.5Z"/>',
  dragon: '<path d="M12 3c-1 2-3 3-5 3l1.5 3L5 11l3 1-1 4 3-2 2 5 2-5 3 2-1-4 3-1-3.5-2L17 6c-2 0-4-1-5-3Z"/>',
  baron: '<path d="M12 3a7 7 0 0 0-7 7c0 3 1.6 4.6 3 5.6V20h2v-2h1v2h2v-2h1v2h2v-4.4c1.4-1 3-2.6 3-5.6a7 7 0 0 0-7-7Zm-3 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/>',
  grubs: '<path d="M6 14a4 4 0 0 1 4-4h1a3 3 0 1 1 3 4 4 4 0 0 1-8 0Zm11-7 2-2M15 6l1-3"/>',
  herald: '<path d="M12 2 9 7H4l3 4-2 6 7-3 7 3-2-6 3-4h-5Zm0 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/>',
  atakhan: '<path d="M12 2 4 8v6l8 8 8-8V8Zm0 5 3 3-3 6-3-6Z"/>',
};
const OBJ_IMG = ['baron', 'dragon', 'herald', 'grubs', 'tower'];
const objIc = (k) =>
  OBJ_IMG.includes(k)
    ? `<img class="obj-ic" src="/img/obj/${k}.png" alt="" height="18" decoding="async">`
    : `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="currentColor" stroke="currentColor" stroke-width="0">${OBJ_IC[k]}</svg>`;

const scoreColor = (v) => (v >= 80 ? 'var(--sc-s)' : v >= 62 ? 'var(--sc-a)' : v >= 42 ? 'var(--sc-b)' : 'var(--sc-c)');

function playerRow(m, p, i, ctx) {
  const { puuid, platform, maxDmg, sc } = ctx;
  const min = Math.max(1, m.dur / 60);
  const tk = groupKills(m, p);
  const s100 = m.remake ? null : Math.round(sc.scores[i] * 10);
  const place = m.remake
    ? '<span class="sb-place">–</span>'
    : i === sc.mvp
      ? '<span class="sb-place mvp">MVP</span>'
      : i === sc.ace
        ? '<span class="sb-place ace">ACE</span>'
        : `<span class="sb-place">${ordinal(sc.rank[i])}</span>`;
  const sup = p.pos === 'UTILITY';
  const items = p.items.slice(0, 7);
  while (items.length < 7) items.push(0);
  const it = (x) => (x ? itemImg(x, 22) : '<span class="sb-empty"></span>');
  const pro = p.pro && p.pro.kind === 'pro' ? ' is-pro' : '';
  const sub = isArena(m.q) ? `<small>${ordinal(p.place || 0)} place</small>` : `<small class="sb-rank" data-rk="${esc(p.puuid || '')}"><span class="sb-sk"></span></small>`;
  return `<div class="sb-row${p.puuid === puuid ? ' me' : ''}${p.win ? ' w' : ' l'}">
    ${place}
    <div class="sb-champ">${champImg(p.champ, 38)}<span class="lvl">${p.lvl}</span></div>
    <div class="sb-name"><span class="sb-n${pro}">${playerLink(platform, p)}${p.pro ? proBadge(p.pro) : ''}</span>${sub}</div>
    <div class="sb-sr">${spellImg(p.s1, 19)}${runeImg(p.ks, 19)}${spellImg(p.s2, 19)}${runeImg(p.ss, 19, true)}</div>
    <div class="sb-items">${items.slice(0, 4).map(it).join('')}${items.slice(4).map(it).join('')}</div>
    <div class="sb-kda"><b>${p.k} <i>/</i> <span class="d">${p.d}</span> <i>/</i> ${p.a}</b><small>${kdaText(kdaRatio(p.k, p.d, p.a))} KDA</small></div>
    <div class="sb-stat"><b>${pct(p.k + p.a, tk)}</b><small>KP</small></div>
    <div class="sb-stat">${sup ? `<b>${p.vis}</b><small>vision</small>` : `<b>${dec(p.cs / min, 1)}</b><small>CS/min</small>`}</div>
    <div class="sb-dmg"><div class="sb-bar${p.dmg === maxDmg ? ' top' : ''}"><i style="width:${maxDmg ? ((p.dmg / maxDmg) * 100).toFixed(1) : 0}%"></i></div><small><b>${kNum(p.dmg)}</b> (${num(Math.round(p.dmg / min))}/m)</small></div>
    <div class="sb-score">${s100 == null ? '<b class="muted">–</b>' : `<span class="score sb-ring" style="--p:${s100};--c:${scoreColor(s100)}" title="Score cupcake : ${s100} sur 100"><b style="color:${scoreColor(s100)}">${s100}</b></span>`}</div>
  </div>`;
}

// Rang et LP de chaque joueur sous son nom (chargés après l'affichage).
function fillRanks(root, m, platform) {
  const apply = (rk) => {
    root.querySelectorAll('[data-rk]').forEach((el) => {
      const r = rk[el.dataset.rk];
      if (!r) return;
      if (!r.tier) {
        el.innerHTML = '<span class="muted">Non classé</span>';
        return;
      }
      const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(r.tier);
      el.innerHTML = `${crest(r, 'xs')}<span>${apex ? `${num(r.lp)} LP` : `${esc(rankText(r))} · ${num(r.lp)} LP`}</span>`;
      el.title = `${rankText(r)} ${r.lp} LP${r.q === 'flex' ? ' (Flex)' : ''}`;
      if (r.pro) {
        const row = el.closest('.sb-row');
        const n = row?.querySelector('.sb-n');
        if (n && !n.querySelector('.who')) {
          if (r.pro.kind === 'pro') n.classList.add('is-pro');
          n.insertAdjacentHTML('beforeend', proBadge(r.pro));
        }
      }
    });
  };
  if (m._rk) return apply(m._rk);
  const ids = m.parts.map((p) => p.puuid).filter(Boolean);
  if (!ids.length) return;
  api(`/ranks/${platform}?ids=${ids.join(',')}`)
    .then((rk) => {
      m._rk = rk;
      apply(rk);
    })
    .catch(() => root.querySelectorAll('[data-rk]').forEach((el) => (el.innerHTML = '')));
}

function tableView(m, puuid, platform) {
  const sc = scoreMatch(m);
  const maxDmg = Math.max(...m.parts.map((p) => p.dmg), 1);
  const ctx = { puuid, platform, maxDmg, sc };
  if (isArena(m.q)) {
    const order = m.parts.map((p, i) => [p, i]).sort((a, b) => (a[0].place || 99) - (b[0].place || 99));
    return `<div class="scroll-x"><div class="sb">${order.map(([p, i]) => playerRow(m, p, i, ctx)).join('')}</div></div>`;
  }
  return `<div class="scroll-x"><div class="sb">${[100, 200]
    .map((teamId) => {
      const parts = m.parts.map((p, i) => [p, i]).filter(([p]) => p.team === teamId);
      if (!parts.length) return '';
      const T = m.teams.find((t) => t.id === teamId) || {};
      const tot = teamTotals(parts.map(([p]) => p));
      const win = parts[0][0].win;
      // Les objectifs absents des deux côtés (Atakhan, larves…) sont masqués.
      const seen = (k) => m.teams.some((t) => t[k] > 0);
      const objs = [
        ...(seen('grubs') ? [['grubs', 'Larves du Néant', T.grubs || 0]] : []),
        ['dragon', 'Dragons', T.dragon || 0],
        ...(seen('herald') ? [['herald', 'Héraut', T.herald || 0]] : []),
        ['baron', 'Barons', T.baron || 0],
        ...(seen('atakhan') ? [['atakhan', 'Atakhan', T.atakhan || 0]] : []),
        ['tower', 'Tours', T.tower || 0],
      ];
      return `<div class="sb-head ${teamId === 100 ? 'blue' : 'red'}">
          <h4 class="${m.remake ? '' : win ? 't-win' : 't-loss'}">${m.remake ? 'Remake' : win ? 'Victoire' : 'Défaite'} <span>(côté ${teamId === 100 ? 'bleu' : 'rouge'})</span></h4>
          <span class="sb-tot" title="Éliminations · or de l’équipe"><b>${tot.k}</b> kills · <b>${kNum(tot.gold)}</b> ${document.documentElement.lang === 'en' ? 'gold' : 'or'}</span>
          <div class="sb-objs">${objs.map(([k, l, v]) => `<span title="${l}">${objIc(k)}<b>${v}</b></span>`).join('')}</div>
          ${T.bans?.length ? `<div class="bans" title="Champions bannis">${T.bans.map((c) => champImg(c, 20)).join('')}</div>` : ''}
        </div>
        ${parts.map(([p, i]) => playerRow(m, p, i, ctx)).join('')}`;
    })
    .join('')}</div></div>`;
}

/* ---------- Comparaison ---------- */

const METRICS = [
  ['Dégâts aux champions', 'dmg'],
  ['Dégâts subis', 'taken'],
  ['Or gagné', 'gold'],
  ['Sbires et monstres', 'cs'],
  ['Score de vision', 'vis'],
  ['Dégâts atténués', 'mitig'],
  ['Soins et boucliers alliés', 'heal'],
  ['Dégâts aux objectifs', 'obj'],
];

function chartsView(m, puuid) {
  const arena = isArena(m.q);
  const parts = arena ? [...m.parts].sort((a, b) => (a.place || 99) - (b.place || 99)) : [...m.parts].sort((a, b) => a.team - b.team);
  const legend = arena
    ? ''
    : '<div class="legend"><span><i class="l1"></i>Équipe bleue</span><span><i class="l2"></i>Équipe rouge</span></div>';
  return `${legend}<div class="chart-rows">${METRICS.map(([label, key]) => {
    const max = Math.max(...parts.map((p) => p[key] || 0), 1);
    return `<section><h4>${label}</h4><div class="cmp">${parts
      .map(
        (p) =>
          `<div class="${p.puuid === puuid ? 'me' : ''}">${champImg(p.champ, 22)}<div class="bar ${arena ? '' : p.team === 200 ? 't2' : 't1'}" title="${esc(p.name)}"><i style="width:${((p[key] || 0) / max) * 100}%"></i></div><span class="num">${kNum(p[key] || 0)}</span></div>`
      )
      .join('')}</div></section>`;
  }).join('')}</div>`;
}

/* ---------- Chronologie ---------- */

const MONSTERS = { DRAGON: 'Dragon', BARON_NASHOR: 'Baron Nashor', RIFTHERALD: 'Héraut de la Faille', HORDE: 'Larve du Néant', ATAKHAN: 'Atakhan', ELDER_DRAGON: 'Dragon ancestral' };

function goldChart(m, tl, me) {
  const teamOf = {};
  for (const [pid, pu] of Object.entries(tl.pmap)) teamOf[pid] = m.parts.find((p) => p.puuid === pu)?.team;
  const series = tl.frames.map((f) => {
    let mine = 0;
    let theirs = 0;
    for (const [pid, v] of Object.entries(f.pf)) {
      if (teamOf[pid] === me.team) mine += v.g;
      else theirs += v.g;
    }
    return { t: f.t / 60000, d: mine - theirs };
  });
  if (series.length < 2) return '<p class="muted">Pas assez de données pour tracer l’écart d’or.</p>';
  const W = 680;
  const H = 210;
  const pad = { l: 52, r: 12, t: 12, b: 26 };
  const maxT = series[series.length - 1].t || 1;
  const rawMax = Math.max(1000, ...series.map((s) => Math.abs(s.d)));
  const step = rawMax > 10000 ? 5000 : rawMax > 4000 ? 2000 : 1000;
  const maxY = Math.ceil(rawMax / step) * step;
  const x = (t) => pad.l + (t / maxT) * (W - pad.l - pad.r);
  const y = (d) => pad.t + ((maxY - d) / (2 * maxY)) * (H - pad.t - pad.b);
  const y0 = y(0);

  // Ajoute les points de passage par zéro pour des aires nettes.
  const pts = [];
  for (let i = 0; i < series.length; i++) {
    const a = series[i];
    pts.push(a);
    const b = series[i + 1];
    if (b && Math.sign(a.d) !== Math.sign(b.d) && a.d !== 0 && b.d !== 0) {
      const r = a.d / (a.d - b.d);
      pts.push({ t: a.t + (b.t - a.t) * r, d: 0 });
    }
  }
  const area = (fn) =>
    `M${x(pts[0].t)},${y0} ` + pts.map((p) => `L${x(p.t).toFixed(1)},${y(fn(p.d)).toFixed(1)}`).join(' ') + ` L${x(pts[pts.length - 1].t)},${y0} Z`;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.d).toFixed(1)}`).join(' ');

  const gridY = [maxY, maxY / 2, -maxY / 2, -maxY];
  const ticks = [];
  for (let t = 0; t <= maxT; t += 5) ticks.push(t);
  const objs = tl.ev.filter((e) => e.ty === 'monster');

  return `<svg class="gold-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Écart d’or de ton équipe minute par minute">
    <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff"/><rect width="2.2" height="6" fill="#000"/></pattern></defs>
    ${gridY.map((v) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v > 0 ? '+' : '−'}${kNum(Math.abs(v))}</text>`).join('')}
    <path class="ahead" d="${area((d) => Math.max(0, d))}"/>
    <path class="behind" d="${area((d) => Math.min(0, d))}"/>
    <line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${y0}" y2="${y0}"/>
    <text x="${pad.l - 6}" y="${y0 + 4}" text-anchor="end">0</text>
    <path class="line" d="${line}"/>
    ${ticks.map((t) => `<text x="${x(t)}" y="${H - 8}" text-anchor="middle">${t}′</text>`).join('')}
    <g class="obj">${objs
      .map((e) => {
        const name = MONSTERS[e.m] || e.m;
        const sub = e.sub ? ` (${e.sub.replace(/_DRAGON$/, '').toLowerCase()})` : '';
        const side = e.team === 100 ? 'bleue' : 'rouge';
        return `<circle class="${e.team === 100 ? 'obj-t1' : 'obj-t2'}" cx="${x(e.t / 60000).toFixed(1)}" cy="${e.team === me.team ? pad.t + 6 : H - pad.b - 6}" r="5"><title>${esc(name + sub)} · équipe ${side} · ${clock(e.t / 1000)}</title></circle>`;
      })
      .join('')}</g>
  </svg>`;
}

function buildOrder(tl, pid) {
  const list = [];
  for (const e of tl.ev) {
    if (e.p !== pid) continue;
    if (e.ty === 'buy') list.push({ t: e.t, i: e.i });
    else if (e.ty === 'undo') {
      for (let k = list.length - 1; k >= 0; k--) {
        if (list[k].i === e.i) {
          list.splice(k, 1);
          break;
        }
      }
    }
  }
  const steps = [];
  for (const b of list) {
    const minute = Math.floor(b.t / 60000);
    const last = steps[steps.length - 1];
    if (last && minute - last.m <= 0) last.items.push(b.i);
    else steps.push({ m: minute, items: [b.i] });
  }
  return steps;
}

function skillOrder(tl, pid) {
  return tl.ev.filter((e) => e.ty === 'skill' && e.p === pid).map((e) => e.s).slice(0, 18);
}

function skillPriority(order) {
  const keys = { 1: 'Q', 2: 'W', 3: 'E' };
  const counts = { 1: 0, 2: 0, 3: 0 };
  const maxedAt = {};
  order.forEach((s, i) => {
    if (!counts.hasOwnProperty(s)) return;
    counts[s]++;
    if (counts[s] === 5) maxedAt[s] = i;
  });
  return [1, 2, 3]
    .sort((a, b) => (maxedAt[a] ?? 99 + (5 - counts[a])) - (maxedAt[b] ?? 99 + (5 - counts[b])))
    .map((s) => keys[s]);
}

function timelineView(m, tl, puuid) {
  const me = m.parts.find((p) => p.puuid === puuid) || m.parts[0];
  const pid = Number(Object.keys(tl.pmap).find((k) => tl.pmap[k] === me.puuid));
  const steps = buildOrder(tl, pid);
  const skills = skillOrder(tl, pid);
  const chart = isArena(m.q)
    ? ''
    : `<h4 class="small" style="margin:0 0 8px">Écart d’or de ton équipe</h4>
       <div class="legend"><span><i class="l1"></i>Objectif de l’équipe bleue</span><span><i class="l2"></i>Objectif de l’équipe rouge</span><span>Points du haut : ton équipe</span></div>
       ${goldChart(m, tl, me)}`;
  const grid = ['Q', 'W', 'E', 'R']
    .map((k, row) => {
      const cells = [];
      for (let lvl = 0; lvl < 18; lvl++) {
        const on = skills[lvl] === row + 1;
        cells.push(`<span class="${on ? 'on' + (row === 3 ? ' r' : '') : ''}">${on ? lvl + 1 : ''}</span>`);
      }
      return `<span class="k">${k}</span>${cells.join('')}`;
    })
    .join('');
  const prio = skillPriority(skills);
  return `${chart}
    <div class="tl-grid">
      <section>
        <h4 class="small" style="margin:0 0 8px">Ordre d’achat</h4>
        ${steps.length ? `<div class="build-seq">${steps.map((s) => `<div class="build-step"><div class="items-row">${s.items.map((i) => itemImg(i, 24)).join('')}</div><small>${s.m} min</small></div>`).join('')}</div>` : '<p class="muted small">Aucun achat enregistré.</p>'}
      </section>
      <section>
        <h4 class="small" style="margin:0 0 8px">Ordre des compétences</h4>
        ${skills.length ? `<div class="skill-path" aria-label="Priorité de montée">${prio.map((k) => `<span>${k}</span>`).join('')}</div><div class="skills">${grid}</div>` : '<p class="muted small">Aucune donnée de compétence.</p>'}
      </section>
    </div>`;
}
