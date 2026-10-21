// Classement : podium des 3 premiers puis tableau (région ou mondial).
import { S, api, esc, num, dec, crest, rankText, playerHref, setPlatform, setTitle, loading, errorState, profileImg, champImg, roleIcon, ROLES } from '../core.js';

const regionBadge = (p) => `<span class="rg rg-${esc(p)}">${esc(S.cfg.platforms[p]?.label || p)}</span>`;

function nameHtml(r) {
  if (r.name) {
    return `<a class="lp-name" href="${playerHref(r.p, r.name, r.tag)}">${esc(r.name)}</a><span class="lp-tag">#${esc(r.tag)}</span>`;
  }
  return r.puuid ? '<span class="skel name-pending"></span>' : '<span class="muted">Joueur masqué</span>';
}
const iconHtml = (r, size) => (r.icon != null ? profileImg(r.icon, size) : `<span class="skel ic-skel" style="width:${size}px;height:${size}px"></span>`);
const wrPct = (r) => (r.w + r.l ? Math.round((r.w / (r.w + r.l)) * 100) : 0);
const wrClass = (v) => (v >= 60 ? 'hi' : v >= 55 ? 'mid' : 'lo');

function roleHtml(st) {
  if (!st) return '<span class="skel stat-skel"></span>';
  if (!st.role) return '<span class="muted">–</span>';
  return `<span class="lr-role" title="${ROLES[st.role]}">${roleIcon(st.role, false)}<small>${Math.round(st.rolePct * 100)}%</small></span>`;
}
function champsHtml(r, st, size) {
  const list = [...new Set([...(st?.champs || []), ...(r.mastery || [])])].slice(0, 4);
  if (!list.length) return st || r.mastery ? '<span class="muted">–</span>' : '<span class="skel champs-skel"></span>';
  return `<span class="lr-champs">${list.map((c) => champImg(c, size)).join('')}</span>`;
}
const kdaHtml = (st) => (!st ? '<span class="skel stat-skel"></span>' : st.kda == null ? '<span class="muted">–</span>' : `<b>${dec(st.kda, 1)}</b>`);

function podium(r) {
  const wr = wrPct(r);
  return `<article class="pod pod-${r.rank}" data-id="${esc(r.puuid || '')}">
    <div class="pod-top">
      <span class="pod-rank">${r.rank}</span>
      ${regionBadge(r.p)}
      <span class="pod-ic">${iconHtml(r, 48)}</span>
      <span class="pod-who">${nameHtml(r)}</span>
      <span class="pod-role" data-slot="role">${roleHtml(r._st)}</span>
    </div>
    <div class="pod-lp">${crest({ tier: r.tier }, 'md')}<b class="lp-val">${num(r.lp)} LP</b></div>
    <div class="pod-wl">${r.w} V – ${r.l} D <span class="wr-${wrClass(wr)}">(${wr}%)</span></div>
    <div class="pod-foot">
      <span><b>${num(r.w + r.l)}</b><small>parties</small></span>
      <span data-slot="champs">${champsHtml(r, r._st, 30)}</span>
      <span class="pod-kda"><span data-slot="kda">${kdaHtml(r._st)}</span><small>KDA</small></span>
    </div>
  </article>`;
}

function row(r) {
  const wr = wrPct(r);
  const n = r.w + r.l;
  return `<div class="lr" role="row" data-id="${esc(r.puuid || '')}">
    <span class="lr-rank" role="cell">${r.rank}</span>
    <span role="cell">${regionBadge(r.p)}</span>
    <span class="lr-player" role="cell"><span class="lr-ic">${iconHtml(r, 36)}</span><span class="lr-who">${nameHtml(r)}</span></span>
    <span role="cell" data-slot="role">${roleHtml(r._st)}</span>
    <span class="lr-lp" role="cell">${crest({ tier: r.tier }, 'sm')}<b class="lp-val">${num(r.lp)} LP</b></span>
    <span class="lr-wr" role="cell">
      <span class="wl-bar"><i style="width:${n ? (r.w / n) * 100 : 0}%"></i><em>${r.w} V – ${r.l} D</em></span>
      <b class="wr-chip wr-${wrClass(wr)}">${wr}%</b>
    </span>
    <span class="lr-kda" role="cell" data-slot="kda">${kdaHtml(r._st)}</span>
    <span role="cell" data-slot="champs">${champsHtml(r, r._st, 28)}</span>
  </div>`;
}

