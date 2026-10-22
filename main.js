// Point d'entrée : thème, recherche rapide, routeur.
import { S, api, store, errorState, loading, setPlatform, regionOptions, fallbackCrest } from './core.js';
import { bindOmni } from './omni.js';
import * as Home from './views/home.js';
import * as Profile from './views/profile.js';
import * as Champions from './views/champions.js';
import * as Ladder from './views/ladder.js';
import * as Multi from './views/multi.js';
import * as Wiki from './views/wiki.js';
import * as Otp from './views/otp.js';
import * as Matchups from './views/matchups.js';
import * as Patch from './views/patch.js';

const view = document.getElementById('view');
let cleanup = null;
let lastKey = null;

/* ---------- Thème ---------- */

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('themeBtn');
  const label = t === 'dark' ? 'Activer le thème clair' : 'Activer le thème sombre';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}
document.getElementById('themeBtn').addEventListener('click', () => {
  const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(t);
  try {
    localStorage.setItem('rs-theme', t);
  } catch {
    /* stockage indisponible */
  }
});

// Une icône introuvable laisse une case neutre au lieu d'une image cassée.
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    // Emblème de rang indisponible : on revient à l'écusson dessiné.
    if (img.classList.contains('rank-img')) {
      const box = img.closest('.emb');
      const size = (box.className.match(/emb-(\w+)/) || [])[1] || 'md';
      box.outerHTML = fallbackCrest(box.dataset.tier, box.dataset.div, size);
      return;
    }
    img.classList.add('broken');
  },
  true
);

/* ---------- Menu « Classements » ---------- */

const dd = document.getElementById('navRank');
const ddBtn = dd.querySelector('button');
const setDd = (open) => {
  dd.classList.toggle('open', open);
  ddBtn.setAttribute('aria-expanded', String(open));
};
ddBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setDd(!dd.classList.contains('open'));
});
dd.addEventListener('mouseenter', () => window.matchMedia('(hover: hover)').matches && setDd(true));
dd.addEventListener('mouseleave', () => window.matchMedia('(hover: hover)').matches && setDd(false));
dd.addEventListener('click', (e) => {
  if (e.target.closest('a')) setDd(false);
});
document.addEventListener('click', (e) => {
  if (!dd.contains(e.target)) setDd(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dd.classList.contains('open')) {
    setDd(false);
    ddBtn.focus();
  }
});

/* ---------- Recherche (palette Ctrl+K) ---------- */

const dialog = document.getElementById('omniDialog');
let palette = null;

export function openPalette(text = '') {
  if (!S.st) return;
  const input = document.getElementById('paletteInput');
  document.getElementById('paletteRegion').value = S.platform;
  input.value = text;
  if (!dialog.open) dialog.showModal();
  input.focus();
  palette.refresh();
}

function wireSearch() {
  const sel = document.getElementById('paletteRegion');
  sel.innerHTML = regionOptions(S.platform);
  sel.addEventListener('change', () => {
    setPlatform(sel.value);
    palette.refresh();
  });
  palette = bindOmni(document.getElementById('paletteInput'), document.getElementById('paletteList'), {
    region: () => sel.value,
    keepOpen: true,
    closeOnEscape: false,
    onPick: (href) => {
      dialog.close();
      location.hash = href;
    },
  });
  document.getElementById('omniOpen').addEventListener('click', () => openPalette());
  document.getElementById('omniClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
      e.preventDefault();
      openPalette();
    }
  });
}

