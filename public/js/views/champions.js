// Tier list, liste des champions, fiche champion (builds haut niveau du patch, joueurs, compétences, skins).
import {
  S, api, esc, num, dec, pct, kdaText, kdaRatio, ago, champImg, champOf, champByKey, champHref, itemImg, spellImg,
  runeImg, abilityImg, passiveImg, splashUrl, loadingUrl, roleIcon, ROLES, ROLE_ORDER, CLASSES, rich, crest, rankText,
  regionOptions, setPlatform, setTitle, loading, errorState, store, toast, playerHref, norm,
} from '../core.js';

const cmpPatch = (a, b) => {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
};
const ordinal = (n) => (n === 1 ? '1er' : `${n}e`);

async function getMeta(p, force = false) {
  const hit = S.meta[p];
  if (!force && hit && Date.now() - hit._at < 20e3) return hit;
  const m = await api(`/meta/${p}`);
  m._at = Date.now();
  S.meta[p] = m;
  return m;
}

const patchesOf = (meta) =>
  Object.keys(meta?.patches || {})
    .filter((k) => meta.patches[k].games > 0)
    .sort(cmpPatch)
    .reverse();

export function tierRows(P, role) {
  const rows = [];
  for (const [k, c] of Object.entries(P.champs)) {
    const [id, r] = k.split('|');
    if (r !== role) continue;
    const champ = champOf(id);
    if (!champ) continue;
    const wr = c.w / c.g;
    const pr = c.g / P.games;
    const br = (P.bans[id] || 0) / P.games;
    // Taux de victoire « lissé » vers 50 % : un 3/3 ne doit pas finir tier S.
    const adj = (c.w + 15) / (c.g + 30);
    const score = (adj - 0.5) * 100 + Math.sqrt(pr * 100) * 2.2 + br * 8;
    rows.push({ id: Number(id), champ, c, wr, pr, br, score, kda: (c.k + c.a) / Math.max(1, c.d) });
  }
  rows.sort((a, b) => b.score - a.score);
  const reliable = rows.filter((r) => r.c.g >= 3);
  for (const r of rows) {
    if (r.c.g < 3) {
      r.tier = '?';
      continue;
    }
    const q = reliable.indexOf(r) / Math.max(1, reliable.length);
    r.tier = q < 0.1 ? 'S' : q < 0.3 ? 'A' : q < 0.6 ? 'B' : q < 0.85 ? 'C' : 'D';
  }
  // Les choix trop rares (moins de 3 parties) passent en fin de liste.
  return [...reliable, ...rows.filter((r) => r.c.g < 3)];
}

const wrClass = (w, g) => (g && w / g >= 0.5 ? 'good' : 'bad');
const top = (obj, n) =>
  Object.entries(obj || {})
    .sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1])
    .slice(0, n);

/* ===================================================================== */
/* Liste : tier list + tous les champions                                */
/* ===================================================================== */