export async function render(el, { p }, ctx) {
  const world = p === 'world';
  const platform = world ? 'world' : S.cfg.platforms[p] ? p : S.platform;
  if (!world) setPlatform(platform);
  const queue = ctx.query.queue === 'flex' ? 'flex' : 'solo';
  const page = Math.max(1, parseInt(ctx.query.page, 10) || 1);
  const label = world ? 'Mondial' : S.cfg.platforms[platform].label;
  setTitle(`Classement ${label}`);
  const href = (q, pg, pf = platform) => `#/classement/${pf}?queue=${q}${pg > 1 ? '&page=' + pg : ''}`;
  const opts = `<option value="world"${world ? ' selected' : ''}>Mondial</option>${Object.entries(S.cfg.platforms)
    .map(([k, v]) => `<option value="${k}"${k === platform ? ' selected' : ''}>${esc(v.label)}</option>`)
    .join('')}`;

  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="grad-title">Classement ${esc(label)}</h1>
        <p>${world ? 'Les Challenger de toutes les régions, triés par LP.' : `Challenger, Grand Maître et Maître de ${esc(S.cfg.platforms[platform].name)}, triés par palier puis par LP.`}</p>
      </div>
      <div class="row wrap">
        <nav class="seg" aria-label="File">
          <a href="${href('solo', 1)}"${queue === 'solo' ? ' aria-current="page"' : ''}>Solo/Duo</a>
          <a href="${href('flex', 1)}"${queue === 'flex' ? ' aria-current="page"' : ''}>Flex</a>
        </nav>
        <label class="sr" for="lRegion">Région</label>
        <select class="select" id="lRegion">${opts}</select>
      </div>
    </div>
    <div id="ladder">${loading(world ? 'Chargement des Challenger de toutes les régions…' : 'Chargement du classement…')}</div>`;

  el.querySelector('#lRegion').addEventListener('change', (e) => {
    if (e.target.value !== 'world') setPlatform(e.target.value);
    location.hash = href(queue, 1, e.target.value);
  });

  if (!S.cfg.hasKey) {
    el.querySelector('#ladder').innerHTML = '<div class="panel state"><p>Le classement a besoin d’une clé API Riot.</p></div>';
    return;
  }
  let data;
  try {
    data = await api(`/ladder/${platform}?queue=${queue}&page=${page}`);
  } catch (e) {
    if (ctx.alive()) el.querySelector('#ladder').innerHTML = errorState(e);
    return;
  }
  if (!ctx.alive()) return;
  const box = el.querySelector('#ladder');
  if (!data.rows.length) {
    box.innerHTML = '<div class="panel state"><p class="state-title">Classement vide</p><p>Aucun joueur pour cette file. C’est fréquent en début de saison.</p></div>';
    return;
  }
  const podRows = page === 1 ? data.rows.slice(0, 3) : [];
  const listRows = page === 1 ? data.rows.slice(3) : data.rows;

  box.innerHTML = `
    ${podRows.length ? `<div class="podium">${podRows.map(podium).join('')}</div>` : ''}
    <div class="ltable" role="table" aria-label="Classement">
      <div class="lr lr-head" role="row"><span role="columnheader"></span><span role="columnheader"></span><span role="columnheader">Joueur</span><span role="columnheader">Rôle</span><span role="columnheader">Rang</span><span role="columnheader">Winrate</span><span role="columnheader">KDA</span><span role="columnheader">Meilleurs champions</span></div>
      ${listRows.map(row).join('')}
    </div>
    <p class="muted small" style="margin-top:10px">${num(data.total)} joueurs. Rôle, KDA et champions calculés sur les ${'5'} dernières parties classées de chaque joueur, chargés progressivement.</p>
    <nav class="pager" aria-label="Pages du classement">
      ${data.page > 1 ? `<a class="btn" href="${href(queue, data.page - 1)}">Page précédente</a>` : ''}
      <span class="muted">${data.page} / ${data.pages}</span>
      ${data.page < data.pages ? `<a class="btn" href="${href(queue, data.page + 1)}">Page suivante</a>` : ''}
    </nav>`;

  const byId = Object.fromEntries(data.rows.filter((r) => r.puuid).map((r) => [r.puuid, r]));
  const nodes = (id) => box.querySelectorAll(`[data-id="${CSS.escape(id)}"]`);
  const ids = data.rows.filter((r) => r.puuid).map((r) => `${r.p}:${r.puuid}`);

  // 1. Identité (noms, icônes, maîtrises).
  try {
    const idMap = await api(`/ladder-id?ids=${ids.join(',')}`);
    if (!ctx.alive()) return;
    for (const [id, v] of Object.entries(idMap)) {
      const r = Object.assign(byId[id], v);
      nodes(id).forEach((n) => {
        const big = n.classList.contains('pod');
        n.querySelector(big ? '.pod-ic' : '.lr-ic').innerHTML = iconHtml(r, big ? 48 : 36);
        n.querySelector(big ? '.pod-who' : '.lr-who').innerHTML = nameHtml(r);
        n.querySelector('[data-slot="champs"]').innerHTML = champsHtml(r, r._st, big ? 30 : 28);
      });
    }
  } catch {
    /* noms indisponibles */
  }
  box.querySelectorAll('.name-pending').forEach((x) => (x.outerHTML = '<span class="muted">Nom indisponible</span>'));

  // 2. Forme récente, par paquets de 5 joueurs.
  for (let i = 0; i < ids.length; i += 5) {
    if (!ctx.alive()) return;
    let st;
    try {
      st = await api(`/ladder-stats?ids=${ids.slice(i, i + 5).join(',')}`);
    } catch {
      break;
    }
    if (!ctx.alive()) return;
    for (const [id, v] of Object.entries(st)) {
      const r = byId[id];
      r._st = v;
      nodes(id).forEach((n) => {
        const big = n.classList.contains('pod');
        n.querySelector('[data-slot="role"]').innerHTML = roleHtml(v);
        n.querySelector('[data-slot="kda"]').innerHTML = kdaHtml(v);
        n.querySelector('[data-slot="champs"]').innerHTML = champsHtml(r, v, big ? 30 : 28);
      });
    }
  }
}
