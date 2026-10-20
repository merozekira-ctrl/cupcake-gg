// Multi-recherche : colle le chat du salon, analyse chaque joueur.
import {
  S, api, esc, num, dec, pct, kdaRatio, kdaText, champImg, champOf, crest, rankText, playerHref, profileImg,
  regionOptions, setPlatform, setTitle, store, parseRiotId, roleIcon, ROLES, errorState,
} from '../core.js';
import { resultOf } from './match.js';

const LOBBY_SUFFIX = /\s*(a rejoint le salon|a rejoint la partie|joined the lobby|has joined the lobby|left the lobby|a quitté le salon)\.?\s*$/i;

export function parsePlayers(text) {
  const out = [];
  const seen = new Set();
  for (let line of String(text).split(/[\n\r,;]+/)) {
    line = line.replace(LOBBY_SUFFIX, '').trim();
    if (!line.includes('#')) continue;
    const { name, tag } = parseRiotId(line);
    const cleanTag = (tag.match(/^[\p{L}\p{N}]{2,5}/u) || [''])[0];
    const cleanName = name.replace(/^.*:\s*/, '').trim().slice(-16);
    if (!cleanName || !cleanTag) continue;
    const key = `${cleanName}#${cleanTag}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: cleanName, tag: cleanTag });
  }
  return out.slice(0, 10);
}

export async function render(el, _p, ctx) {
  setTitle('Multi-recherche');
  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Multi-recherche</h1>
        <p>Colle les messages du salon (« Nom#TAG a rejoint le salon ») ou une liste de Riot ID, un par ligne ou séparés par des virgules. Jusqu’à 10 joueurs.</p>
      </div>
    </div>
    <form class="multi-form" id="multiForm">
      <div>
        <label class="sr" for="multiText">Joueurs à analyser</label>
        <textarea class="field" id="multiText" rows="6" spellcheck="false" placeholder="Joueur Un#EUW a rejoint le salon.&#10;Joueur Deux#1234 a rejoint le salon.&#10;Joueur Trois#FR1"></textarea>
      </div>
      <div class="side">
        <label class="sr" for="multiRegion">Région</label>
        <select class="select" id="multiRegion">${regionOptions(S.platform)}</select>
        <button class="btn btn-primary" type="submit">Analyser</button>
      </div>
    </form>
    <p class="muted small" id="multiHint" style="margin-top:8px">Chaque carte charge le rang et les 5 dernières parties du joueur. Avec une clé de développement (100 requêtes toutes les 2 minutes), un salon complet peut prendre jusqu’à une minute.</p>
    <div class="multi-grid" id="multiGrid" aria-live="polite"></div>`;

  const ta = el.querySelector('#multiText');
  ta.value = store.get('multi-last', '');
  el.querySelector('#multiRegion').addEventListener('change', (e) => setPlatform(e.target.value));
  el.querySelector('#multiForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const players = parsePlayers(ta.value);
    const hint = el.querySelector('#multiHint');
    if (!players.length) {
      hint.textContent = 'Aucun Riot ID reconnu. Vérifie que chaque joueur a la forme Nom#TAG.';
      hint.classList.add('bad');
      return;
    }
    hint.classList.remove('bad');
    hint.textContent = `${players.length} joueur${players.length > 1 ? 's' : ''} reconnu${players.length > 1 ? 's' : ''}.`;
    store.set('multi-last', ta.value);
    run(el.querySelector('#multiGrid'), players, el.querySelector('#multiRegion').value, ctx);
  });
}

function run(grid, players, platform, ctx) {
  grid.innerHTML = players
    .map(
      (p, i) => `<article class="panel mp" id="mp-${i}" aria-busy="true">
        <div class="mp-top"><div class="skel" style="width:40px;height:40px;border-radius:50%"></div><div class="grow"><strong>${esc(p.name)}</strong> <span class="muted">#${esc(p.tag)}</span></div></div>
        <div class="skel" style="height:22px"></div><div class="skel" style="height:44px"></div>
      </article>`
    )
    .join('');
  players.forEach((p, i) => loadCard(grid.querySelector(`#mp-${i}`), p, platform, ctx));
}