export async function renderList(el, _p, ctx) {
  const vue = ctx.query.vue === 'tous' ? 'tous' : 'tier';
  setTitle(vue === 'tous' ? 'Champions' : 'Tier list et builds');
  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${vue === 'tous' ? 'Champions' : 'Tier list et builds'}</h1>
        <p>${vue === 'tous'
          ? 'Tous les champions du patch actuel. Ouvre une fiche pour voir son build, ses compétences et ses skins.'
          : 'Classement par rôle calculé sur les parties classées Solo/Duo du patch actuel, jouées par les joueurs Challenger, Grand Maître et les pros que tu suis.'}</p>
      </div>
      <nav class="seg" aria-label="Vue">
        <a href="#/champions"${vue === 'tier' ? ' aria-current="page"' : ''}>Tier list</a>
        <a href="#/champions?vue=tous"${vue === 'tous' ? ' aria-current="page"' : ''}>Tous les champions</a>
      </nav>
    </div>
    <div id="body"></div>`;
  const body = el.querySelector('#body');
  if (vue === 'tous') return drawAll(body);
  return drawTier(body, ctx);
}

function drawAll(body) {
  const all = Object.values(S.st.champions).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  let cls = '';
  let q = '';
  body.innerHTML = `
    <div class="toolbar">
      <label class="sr" for="cSearch">Rechercher un champion</label>
      <input class="field" id="cSearch" type="search" placeholder="Rechercher un champion" style="width:260px">
      <div class="chips" role="group" aria-label="Classe">
        <button class="chip" type="button" data-c="" aria-pressed="true">Toutes</button>
        ${Object.entries(CLASSES).map(([k, v]) => `<button class="chip" type="button" data-c="${k}" aria-pressed="false">${v}</button>`).join('')}
      </div>
    </div>
    <div class="champ-grid" id="cGrid"></div>`;
  const grid = body.querySelector('#cGrid');
  const paint = () => {
    const list = all.filter((c) => (!cls || c.tags.includes(cls)) && (!q || norm(c.name).includes(norm(q))));
    grid.innerHTML = list.length
      ? list.map((c) => `<a href="${champHref(c)}">${champImg(c.key, 64)}<span>${esc(c.name)}</span></a>`).join('')
      : '<p class="muted">Aucun champion ne correspond.</p>';
  };
  body.querySelector('#cSearch').addEventListener('input', (e) => {
    q = e.target.value.trim();
    paint();
  });
  body.querySelectorAll('[data-c]').forEach((b) =>
    b.addEventListener('click', () => {
      cls = b.dataset.c;
      body.querySelectorAll('[data-c]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      paint();
    })
  );
  paint();
}

function sampleBoxHtml(meta, patch, region) {
  const job = meta?.job;
  const total = patch ? meta.patches[patch].games : 0;
  const err = job?.error ? `<p class="small bad">${esc(job.error)}</p>` : '';
  if (job?.running) {
    const ratio = job.target ? Math.min(1, job.done / job.target) : 0;
    return `<div class="row wrap"><span class="spinner"></span><strong class="grow">${esc(job.phase)} : ${job.done} / ${job.target} parties</strong><button class="btn btn-sm" type="button" id="stopMeta">Arrêter</button></div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${job.target}" aria-valuenow="${job.done}" aria-label="Progression de l’analyse"><i style="width:${(ratio * 100).toFixed(1)}%"></i></div>
      <p class="muted small">Chaque partie demande 2 requêtes (partie et chronologie). Avec une clé de développement, compte environ 3 minutes pour 50 parties. L’analyse laisse 30 % de la limite à tes recherches et continue si tu changes de page.</p>`;
  }
  if (!total) {
    return `<div><strong>Pas encore d’échantillon pour ${esc(region)} sur ce patch.</strong>
      <p class="muted small" style="margin-top:4px">cupcake.gg lit les parties classées Solo/Duo du patch ${esc(meta?.current || '')} jouées par les Challenger, Grand Maître et pros suivis, avec leur chronologie : ordre des objets, objets de départ, compétences. Il en tire tier list, builds, runes et matchups. Avec une clé de développement, 150 parties prennent environ 9 minutes.</p></div>
      <div class="row wrap"><button class="btn btn-primary" type="button" data-start="150">Analyser 150 parties</button><button class="btn" type="button" data-start="400">Analyser 400 parties</button></div>${err}`;
  }
  return `<div class="row wrap">
      <p class="grow">Échantillon : <strong>${num(total)} parties</strong> Challenger, Grand Maître et pros sur ${esc(region)}, patch ${esc(patch)}.<span class="muted small"> Mis à jour ${esc(ago(meta.updated))}.</span></p>
      <button class="btn btn-sm" type="button" data-start="150">Ajouter 150 parties</button>
    </div>
    ${total < 300 ? '<p class="muted small">Moins de 300 parties : les écarts entre champions peu joués restent fragiles. Ajoute des parties pour affiner.</p>' : ''}${err}`;
}

function prosHtml(pros, p) {
  const mine = pros.filter((x) => x.platform === p);
  return `<details class="panel pros-box"${mine.length ? '' : ''}>
    <summary><span><strong>Pros suivis</strong> <span class="muted">${mine.length} sur ${esc(S.cfg.platforms[p].label)}</span></span><span class="muted small">Leurs parties sont lues en premier et signalées « Pro » dans les builds.</span></summary>
    <div class="pros-in">
      ${mine.length ? `<ul class="pros-list">${mine.map((x) => `<li><span class="pro-badge">${esc(x.team || 'Pro')}</span><b>${esc(x.label)}</b><span class="muted small">${esc(x.riotId)}</span><button class="x-btn" type="button" data-unpro="${esc(x.puuid)}" aria-label="Ne plus suivre ${esc(x.label)}">×</button></li>`).join('')}</ul>` : '<p class="muted small">Aucun pro suivi pour cette région.</p>'}
      <form class="pro-form" id="proForm">
        <label><span>Riot ID du compte</span><input class="field" name="riotId" placeholder="Nom#TAG" required></label>
        <label><span>Nom affiché</span><input class="field" name="label" placeholder="Pseudo pro" maxlength="24"></label>
        <label><span>Équipe</span><input class="field" name="team" placeholder="Sigle" maxlength="12"></label>
        <button class="btn" type="submit">Suivre</button>
      </form>
    </div>
  </details>`;
}

function drawTier(body, ctx) {
  let role = ROLES[ctx.query.role] ? ctx.query.role : store.get('tierRole', 'MIDDLE');
  let patch = null;
  let search = '';
  let timer = null;
  const p = S.platform;
  const region = S.cfg.platforms[p].label;

  body.innerHTML = `
    <div class="toolbar">
      <div class="chips" role="group" aria-label="Rôle">
        ${ROLE_ORDER.map((r) => `<button class="chip" type="button" data-role="${r}" aria-pressed="${r === role}">${roleIcon(r, false)}${ROLES[r]}</button>`).join('')}
      </div>
      <span class="grow"></span>
      <label class="sr" for="tRegion">Région</label>
      <select class="select" id="tRegion">${regionOptions(p)}</select>
      <label class="sr" for="tPatch">Patch</label>
      <select class="select" id="tPatch" disabled><option>Patch</option></select>
      <label class="sr" for="tSearch">Filtrer les champions</label>
      <input class="field" id="tSearch" type="search" placeholder="Filtrer" style="width:150px">
    </div>
    <section class="panel sample-box" id="sample" aria-live="polite">${loading()}</section>
    <div id="pros"></div>
    <div id="tierTable"></div>`;

  const sample = body.querySelector('#sample');
  const table = body.querySelector('#tierTable');
  const patchSel = body.querySelector('#tPatch');

  body.querySelector('#tRegion').addEventListener('change', (e) => {
    setPlatform(e.target.value);
    location.hash = `#/champions?role=${role}&r=${e.target.value}`;
  });
  body.querySelector('#tSearch').addEventListener('input', (e) => {
    search = norm(e.target.value.trim());
    paintTable();
  });
  patchSel.addEventListener('change', () => {
    patch = patchSel.value;
    paintSample();
    paintTable();
  });
  body.querySelectorAll('[data-role]').forEach((b) =>
    b.addEventListener('click', () => {
      role = b.dataset.role;
      store.set('tierRole', role);
      body.querySelectorAll('[data-role]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      paintTable();
    })
  );

  const start = async (target) => {
    try {
      S.meta[p] = await api(`/meta/${p}/start?target=${target}`, { method: 'POST' });
      S.meta[p]._at = Date.now();
      paintSample();
      poll();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  function paintSample() {
    const meta = S.meta[p];
    const patches = patchesOf(meta);
    if (!patch || !patches.includes(patch)) patch = patches.includes(meta.current) ? meta.current : patches[0] || null;
    patchSel.disabled = !patches.length;
    patchSel.innerHTML = patches.length
      ? patches.map((x) => `<option value="${x}"${x === patch ? ' selected' : ''}>Patch ${x}${x === meta.current ? ' (actuel)' : ''}</option>`).join('')
      : '<option>Patch</option>';
    sample.innerHTML = sampleBoxHtml(meta, patch, region);
    sample.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => start(Number(b.dataset.start))));
    sample.querySelector('#stopMeta')?.addEventListener('click', async () => {
      try {
        await api(`/meta/${p}/stop`, { method: 'POST' });
        toast('Analyse arrêtée. Les parties déjà lues sont conservées.');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  function paintPros() {
    const box = body.querySelector('#pros');
    const wasOpen = box.querySelector('details')?.open;
    box.innerHTML = prosHtml(S.meta[p].pros || [], p);
    if (wasOpen) box.querySelector('details').open = true;
    box.querySelectorAll('[data-unpro]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          S.meta[p].pros = await api(`/pros/${b.dataset.unpro}`, { method: 'DELETE' });
          paintPros();
        } catch (e) {
          toast(e.message, 'error');
        }
      })
    );
    box.querySelector('#proForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const btn = e.currentTarget.querySelector('button');
      btn.disabled = true;
      try {
        S.meta[p].pros = await api('/pros', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ riotId: f.get('riotId'), label: f.get('label'), team: f.get('team'), platform: p }),
        });
        toast('Pro ajouté. Ses parties seront lues en premier à la prochaine analyse.');
        paintPros();
        box.querySelector('details').open = true;
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  }

  function paintTable() {
    const meta = S.meta[p];
    if (!patch || !meta?.patches?.[patch]) {
      table.innerHTML = '';
      return;
    }
    const P = meta.patches[patch];
    const rows = tierRows(P, role).filter((r) => !search || norm(r.champ.name).includes(search));
    const maxPr = Math.max(0.01, ...rows.map((r) => r.pr));
    table.innerHTML = rows.length
      ? `<div class="panel scroll-x"><table class="table tier-table">
        <caption class="sr">Tier list ${ROLES[role]}, patch ${esc(patch)}</caption>
        <thead><tr><th scope="col" class="num">#</th><th scope="col">Champion</th><th scope="col">Tier</th><th scope="col" class="num">Victoires</th><th scope="col">Sélection</th><th scope="col" class="num">Bannissement</th><th scope="col" class="num">Parties</th><th scope="col" class="num">KDA</th></tr></thead>
        <tbody>${rows
          .map(
            (r, i) => `<tr class="clickable${r.tier === '?' ? ' rare' : ''}" data-href="${champHref(r.champ, role)}">
            <td class="num muted">${i + 1}</td>
            <td><div class="cell-player">${champImg(r.id, 36)}<div class="pn"><a href="${champHref(r.champ, role)}">${esc(r.champ.name)}</a></div></div></td>
            <td><span class="tier tier-${r.tier === '?' ? 'D' : r.tier}" title="${r.tier === '?' ? 'Moins de 3 parties : pas assez de données' : 'Tier ' + r.tier}">${r.tier}</span></td>
            <td class="num"><b class="${r.wr >= 0.5 ? 'good' : 'bad'}">${pct(r.c.w, r.c.g, 1)}</b></td>
            <td style="min-width:140px"><div class="row"><span class="num" style="width:52px">${pct(r.pr, 1, 1)}</span><div class="bar grow"><i style="width:${(r.pr / maxPr) * 100}%"></i></div></div></td>
            <td class="num">${pct(r.br, 1, 1)}</td>
            <td class="num">${num(r.c.g)}</td>
            <td class="num">${dec(r.kda, 2)}</td>
          </tr>`
          )
          .join('')}</tbody></table></div>`
      : `<div class="panel state"><p>Aucun champion ${search ? 'ne correspond à ce filtre' : 'pour ce rôle dans l’échantillon'}.</p></div>`;
    table.querySelectorAll('tr[data-href]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (!e.target.closest('a')) location.hash = tr.dataset.href;
      })
    );
  }

  function poll() {
    clearInterval(timer);
    timer = setInterval(async () => {
      if (!ctx.alive()) return clearInterval(timer);
      try {
        await getMeta(p, true);
      } catch {
        return;
      }
      if (!ctx.alive()) return;
      paintSample();
      paintTable();
      if (!S.meta[p].job?.running) clearInterval(timer);
    }, 3000);
  }

  if (!S.cfg.hasKey) {
    sample.innerHTML = '<p>La tier list a besoin d’une clé API Riot dans le fichier <code>.env</code>.</p>';
    return;
  }
  getMeta(p, true)
    .then(() => {
      if (!ctx.alive()) return;
      paintSample();
      paintPros();
      paintTable();
      if (S.meta[p].job?.running) poll();
    })
    .catch((e) => {
      if (ctx.alive()) sample.innerHTML = errorState(e);
    });

  return () => clearInterval(timer);
}

