// Matchups « arène » : deux camps (bleu / rouge), recherche de chaque côté, balance des winrates,
// duels populaires et cartes de parties.
import {
  S, api, esc, num, dec, ago, crest, rankText, playerHref, setPlatform, setTitle, loading, errorState, champImg, champOf, champByKey,
  champHref, itemImg, runeImg, spellImg, roleIcon, roleBar, ROLES, ROLE_ORDER, wrBadge, proBadge, regionBadge, scoreRing,
  patchLabel, norm, kdaRatio, kdaText, loadingUrl,
} from '../core.js';

const SWORD = '<svg class="sword" viewBox="0 0 64 64" aria-hidden="true"><path fill="#c9cdf0" d="M17.8 37.8 50 5.5 60 4 22 42Z"/><path fill="#99a0d8" d="M22 42 60 4l-1.5 10-32.3 32.2Z"/><rect x="17.5" y="44" width="7" height="14" fill="#e8730c" transform="rotate(45 21 43)"/><rect x="21" y="44" width="3.5" height="14" fill="#c4560a" transform="rotate(45 21 43)"/><rect x="10" y="40" width="22" height="6" rx="3" fill="#f6b51e" transform="rotate(45 21 43)"/><rect x="2.5" y="51.5" width="14" height="6" rx="3" fill="#f6b51e" transform="rotate(45 9.5 54.5)"/></svg>';
const signed = (v, d = 0) => (v == null ? '–' : `${v > 0 ? '+' : ''}${dec(v, d)}`);
const duel = (a, b, size = 40) => `<span class="duel" style="--ds:${size}px" aria-hidden="true">${champImg(a, size)}${champImg(b, size)}${SWORD}</span>`;

function side(c, which, label) {
  return `<div class="ar-side ar-${which}">
    <div class="ar-art">${c ? `<img src="${esc(loadingUrl(c.id))}" alt="" loading="lazy">` : `<span class="ar-q">?</span>`}</div>
    <div class="ar-info">
      <small>${label}</small>
      <b>${c ? esc(c.name) : 'Choisir'}</b>
      <div class="ar-search">
        <input class="field" type="search" data-side="${which}" placeholder="${c ? 'Changer' : 'Rechercher'} un champion" autocomplete="off" aria-label="${label}">
        <div class="dd-list" hidden></div>
      </div>
      ${c ? `<button type="button" class="link-btn small" data-clear="${which}">Retirer</button>` : ''}
    </div>
  </div>`;
}

function gameCard(g, role) {
  const items = (g.ord?.length ? [...g.ord] : (g.it || []).slice(0, 6)).filter(Boolean).slice(0, 6);
  const who = g.tg ? `<a href="${playerHref(g.p, g.n, g.tg)}">${esc(g.n)}</a>` : `<span>${esc(g.n || 'Joueur')}</span>`;
  const sub = g.pro ? proBadge(g.pro) : `<small>${g.tier ? `${esc(rankText({ tier: g.tier }))}${g.lp != null ? ` · ${num(g.lp)} LP` : ''}` : '#' + esc(g.tg || '')}</small>`;
  return `<article class="dc ${g.w ? 'win' : 'loss'}">
    <header class="dc-top">
      ${duel(g.champ, g.vs || g.champ, 44)}
      <span class="dc-res">${g.w ? 'Victoire' : 'Défaite'}</span>
      ${scoreRing(g.score)}
    </header>
    <div class="dc-who">${g.tier ? crest({ tier: g.tier }, 'sm') : ''}<span class="pl-name">${who}${sub}</span></div>
    <div class="dc-kda"><b>${g.k}</b>/<b class="bad">${g.d}</b>/<b>${g.a}</b><small>${kdaText(kdaRatio(g.k, g.d, g.a))} KDA · ${g.cs} CS</small></div>
    <div class="dc-build">${runeImg(g.ks, 24)}${spellImg(g.s1, 20)}${spellImg(g.s2, 20)}<i></i>${items.map((id) => itemImg(id, 24)).join('')}</div>
    <footer class="dc-foot">${regionBadge(g.p)}<span>${esc(patchLabel(g.patch))}</span><span class="grow"></span><span>${esc(ago(g.t))}</span></footer>
  </article>`;
}

