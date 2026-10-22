// Matchups : champion contre adversaire, statistiques du face-à-face et parties des meilleurs joueurs.
import {
  S, api, esc, num, dec, ago, crest, rankText, playerHref, setPlatform, setTitle, loading, errorState, champImg, champOf, champByKey,
  champHref, itemImg, runeImg, spellImg, roleIcon, roleBar, ROLES, ROLE_ORDER, wrBadge, proBadge, regionBadge, scoreRing,
  patchLabel, norm, kdaRatio, kdaText,
} from '../core.js';

const SWORDS = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M3 3h4l9.5 9.5-2 2L5 5V3Zm18 0h-4l-5 5 2 2 5-5V3ZM5.6 14.6l3.8 3.8-1.6 1.6-1.1-1.1L4 21.6 2.4 20l2.7-2.7L4 16.2Zm12.8 0 1.6 1.6-1.1 1.1 2.7 2.7-1.6 1.6-2.7-2.7-1.1 1.1-1.6-1.6Z" fill="currentColor"/></svg>';

function gameRow(g, role, side) {
  const items = (g.ord?.length ? [...g.ord] : (g.it || []).slice(0, 6)).filter(Boolean).slice(0, 6);
  const who = g.tg
    ? `<a href="${playerHref(g.p, g.n, g.tg)}">${esc(g.n)}</a>`
    : `<span>${esc(g.n || 'Joueur')}</span>`;
  const sub = g.pro ? proBadge(g.pro) : `<small class="muted">${g.tier ? `${esc(rankText({ tier: g.tier }))}${g.lp != null ? ` ${num(g.lp)} LP` : ''}` : '#' + esc(g.tg || '')}</small>`;
  const me = champOf(g.champ);
  return `<div class="mg ${g.w ? 'win' : 'loss'}">
    <div class="mg-when"><b>${esc(ago(g.t))}</b><span class="row" style="gap:6px">${regionBadge(g.p)}<span>${esc(patchLabel(g.patch))}</span></span></div>
    <div class="mg-champs" title="${esc(me?.name || '')} contre ${esc(champOf(g.vs)?.name || '?')}">
      <a class="me" href="${me ? champHref(me, role) : '#/champions'}">${champImg(g.champ, 46)}${role ? roleIcon(role, false) : ''}</a>
      <span class="x">VS</span>
      <span class="opp">${g.vs ? champImg(g.vs, 34) : ''}</span>
    </div>
    <div class="mg-who">${g.tier ? crest({ tier: g.tier }, 'sm') : ''}<span class="pl-name">${who}${sub}</span></div>
    <div class="mg-runes">${runeImg(g.ks, 26)}${runeImg(g.ss, 18, true)}<i></i>${spellImg(g.s1, 22)}${spellImg(g.s2, 22)}</div>
    <div class="mg-items">${g.bt ? itemImg(g.bt, 28) : ''}${items.map((id) => itemImg(id, 28)).join('')}</div>
    <div class="mg-kda">${g.k} / <span class="d">${g.d}</span> / ${g.a}<small>${kdaText(kdaRatio(g.k, g.d, g.a))} KDA · ${g.cs} CS</small></div>
    ${scoreRing(g.score)}
  </div>`;
}

const signed = (v, d = 0) => (v == null ? '–' : `${v > 0 ? '+' : ''}${dec(v, d)}`);