/* ===================================================================== */
/* Fiche champion                                                        */
/* ===================================================================== */

const SHARDS = {
  5008: 'Force adaptative',
  5005: 'Vitesse d’attaque',
  5007: 'Accélération de compétence',
  5010: 'Vitesse de déplacement',
  5001: 'PV croissants',
  5011: 'PV',
  5013: 'Ténacité et résistance au ralentissement',
  5002: 'Armure',
  5003: 'Résistance magique',
};

function stat(label, value, cls = '') {
  return `<div class="hs"><small>${label}</small><b class="${cls}">${value}</b></div>`;
}

function itemStep(label, ids, sub) {
  const counts = {};
  for (const id of ids) counts[id] = (counts[id] || 0) + 1;
  const uniq = Object.keys(counts);
  return `<div class="step">
    <span class="step-label">${label}</span>
    <div class="step-items">${uniq.map((id) => `<span class="it">${itemImg(Number(id), 44)}${counts[id] > 1 ? `<b class="it-n">${counts[id]}</b>` : ''}</span>`).join('')}</div>
    <span class="step-name">${uniq.length === 1 ? esc(S.st.items[uniq[0]]?.name || '') : ''}${sub ? `<small>${sub}</small>` : ''}</span>
  </div>`;
}

function wrLine(n, w, total) {
  return `<span class="wrl"><b class="${wrClass(w, n)}">${pct(w, n, 1)}</b> <span class="muted">victoires</span></span><span class="muted">${num(n)} partie${n > 1 ? 's' : ''}${total ? `, ${pct(n, total)} des builds` : ''}</span>`;
}

function skillPrioOf(order) {
  const counts = { 1: 0, 2: 0, 3: 0 };
  const maxedAt = {};
  order.forEach((s, i) => {
    if (!(s in counts)) return;
    counts[s]++;
    if (counts[s] === 5 && maxedAt[s] === undefined) maxedAt[s] = i;
  });
  if (counts[1] + counts[2] + counts[3] < 6) return '';
  return [1, 2, 3]
    .sort((a, b) => (maxedAt[a] ?? 100 - counts[a]) - (maxedAt[b] ?? 100 - counts[b]))
    .map((s) => ({ 1: 'Q', 2: 'W', 3: 'E' })[s])
    .join('>');
}

function skillGrid(order) {
  return `<div class="skills">${['Q', 'W', 'E', 'R']
    .map((k, row) => {
      const cells = [];
      for (let lvl = 0; lvl < 18; lvl++) {
        const on = order[lvl] === row + 1;
        cells.push(`<span class="${on ? 'on' + (row === 3 ? ' r' : '') : ''}">${on ? lvl + 1 : ''}</span>`);
      }
      return `<span class="k">${k}</span>${cells.join('')}`;
    })
    .join('')}</div>`;
}