export async function render(el, { p }, ctx) {
  const platform = S.cfg.platforms[p] ? p : S.platform;
  setPlatform(platform);
  const q = ctx.query;
  const st = {
    champ: champByKey(q.champ || '') || null,
    vs: champByKey(q.vs || '') || null,
    role: ROLE_ORDER.includes(q.role) ? q.role : '',
    side: q.side === 'against' ? 'against' : 'with',
  };
  setTitle(st.champ ? `Matchups ${st.champ.name}${st.vs ? ' contre ' + st.vs.name : ''}` : 'Matchups');
  const hrefOf = (o = {}) => {
    const s = { ...st, ...o };
    const qs = new URLSearchParams();
    if (s.champ) qs.set('champ', s.champ.id);
    if (s.vs) qs.set('vs', s.vs.id);
    if (s.role) qs.set('role', s.role);
    if (s.side !== 'with') qs.set('side', s.side);
    const str = qs.toString();
    return `#/matchups/${o.p || platform}${str ? '?' + str : ''}`;
  };

  el.innerHTML = `
    <div class="page-head" style="margin-bottom:14px">
      <div><div class="page-kicker">Matchups</div><h1 class="mu-title">L’arène des <em>matchups</em></h1>
      <p>Place ton champion dans le camp bleu, l’adversaire dans le camp rouge : cupcake.gg te montre qui gagne le duel, l’écart à 15 minutes et les parties des meilleurs joueurs.</p></div>
      <div class="row wrap">${roleBar(st.role || 'ALL')}<select class="select" id="muRegion" aria-label="Région">${Object.entries(S.cfg.platforms)
        .map(([k, v]) => `<option value="${k}"${k === platform ? ' selected' : ''}>${esc(v.label)}</option>`)
        .join('')}</select></div>
    </div>
    <section class="arena">
      ${side(st.champ, 'blue', 'Ton champion')}
      <div class="ar-mid"><span class="ar-sword">${SWORD}</span><b>VS</b><small id="muCount"></small></div>
      ${side(st.vs, 'red', 'Adversaire')}
    </section>
    <div id="muBody">${loading('Lecture des duels…')}</div>`;

  el.querySelector('#muRegion').addEventListener('change', (e) => (location.hash = hrefOf({ p: e.target.value })));
  el.querySelectorAll('.page-head [data-role]').forEach((b) =>
    b.addEventListener('click', () => (location.hash = hrefOf({ role: b.dataset.role === 'ALL' ? '' : b.dataset.role })))
  );
  el.querySelectorAll('[data-clear]').forEach((b) =>
    b.addEventListener('click', () => (location.hash = b.dataset.clear === 'blue' ? hrefOf({ champ: st.vs, vs: null }) : hrefOf({ vs: null })))
  );
  // Recherche de champion de chaque côté.
  el.querySelectorAll('.ar-search').forEach((box) => {
    const input = box.querySelector('input');
    const list = box.querySelector('.dd-list');
    const which = input.dataset.side;
    const paint = () => {
      const qn = norm(input.value);
      const items = Object.values(S.st.champions)
        .filter((c) => !qn || norm(c.name).includes(qn))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        .slice(0, 40);
      list.innerHTML = items.map((c) => `<button type="button" data-c="${esc(c.id)}">${champImg(c.key, 26)}${esc(c.name)}</button>`).join('');
      list.hidden = false;
    };
    input.addEventListener('focus', paint);
    input.addEventListener('input', paint);
    input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') list.querySelector('[data-c]')?.click();
    });
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      const c = champByKey(b.dataset.c);
      location.hash = which === 'blue' ? hrefOf({ champ: c, vs: st.vs?.key === c.key ? null : st.vs }) : st.champ ? hrefOf({ vs: c }) : hrefOf({ champ: c });
    });
  });

  const body = el.querySelector('#muBody');
  if (!S.cfg.hasKey) {
    body.innerHTML = '<div class="panel state"><p>Les matchups ont besoin d’une clé API Riot.</p></div>';
    return;
  }
  let data;
  try {
    const qs = new URLSearchParams({ side: st.side });
    if (st.champ) qs.set('champ', st.champ.key);
    if (st.vs) qs.set('vs', st.vs.key);
    if (st.role) qs.set('role', st.role);
    data = await api(`/matchup/${platform}?${qs}`);
  } catch (e) {
    if (ctx.alive()) body.innerHTML = errorState(e);
    return;
  }
  if (!ctx.alive()) return;
  const role = data.role || st.role || '';
  el.querySelector('#muCount').textContent = data.games ? `${num(data.games)} parties · patch ${patchLabel(data.patch)}` : '';
  const c = st.champ;
  const v = st.vs;
  const parts = [];

  // Balance du duel.
  if (c && v && data.summary) {
    const s = data.summary;
    const wr = s.g ? (s.w / s.g) * 100 : 50;
    parts.push(`<section class="panel balance">
      <div class="bal-head"><span class="bal-c blue">${champImg(c.key, 40)}<b>${esc(c.name)}</b></span><span class="muted small">${s.g ? `${num(s.g)} duel${s.g > 1 ? 's' : ''} en ${esc((ROLES[role] || '').toLowerCase())}` : 'Aucun duel dans l’échantillon'}</span><span class="bal-c red"><b>${esc(v.name)}</b>${champImg(v.key, 40)}</span></div>
      <div class="bal-bar" role="img" aria-label="${esc(c.name)} gagne ${Math.round(wr)} % des duels"><i class="b" style="width:${wr.toFixed(1)}%"></i><i class="r"></i><span class="bl">${s.g ? Math.round(wr) + ' %' : '–'}</span><span class="br">${s.g ? Math.round(100 - wr) + ' %' : '–'}</span></div>
      <div class="bal-stats">
        <div><small>KDA moyen de ${esc(c.name)}</small><b>${s.n ? `${dec(s.k, 1)} / ${dec(s.d, 1)} / ${dec(s.a, 1)}` : '–'}</b></div>
        <div><small>CS par minute</small><b>${s.n ? dec(s.cs, 1) : '–'}</b></div>
        <div><small>Écart d’or à 15 min</small><b class="${s.gd15 > 0 ? 'good' : s.gd15 < 0 ? 'bad' : ''}">${signed(s.gd15)}</b></div>
        <div><small>Écart de CS à 15 min</small><b class="${s.csd15 > 0 ? 'good' : s.csd15 < 0 ? 'bad' : ''}">${signed(s.csd15, 1)}</b></div>
      </div>
      ${s.items?.length ? `<div class="bal-build"><span class="sum-label">Build gagnant contre ${esc(v.name)}</span><span class="items-row">${s.items.map(([id]) => itemImg(id, 34)).join('')}</span>${s.keystones?.length ? `<span class="items-row">${s.keystones.map(([id]) => runeImg(id, 32)).join('')}</span>` : ''}</div>` : ''}
    </section>`);
  }
  // Adversaires du champion choisi.
  if (c && !v && data.opponents?.length) {
    parts.push(`<section class="pn-sec"><div class="pn-sec-head"><h2>Adversaires de ${esc(c.name)}</h2><span>clique pour ouvrir le duel</span></div>
      <div class="duel-grid">${data.opponents
        .slice(0, 12)
        .map((o) => {
          const oc = champOf(o.id);
          return oc ? `<a class="duel-tile" href="${hrefOf({ vs: oc })}">${duel(c.key, o.id, 46)}<span><b>${esc(oc.name)}</b><small>${o.g} duel${o.g > 1 ? 's' : ''}</small></span>${wrBadge(o.w, o.g)}</a>` : '';
        })
        .join('')}</div></section>`);
  }
  // Duels populaires (aucun champion choisi).
  if (!c && data.popular?.length) {
    parts.push(`<section class="pn-sec"><div class="pn-sec-head"><h2>Duels les plus joués</h2><span>${role ? esc(ROLES[role]) : 'tous rôles'}</span></div>
      <div class="duel-grid">${data.popular
        .map((x) => {
          const a = champOf(x.a);
          const b = champOf(x.b);
          return a && b ? `<a class="duel-tile" href="${hrefOf({ champ: a, vs: b, role: x.role })}">${duel(x.a, x.b, 46)}<span><b>${esc(a.name)} <span class="muted">vs</span> ${esc(b.name)}</b><small>${x.g} duel${x.g > 1 ? 's' : ''} · ${esc(ROLES[x.role] || '')}</small></span>${wrBadge(x.w, x.g)}</a>` : '';
        })
        .join('')}</div></section>`);
  }
  const title = c ? (st.side === 'with' ? `Parties de ${esc(c.name)}${v ? ` contre ${esc(v.name)}` : ''}` : `Parties contre ${esc(c.name)}`) : 'Dernières parties';
  parts.push(`<section class="pn-sec">
    <div class="pn-sec-head"><h2>${title}</h2><span>${data.rows.length}</span>${c ? `<nav class="seg" aria-label="Point de vue" style="margin-left:auto"><a href="${hrefOf({ side: 'with' })}"${st.side === 'with' ? ' aria-current="page"' : ''}>Avec ${esc(c.name)}</a><a href="${hrefOf({ side: 'against' })}"${st.side === 'against' ? ' aria-current="page"' : ''}>Contre ${esc(c.name)}</a></nav>` : ''}</div>
    ${data.rows.length ? `<div class="dc-grid">${data.rows.slice(0, 30).map((g) => gameCard(g, role)).join('')}</div>` : `<div class="panel state"><p class="state-title">Aucune partie pour ce duel</p><p>${S.cfg.demo ? 'La démonstration ne contient que 150 parties : essaie un champion plus joué.' : 'Essaie un autre rôle : l’échantillon grossit à chaque analyse.'}</p></div>`}
  </section>
  <p class="muted small" style="margin-top:12px">Note sur 100 : KDA, farm par minute, participation et résultat. Parties classées Solo/Duo des joueurs Challenger et Grand Maître.</p>`);
  body.innerHTML = parts.join('');
}

export { roleIcon };
