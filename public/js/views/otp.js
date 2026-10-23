// Classement OTP : joueurs Challenger / Grand Maître qui jouent surtout un champion.
import {
  S, api, esc, num, dec, pct, crest, playerHref, setPlatform, setTitle, loading, errorState, profileImg, champImg, champOf, champHref,
  itemImg, roleIcon, roleBar, ROLES, wrBadge, proBadge, regionBadge, norm, patchLabel, store,
} from '../core.js';

const nameHtml = (r) =>
  `<a class="lp-name" href="${playerHref(r.p, r.name, r.tag)}">${esc(r.name)}</a>${r.pro ? proBadge(r.pro) : `<span class="lp-tag">#${esc(r.tag)}</span>`}`;
const iconHtml = (r, size) => (r.icon != null ? profileImg(r.icon, size) : `<span class="skel ic-skel" style="width:${size}px;height:${size}px"></span>`);
const lpHtml = (r, size) => (r.tier ? `${crest({ tier: r.tier }, size)}<b class="lp-val">${r.lp != null ? num(r.lp) + ' LP' : ''}</b>` : '<span class="muted">–</span>');

function podium(r) {
  const c = champOf(r.champ);
  return `<article class="pod otp-pod pod-${r.rank}" data-id="${esc(r.puuid)}">
    <a class="pod-champ" href="${c ? champHref(c, r.role) : '#/champions'}" title="${esc(c?.name || '')}">${champImg(r.champ, 56)}<b>${Math.round(r.share * 100)} %</b></a>
    <div class="pod-top">
      <span class="pod-rank">${r.rank}</span>
      ${regionBadge(r.p)}
      <span class="pod-ic">${iconHtml(r, 46)}</span>
      <span class="pod-who">${nameHtml(r)}</span>
    </div>
    <div class="pod-lp">${lpHtml(r, 'md')}</div>
    <div class="pod-foot">
      <span class="items-row">${r.items.map((id) => itemImg(id, 30)).join('') || '<span class="muted small">–</span>'}</span>
      <span class="otp-stats">
        <span><b>${dec(r.kda, 1)}</b><small>KDA</small></span>
        <span>${wrBadge(r.cw, r.g, { text: true })}<small>WR</small></span>
        <span><b>${r.g}</b><small>parties</small></span>
      </span>
    </div>
  </article>`;
}

function row(r) {
  const c = champOf(r.champ);
  return `<div class="lr or" role="row" data-id="${esc(r.puuid)}">
    <span class="lr-rank" role="cell">${r.rank}</span>
    <span role="cell">${regionBadge(r.p)}</span>
    <span class="lr-player" role="cell"><span class="lr-ic">${iconHtml(r, 38)}</span><span class="lr-who">${nameHtml(r)}</span></span>
    <span class="lr-lp" role="cell">${lpHtml(r, 'sm')}</span>
    <a class="or-champ" role="cell" href="${c ? champHref(c, r.role) : '#/champions'}">${champImg(r.champ, 38)}<span><b>${Math.round(r.share * 100)} %</b><small>de ses parties</small><span class="share"><i style="width:${Math.round(r.share * 100)}%"></i></span></span></a>
    <span class="items-row" role="cell">${r.items.map((id) => itemImg(id, 30)).join('')}</span>
    <span class="or-n" role="cell"><b>${r.g}</b><small>sur ${r.n}</small></span>
    <span class="or-n" role="cell"><b>${dec(r.kda, 1)}</b><small>KDA</small></span>
    <span class="or-n" role="cell">${wrBadge(r.cw, r.g)}</span>
  </div>`;
}

