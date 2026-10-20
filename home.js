// Accueil : recherche unifiée, aperçu de la tier list, rotation, favoris, récents, état du serveur.
import {
  S, api, esc, DEMO_NOTE, store, champImg, champOf, champHref, crest, rankText, playerHref, profileImg, pct,
  regionOptions, setPlatform, removeRecent, setTitle, loading, ago, roleIcon, ROLES, ROLE_ORDER,
} from '../core.js';
import { bindOmni } from '../omni.js';
import { tierRows } from './champions.js';

export async function render(el, _params, ctx) {
  setTitle('');
  el.innerHTML = `
    <section class="hero">
      <div class="hero-logo-wrap" aria-hidden="true"><img class="hero-logo" src="/brand/logo.webp" alt="" width="240" height="235"></div>
      <p class="hero-kicker">Patch ${esc(S.st.version.split('.').slice(0, 2).join('.'))}</p>
      <h1>Toute la Faille, en un coup d’œil</h1>
      <p class="hero-sub">Profils, historique détaillé, partie en direct et builds des meilleurs joueurs du patch actuel.</p>
      <div class="hero-search" role="search">
        <label class="sr" for="heroRegion">Région</label>
        <select id="heroRegion" class="hero-region">${regionOptions(S.platform)}</select>
        <label class="sr" for="heroInput">Joueur ou champion</label>
        <input id="heroInput" type="search" placeholder="Nom#TAG ou champion">
        <span class="hero-kbd" aria-hidden="true">Entrée</span>
        <ul class="omni-list hero-list" id="heroList" hidden></ul>
      </div>
      <p class="hero-hint">Exemples : <button type="button" class="link-btn" data-try="Ahri">Ahri</button>, <button type="button" class="link-btn" data-try="Lee Sin">Lee Sin</button>, ou un Riot ID comme <kbd>Pseudo#EUW</kbd>. Raccourci : <kbd>Ctrl K</kbd> depuis n’importe quelle page.</p>
    </section>

    ${S.cfg.demo ? `<div class="demo-note" role="note"><strong>Maquette en attente de validation Riot</strong><p>${esc(DEMO_NOTE)}</p></div>` : ''}
    <div class="home-grid">
      <section class="panel card-accent" aria-labelledby="h-tier">
        <div class="panel-title"><h2 id="h-tier">Meilleurs champions du patch</h2><a class="small" href="#/champions">Tier list complète</a></div>
        <div id="tierPreview">${loading()}</div>
      </section>
      <div class="stack">
        <section class="panel" aria-labelledby="h-fav">
          <div class="panel-title"><h2 id="h-fav">Favoris</h2></div>
          <div id="favs"></div>
        </section>
        <section class="panel" aria-labelledby="h-rec">
          <div class="panel-title"><h2 id="h-rec">Recherches récentes</h2></div>
          <div id="recents"></div>
        </section>
      </div>
      <div class="stack">
        <section class="panel" aria-labelledby="h-rot">
          <div class="panel-title"><h2 id="h-rot">Rotation gratuite</h2><span class="muted small" id="rotRegion"></span></div>
          <div id="rot">${loading()}</div>
        </section>
        <section class="panel" aria-labelledby="h-st">
          <div class="panel-title"><h2 id="h-st">État du serveur</h2><span class="muted small" id="stRegion"></span></div>
          <div id="status">${loading()}</div>
        </section>
      </div>
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
  loadRegionPanels(el, ctx);
}

function personRow(x, i, removable) {
  const region = S.cfg.platforms[x.p]?.label || x.p;
  return `<li>
    <a class="person" href="${playerHref(x.p, x.name, x.tag)}">
      ${x.icon != null ? profileImg(x.icon, 32, true) : ''}
      <span class="grow">
        <span class="person-name">${esc(x.name)} <span>#${esc(x.tag)}</span></span>
        <span class="row small muted" style="gap:10px"><span>${esc(region)}</span>${x.rank ? `<span>${rankText(x.rank)}</span>` : ''}</span>
      </span>
      ${x.rank ? crest(x.rank, 'sm') : ''}
    </a>
    ${removable ? `<button class="x-btn" type="button" data-i="${i}" aria-label="Retirer ${esc(x.name)} des recherches récentes">×</button>` : ''}
  </li>`;
}

function drawPeople(el) {
  const favs = store.get('favs', []);
  const recents = store.get('recent', []).slice(0, 5);
  el.querySelector('#favs').innerHTML = favs.length
    ? `<ul class="people">${favs.map((x, i) => personRow(x, i, false)).join('')}</ul>`
    : `<p class="muted small pad">Ajoute un joueur avec le bouton « Ajouter aux favoris » de son profil.</p>`;
  const rec = el.querySelector('#recents');
  rec.innerHTML = recents.length
    ? `<ul class="people">${recents.map((x, i) => personRow(x, i, true)).join('')}</ul>`
    : `<p class="muted small pad">Les joueurs que tu consultes apparaîtront ici.</p>`;
  rec.querySelectorAll('.x-btn').forEach((b) =>
    b.addEventListener('click', () => {
      removeRecent(recents[Number(b.dataset.i)]);
      drawPeople(el);
    })
  );
}

function drawTierPreview(box, meta) {
  const patch = meta.patches[meta.current] ? meta.current : Object.keys(meta.patches)[0];
  const P = patch && meta.patches[patch];
  if (!P || P.games < 10) {
    box.innerHTML = `<div class="pad stack" style="gap:10px">
      <p class="muted small">Aucun échantillon pour ${esc(S.cfg.platforms[S.platform].label)} sur ce patch. cupcake.gg lit les parties classées des joueurs Challenger et Grand Maître pour calculer winrates et builds.</p>
      <a class="btn btn-primary" href="#/champions">Lancer l’analyse</a>
    </div>`;
    return;
  }
  box.innerHTML = `<div class="tier-preview">${ROLE_ORDER.map((role) => {
    const rows = tierRows(P, role).filter((r) => r.tier !== '?').slice(0, 3);
    return `<div class="tp-role"><div class="tp-head">${roleIcon(role, false)}<span>${ROLES[role]}</span></div>${rows
      .map(
        (r) => `<a class="tp-row" href="${champHref(r.champ, role)}" title="${esc(r.champ.name)}, tier ${r.tier}, ${pct(r.c.w, r.c.g, 1)} de victoires"><span class="tp-ic">${champImg(r.id, 36)}<span class="tier tier-${r.tier}">${r.tier}</span></span><span class="tp-txt"><span class="tp-name">${esc(r.champ.name)}</span><b class="${r.wr >= 0.5 ? 'good' : 'bad'}">${pct(r.c.w, r.c.g, 1)}</b></span></a>`
      )
      .join('') || '<p class="muted small">Pas assez de parties.</p>'}</div>`;
  }).join('')}</div>
  <p class="muted small pad">Patch ${esc(patch)}, ${P.games} parties Challenger et Grand Maître sur ${esc(S.cfg.platforms[S.platform].label)}.</p>`;
}

async function loadRegionPanels(el, ctx) {
  const p = S.platform;
  const label = S.cfg.platforms[p].label;
  el.querySelector('#rotRegion').textContent = label;
  el.querySelector('#stRegion').textContent = label;
  const rot = el.querySelector('#rot');
  const status = el.querySelector('#status');
  const tier = el.querySelector('#tierPreview');
  if (!S.cfg.hasKey) {
    const msg = '<p class="muted small pad">Nécessite une clé API Riot dans le fichier .env.</p>';
    rot.innerHTML = msg;
    status.innerHTML = msg;
    tier.innerHTML = msg;
    return;
  }
  rot.innerHTML = loading();
  status.innerHTML = loading();
  tier.innerHTML = loading();
  const fail = (box) => (e) => {
    if (ctx.alive()) box.innerHTML = `<p class="small bad pad">${esc(e.message)}</p>`;
  };

  api(`/meta/${p}`)
    .then((m) => {
      if (!ctx.alive() || S.platform !== p) return;
      S.meta[p] = { ...m, _at: Date.now() };
      drawTierPreview(tier, m);
    })
    .catch(fail(tier));

  api(`/rotation/${p}`)
    .then((r) => {
      if (!ctx.alive() || S.platform !== p) return;
      const champs = r.free.map((id) => champOf(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      rot.innerHTML = champs.length
        ? `<div class="rotation">${champs.map((c) => `<a href="${champHref(c)}" title="${esc(c.name)}">${champImg(c.key, 40)}<span>${esc(c.name)}</span></a>`).join('')}</div>`
        : '<p class="muted small pad">Aucune rotation publiée pour cette région.</p>';
    })
    .catch(fail(rot));

  api(`/status/${p}`)
    .then((s) => {
      if (!ctx.alive() || S.platform !== p) return;
      status.innerHTML = s.issues.length
        ? s.issues
            .map(
              (x) =>
                `<div class="issue"><strong>${esc(x.title || (x.kind === 'maintenance' ? 'Maintenance' : 'Incident'))}</strong>${esc(x.text)}${x.at ? `<div class="muted small">${ago(new Date(x.at).getTime())}</div>` : ''}</div>`
            )
            .join('')
        : `<div class="status-ok"><span class="dot" aria-hidden="true"></span><span>Aucun incident signalé sur ${esc(label)}.</span></div>`;
    })
    .catch(fail(status));
}