async function loadCard(card, p, platform, ctx) {
  let sum;
  let matches = [];
  try {
    sum = await api(`/summoner/${platform}/${encodeURIComponent(p.name)}/${encodeURIComponent(p.tag)}`);
    const r = await api(`/matches/${platform}/${sum.puuid}?count=5`);
    matches = r.matches;
  } catch (e) {
    if (!ctx.alive()) return;
    card.removeAttribute('aria-busy');
    card.innerHTML = `<div class="mp-top"><div class="grow"><strong>${esc(p.name)}</strong> <span class="muted">#${esc(p.tag)}</span></div></div>${sum ? '' : `<p class="small bad">${esc(e.message)}</p>`}`;
    if (!sum) return;
  }
  if (!ctx.alive()) return;

  const games = matches
    .map((m) => ({ m, me: m.parts.find((x) => x.puuid === sum.puuid) }))
    .filter((g) => g.me);
  const done = games.filter((g) => !g.m.remake);
  const tot = done.reduce((s, { me }) => ({ k: s.k + me.k, d: s.d + me.d, a: s.a + me.a }), { k: 0, d: 0, a: 0 });
  const wins = done.filter(({ m, me }) => resultOf(m, me).cls === 'win').length;
  const champs = {};
  const roles = {};
  for (const { me } of done) {
    champs[me.champ] = (champs[me.champ] || 0) + 1;
    if (me.pos) roles[me.pos] = (roles[me.pos] || 0) + 1;
  }
  const topChamps = Object.entries(champs).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const mainRole = Object.entries(roles).sort((a, b) => b[1] - a[1])[0]?.[0];
  const r = sum.ranked.solo;
  const n = r ? r.w + r.l : 0;
  const mastery = [...sum.mastery].sort((a, b) => b.pts - a.pts).slice(0, 3);

  card.removeAttribute('aria-busy');
  card.innerHTML = `
    <div class="mp-top">
      ${profileImg(sum.icon, 40, true)}
      <div class="grow" style="min-width:0">
        <a href="${playerHref(platform, sum.name, sum.tag)}">${esc(sum.name)} <span class="muted">#${esc(sum.tag)}</span></a>
        <span class="muted small">Niveau ${sum.level}</span>
      </div>
      ${mainRole ? `<span title="Rôle principal : ${ROLES[mainRole]}">${roleIcon(mainRole)}</span>` : ''}
    </div>
    <div class="row">${crest(r || null, 'md')}<div class="grow"><strong>${rankText(r)}</strong>${r ? `<div class="small muted">${num(r.lp)} LP, ${pct(r.w, n)} sur ${n} parties</div>` : '<div class="small muted">Solo/Duo</div>'}</div></div>
    ${games.length
      ? `<div><div class="small muted" style="margin-bottom:4px">Forme récente, de la plus récente à la plus ancienne</div><div class="form">${games
          .map(({ m, me }) => {
            const res = resultOf(m, me).cls;
            return `<span class="${res === 'win' ? 'w' : res === 'loss' ? 'l' : 'r'}" title="${esc(champOf(me.champ)?.name || '')}">${res === 'win' ? 'V' : res === 'loss' ? 'D' : 'R'}</span>`;
          })
          .join('')}</div></div>
      <div class="mp-stats">
        <div><b>${done.length ? pct(wins, done.length) : '–'}</b><small>Victoires</small></div>
        <div><b>${done.length ? kdaText(kdaRatio(tot.k, tot.d, tot.a)) : '–'}</b><small>KDA</small></div>
        <div><b>${done.length ? `${dec(tot.k / done.length)}/${dec(tot.d / done.length)}/${dec(tot.a / done.length)}` : '–'}</b><small>Moyenne</small></div>
      </div>
      <div><div class="small muted" style="margin-bottom:4px">Joués récemment</div><div class="mp-champs">${topChamps.map(([c, k]) => `<div>${champImg(c, 32)}<span>${k}</span></div>`).join('')}</div></div>`
      : '<p class="small muted">Aucune partie récente.</p>'}
    ${mastery.length ? `<div><div class="small muted" style="margin-bottom:4px">Meilleures maîtrises</div><div class="mp-champs">${mastery.map((m) => `<div>${champImg(m.c, 28)}<span>${num(m.pts / 1000)} k</span></div>`).join('')}</div></div>` : ''}`;
}