/* ---------- Routeur ---------- */

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const segs = path
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  return { segs, path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

const NAV = { champions: 'champions', champion: 'champions', classement: 'classements', otp: 'classements', matchups: 'matchups', patch: 'patch', multi: 'multi', wiki: 'wiki' };

async function router() {
  const { segs, path, query } = parseHash();
  const token = ++S.nav;
  const ctx = { alive: () => token === S.nav, query };
  if (typeof cleanup === 'function') {
    try {
      cleanup();
    } catch {
      /* rien */
    }
  }
  cleanup = null;

  const page = segs[0] || '';
  // Les onglets d'un profil ne remontent pas la page.
  const key = page === 'joueur' ? segs.slice(0, 4).join('/').toLowerCase() : path;
  const changed = key !== lastKey;
  if (changed) {
    window.scrollTo(0, 0);
    // Entrée de page : une seule animation orchestrée par changement de page.
    view.classList.remove('view-enter');
    void view.offsetWidth;
    view.classList.add('view-enter');
  }
  if (changed && lastKey !== null) view.focus({ preventScroll: true });
  lastKey = key;

  document.body.classList.toggle('is-home', page === '');
  document.querySelectorAll('.nav a').forEach((a) => a.removeAttribute('aria-current'));
  const navKey = page === 'champions' && query.vue === 'tous' ? 'liste' : NAV[page];
  if (navKey) document.querySelector(`.nav > a[data-nav="${navKey}"]`)?.setAttribute('aria-current', 'page');
  dd.classList.toggle('current', navKey === 'classements');
  const sub = page === 'otp' ? 'otp' : page === 'classement' ? (query.queue === 'flex' ? 'flex' : 'solo') : '';
  if (sub) dd.querySelector(`a[data-sub="${sub}"]`)?.setAttribute('aria-current', 'page');
  setDd(false);
  if (dialog.open) dialog.close();

  try {
    switch (page) {
      case '':
        cleanup = await Home.render(view, {}, ctx);
        break;
      case 'joueur':
        cleanup = await Profile.render(view, { p: segs[1], name: segs[2], tag: segs[3], tab: segs[4] || 'apercu' }, ctx);
        break;
      case 'champions':
        cleanup = await Champions.renderList(view, {}, ctx);
        break;
      case 'champion':
        cleanup = await Champions.renderChampion(view, { id: segs[1] }, ctx);
        break;
      case 'classement':
        cleanup = await Ladder.render(view, { p: segs[1] }, ctx);
        break;
      case 'multi':
        cleanup = await Multi.render(view, {}, ctx);
        break;
      case 'otp':
        cleanup = await Otp.render(view, { p: segs[1] }, ctx);
        break;
      case 'matchups':
        cleanup = await Matchups.render(view, { p: segs[1] }, ctx);
        break;
      case 'patch':
        cleanup = await Patch.render(view, { v: segs[1] }, ctx);
        break;
      case 'wiki':
        cleanup = await Wiki.render(view, { tab: segs[1] || 'objets' }, ctx);
        break;
      default:
        view.innerHTML = `<div class="state"><p class="state-title">Page introuvable</p><p>Cette adresse ne correspond à aucune page du site.</p><a class="btn" href="#/">Retour à l’accueil</a></div>`;
    }
  } catch (e) {
    console.error(e);
    if (ctx.alive()) view.innerHTML = errorState(e);
  }
}

/* ---------- Démarrage ---------- */

async function boot() {
  applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
  view.innerHTML = loading('Chargement des données du jeu…');
  try {
    const [cfg, st] = await Promise.all([api('/config'), api('/static')]);
    S.cfg = cfg;
    S.st = st;
  } catch (e) {
    view.innerHTML = `${errorState(e, 'Données du jeu indisponibles')}<div class="row" style="justify-content:center"><button class="btn" id="retryBoot" type="button">Réessayer</button></div>`;
    document.getElementById('retryBoot').addEventListener('click', boot);
    return;
  }
  const saved = store.get('platform', null);
  S.platform = S.cfg.platforms[saved] ? saved : S.cfg.defaultPlatform;
  if (!S.cfg.hasKey) {
    document.getElementById('banner').innerHTML = `<div class="banner"><div class="banner-in" role="status"><strong>Clé API manquante.</strong> Ajoute <code>RIOT_API_KEY=…</code> dans le fichier <code>.env</code>, puis relance le serveur. L’encyclopédie fonctionne sans clé.</div></div>`;
  }
  wireSearch();
  window.addEventListener('hashchange', router);
  router();
}

boot();