export async function render(el, { p }, ctx) {
  const platform = S.cfg.platforms[p] ? p : S.platform;
  setPlatform(platform);
  const label = S.cfg.platforms[platform].label;
  setTitle(`Meilleurs OTP ${label}`);
  const state = {
    role: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].includes(ctx.query.role) ? ctx.query.role : 'ALL',
    champ: Number(ctx.query.champ) || 0,
    sort: ctx.query.sort === 'score' ? 'score' : 'lp',
  };
  const hrefOf = (o = {}) => {
    const s = { ...state, ...o };
    const q = new URLSearchParams();
    if (s.role !== 'ALL') q.set('role', s.role);
    if (s.champ) q.set('champ', s.champ);
    if (s.sort !== 'lp') q.set('sort', s.sort);
    const qs = q.toString();
    return `#/otp/${o.p || platform}${qs ? '?' + qs : ''}`;
  };

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-kicker">Classements · OTP</div>
        <h1 class="grad-title">Meilleurs OTP ${esc(label)}</h1>
        <p>Les joueurs Challenger et Grand Maître qui jouent surtout un champion, d’après leurs dernières parties classées de l’échantillon. Clique sur un champion pour voir ses spécialistes.</p>
      </div>
      <div class="row wrap">
        <nav class="seg" aria-label="Tri">
          <a href="${hrefOf({ sort: 'lp' })}"${state.sort === 'lp' ? ' aria-current="page"' : ''}>Rang</a>
          <a href="${hrefOf({ sort: 'score' })}"${state.sort === 'score' ? ' aria-current="page"' : ''}>Score OTP</a>
        </nav>
        <label class="sr" for="oRegion">Région</label>
        <select class="select" id="oRegion">${Object.entries(S.cfg.platforms)
          .map(([k, v]) => `<option value="${k}"${k === platform ? ' selected' : ''}>${esc(v.label)}</option>`)
          .join('')}</select>
      </div>
    </div>
    <div class="toolbar">
      ${roleBar(state.role)}
      <div class="champ-filter" id="cFilter"></div>
      <span class="grow"></span>
      <span class="muted small" id="oInfo"></span>
    </div>
    <div id="otp">${loading('Recherche des spécialistes…')}</div>`;

  el.querySelector('#oRegion').addEventListener('change', (e) => {
    location.hash = hrefOf({ p: e.target.value });
  });
  el.querySelectorAll('[data-role]').forEach((b) =>
    b.addEventListener('click', () => {
      location.hash = hrefOf({ role: b.dataset.role });
    })
  );

  if (!S.cfg.hasKey) {
    el.querySelector('#otp').innerHTML = '<div class="panel state"><p>Le classement OTP a besoin d’une clé API Riot.</p></div>';
    return;
  }
  let data;
  try {
    const q = new URLSearchParams({ sort: state.sort });
    if (state.role !== 'ALL') q.set('role', state.role);
    if (state.champ) q.set('champ', state.champ);
    data = await api(`/otp/${platform}?${q}`);
  } catch (e) {
    if (ctx.alive()) el.querySelector('#otp').innerHTML = errorState(e);
    return;
  }
  if (!ctx.alive()) return;
  drawFilter(el, state, data, hrefOf);
  el.querySelector('#oInfo').textContent = `${data.total} OTP repéré${data.total > 1 ? 's' : ''}${data.patches?.length ? ` · patch ${data.patches.map(patchLabel).join(', ')}` : ''}`;
  const box = el.querySelector('#otp');
  if (!data.rows.length) {
    const c = state.champ && champOf(state.champ);
    box.innerHTML = `<div class="panel state"><p class="state-title">Aucun OTP ${c ? 'de ' + esc(c.name) : ''} pour l’instant</p><p>${S.cfg.demo ? 'La démonstration ne contient que 150 parties : seuls les joueurs les plus réguliers apparaissent.' : 'L’échantillon de parties grossit à chaque analyse automatique : reviens un peu plus tard.'}</p>${state.champ || state.role !== 'ALL' ? `<a class="btn" href="#/otp/${platform}">Voir tous les OTP</a>` : ''}</div>`;
    return;
  }
  await drawOtpList(box, data.rows, ctx);
}

// Podium + tableau des OTP, puis icônes et identités (25 par appel). Réutilisé par la fiche champion.
export async function drawOtpList(box, rows, ctx) {
  const pod = rows.slice(0, 3);
  const rest = rows.slice(3);
  box.innerHTML = `
    <div class="podium">${pod.map(podium).join('')}</div>
    ${rest.length ? `<div class="ltable" role="table" aria-label="Classement OTP">
      <div class="lr or lr-head" role="row"><span role="columnheader">#</span><span role="columnheader"></span><span role="columnheader">Joueur</span><span role="columnheader">Rang</span><span role="columnheader">Champion</span><span role="columnheader">Objets</span><span role="columnheader">Parties</span><span role="columnheader">KDA</span><span role="columnheader">Winrate</span></div>
      ${rest.map(row).join('')}
    </div>` : ''}
    <p class="muted small" style="margin-top:12px">Part du champion, KDA et winrate calculés sur les parties classées Solo/Duo lues dans l’échantillon (un OTP joue son champion dans plus de la moitié de ses parties). LP et rang mis à jour avec le classement en direct.</p>`;

  // Icônes et identités (25 par appel).
  const byId = Object.fromEntries(rows.map((r) => [r.puuid, r]));
  for (let i = 0; i < rows.length && i < 100; i += 25) {
    const ids = rows.slice(i, i + 25).map((r) => `${r.p}:${r.puuid}`);
    let idMap;
    try {
      idMap = await api(`/ladder-id?ids=${ids.join(',')}`);
    } catch {
      break;
    }
    if (!ctx.alive()) return;
    for (const [id, v] of Object.entries(idMap)) {
      const r = byId[id];
      if (!r) continue;
      r.icon = v.icon;
      if (v.name) Object.assign(r, { name: v.name, tag: v.tag });
      if (v.pro && !r.pro) r.pro = v.pro;
      box.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach((n) => {
        const big = n.classList.contains('pod');
        n.querySelector(big ? '.pod-ic' : '.lr-ic').innerHTML = iconHtml(r, big ? 46 : 38);
        n.querySelector(big ? '.pod-who' : '.lr-who').innerHTML = nameHtml(r);
      });
    }
  }
  box.querySelectorAll('.ic-skel').forEach((x) => (x.outerHTML = '<span class="omni-person" aria-hidden="true"></span>'));
}

// Filtre par champion : liste des champions qui ont des OTP, recherche par nom.
function drawFilter(el, state, data, hrefOf) {
  const box = el.querySelector('#cFilter');
  if (state.champ) {
    const c = champOf(state.champ);
    box.innerHTML = `<span class="chosen">${champImg(state.champ, 30)}${esc(c?.name || '?')}<a class="x-btn" href="${hrefOf({ champ: 0 })}" aria-label="Retirer le filtre champion">×</a></span>`;
    return;
  }
  const counts = data.champs || {};
  box.innerHTML = `<div class="search-field"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m13 13 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input class="field" id="cfInput" type="search" placeholder="Filtrer par champion" autocomplete="off" aria-label="Filtrer par champion"></div><div class="dd-list" id="cfList" hidden></div>`;
  const input = box.querySelector('#cfInput');
  const list = box.querySelector('#cfList');
  const all = Object.values(S.st.champions);
  const paint = () => {
    const q = norm(input.value);
    const items = all
      .filter((c) => (!q ? counts[c.key] : norm(c.name).includes(q)))
      .sort((a, b) => (counts[b.key] || 0) - (counts[a.key] || 0) || a.name.localeCompare(b.name, LOC))
      .slice(0, 30);
    list.innerHTML = items.length
      ? items.map((c) => `<button type="button" data-c="${c.key}">${champImg(c.key, 26)}${esc(c.name)}<small>${counts[c.key] ? `${counts[c.key]} OTP` : ''}</small></button>`).join('')
      : '<p class="muted small" style="padding:8px">Aucun champion.</p>';
    list.hidden = false;
  };
  input.addEventListener('focus', paint);
  input.addEventListener('input', paint);
  input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 150));
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (b) location.hash = hrefOf({ champ: Number(b.dataset.c) });
  });
}

export { ROLES, pct, roleIcon, store };