// Variantes de runes : une par combinaison clé de voûte + arbre secondaire,
// chacune avec sa page complète la plus jouée.
function runeOptions(R) {
  const pages = Object.entries(R.pages || {});
  return top(R.runes, 4)
    .filter(([, [n]], i) => i === 0 || n >= 2)
    .map(([k, [n, w]]) => {
      const [ks, ss] = k.split('-').map(Number);
      const match = pages
        .filter(([pk]) => {
          const [prim, sec] = pk.split('|');
          return Number(prim.split(':')[1]?.split('.')[0]) === ks && Number((sec || '').split(':')[0]) === ss;
        })
        .sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1])[0];
      return { ks, ss, n, w, page: match?.[0] || null, pageN: match?.[1][0] || 0 };
    });
}

function runePage(key) {
  const [prim, sec, shards] = key.split('|');
  const [pStyle, pPerks] = prim.split(':');
  const [sStyle, sPerks] = (sec || '0:').split(':');
  const chosen = new Set([...(pPerks || '').split('.'), ...(sPerks || '').split('.')].map(Number));
  const treeHtml = (style, rows) => {
    const t = S.st.trees.find((x) => x.id === Number(style));
    if (!t) return '';
    return `<div class="rp-tree"><div class="rp-head">${runeImg(t.id, 24)}<b>${esc(t.name)}</b></div>${rows
      .map((slot) => `<div class="rp-row">${slot.map((id) => `<span class="rp-rune${chosen.has(id) ? ' on' : ''}">${runeImg(id, slot === t.slots[0] ? 40 : 30)}</span>`).join('')}</div>`)
      .join('')}</div>`;
  };
  const tP = S.st.trees.find((x) => x.id === Number(pStyle));
  const tS = S.st.trees.find((x) => x.id === Number(sStyle));
  const named = [...chosen].map((id) => S.st.runes[id]?.name).filter(Boolean);
  return `<div class="rune-page" role="img" aria-label="Runes : ${esc(named.join(', '))}">
    ${tP ? treeHtml(pStyle, tP.slots) : ''}
    ${tS ? treeHtml(sStyle, tS.slots.slice(1)) : ''}
  </div>
  ${shards ? `<div class="shards">${shards.split('.').map((s) => `<span>${esc(SHARDS[s] || 'Fragment ' + s)}</span>`).join('')}</div>` : ''}`;
}

function augmentsHtml(R) {
  const list = top(R.aug, 40);
  if (!list.length) return '';
  const total = Object.values(R.aug).reduce((s, [n]) => s + n, 0) || 1;
  const rows = list
    .filter(([, [n]]) => n >= 1)
    .map(([id, [n, w]]) => ({ id, n, w, wr: w / n, a: AUG?.[id] }))
    .sort((a, b) => (b.n >= 3) - (a.n >= 3) || b.wr - a.wr || b.n - a.n)
    .slice(0, 12);
  const RAR = ['Argent', 'Or', 'Prismatique'];
  return `<section class="panel card-accent" aria-labelledby="h-aug">
    <div class="panel-title"><h2 id="h-aug">Meilleurs augments</h2><span class="muted small">Triés par taux de victoire (3 parties minimum en premier)</span></div>
    <div class="aug-grid">${rows
      .map((x) => `<div class="aug" data-r="${x.a?.rarity ?? 0}" title="${esc(x.a ? stripRich(x.a.desc) : '')}">
        ${x.a?.icon ? `<img class="ic ic-40 aug-ic" src="${esc(x.a.icon)}" alt="" loading="lazy">` : '<span class="ic ic-40 aug-ic"></span>'}
        <span class="aug-txt"><b>${esc(x.a?.name || `Augment ${x.id}`)}</b><small>${x.a ? RAR[x.a.rarity] || '' : ''}</small></span>
        <span class="aug-stat"><b class="${x.wr >= 0.5 ? 'good' : 'bad'}">${pct(x.w, x.n)}</b><small>${x.n} p., ${pct(x.n, total)}</small></span>
      </div>`)
      .join('')}</div>
    ${AUG && !Object.keys(AUG).length ? '<p class="muted small pad">Noms des augments indisponibles (Community Dragon injoignable) : seuls les numéros sont affichés.</p>' : ''}
  </section>`;
}
const stripRich = (t) => String(t || '').replace(/[\u0001\u0002]/g, '');

