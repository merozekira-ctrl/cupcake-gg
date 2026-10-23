// Accueil : recherche, tier list, classement, dernier patch, nouveautés, favoris, rotation, état du serveur.
import {
  S, api, esc, store, champImg, champOf, champByKey, champHref, crest, rankText, playerHref, profileImg,
  regionOptions, setPlatform, removeRecent, toggleFav, setTitle, loading, ago, roleIcon, roleBar, ROLES,
  wrBadge, proBadge, patchLabel, num, pct,
} from '../core.js';
import { bindOmni } from '../omni.js';
import { tierRows } from './champions.js';

const LADDER_TABS = [
  ['euw1', 'EUW'],
  ['kr', 'KR'],
  ['na1', 'NA'],
];

export async function render(el, _params, ctx) {
  setTitle('');
  const patch = patchLabel(S.st.version);
  el.innerHTML = `
    <section class="hero">
      <div class="hero-logo-wrap" aria-hidden="true"><img class="hero-logo" src="/brand/logo.webp" alt="" width="300" height="213"></div>
      <div class="hero-word" aria-hidden="true">cupcake<span class="brand-tld">.gg</span></div>
      <h1>Profils, builds, matchups et parties en direct. <b>Gratuit, sans compte.</b></h1>
      <div class="hero-search" role="search">
        <svg class="hs-ic" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m13 13 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <label class="sr" for="heroRegion">Région</label>
        <select id="heroRegion" class="hero-region">${regionOptions(S.platform)}</select>
        <label class="sr" for="heroInput">Joueur ou champion</label>
        <input id="heroInput" type="search" placeholder="Rechercher un joueur (Nom#TAG) ou un champion">
        <span class="hero-kbd" aria-hidden="true">Ctrl K</span>
        <ul class="omni-list hero-list" id="heroList" hidden></ul>
      </div>
      <div class="hero-quick">
        <a class="chip" href="#/champions">${roleIcon('MIDDLE', false)}Tier list ${esc(patch)}</a>
        <a class="chip" href="#/matchups">Matchups</a>
        <a class="chip" href="#/otp">Classement OTP</a>
        <a class="chip" href="#/patch">Patch notes ${esc(patch)}</a>
        <button type="button" class="chip" data-try="Ahri">${champImg(103, 22)}Ahri</button>
        <button type="button" class="chip" data-try="Lee Sin">${champImg(64, 22)}Lee Sin</button>
      </div>
      <div class="hero-status" id="status" aria-live="polite"></div>
      ${S.cfg.hasKey ? `<div class="add-games" id="addGames">
        <button class="btn btn-sm" type="button" id="agOpen"><svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>Ajouter 150 parties</button>
        <form class="ag-form" id="agForm" hidden>
          <input type="password" id="agPass" placeholder="Mot de passe" autocomplete="current-password" aria-label="Mot de passe" required>
          <button class="btn btn-sm btn-primary" type="submit">Lancer</button>
        </form>
        <span class="ag-msg" id="agMsg" aria-live="polite"></span>
      </div>` : ''}
    </section>

    <div class="home-cards">
      <section class="panel hc hc-tier" aria-labelledby="h-tier">
        <div class="hc-head"><h2 id="h-tier"><a href="#/champions">Tier list <span id="tierPatch"></span></a></h2><span id="tierRoles"></span></div>
        <div class="hc-body" id="tierPreview">${loading()}</div>
        <div class="hc-foot"><a href="#/champions">Voir la tier list complète</a></div>
      </section>
      <section class="panel hc hc-ladder" aria-labelledby="h-lad">
        <div class="hc-head"><h2 id="h-lad"><a href="#/classement">Classement</a></h2>
          <div class="hc-tabs" role="group" aria-label="Région du classement">${LADDER_TABS.map(([p, l], i) => `<button type="button" data-lad="${p}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>
        </div>
        <div class="hc-body" id="ladPreview">${loading()}</div>
        <div class="hc-foot"><a href="#/classement" id="ladMore">Voir tout le classement</a></div>
      </section>
      <section class="panel hc hc-patch" aria-labelledby="h-patch">
        <div class="hc-head"><h2 id="h-patch"><a href="#/patch">Patch notes</a></h2></div>
        <div class="hc-body" id="patchPreview">${loading()}</div>
        <div class="hc-foot"><a href="#/patch" id="patchMore">Lire toutes les notes du patch</a></div>
      </section>
    </div>

    <div class="home-strip two">
      <a class="feat feat-mu" href="#/matchups">${duelArt()}<span><b>Matchups <span class="nav-new">NEW</span></b><small>Chaque face-à-face analysé, avec les parties des meilleurs joueurs.</small></span></a>
      <a class="feat feat-otp" href="#/otp"><span class="feat-img"><img src="/brand/otp.png" alt=""></span><span><b>Classement OTP</b><small>Les spécialistes d’un seul champion, région par région.</small></span></a>
    </div>

    <div class="home-grid home-duo">
      <section class="panel" aria-labelledby="h-fav">
        <div class="panel-title"><h2 id="h-fav">Favoris</h2></div>
        <div id="favs"></div>
      </section>
      <section class="panel" aria-labelledby="h-rec">
        <div class="panel-title"><h2 id="h-rec">Recherches récentes</h2></div>
        <div id="recents"></div>
      </section>
    </div>`;

  const region = el.querySelector('#heroRegion');
  const input = el.querySelector('#heroInput');
  const omni = bindOmni(input, el.querySelector('#heroList'), {
    region: () => region.value,
    onPick: (href) => {
      location.hash = href;
    },
  });
  region.addEventListener('change', () => {
    setPlatform(region.value);
    loadRegionPanels(el, ctx);
  });
  el.querySelectorAll('[data-try]').forEach((b) =>
    b.addEventListener('click', () => {
      input.value = b.dataset.try;
      input.focus();
      omni.refresh();
    })
  );

  drawPeople(el);
  wireAddGames(el, ctx);
  loadRegionPanels(el, ctx);
  loadLadder(el, ctx, LADDER_TABS[0][0]);
  el.querySelectorAll('[data-lad]').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('[data-lad]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      loadLadder(el, ctx, b.dataset.lad);
    })
  );
  loadPatch(el, ctx);
}

// Deux champions tirés au hasard, fusionnés autour d'une épée.
export const SWORD = '<svg class="sword" viewBox="0 0 64 64" aria-hidden="true"><path fill="#c9cdf0" d="M17.8 37.8 50 5.5 60 4 22 42Z"/><path fill="#99a0d8" d="M22 42 60 4l-1.5 10-32.3 32.2Z"/><rect x="17.5" y="44" width="7" height="14" fill="#e8730c" transform="rotate(45 21 43)"/><rect x="21" y="44" width="3.5" height="14" fill="#c4560a" transform="rotate(45 21 43)"/><rect x="10" y="40" width="22" height="6" rx="3" fill="#f6b51e" transform="rotate(45 21 43)"/><rect x="2.5" y="51.5" width="14" height="6" rx="3" fill="#f6b51e" transform="rotate(45 9.5 54.5)"/></svg>';
export function duelArt(a, b) {
  const all = Object.values(S.st.champions);
  const pick = () => all[Math.floor(Math.random() * all.length)];
  const x = a || pick();
  let y = b || pick();
  while (!b && y.key === x.key) y = pick();
  return `<span class="duel" aria-hidden="true">${champImg(x.key, 40)}${champImg(y.key, 40)}${SWORD}</span>`;
}

/* ---------- Favoris et récents ---------- */

function personRow(x, i, removable) {
  const region = S.cfg.platforms[x.p]?.label || x.p;
  return `<li>
    <a class="person" href="${playerHref(x.p, x.name, x.tag)}">
      ${x.icon != null ? profileImg(x.icon, 34, true) : '<span class="omni-person" aria-hidden="true"></span>'}
      <span class="grow">
        <span class="person-name">${esc(x.name)} <span>#${esc(x.tag)}</span></span>
        <span class="row small muted" style="gap:8px"><span>${esc(region)}</span>${x.rank ? `<span>${rankText(x.rank)}</span>` : ''}</span>
      </span>
      ${x.rank ? crest(x.rank, 'sm') : ''}
    </a>
    <button class="x-btn" type="button" data-i="${i}" aria-label="Retirer ${esc(x.name)} des ${removable ? 'recherches récentes' : 'favoris'}">×</button>
  </li>`;
}

function drawPeople(el) {
  const favs = store.get('favs', []);
  const recents = store.get('recent', []).slice(0, 5);
  el.querySelector('#favs').innerHTML = favs.length
    ? `<ul class="people" id="favList">${favs.map((x, i) => personRow(x, i, false)).join('')}</ul>`
    : `<p class="empty-hint">Ajoute un joueur avec l’étoile « Ajouter aux favoris » de son profil.</p>`;
  el.querySelectorAll('#favList .x-btn').forEach((b) =>
    b.addEventListener('click', () => {
      toggleFav(favs[Number(b.dataset.i)]);
      drawPeople(el);
    })
  );
  const rec = el.querySelector('#recents');
  rec.innerHTML = recents.length
    ? `<ul class="people">${recents.map((x, i) => personRow(x, i, true)).join('')}</ul>`
    : `<p class="empty-hint">Les joueurs que tu consultes apparaîtront ici.</p>`;
  rec.querySelectorAll('.x-btn').forEach((b) =>
    b.addEventListener('click', () => {
      removeRecent(recents[Number(b.dataset.i)]);
      drawPeople(el);
    })
  );
}

/* ---------- Tier list ---------- */

function drawTierPreview(el, meta) {
  const box = el.querySelector('#tierPreview');
  const patches = Object.keys(meta.patches).filter((k) => meta.patches[k].games > 0);
  const patch = patches.includes(meta.current) ? meta.current : patches.sort().reverse()[0];
  const P = patch && meta.patches[patch];
  if (!P || P.games < 10) {
    box.innerHTML = `<p class="empty-hint">Pas encore d’échantillon pour ${esc(S.cfg.platforms[S.platform].label)}. La tier list se calcule sur les parties Challenger et Grand Maître.</p>`;
    return;
  }
  el.querySelector('#tierPatch').textContent = patchLabel(patch);
  let role = store.get('homeRole', 'MIDDLE');
  const paint = () => {
    const rows = tierRows(P, role)
      .filter((r) => r.tier !== '?')
      .slice(0, 5);
    box.innerHTML = rows.length
      ? `<div class="hc-cols"><span>Champion</span><span>Tier</span><span>Winrate</span><span>Pick</span></div>${rows
          .map(
            (r) => `<a class="hc-row" href="${champHref(r.champ, role)}">
              <span class="hc-who">${champImg(r.id, 38)}<span><b>${esc(r.champ.name)}</b><small>${num(r.c.g)} parties</small></span></span>
              <span class="tier tier-${r.tier.replace('+', 'P')}">${r.tier}</span>
              <span class="hc-num">${wrBadge(r.c.w, r.c.g, { d: 1 })}</span>
              <span class="hc-num">${pct(r.pr, 1, 1)}</span>
            </a>`
          )
          .join('')}`
      : '<p class="empty-hint">Pas assez de parties pour ce rôle.</p>';
  };
  const roles = el.querySelector('#tierRoles');
  roles.innerHTML = roleBar(role, { all: false, mini: true });
  roles.querySelectorAll('[data-role]').forEach((b) =>
    b.addEventListener('click', () => {
      role = b.dataset.role;
      store.set('homeRole', role);
      roles.querySelectorAll('[data-role]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      paint();
    })
  );
  paint();
}

/* ---------- Classement ---------- */

async function loadLadder(el, ctx, p) {
  const box = el.querySelector('#ladPreview');
  el.querySelector('#ladMore').href = `#/classement/${p}`;
  if (!S.cfg.hasKey) {
    box.innerHTML = '<p class="empty-hint">Le classement a besoin d’une clé API Riot.</p>';
    return;
  }
  box.innerHTML = loading();
  let data;
  try {
    data = await api(`/ladder/${p}?queue=solo&page=1`);
  } catch (e) {
    if (ctx.alive()) box.innerHTML = `<p class="empty-hint">${esc(e.message)}</p>`;
    return;
  }
  if (!ctx.alive() || el.querySelector('[data-lad][aria-pressed="true"]')?.dataset.lad !== p) return;
  const rows = data.rows.slice(0, 5);
  const draw = () => {
    box.innerHTML = rows.length
      ? `<div class="hc-cols hc-lad"><span>Joueur</span><span>Rang</span><span>Winrate</span></div>${rows
          .map((r) => {
            const who = r.name
              ? `<b>${esc(r.name)}</b><small>${r.pro ? proBadge(r.pro, { link: false }) : '#' + esc(r.tag)}</small>`
              : `<b><span class="skel name-pending"></span></b><small>&nbsp;</small>`;
            const href = r.name ? playerHref(r.p, r.name, r.tag) : `#/classement/${p}`;
            return `<a class="hc-row hc-lad" href="${href}">
              <span class="hc-who"><span class="hc-rank r${r.rank}">${r.rank}</span>${r.icon != null ? profileImg(r.icon, 36) : '<span class="skel ic-skel" style="width:36px;height:36px"></span>'}<span>${who}</span></span>
              <span class="hc-lp">${crest({ tier: r.tier }, 'xs')}${num(r.lp)} LP</span>
              <span class="hc-num">${wrBadge(r.w, r.w + r.l)}</span>
            </a>`;
          })
          .join('')}`
      : '<p class="empty-hint">Classement vide pour le moment.</p>';
  };
  draw();
  const ids = rows.filter((r) => r.puuid && !r.name).map((r) => `${r.p}:${r.puuid}`);
  if (!ids.length) return;
  try {
    const idMap = await api(`/ladder-id?ids=${ids.join(',')}`);
    if (!ctx.alive() || el.querySelector('[data-lad][aria-pressed="true"]')?.dataset.lad !== p) return;
    for (const r of rows) if (idMap[r.puuid]) Object.assign(r, idMap[r.puuid]);
    draw();
  } catch {
    /* noms indisponibles */
  }
}

/* ---------- Dernier patch ---------- */

async function loadPatch(el, ctx) {
  const box = el.querySelector('#patchPreview');
  let list;
  try {
    list = await api('/patches');
  } catch (e) {
    if (ctx.alive()) box.innerHTML = `<p class="empty-hint">${esc(e.message)}</p>`;
    return;
  }
  const cur = list.list.find((x) => x.counts) || list.list[0];
  if (!cur) {
    box.innerHTML = '<p class="empty-hint">Aucun patch connu.</p>';
    return;
  }
  el.querySelector('#patchMore').href = `#/patch/${cur.patch}`;
  let notes = null;
  try {
    notes = await api(`/patch-notes/${cur.patch}${document.documentElement.lang === 'en' ? '?lang=en_US' : ''}`);
  } catch {
    /* notes indisponibles */
  }
  if (!ctx.alive()) return;
  const ents = (notes?.sections || []).filter((s) => /champion/i.test(s.title)).flatMap((s) => s.entries || []);
  const kinds = [
    ['buff', 'Buffs'],
    ['nerf', 'Nerfs'],
    ['adjust', 'Ajustés'],
  ];
  const icon = (e) => {
    const c = champByKey(e.champ || '') || (e.key && champOf(e.key));
    return c ? `<a class="k-${e.kind}" href="#/patch/${cur.patch}?c=${esc(c.id)}" title="${esc(c.name)}">${champImg(c.key, 30)}</a>` : '';
  };
  // Version anglaise : les points clés en français ne sont pas affichés.
  if (notes && document.documentElement.lang === 'en' && notes.lang === 'fr') notes.highlights = [];
  const date = notes?.date || cur.date;
  box.innerHTML = `
    <div class="hp-banner">${notes?.image || cur.image ? `<img src="${esc(notes?.image || cur.image)}" alt="" loading="lazy">` : ''}<b>Patch ${esc(cur.patch)}</b>${date ? `<small>${esc(new Date(date).toLocaleDateString(LOC, { day: 'numeric', month: 'long' }))}</small>` : ''}</div>
    ${ents.length ? `<div class="hp-kinds">${kinds
      .map(([k, l]) => {
        const list2 = ents.filter((e) => e.kind === k);
        return list2.length ? `<div class="hp-kind"><span class="kind kind-${k}">${l} ${list2.length}</span><span class="champs">${list2.slice(0, 7).map(icon).join('')}${list2.length > 7 ? `<span class="muted small">+${list2.length - 7}</span>` : ''}</span></div>` : '';
      })
      .join('')}</div>` : ''}
    ${notes?.highlights?.length ? `<ul class="hp-hl">${notes.highlights.slice(0, 2).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
    ${!ents.length && !notes?.highlights?.length ? `<p class="empty-hint">Les notes détaillées de ce patch ne sont pas encore disponibles. <a href="${esc(cur.url)}" target="_blank" rel="noopener">Notes officielles</a></p>` : ''}`;
}

/* ---------- Panneaux par région ---------- */

async function loadRegionPanels(el, ctx) {
  const p = S.platform;
  const label = S.cfg.platforms[p].label;
  // Rotation gratuite retirée de l'accueil : élément détaché pour garder le code de chargement inoffensif.
  const rot = el.querySelector('#rot') || document.createElement('div');
  const status = el.querySelector('#status');
  const tier = el.querySelector('#tierPreview');
  if (!S.cfg.hasKey) {
    const msg = '<p class="empty-hint">Nécessite une clé API Riot dans le fichier .env.</p>';
    rot.innerHTML = msg;
    status.innerHTML = msg;
    tier.innerHTML = msg;
    return;
  }
  rot.innerHTML = loading();
  status.innerHTML = '';
  tier.innerHTML = loading();
  const fail = (box) => (e) => {
    if (ctx.alive()) box.innerHTML = box === status ? '' : `<p class="empty-hint">${esc(e.message)}</p>`;
  };

  api(`/meta/${p}`)
    .then((m) => {
      if (!ctx.alive() || S.platform !== p) return;
      S.meta[p] = { ...m, _at: Date.now() };
      drawTierPreview(el, m);
    })
    .catch(fail(tier));

  api(`/rotation/${p}`)
    .then((r) => {
      if (!ctx.alive() || S.platform !== p) return;
      const champs = r.free.map((id) => champOf(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, LOC));
      rot.innerHTML = champs.length
        ? `<div class="rotation">${champs.map((c) => `<a href="${champHref(c)}" title="${esc(c.name)}">${champImg(c.key, 44)}<span>${esc(c.name)}</span></a>`).join('')}</div>`
        : '<p class="empty-hint">Aucune rotation publiée pour cette région.</p>';
    })
    .catch(fail(rot));

  api(`/status/${p}${document.documentElement.lang === "en" ? "?lang=en_US" : ""}`)
    .then((s) => {
      if (!ctx.alive() || S.platform !== p) return;
      const first = s.issues[0];
      status.innerHTML = first
        ? `<span class="dot warn" aria-hidden="true"></span><b>${esc(label)}</b><span title="${esc(first.text)}">${esc(first.title || (first.kind === 'maintenance' ? 'Maintenance en cours' : 'Incident en cours'))}${s.issues.length > 1 ? ` (+${s.issues.length - 1})` : ''}</span>`
        : `<span class="dot" aria-hidden="true"></span><b>${esc(label)}</b><span>Serveurs en ligne, aucun incident signalé</span>`;
    })
    .catch(fail(status));
}


/* ---------- Ajout de 150 parties (protégé par mot de passe côté serveur) ---------- */
function wireAddGames(el, ctx) {
  const box = el.querySelector('#addGames');
  if (!box) return;
  const form = box.querySelector('#agForm');
  const msg = box.querySelector('#agMsg');
  const show = (t, cls = '') => {
    msg.className = `ag-msg ${cls}`;
    msg.innerHTML = t;
  };
  let timer = null;
  const poll = async () => {
    clearTimeout(timer);
    if (!ctx.alive()) return;
    const r = await api(`/admin/job/${S.platform}`).catch(() => null);
    const j = r?.job;
    if (j?.running) {
      show(`<span class="spinner"></span>${esc(j.phase || 'Analyse')} : ${j.done} / ${j.target} parties`);
      timer = setTimeout(poll, 4000);
    } else if (j && j.done) show(j.error ? esc(j.error) : `${j.done} parties ajoutées.`, j.error ? 'bad' : 'good');
  };
  box.querySelector('#agOpen').addEventListener('click', () => {
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('input').focus();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input');
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await api(`/admin/add-games/${S.platform}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
      input.value = '';
      form.hidden = true;
      show('<span class="spinner"></span>Analyse lancée…');
      poll();
    } catch (err) {
      show(esc(err.message), 'bad');
    } finally {
      btn.disabled = false;
    }
  });
  poll();
}
