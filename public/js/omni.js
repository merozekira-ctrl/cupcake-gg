// Recherche unifiée : joueurs (Riot ID) et champions, au clavier comme à la souris.
import { S, api, esc, store, norm, champImg, champHref, playerHref, profileImg, parseRiotId, DEFAULT_TAG, CLASSES } from './core.js';

let uid = 0;
const TIERS_FR = { IRON: 'Fer', BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or', PLATINUM: 'Platine', EMERALD: 'Émeraude', DIAMOND: 'Diamant', MASTER: 'Maître', GRANDMASTER: 'Grand Maître', CHALLENGER: 'Challenger' };

function results(q, region, remote = []) {
  const raw = q.trim();
  const out = [];
  const people = [...store.get('favs', []).map((x) => ({ ...x, fav: true })), ...store.get('recent', [])];
  const seenPeople = new Set();
  const addPerson = (x) => {
    const k = `${x.p}|${x.name}|${x.tag}`.toLowerCase();
    if (seenPeople.has(k)) return;
    seenPeople.add(k);
    out.push({ type: 'player', p: x.p, name: x.name, tag: x.tag, icon: x.icon, note: x.note || (x.fav ? 'Favori' : 'Récent') });
  };

  if (!raw) {
    people.slice(0, 6).forEach(addPerson);
    return out;
  }

  const { name, tag } = parseRiotId(raw);
  const typedId = raw.includes('#') && name && tag;
  if (typedId) {
    const known = people.find((x) => x.p === region && x.name.toLowerCase() === name.toLowerCase() && x.tag.toLowerCase() === tag.toLowerCase());
    seenPeople.add(`${region}|${name}|${tag}`.toLowerCase());
    out.push({ type: 'player', p: region, name: known?.name || name, tag: known?.tag || tag, icon: known?.icon, note: 'Ouvrir le profil' });
  }

  // Joueurs connus du serveur dont le nom commence par / contient la saisie.
  for (const x of remote) addPerson({ ...x, note: x.tier ? `${TIERS_FR[x.tier] || x.tier}${x.lp != null && ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(x.tier) ? ` ${x.lp} LP` : ''}` : 'Joueur' });
  const n = norm(raw.replace(/#.*$/, ''));
  if (n) {
    const champs = Object.values(S.st.champions)
      .map((c) => {
        const cn = norm(c.name);
        const ci = norm(c.id);
        const score = cn.startsWith(n) || ci.startsWith(n) ? 0 : cn.includes(n) || ci.includes(n) ? 1 : -1;
        return { c, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name, 'fr'))
      .slice(0, typedId ? 3 : 6);
    for (const { c } of champs) out.push({ type: 'champ', c });
    people.filter((x) => norm(x.name).includes(n)).slice(0, 4).forEach(addPerson);
  }

  if (!typedId && raw.length >= 2) {
    out.push({ type: 'player', p: region, name: raw, tag: DEFAULT_TAG[region] || '', note: `Joueur avec le tag par défaut #${DEFAULT_TAG[region] || ''}`, guess: true });
  }
  return out;
}

function optionHtml(r, id, active) {
  if (r.type === 'champ') {
    const cls = r.c.tags.map((t) => CLASSES[t] || t).join(', ');
    return `<li role="option" id="${id}" class="omni-opt${active ? ' is-active' : ''}" aria-selected="${active}">
      ${champImg(r.c.key, 32)}
      <span class="omni-main"><b>${esc(r.c.name)}</b><small>${esc(cls)}</small></span>
      <span class="omni-kind">Champion</span>
    </li>`;
  }
  const region = S.cfg.platforms[r.p]?.label || r.p;
  return `<li role="option" id="${id}" class="omni-opt${active ? ' is-active' : ''}" aria-selected="${active}">
    ${r.icon != null ? profileImg(r.icon, 32, true) : '<span class="omni-person" aria-hidden="true"></span>'}
    <span class="omni-main"><b>${esc(r.name)}<span class="muted">#${esc(r.tag)}</span></b><small>${esc(r.note)}</small></span>
    <span class="omni-kind">${esc(region)}</span>
  </li>`;
}

export function hrefOf(r) {
  return r.type === 'champ' ? champHref(r.c) : playerHref(r.p, r.name, r.tag);
}

/**
 * Relie un champ de saisie à une liste de suggestions.
 * opts.region() renvoie la région choisie ; opts.onPick(href) est appelé à la sélection.
 */
export function bindOmni(input, list, opts) {
  const id = `omni-${++uid}`;
  list.id = `${id}-list`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Suggestions');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  let items = [];
  let active = 0;
  let remote = [];
  let remoteQ = '';
  let timer = null;
  const fetchRemote = () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.replace(/#.*$/, '').length < 2 || !S.cfg?.hasKey) {
      remote = [];
      remoteQ = '';
      return;
    }
    timer = setTimeout(async () => {
      try {
        const r = await api(`/players?q=${encodeURIComponent(q)}&p=${opts.region()}`);
        if (input.value.trim() !== q) return;
        remote = r;
        remoteQ = q;
        if (!list.hidden) paint();
      } catch {
        /* annuaire indisponible */
      }
    }, 180);
  };
  const open = (on) => {
    list.hidden = !on;
    input.setAttribute('aria-expanded', String(on));
  };
  const paint = () => {
    items = results(input.value, opts.region(), remoteQ && input.value.trim().toLowerCase().startsWith(remoteQ.toLowerCase().slice(0, 2)) ? remote : []);
    if (active >= items.length) active = 0;
    if (!items.length) {
      list.innerHTML = input.value.trim()
        ? '<li class="omni-empty">Aucun champion trouvé. Pour un joueur, ajoute son tag : Nom#TAG.</li>'
        : '<li class="omni-empty">Tape un Riot ID (Nom#TAG) ou un nom de champion.</li>';
      input.removeAttribute('aria-activedescendant');
    } else {
      const head = !input.value.trim() ? '<li class="omni-head" role="presentation">Joueurs récents et favoris</li>' : '';
      list.innerHTML = head + items.map((r, i) => optionHtml(r, `${id}-o${i}`, i === active)).join('');
      input.setAttribute('aria-activedescendant', `${id}-o${active}`);
    }
    open(true);
  };
  const pick = (r) => {
    if (!r) return;
    open(false);
    opts.onPick(hrefOf(r));
  };
  const move = (d) => {
    if (!items.length) return;
    active = (active + d + items.length) % items.length;
    list.querySelectorAll('.omni-opt').forEach((el, i) => {
      el.classList.toggle('is-active', i === active);
      el.setAttribute('aria-selected', String(i === active));
    });
    input.setAttribute('aria-activedescendant', `${id}-o${active}`);
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', () => {
    active = 0;
    paint();
    fetchRemote();
  });
  input.addEventListener('focus', paint);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.hidden) paint();
      else move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!items.length) paint();
      pick(items[active]);
    } else if (e.key === 'Escape' && !list.hidden && opts.closeOnEscape !== false) {
      open(false);
    }
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const opt = e.target.closest('.omni-opt');
    if (!opt) return;
    pick(items[[...list.querySelectorAll('.omni-opt')].indexOf(opt)]);
  });
  input.addEventListener('blur', () => {
    if (opts.keepOpen) return;
    setTimeout(() => open(false), 120);
  });
  return { refresh: paint, close: () => open(false) };
}