function buildTab(c, R, cm, role, mode = 'sr') {
  const total = R.g;
  const tlGames = R.tl || 0;
  const cores = top(R.core, 5);
  const startT = top(R.start, 1)[0];
  const bootsT = top(R.boots, 1)[0];
  const main = cores[0];
  const coreIds = main ? main[0].split('-').map(Number) : top(R.items, 3).map(([id]) => Number(id));
  const runeSets = runeOptions(R);
  const spells = top(R.spells, 2);
  const skills = top(R.skills, 2);
  const prioSeq = skills[0] && (R.recent || []).find((g) => g.sk?.length >= 15 && skillPrioOf(g.sk) === skills[0][0]);
  const vs = Object.entries(R.vs || {}).filter(([, [n]]) => n >= 2).map(([id, [n, w]]) => ({ id, n, w, wr: w / n }));
  const best = vs.filter((x) => x.wr >= 0.5).sort((a, b) => b.wr - a.wr || b.n - a.n).slice(0, 5);
  const worst = vs.filter((x) => x.wr < 0.5).sort((a, b) => a.wr - b.wr || b.n - a.n).slice(0, 5);
  const slots = (R.slot || []).map((s, i) => ({ i, list: top(s, 4), n: Object.values(s).reduce((x, [g]) => x + g, 0) })).filter((s) => s.list.length);

  const steps = [
    startT ? itemStep('Départ', startT[0].split(',').map(Number), `${pct(startT[1][1], startT[1][0])} victoires`) : '',
    bootsT ? itemStep('Bottes', [Number(bootsT[0])], `${pct(bootsT[1][1], bootsT[1][0])} victoires`) : '',
    ...coreIds.map((id, i) => itemStep(`${ordinal(i + 1)} objet`, [id])),
  ].filter(Boolean);

  return `<div class="build-layout">
    <div class="stack">
      <section class="panel card-accent" aria-labelledby="h-core">
        <div class="panel-title"><h2 id="h-core">Build principal</h2>${main ? `<div class="wr-head">${wrLine(main[1][0], main[1][1], tlGames)}</div>` : ''}</div>
        ${steps.length ? `<div class="path">${steps.join('<span class="path-sep" aria-hidden="true"></span>')}</div>` : '<p class="muted pad">Pas encore de build complet observé.</p>'}
        ${!main && coreIds.length ? '<p class="muted small pad-x">Ordre non disponible : objets les plus présents en fin de partie.</p>' : ''}
        ${main && main[1][0] < 10 ? '<p class="note pad-x">Échantillon encore faible pour ce build : ajoute des parties depuis la tier list pour le fiabiliser.</p>' : ''}
        ${cores.length > 1 ? `<div class="alt-builds"><h3>Autres builds</h3>${cores
          .slice(1)
          .map(([k, [n, w]]) => `<div class="alt"><div class="items-row">${k.split('-').map((id) => itemImg(Number(id), 32)).join('<span class="mini-sep" aria-hidden="true"></span>')}</div><div class="bar alt-bar" aria-hidden="true"><i style="width:${(n / cores[0][1][0]) * 100}%"></i></div><div class="alt-stat">${wrLine(n, w, tlGames)}</div></div>`)
          .join('')}</div>` : ''}
      </section>

      ${slots.length ? `<section class="panel" aria-labelledby="h-opts">
        <div class="panel-title"><h2 id="h-opts">Options d’objets</h2><span class="muted small">Par rang d’achat, avec taux de victoire</span></div>
        <div class="slot-grid">${slots
          .map((s) => `<div class="slot-col"><h3>${ordinal(s.i + 1)} objet</h3>${s.list
            .map(([id, [n, w]]) => `<div class="opt">${itemImg(Number(id), 32)}<span class="opt-txt"><b class="${wrClass(w, n)}">${pct(w, n)}</b><small>${n} partie${n > 1 ? 's' : ''}, ${pct(n, s.n)}</small></span></div>`)
            .join('')}</div>`)
          .join('')}</div>
      </section>` : ''}

      ${mode === 'sr' ? '' : augmentsHtml(R)}
      ${mode !== 'sr' ? '' : `<section class="panel" aria-labelledby="h-mu">
        <div class="panel-title"><h2 id="h-mu">Matchups en ${esc(ROLES[role] || role).toLowerCase()}</h2><span class="muted small">Contre l’adversaire direct, 2 parties minimum</span></div>
        ${vs.length ? `<div class="mu-grid">
          <div><h3 class="good">Favorables</h3>${best.map((x) => muRow(x)).join('') || '<p class="muted small">Aucun pour l’instant.</p>'}</div>
          <div><h3 class="bad">Difficiles</h3>${worst.map((x) => muRow(x)).join('') || '<p class="muted small">Aucun pour l’instant.</p>'}</div>
        </div>` : '<p class="muted small pad">Pas encore assez de face-à-face dans l’échantillon.</p>'}
      </section>`}
    </div>

    <div class="stack">
      ${mode === 'arena' ? '' : `      <section class="panel" aria-labelledby="h-runes">
        <div class="panel-title"><h2 id="h-runes">Runes</h2><span class="muted small">${runeSets.length > 1 ? `${runeSets.length} pages jouées` : ''}</span></div>
        ${runeSets.length ? `<div class="rp-tabs" role="tablist" aria-label="Pages de runes">${runeSets
          .map((o, i) => `<button type="button" role="tab" id="rpt-${i}" aria-controls="rpp-${i}" aria-selected="${i === 0}" data-rp="${i}">
              <span class="rp-tab-ic">${runeImg(o.ks, 30)}${runeImg(o.ss, 16, true)}</span>
              <span class="rp-tab-txt"><b>${esc(S.st.runes[o.ks]?.name || '')}</b><small><b class="${wrClass(o.w, o.n)}">${pct(o.w, o.n, 1)}</b> sur ${num(o.n)} p., ${pct(o.n, total)}</small></span>
            </button>`)
          .join('')}</div>
        ${runeSets
          .map((o, i) => `<div class="pad-x rp-panel" role="tabpanel" id="rpp-${i}" aria-labelledby="rpt-${i}"${i ? ' hidden' : ''}>
            ${o.page ? runePage(o.page) : `<p class="muted small">Page détaillée indisponible pour cette variante.</p>`}
            ${o.page && o.pageN < o.n ? `<p class="muted small" style="margin:-6px 0 14px">Page la plus fréquente avec cette clé de voûte : ${num(o.pageN)} partie${o.pageN > 1 ? 's' : ''} sur ${num(o.n)}.</p>` : ''}
          </div>`)
          .join('')}` : '<p class="muted small pad">Pas encore de runes observées.</p>'}
      </section>`}
      <section class="panel" aria-labelledby="h-sp">
        <div class="panel-title"><h2 id="h-sp">Sorts d’invocateur</h2></div>
        <div class="pad-x stack" style="gap:10px;padding-bottom:16px">${spells
          .map(([k, [n, w]]) => {
            const [a, b] = k.split('-');
            return `<div class="alt">${spellImg(a, 34)}${spellImg(b, 34)}<span class="grow small">${esc(S.st.spells[a]?.name || '')}, ${esc(S.st.spells[b]?.name || '')}</span><div class="alt-stat">${wrLine(n, w, total)}</div></div>`;
          })
          .join('')}</div>
      </section>
      <section class="panel" aria-labelledby="h-sk">
        <div class="panel-title"><h2 id="h-sk">Compétences</h2>${skills[0] ? `<div class="wr-head">${wrLine(skills[0][1][0], skills[0][1][1], tlGames)}</div>` : ''}</div>
        ${skills[0] ? `<div class="pad-x" style="padding-bottom:16px"><div class="skill-path" aria-label="Priorité de montée ${skills[0][0].replace(/>/g, ' puis ')}">${skills[0][0].split('>').map((k) => `<span>${k}</span>`).join('<i aria-hidden="true"></i>')}</div>${prioSeq ? skillGrid(prioSeq.sk) : ''}</div>` : '<p class="muted small pad">Pas encore de données de compétences.</p>'}
      </section>
    </div>
  </div>`;
}

function muRow(x) {
  const ch = champOf(x.id);
  return `<a class="mu" href="${ch ? champHref(ch) : '#/champions'}">${champImg(x.id, 30)}<span class="grow">${esc(ch?.name || '?')}</span><b class="${x.wr >= 0.5 ? 'good' : 'bad'}">${pct(x.w, x.n)}</b><small class="muted">${x.n} p.</small></a>`;
}