export async function render(el, { p }, ctx) {
  const platform = S.cfg.platforms[p] ? p : S.platform;
  setPlatform(platform);
  const q = ctx.query;
  const st = {
    champ: champByKey(q.champ || '') || null,
    vs: champByKey(q.vs || '') || null,
    role: ROLE_ORDER.includes(q.role) ? q.role : '',
    side: q.side === 'against' ? 'against' : 'with',
    slot: 'champ',
    search: '',
  };
  st.slot = st.champ && !st.vs ? 'vs' : 'champ';
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
    <section class="mu-hero">
      <div>
        <div class="page-kicker">Matchups</div>
        <h1 class="mu-title">Chaque matchup,<br><em>décortiqué.</em></h1>
        <p class="mu-lead">Choisis ton champion puis ton adversaire : winrate du face-à-face, écart à 15 minutes, build gagnant et parties des meilleurs joueurs.</p>
        <p class="mu-count" id="muCount">&nbsp;</p>
        <div class="mu-vs-art" id="muArt"></div>
      </div>
      <div class="panel picker">
        <div class="slots">
          <button type="button" class="slot me" data-slot="champ"></button>
          <span class="slots-vs">${SWORDS}</span>
          <button type="button" class="slot vs" data-slot="vs"></button>
        </div>
        <div class="picker-tools">
          ${roleBar(st.role || 'ALL')}
          <div class="search-field"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m13 13 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input class="field" id="muSearch" type="search" placeholder="Rechercher un champion" autocomplete="off" aria-label="Rechercher un champion"></div>
          <label class="sr" for="muRegion">Région</label>
          <select class="select" id="muRegion">${Object.entries(S.cfg.platforms)
            .map(([k, v]) => `<option value="${k}"${k === platform ? ' selected' : ''}>${esc(v.label)}</option>`)
            .join('')}</select>
        </div>
        <div class="cgrid" id="cgrid" role="listbox" aria-label="Champions"></div>
      </div>
    </section>
    <div id="muBody">${loading('Lecture des face-à-face…')}</div>`;

  const body = el.querySelector('#muBody');
  el.querySelector('#muRegion').addEventListener('change', (e) => {
    location.hash = hrefOf({ p: e.target.value });
  });
  el.querySelectorAll('.picker [data-role]').forEach((b) =>
    b.addEventListener('click', () => {
      location.hash = hrefOf({ role: b.dataset.role === 'ALL' ? '' : b.dataset.role });
    })
  );

  if (!S.cfg.hasKey) {
    body.innerHTML = '<div class="panel state"><p>Les matchups ont besoin d’une clé API Riot.</p></div>';
    return;
  }
  let data;
  let meta;
  try {
    const qs = new URLSearchParams({ side: st.side });
    if (st.champ) qs.set('champ', st.champ.key);
    if (st.vs) qs.set('vs', st.vs.key);
    if (st.role) qs.set('role', st.role);
    [data, meta] = await Promise.all([api(`/matchup/${platform}?${qs}`), S.meta[platform] ? Promise.resolve(S.meta[platform]) : api(`/meta/${platform}`)]);
  } catch (e) {
    if (ctx.alive()) body.innerHTML = errorState(e);
    return;
  }
  if (!ctx.alive()) return;
  S.meta[platform] = { ...meta, _at: Date.now() };
  const role = data.role || st.role || '';
  el.querySelector('#muCount').innerHTML = data.games
    ? `<b>${num(data.games)}</b> parties Challenger et Grand Maître analysées · patch ${esc(patchLabel(data.patch))}`
    : 'Aucune partie analysée pour cette région.';

  // Champions présents dans l'échantillon pour le rôle choisi (les autres sont grisés).
  const P = meta.patches?.[data.patch];
  const present = {};
  for (const [k, c] of Object.entries(P?.champs || {})) {
    const [id, r] = k.split('|');
    if (!role || r === role) present[id] = (present[id] || 0) + c.g;
  }
  const opp = Object.fromEntries((data.opponents || []).map((o) => [o.id, o]));

  const drawSlots = () => {
    const slot = (c, label, which) => {
      const btn = el.querySelector(`.slot[data-slot="${which}"]`);
      btn.classList.toggle('active', st.slot === which);
      btn.innerHTML = `${c ? champImg(c.key, 56) : '<span class="ph">?</span>'}<span><small>${label}</small><b>${c ? esc(c.name) : 'Choisir'}</b></span>${c ? `<span class="x-btn" role="button" tabindex="0" data-clear="${which}" aria-label="Retirer ${esc(c.name)}">×</span>` : ''}`;
    };
    slot(st.champ, 'Champion', 'champ');
    slot(st.vs, 'Adversaire', 'vs');
  };
  const drawGrid = () => {
    const qn = norm(st.search);
    const list = Object.values(S.st.champions)
      .filter((c) => !qn || norm(c.name).includes(qn))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const choosingVs = st.slot === 'vs' && st.champ;
    el.querySelector('#cgrid').innerHTML = list
      .map((c) => {
        const n = choosingVs ? opp[c.key]?.g || 0 : present[c.key] || 0;
        const sel = (st.champ && st.champ.key === c.key) || (st.vs && st.vs.key === c.key);
        return `<button type="button" role="option" aria-selected="${!!sel}" class="${sel ? 'sel' : ''}${n ? '' : ' dim'}" data-c="${esc(c.id)}" title="${esc(c.name)}${n ? ` · ${n} partie${n > 1 ? 's' : ''}` : ''}">${champImg(c.key, 50)}${n && choosingVs ? `<span class="n">${n}</span>` : ''}</button>`;
      })
      .join('');
  };
  drawSlots();
  drawGrid();
  el.querySelectorAll('.slot').forEach((b) =>
    b.addEventListener('click', (e) => {
      const clear = e.target.closest('[data-clear]');
      if (clear) {
        const which = clear.dataset.clear;
        location.hash = hrefOf(which === 'champ' ? { champ: st.vs, vs: null } : { vs: null });
        return;
      }
      st.slot = b.dataset.slot;
      drawSlots();
      drawGrid();
    })
  );
  el.querySelector('#cgrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    const c = champByKey(b.dataset.c);
    if (st.slot === 'vs' && st.champ) location.hash = hrefOf({ vs: c.key === st.champ.key ? null : c });
    else location.hash = hrefOf({ champ: c, vs: st.vs && st.vs.key !== c.key ? st.vs : null });
  });
  el.querySelector('#muSearch').addEventListener('input', (e) => {
    st.search = e.target.value.trim();
    drawGrid();
  });

  // Illustration : les deux champions face à face.
  el.querySelector('#muArt').innerHTML = st.champ
    ? `${champImg(st.champ.key, 72)}<span>VS</span>${st.vs ? champImg(st.vs.key, 72) : '<span class="slot"><span class="ph">?</span></span>'}`
    : '';

  /* ----- Corps : résumé, adversaires, parties ----- */
  const c = st.champ;
  const v = st.vs;
  const parts = [];
  if (c && v && data.summary) {
    const s = data.summary;
    const ratio = s.g ? s.w / s.g : 0;
    parts.push(`<section class="panel mu-summary card-accent">
      <div class="mu-faces">
        <a class="face" href="${champHref(c, role)}">${champImg(c.key, 72)}${esc(c.name)}</a>
        <span class="vs">VS</span>
        <a class="face" href="${champHref(v, role)}">${champImg(v.key, 72)}${esc(v.name)}</a>
      </div>
      <div>
        <div class="mu-stats">
          <div class="mu-stat"><small>Winrate de ${esc(c.name)}</small>${s.g ? wrBadge(s.w, s.g, { lg: true, d: 1 }) : '<b>–</b>'}</div>
          <div class="mu-stat"><small>Face-à-face</small><b>${num(s.g)}</b></div>
          <div class="mu-stat"><small>KDA moyen</small><b>${s.n ? `${dec(s.k, 1)}/${dec(s.d, 1)}/${dec(s.a, 1)}` : '–'}</b></div>
          <div class="mu-stat"><small>CS / min</small><b>${s.n ? dec(s.cs, 1) : '–'}</b></div>
          <div class="mu-stat"><small>Écart d’or à 15 min</small><b class="${s.gd15 > 0 ? 'good' : s.gd15 < 0 ? 'bad' : ''}">${signed(s.gd15)}</b></div>
          <div class="mu-stat"><small>Écart de CS à 15 min</small><b class="${s.csd15 > 0 ? 'good' : s.csd15 < 0 ? 'bad' : ''}">${signed(s.csd15, 1)}</b></div>
        </div>
        ${s.items?.length ? `<div class="mu-build"><span class="muted small">Objets les plus construits</span><span class="items-row">${s.items.map(([id]) => itemImg(id, 34)).join('')}</span>${s.keystones?.length ? `<span class="muted small">Runes</span><span class="items-row">${s.keystones.map(([id]) => runeImg(id, 32)).join('')}</span>` : ''}${s.spells?.length ? `<span class="items-row">${s.spells[0][0].split('-').map((x) => spellImg(Number(x), 28)).join('')}</span>` : ''}</div>` : ''}
        ${!s.g ? `<p class="muted small" style="margin-top:10px">${esc(c.name)} et ${esc(v.name)} ne se sont pas encore affrontés en ${esc((ROLES[role] || '').toLowerCase())} dans l’échantillon.</p>` : ''}
        ${s.gd15 == null && s.g ? '<p class="muted small" style="margin-top:10px">Les écarts à 15 minutes apparaîtront avec les prochaines parties analysées (chronologie complète).</p>' : ''}
      </div>
    </section>`);
  }
  if (c && data.opponents?.length) {
    const top = data.opponents.slice(0, 18);
    parts.push(`<section class="panel" style="margin-bottom:16px">
      <div class="panel-title"><h2>Adversaires de ${esc(c.name)} ${role ? `en ${esc(ROLES[role].toLowerCase())}` : ''}</h2><span class="muted small">Winrate de ${esc(c.name)} contre chaque champion</span></div>
      <div class="mu-opps">${top
        .map((o) => {
          const oc = champOf(o.id);
          return oc ? `<a class="mu-opp" href="${hrefOf({ vs: oc })}">${champImg(o.id, 30)}${esc(oc.name)}${wrBadge(o.w, o.g)}<small>${o.g} p.</small></a>` : '';
        })
        .join('')}</div>
    </section>`);
  }
  const title = c
    ? st.side === 'with'
      ? `Parties de ${esc(c.name)}${v ? ` contre ${esc(v.name)}` : ''}`
      : `Parties contre ${esc(c.name)}${v ? ` avec ${esc(v.name)}` : ''}`
    : `Parties récentes${role ? ` en ${esc(ROLES[role].toLowerCase())}` : ''}`;
  parts.push(`<div class="toolbar">
      <h2 style="font-size:20px">${title} <span class="muted small" style="font-family:var(--font-ui)">${data.rows.length}</span></h2>
      ${c ? `<nav class="seg side-seg" aria-label="Point de vue">
        <a href="${hrefOf({ side: 'with' })}"${st.side === 'with' ? ' aria-current="page"' : ''}>Avec ${esc(c.name)}</a>
        <a href="${hrefOf({ side: 'against' })}"${st.side === 'against' ? ' aria-current="page"' : ''}>Contre ${esc(c.name)}</a>
      </nav>` : ''}
    </div>
    ${data.rows.length ? `<div class="mg-list">${data.rows.map((g) => gameRow(g, role, st.side)).join('')}</div>` : `<div class="panel state"><p class="state-title">Aucune partie pour ce matchup</p><p>${S.cfg.demo ? 'La démonstration ne contient que 150 parties : essaie un champion plus joué ou retire l’adversaire.' : 'Essaie un autre rôle ou retire l’adversaire : l’échantillon grossit à chaque analyse.'}</p></div>`}
    <p class="muted small" style="margin-top:12px">Note sur 100 calculée à partir du KDA, du farm par minute, de la participation et du résultat. Parties classées Solo/Duo des joueurs Challenger et Grand Maître.</p>`);
  body.innerHTML = parts.join('');
}