function playersTab(R, cm, filter, limit = 15) {
  const pros = Object.fromEntries((cm.pros || []).map((x) => [x.puuid, x]));
  let list = R.recent || [];
  if (filter === 'win') list = list.filter((g) => g.w);
  if (filter === 'pro') list = list.filter((g) => pros[g.pu]);
  const more = list.length > limit;
  const rows = list
    .slice(0, limit)
    .map((g) => {
      const pro = pros[g.pu];
      const items = g.ord?.length ? [...g.ord] : g.it.slice(0, 6).filter(Boolean);
      const who = pro
        ? `<span class="pro-badge">${esc(pro.team || 'Pro')}</span><span class="pl-name"><a href="${playerHref(pro.platform, ...pro.riotId.split('#'))}">${esc(pro.label)}</a><small>${esc(pro.riotId)}</small></span>`
        : `${g.tier ? crest({ tier: g.tier }, 'sm') : ''}<span class="pl-name">${g.tg ? `<a href="${playerHref(S.platform, g.n, g.tg)}">${esc(g.n)}</a>` : `<span>${esc(g.n || 'Joueur')}</span>`}<small>${g.tier ? `${esc(rankText({ tier: g.tier }))}${g.lp != null ? ` ${num(g.lp)} LP` : ''}` : ''}</small></span>`;
      return `<div class="pb ${g.w ? 'win' : 'loss'}">
        <div class="pb-who">${who}</div>
        <div class="pb-vs">${g.vs ? `<span class="muted small">contre</span>${champImg(g.vs, 28)}` : ''}</div>
        <div class="pb-kda"><b>${g.k}/<span class="bad">${g.d}</span>/${g.a}</b><small>${kdaText(kdaRatio(g.k, g.d, g.a))} KDA, ${g.cs} CS</small></div>
        <div class="pb-items">${g.bt ? `${itemImg(g.bt, 28)}<span class="mini-sep" aria-hidden="true"></span>` : ''}${items.map((id) => itemImg(id, 28)).join('')}</div>
        <div class="pb-runes">${runeImg(g.ks, 28)}${runeImg(g.ss, 20, true)}${spellImg(g.s1, 22)}${spellImg(g.s2, 22)}</div>
        <div class="pb-when"><b class="${g.w ? 'good' : 'bad'}">${g.w ? 'Victoire' : 'Défaite'}</b><small>${esc(ago(g.t))}</small></div>
      </div>`;
    })
    .join('');
  return `<div class="toolbar">
      <div class="chips" role="group" aria-label="Filtrer les parties">
        <button class="chip" type="button" data-pf="all" aria-pressed="${filter === 'all'}">Toutes</button>
        <button class="chip" type="button" data-pf="win" aria-pressed="${filter === 'win'}">Victoires</button>
        <button class="chip" type="button" data-pf="pro" aria-pressed="${filter === 'pro'}">Pros suivis</button>
      </div>
      <p class="muted small grow">Dernières parties de l’échantillon, objets dans l’ordre d’achat (bottes en premier).</p>
    </div>
    ${rows ? `<div class="pb-list">${rows}</div>${more ? `<div class="more"><button class="btn btn-block" type="button" id="pbMore">Afficher ${Math.min(15, list.length - limit)} parties de plus</button></div>` : ''}` : `<div class="panel state"><p>${filter === 'pro' ? 'Aucune partie de pro suivi. Ajoute des pros depuis la tier list.' : 'Aucune partie pour ce filtre.'}</p></div>`}`;
}

const STATS = [
  ['PV', 'hp', 'hpperlevel'],
  ['Régénération des PV', 'hpregen', 'hpregenperlevel'],
  ['RESOURCE', 'mp', 'mpperlevel'],
  ['Régénération de ressource', 'mpregen', 'mpregenperlevel'],
  ['Dégâts d’attaque', 'attackdamage', 'attackdamageperlevel'],
  ['Vitesse d’attaque', 'attackspeed', 'attackspeedperlevel', '%'],
  ['Armure', 'armor', 'armorperlevel'],
  ['Résistance magique', 'spellblock', 'spellblockperlevel'],
  ['Vitesse de déplacement', 'movespeed'],
  ['Portée d’attaque', 'attackrange'],
];

function statsHtml(full) {
  const s = full.stats || {};
  const rows = STATS.filter(([, k]) => s[k] !== undefined && !(k.startsWith('mp') && !s.mp)).map(([label, k, per, unit]) => {
    const name = label === 'RESOURCE' ? full.partype || 'Ressource' : label;
    const v = Number.isInteger(s[k]) ? num(s[k]) : dec(s[k], k === 'attackspeed' ? 3 : 2);
    const g = per && s[per] ? ` <small>+${dec(s[per], per === 'attackspeedperlevel' ? 1 : 2)}${unit || ''} par niveau</small>` : '';
    return `<tr><th scope="row">${esc(name)}</th><td>${v}${g}</td></tr>`;
  });
  const info = full.info || {};
  const prof = [
    ['Attaque', info.attack],
    ['Défense', info.defense],
    ['Magie', info.magic],
    ['Difficulté', info.difficulty],
  ];
  return `<section class="panel" aria-labelledby="h-stats">
    <div class="panel-title"><h2 id="h-stats">Statistiques de base</h2></div>
    <table class="kv">${rows.join('')}</table>
    <div class="panel-title"><h3>Profil</h3></div>
    <div class="stack" style="padding:0 16px 16px;gap:8px">${prof
      .map(([l, v]) => `<div class="row small"><span style="width:84px">${l}</span><div class="bar grow" role="img" aria-label="${l} ${v ?? 0} sur 10"><i style="width:${(v || 0) * 10}%"></i></div><span class="muted" style="width:34px;text-align:right">${v ?? 0}/10</span></div>`)
      .join('')}</div>
  </section>`;
}

function abilitiesHtml(full) {
  const passive = `<div class="ability">${passiveImg(full.passive.img, 48, full.passive.name)}<div><h3><span class="key">P</span>${esc(full.passive.name)}</h3><p>${rich(full.passive.desc)}</p></div></div>`;
  const spells = full.spells
    .map((s) => {
      const meta = [
        s.cd && s.cd !== '0' ? `Délai : ${esc(s.cd)} s` : '',
        s.cost && s.cost !== '0' ? `Coût : ${esc(s.cost)}` : '',
        s.range && s.range !== '0' && Number(s.range) < 25000 ? `Portée : ${esc(s.range)}` : '',
      ].filter(Boolean);
      return `<div class="ability">${abilityImg(s.img, 48, s.name)}<div><h3><span class="key">${s.key}</span>${esc(s.name)}</h3>${meta.length ? `<div class="meta">${meta.map((x) => `<span>${x}</span>`).join('')}</div>` : ''}<p>${rich(s.desc)}</p></div></div>`;
    })
    .join('');
  const tips = [...(full.allytips || []).map((t) => ['Avec', t]), ...(full.enemytips || []).map((t) => ['Contre', t])];
  return `<div class="c-cols">
    <section class="panel" aria-labelledby="h-ab"><div class="panel-title"><h2 id="h-ab">Compétences</h2></div>${passive}${spells}</section>
    <div class="stack">${statsHtml(full)}${tips.length ? `<section class="panel" aria-labelledby="h-tips"><div class="panel-title"><h2 id="h-tips">Conseils</h2></div><ul class="tips">${tips.map(([k, t]) => `<li><strong>${k} :</strong> ${esc(t)}</li>`).join('')}</ul></section>` : ''}</div>
  </div>`;
}

const MODE_TABS = [
  ['sr', 'Faille'],
  ['aram', 'ARAM'],
  ['chaos', 'ARAM du chaos'],
  ['arena', 'Arena'],
];
const MODE_LABEL = { sr: 'Faille', aram: 'ARAM', chaos: 'ARAM du chaos', arena: 'Arena' };
let AUG = null;
async function loadAugments() {
  if (AUG) return AUG;
  AUG = await api('/augments').catch(() => ({}));
  return AUG;
}

const gem = (f) => `<img src="/skin/gem-${f}.png" alt="" width="26" height="26">`;
const SKIN_RARITY = {
  kNoRarity: { label: 'Standard', price: '975 RP', rank: 1, icon: '' },
  kEpic: { label: 'Épique', price: '1350 RP', rank: 2, icon: gem('epic') },
  kLegendary: { label: 'Légendaire', price: '1820 RP', rank: 3, icon: gem('legendary') },
  kUltimate: { label: 'Ultime', price: '3250 RP', rank: 4, icon: gem('ultimate') },
  kMythic: { label: 'Mythique', price: 'Essence mythique', rank: 5, icon: gem('mythic') },
  kExalted: { label: 'Exalté', price: 'Événement (Sanctuaire)', rank: 6, icon: gem('exalted') },
  kTranscendent: { label: 'Transcendant', price: 'Événement (Sanctuaire)', rank: 7, icon: gem('transcendent') },
};

const TABS = [
  ['build', 'Build'],
  ['joueurs', 'Meilleurs joueurs'],
  ['competences', 'Compétences'],
  ['skins', 'Skins'],
  ['histoire', 'Histoire'],
];

export async function renderChampion(el, { id }, ctx) {
  const c = champByKey(id || '');
  if (!c) {
    el.innerHTML = `<div class="state"><p class="state-title">Champion introuvable</p><p>Aucun champion ne porte cet identifiant.</p><a class="btn" href="#/champions?vue=tous">Voir tous les champions</a></div>`;
    return;
  }
  setTitle(`${c.name} : build et statistiques`);
  el.innerHTML = loading(`Chargement de ${c.name}…`);
  const p = S.platform;
  const mode = MODE_TABS.some(([m]) => m === ctx.query.mode) ? ctx.query.mode : 'sr';
  let full;
  let cm = null;
  let summary = null;
  try {
    [full, cm, summary] = await Promise.all([
      api(`/champion/${c.id}`),
      S.cfg.hasKey ? api(`/meta/${p}/champion/${c.key}?mode=${mode}${ctx.query.patch ? '&patch=' + encodeURIComponent(ctx.query.patch) : ''}`).catch(() => null) : null,
      S.cfg.hasKey ? getMeta(p).catch(() => null) : null,
      mode === 'arena' || mode === 'chaos' ? loadAugments() : null,
    ]);
  } catch (e) {
    if (ctx.alive()) el.innerHTML = errorState(e);
    return;
  }
  if (!ctx.alive()) return;

  const roles = Object.entries(cm?.roles || {}).sort((a, b) => b[1].g - a[1].g);
  const role = roles.find(([r]) => r === ctx.query.role)?.[0] || roles[0]?.[0] || null;
  const R = role ? cm.roles[role] : null;
  const tab = TABS.some(([t]) => t === ctx.query.tab) ? ctx.query.tab : 'build';
  const sumP = summary?.patches?.[cm?.patch];
  const tierRow = sumP && role && mode === 'sr' ? tierRows(sumP, role).find((r) => r.id === c.key) : null;
  const href = (o) => {
    const q = new URLSearchParams();
    const r = o.role ?? role;
    const t = o.tab ?? tab;
    const md = o.mode ?? mode;
    if (md !== 'sr') q.set('mode', md);
    if (r && md === 'sr' && r !== 'ALL') q.set('role', r);
    if (t !== 'build') q.set('tab', t);
    if (cm?.patch && cm.patch !== cm.current) q.set('patch', cm.patch);
    const s = q.toString();
    return `#/champion/${c.id}${s ? '?' + s : ''}`;
  };

  el.innerHTML = `
    <section class="c-hero" style="background-image:url('${esc(splashUrl(c.id))}')">
      <div class="c-hero-in">
        <div class="c-id">
          ${champImg(c.key, 88)}
          <div>
            <h1>${esc(full.name)}</h1>
            <p class="title">${esc(full.title)}</p>
            <div class="chips">${(full.tags || []).map((t) => `<span class="tag">${esc(CLASSES[t] || t)}</span>`).join('')}${cm?.patch ? `<span class="tag tag-accent">Patch ${esc(cm.patch)}${cm.patch === cm.current ? '' : ' (précédent)'}</span>` : ''}</div>
          </div>
        </div>
        ${R ? `<div class="hero-stats">
          ${tierRow ? `<div class="hs"><small>Tier</small><span class="tier tier-${tierRow.tier === '?' ? 'D' : tierRow.tier}">${tierRow.tier}</span></div>` : ''}
          ${stat('Victoires', pct(R.w, R.g, 1), wrClass(R.w, R.g))}
          ${stat('Sélection', pct(R.g, cm.games, 1))}
          ${mode === 'arena' ? stat('Top 1', pct(R.top1 || 0, R.g, 1)) + stat('Place moyenne', dec((R.place || 0) / R.g, 2)) : stat('Bannissement', pct(cm.bans, cm.games, 1))}
          ${stat('Parties', num(R.g))}
        </div>` : ''}
      </div>
    </section>
    <nav class="seg mode-seg" aria-label="Mode de jeu">${MODE_TABS.map(([m, l]) => `<a href="${href({ mode: m, role: m === 'sr' ? null : 'ALL' })}"${m === mode ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    ${mode === 'sr' && roles.length > 1 ? `<nav class="seg role-seg" aria-label="Rôle">${roles.map(([r, x]) => `<a href="${href({ role: r })}"${r === role ? ' aria-current="page"' : ''}>${roleIcon(r, false)}${ROLES[r] || r}<span class="muted">${x.g}</span></a>`).join('')}</nav>` : ''}
    <nav class="tabs" aria-label="Sections de la fiche">${TABS.map(([t, l]) => `<a href="${href({ tab: t })}"${t === tab ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <div id="cBody"></div>`;

  const body = el.querySelector('#cBody');
  const noData = () => `<div class="panel state">
      <p class="state-title">Pas encore de build pour ${esc(c.name)}</p>
      <p>${S.cfg.hasKey ? `${esc(c.name)} n’apparaît pas encore dans l’échantillon ${esc(MODE_LABEL[mode])} ${esc(S.cfg.platforms[p].label)} du patch actuel.${mode === 'sr' ? ' Lance une analyse depuis la tier list ou ajoute des parties.' : ' Lance une analyse de ce mode : cupcake.gg lit les parties récentes des meilleurs joueurs dans ce mode.'}` : 'Les builds ont besoin d’une clé API Riot dans le fichier .env.'}</p>
      ${!S.cfg.hasKey ? '' : mode === 'sr' ? '<a class="btn btn-primary" href="#/champions">Ouvrir la tier list</a>' : cm?.job?.running ? `<p class="row"><span class="spinner"></span>Analyse ${esc(MODE_LABEL[mode])} en cours : ${cm.job.done} / ${cm.job.target} parties. Recharge la page dans quelques minutes.</p>` : `<button class="btn btn-primary" type="button" id="startMode">Analyser 100 parties ${esc(MODE_LABEL[mode])}</button>`}
    </div>`;

  const wireStart = () =>
    body.querySelector('#startMode')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await api(`/meta/${p}/start?mode=${mode}&target=100`, { method: 'POST' });
        toast(`Analyse ${MODE_LABEL[mode]} lancée. Les builds apparaîtront au fil de la lecture des parties.`);
        e.currentTarget.outerHTML = '<p class="row"><span class="spinner"></span>Analyse en cours. Recharge la page dans quelques minutes.</p>';
      } catch (err) {
        toast(err.message, 'error');
        e.currentTarget.disabled = false;
      }
    });
  if (tab === 'build') {
    body.innerHTML = R ? buildTab(c, R, cm, role, mode) : noData();
    wireStart();
    body.querySelectorAll('[data-rp]').forEach((b) =>
      b.addEventListener('click', () => {
        body.querySelectorAll('[data-rp]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        body.querySelectorAll('.rp-panel').forEach((x) => (x.hidden = x.id !== `rpp-${b.dataset.rp}`));
      })
    );
  }
  else if (tab === 'joueurs') {
    if (!R) {
      body.innerHTML = noData();
      wireStart();
    } else {
      const paint = (f, limit = 15) => {
        body.innerHTML = playersTab(R, cm, f, limit);
        body.querySelectorAll('[data-pf]').forEach((b) => b.addEventListener('click', () => paint(b.dataset.pf)));
        body.querySelector('#pbMore')?.addEventListener('click', () => paint(f, limit + 15));
      };
      paint('all');
    }
  } else if (tab === 'competences') body.innerHTML = abilitiesHtml(full);
  else if (tab === 'skins') {
    // Hors boutique (badge « Skins mythiques ») : rareté mythique et au-delà, Prestige, éditions spéciales.
    const offShop = (s) =>
      s.num !== 0 && (['kMythic', 'kExalted', 'kTranscendent'].includes(s.rarity) || /prestige/i.test(s.name) || (s.cost != null && typeof s.cost !== 'number'));
    const value = (s) => {
      if (s.num === 0) return -1;
      if (offShop(s)) return 100000 + (SKIN_RARITY[s.rarity]?.rank || 0);
      return typeof s.cost === 'number' ? s.cost : parseInt(SKIN_RARITY[s.rarity]?.price, 10) || 0;
    };
    const sorted = [...full.skins].sort((a, b) => value(b) - value(a) || a.num - b.num);
    body.innerHTML = `<div class="skins">${sorted
      .map((s) => {
        const r = s.num === 0 ? null : SKIN_RARITY[s.rarity] || SKIN_RARITY.kNoRarity;
        const prestige = /prestige/i.test(s.name);
        const price =
          s.num === 0
            ? 'Gratuit'
            : typeof s.cost === 'number'
              ? s.rarity === 'kMythic' || (prestige && s.cost < 400)
                ? `${s.cost} Essence mythique`
                : `${s.cost} RP`
              : s.cost && /special|limited|spécial/i.test(String(s.cost))
                ? 'Édition spéciale (hors boutique)'
                : prestige
                  ? 'Essence mythique'
                  : r.price;
                return `<figure class="skin" data-r="${esc(s.rarity || 'base')}">
          <div class="skin-img"><img src="${esc(loadingUrl(c.id, s.num))}" alt="${esc(s.num === 0 ? full.name : s.name)}" loading="lazy" decoding="async">${r && r.icon ? `<span class="skin-gem" title="${esc(r.label)}">${r.icon}</span>` : ''}${offShop(s) ? '<img class="skin-myth-badge" src="/skin/mythic-badge.svg" alt="" title="Skin mythique : non achetable en boutique" width="28" height="28">' : ''}</div>
          <figcaption>
            <b>${esc(s.num === 0 ? 'Apparence de base' : s.name)}</b>
            <span class="skin-meta">${r ? `<span class="skin-tier">${esc(r.label)}</span>` : ''}${offShop(s) ? '<span class="skin-myth">Hors boutique</span>' : ''}${s.legacy ? '<span class="skin-legacy">Héritage</span>' : ''}</span>
            <span class="skin-price">${esc(price)}</span>
          </figcaption>
        </figure>`;
      })
      .join('')}</div>
    ${full.skins.some((s) => s.num && !s.rarity) ? '<p class="muted small" style="margin-top:12px">Rareté indisponible (Community Dragon injoignable) : prix affichés par défaut.</p>' : '<p class="muted small" style="margin-top:12px">Prix officiels issus du wiki League of Legends (hors promotions). Si le wiki est injoignable, le prix habituel de la rareté est affiché.</p>'}`;
  } else body.innerHTML = `<section class="panel pad"><p class="lore">${esc(full.lore)}</p></section>`;
}
