// Profil : score cupcake, jauge, graphiques, rank IA, regroupement par jour, champions mis en avant.
import { esc, num, dec, pct, kdaRatio, kdaText, champImg, champOf, champHref, isArena, scoreMatch, crest, rankText, wrBadge, wrTier, levelRing, allyLevel, TIERS } from '../core.js';

/* ---------- Statistiques par partie ---------- */

// Ajoute à chaque partie le score cupcake (0-100), la place dans la partie et MVP / ACE.
export function gameStats(items, puuid) {
  const out = [];
  for (const m of items) {
    if (m.remake) continue;
    const idx = m.parts.findIndex((p) => p.puuid === puuid);
    if (idx < 0) continue;
    const me = m.parts[idx];
    const sc = scoreMatch(m);
    const arena = isArena(m.q);
    const group = m.parts.filter((p) => (arena ? p.sub === me.sub : p.team === me.team));
    const tk = group.reduce((s, p) => s + p.k, 0);
    const win = arena ? me.place && me.place <= 4 : me.win;
    out.push({
      m,
      me,
      win: !!win,
      score: Math.round(sc.scores[idx] * 10),
      place: sc.rank[idx],
      mvp: idx === sc.mvp,
      ace: idx === sc.ace,
      kp: tk ? (me.k + me.a) / tk : 0,
      min: Math.max(1, m.dur / 60),
      arena,
    });
  }
  return out;
}

/* ---------- Jauge de winrate (demi-cercle) ---------- */

export function gauge(w, n) {
  const p = n ? w / n : 0;
  // Deux arcs séparés par un petit espace : victoires (clair) puis défaites (rouge), extrémités arrondies.
  const pt = (t) => {
    const a = Math.PI * (1 - t);
    return `${(50 + 40 * Math.cos(a)).toFixed(2)} ${(50 - 40 * Math.sin(a)).toFixed(2)}`;
  };
  const arc = (t0, t1) => (t1 - t0 > 0.002 ? `M${pt(t0)} A40 40 0 0 1 ${pt(t1)}` : '');
  const gap = p > 0.02 && p < 0.98 ? 0.025 : 0;
  const winD = arc(0, Math.max(0, p - gap / 2));
  const lossD = arc(Math.min(1, p + gap / 2), 1);
  return `<div class="gauge" role="img" aria-label="${pct(w, n)} de victoires">
    <svg viewBox="0 0 100 56" aria-hidden="true">
      ${n ? '' : `<path d="${arc(0, 1)}" class="g-track"/>`}
      ${lossD ? `<path d="${lossD}" class="g-loss"/>` : ''}
      ${winD ? `<path d="${winD}" class="g-win"/>` : ''}
    </svg>
    <div class="g-txt"><b>${n ? Math.round(p * 100) + ' %' : '–'}</b><small>winrate</small></div>
    <span class="gauge-wl"><span class="good">${w} V</span> – <span class="bad">${n - w} D</span></span>
  </div>`;
}

/* ---------- Graphique (LP si historique, sinon score cupcake par partie) ---------- */

const TIER_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIVS = ['IV', 'III', 'II', 'I'];
const valueLabel = (v) => {
  if (v >= 2800) return `${num(v - 2800)} LP`;
  const t = Math.floor(v / 400);
  const d = Math.floor((v % 400) / 100);
  return `${TIERS[TIER_ORDER[t]] || ''} ${DIVS[d] || ''}`;
};

function linePath(pts) {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
}

export function chartPanel(sum, games) {
  const hist = (sum.lpHistory || []).filter((x) => x.v != null);
  const W = 300;
  const H = 120;
  if (hist.length >= 2) {
    const vs = hist.map((x) => x.v);
    const lo = Math.min(...vs) - 20;
    const hi = Math.max(...vs) + 20;
    const pts = hist.map((x, i) => [(i / (hist.length - 1)) * W, H - ((x.v - lo) / (hi - lo)) * (H - 10) - 5]);
    const first = hist[0];
    const last = hist[hist.length - 1];
    const diff = last.v - first.v;
    const peak = hist.reduce((a, b) => (b.v > a.v ? b : a));
    return `<div class="panel-title"><h2>Évolution des LP</h2><span class="small ${diff >= 0 ? 'good' : 'bad'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)} LP</span></div>
      <div class="chart">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Évolution des LP">
          <defs><linearGradient id="lpg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--c1)" stop-opacity=".35"/><stop offset="1" stop-color="var(--c1)" stop-opacity="0"/></linearGradient></defs>
          <path d="${linePath(pts)}L${W} ${H}L0 ${H}Z" fill="url(#lpg)"/>
          <path d="${linePath(pts)}" fill="none" stroke="var(--c1)" stroke-width="2.4" vector-effect="non-scaling-stroke"/>
        </svg>
      </div>
      <div class="chart-foot"><span>Pic <b>${esc(valueLabel(peak.v))}</b></span><span>Suivi depuis <b>${new Date(first.t).toLocaleDateString(LOC, { day: 'numeric', month: 'short' })}</b></span></div>`;
  }
  const g = [...games].reverse().slice(-20);
  if (g.length < 2) {
    return `<div class="panel-title"><h2>Graphique</h2></div><p class="empty-hint">Le graphique apparaît après quelques parties. Les LP sont enregistrés à chaque visite du profil.</p>`;
  }
  // Courbe du score par partie (lissée) et surface en dessous, points colorés selon le résultat.
  const xs = (i) => 8 + (i / (g.length - 1)) * (W - 16);
  const ys = (v) => H - 6 - (v / 100) * (H - 18);
  const pts = g.map((x, i) => [xs(i), ys(x.score)]);
  const smooth = pts
    .map(([x, y], i) => {
      if (!i) return `M${x.toFixed(1)} ${y.toFixed(1)}`;
      const [px, py] = pts[i - 1];
      const cx = (px + x) / 2;
      return `C${cx.toFixed(1)} ${py.toFixed(1)} ${cx.toFixed(1)} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join('');
  const avg = Math.round(g.reduce((s, x) => s + x.score, 0) / g.length);
  const dots = g
    .map((x, i) => `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="3.4" class="${x.win ? 'd-w' : 'd-l'}"><title>${x.score}/100 · ${x.win ? 'Victoire' : 'Défaite'} · ${esc(champOf(x.me.champ)?.name || '')}</title></circle>`)
    .join('');
  return `<div class="panel-title"><h2>Score cupcake</h2><span class="small muted">${g.length} dernières parties</span></div>
    <div class="chart">
      <svg viewBox="0 0 ${W} ${H}" aria-label="Score cupcake par partie">
        <defs><linearGradient id="scg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--c1)" stop-opacity=".32"/><stop offset="1" stop-color="var(--c1)" stop-opacity="0"/></linearGradient></defs>
        <line x1="0" x2="${W}" y1="${ys(avg).toFixed(1)}" y2="${ys(avg).toFixed(1)}" class="mid"/>
        <path d="${smooth}L${pts[pts.length - 1][0].toFixed(1)} ${H}L${pts[0][0].toFixed(1)} ${H}Z" fill="url(#scg)"/>
        <path d="${smooth}" fill="none" stroke="var(--c1)" stroke-width="2.4" stroke-linecap="round"/>
        ${dots}
      </svg>
    </div>
    <div class="chart-foot"><span>Moyenne <b>${avg}/100</b></span><span><i class="lg-w"></i>Victoire <i class="lg-l"></i>Défaite</span></div>`;
}

/* ---------- Rank IA ---------- */
// Compare le niveau de jeu (place dans la partie, score cupcake, winrate, KDA) au rang actuel.

export function rankIa(sum, games) {
  const r = sum.ranked?.solo || sum.ranked?.flex;
  const g = games.filter((x) => !x.arena);
  if (!r) return `<div class="panel-title"><h2>Rank IA cupcake</h2></div><p class="empty-hint">Joueur non classé : le rank IA a besoin d’un rang Solo/Duo ou Flex.</p>`;
  if (g.length < 5) return `<div class="panel-title"><h2>Rank IA cupcake</h2></div><p class="empty-hint">Encore ${5 - g.length} partie${5 - g.length > 1 ? 's' : ''} à charger pour estimer le rang mérité.</p>`;
  const n = g.length;
  const avgPlace = g.reduce((s, x) => s + x.place, 0) / n;
  const avgScore = g.reduce((s, x) => s + x.score, 0) / n;
  const wr = g.filter((x) => x.win).length / n;
  const kda = kdaRatio(g.reduce((s, x) => s + x.me.k, 0), g.reduce((s, x) => s + x.me.d, 0), g.reduce((s, x) => s + x.me.a, 0));
  // Indice entre -1 et 1 : 45 % place dans la partie, 25 % score, 20 % winrate, 10 % KDA.
  const z =
    0.45 * ((5.5 - avgPlace) / 4.5) +
    0.25 * ((avgScore - 48) / 35) +
    0.2 * ((wr - 0.5) * 3) +
    0.1 * Math.max(-1, Math.min(1, (Math.min(kda, 8) - 3) / 3));
  const conf = Math.min(1, n / 20);
  const delta = Math.max(-6, Math.min(6, Math.round(z * 6 * conf)));
  const t = TIER_ORDER.indexOf(r.tier);
  const cur = t >= 7 ? 28 + (t - 7) : t * 4 + DIVS.indexOf(r.rank);
  const est = Math.max(0, Math.min(30, cur + delta));
  const estRank = est >= 28 ? { tier: TIER_ORDER[Math.min(9, 7 + est - 28)], rank: 'I' } : { tier: TIER_ORDER[Math.floor(est / 4)], rank: DIVS[est % 4] };
  const verdict = delta > 0 ? 'mérite mieux' : delta < 0 ? 'est surclassé' : 'est à sa place';
  const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'eq';
  const pctz = Math.round(((z + 1) / 2) * 100);
  const facts = [
    [`Place moyenne dans la partie`, `${dec(avgPlace, 1)}/10`, avgPlace <= 4.5],
    [`Score cupcake moyen`, `${Math.round(avgScore)}/100`, avgScore >= 55],
    [`Winrate`, pct(wr, 1), wr >= 0.5],
    [`KDA`, kdaText(kda), kda >= 3],
  ];
  return `<div class="panel-title"><h2>Rank IA cupcake</h2><span class="small muted">${n} parties · confiance ${Math.round(conf * 100)} %</span></div>
    <div class="ia ${cls}">
      <div class="ia-ranks">
        <div>${crest(r, 'md')}<small>Actuel</small><b>${esc(rankText(r))}</b></div>
        <span class="ia-arrow" aria-hidden="true">${delta > 0 ? '▲' : delta < 0 ? '▼' : '='}</span>
        <div>${crest(estRank, 'md')}<small>Mérité</small><b>${esc(rankText(estRank))}</b></div>
      </div>
      <p class="ia-verdict">Selon ses stats, ce joueur <b>${verdict}</b>${delta ? ` (${delta > 0 ? '+' : ''}${delta} division${Math.abs(delta) > 1 ? 's' : ''})` : ''}.</p>
      <div class="ia-meter" aria-hidden="true"><b class="ia-fill ${pctz >= 50 ? 'up' : 'down'}" style="left:${Math.min(50, pctz)}%;width:${Math.abs(pctz - 50)}%"></b><i style="left:${pctz}%"></i></div>
      <ul class="ia-facts">${facts.map(([l, v, ok]) => `<li><span>${l}</span><b class="${ok ? 'good' : 'bad'}">${v}</b></li>`).join('')}</ul>
    </div>`;
}

/* ---------- Résumé des parties (en-tête de l'historique) ---------- */

const kdaColor = (k) => (k >= 5 ? 'var(--wr5)' : k >= 3.5 ? 'var(--wr4)' : k >= 2.2 ? 'var(--wr3)' : k >= 1.5 ? 'var(--wr2)' : 'var(--wr0)');

export function summaryBlock(sm, games) {
  if (!games.length) return '<div class="state"><p>Aucune partie terminée à analyser pour ce filtre.</p></div>';
  const n = games.length;
  const w = games.filter((x) => x.win).length;
  const k = games.reduce((s, x) => s + x.me.k, 0) / n;
  const d = games.reduce((s, x) => s + x.me.d, 0) / n;
  const a = games.reduce((s, x) => s + x.me.a, 0) / n;
  const place = games.reduce((s, x) => s + x.place, 0) / n;
  const score = Math.round(games.reduce((s, x) => s + x.score, 0) / n);
  const mvp = games.filter((x) => x.mvp).length;
  const ace = games.filter((x) => x.ace).length;
  const kda = kdaRatio(k, d, a);
  // Niveau moyen des alliés sur les 10 dernières parties (score cupcake de chaque coéquipier).
  let allySum = 0;
  let allyN = 0;
  for (const g of games.slice(0, 10)) {
    const sc = scoreMatch(g.m);
    g.m.parts.forEach((p, i) => {
      if (p === g.me || (g.arena ? p.sub !== g.me.sub : p.team !== g.me.team)) return;
      allySum += sc.scores[i] * 10;
      allyN++;
    });
  }
  const allies = allyN ? allySum / allyN : null;
  return `
    <div class="st st-wr"><div class="sum-label">Victoires · ${n} parties</div>${gauge(w, n)}</div>
    <div class="st st-ch"><div class="sum-label">Champions les plus joués</div>
      ${sm.champList
        .slice(0, 3)
        .map((c) => {
          const kd = kdaRatio(c.k, c.d, c.a);
          const name = esc(champOf(c.id)?.name || '?');
          return `<div class="st-champ" title="${name} · ${c.n} partie${c.n > 1 ? 's' : ''}">${champImg(c.id, 38)}<span class="stc-l1"><b class="stc-wr" style="color:var(--wr${wrTier(c.w / c.n)})">${Math.round((c.w / c.n) * 100)}%</b><span class="stc-rec">${c.w}V–${c.n - c.w}D</span></span><span class="stc-l2"><b class="stc-kda" style="color:${kdaColor(kd)}">${kdaText(kd)}</b> KDA<span class="stc-name">${name}</span></span></div>`;
        })
        .join('')}
    </div>
    <div class="st st-kda"><div class="sum-label">KDA moyen</div>
      <b class="st-big ${kda >= 4 ? 'good' : kda < 2 ? 'bad' : ''}">${kdaText(kda)}</b>
      <div class="kda3">
        <span><b>${dec(k)}</b><small>kills</small></span>
        <span class="dd"><b>${dec(d)}</b><small>morts</small></span>
        <span><b>${dec(a)}</b><small>assists</small></span>
      </div>
      <small class="st-hint">(kills + assists) ÷ morts</small>
    </div>
    <div class="st st-place"><div class="sum-label">Place moyenne</div>
      <b class="st-big">${dec(place, 1)}<small> / 10</small></b>
      <div class="place-bar" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i class="${i + 1 <= Math.round(place) ? 'on' : ''}"></i>`).join('')}</div>
      <small class="st-hint">rang moyen parmi les 10 joueurs</small>
      <span class="row" style="gap:5px">${mvp ? `<span class="badge gold">MVP ×${mvp}</span>` : ''}${ace ? `<span class="badge ace">ACE ×${ace}</span>` : ''}</span>
    </div>
    <div class="st st-score"><div class="sum-label">Score cupcake</div>${scoreBig(score)}<small class="st-hint">performance sur 100 (KDA, dégâts, or, vision…)</small></div>
    ${allies == null ? '' : `<div class="st st-allies"><div class="sum-label">Niveau des alliés</div>${levelRing(allyLevel(allies), { size: 'lg', avatar: true })}<small class="st-hint">sur les ${Math.min(10, games.length)} dernières parties</small></div>`}`;
}
const scoreBig = (v) => `<span class="score score-lg${v >= 80 ? ' s-hi' : ''}" style="--p:${v};--c:${v >= 60 ? 'var(--wr4)' : v >= 45 ? 'var(--wr3)' : v >= 30 ? 'var(--wr1)' : 'var(--wr0)'}"><b>${v}</b></span>`;

/* ---------- Regroupement par jour ---------- */

const dayKey = (t) => new Date(t).toDateString();
export function dayHeader(list, puuid) {
  const games = gameStats(list, puuid);
  const w = games.filter((x) => x.win).length;
  const l = games.length - w;
  const score = games.length ? Math.round(games.reduce((s, x) => s + x.score, 0) / games.length) : null;
  const date = new Date(list[0].start).toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'short' });
  return `<div class="day-head"><b>${esc(date)}</b><span class="grow"></span>${score != null ? `<span class="day-score">Score cupcake : <b>${score}</b></span>` : ''}${w ? `<span class="day-w">${w} victoire${w > 1 ? 's' : ''}</span>` : ''}${l ? `<span class="day-l">${l} défaite${l > 1 ? 's' : ''}</span>` : ''}</div>`;
}
export function groupByDay(items) {
  const groups = [];
  for (const m of items) {
    const k = dayKey(m.start);
    const last = groups[groups.length - 1];
    if (last && last.k === k) last.items.push(m);
    else groups.push({ k, items: [m] });
  }
  return groups;
}

/* ---------- Champions mis en avant (Main, meilleur score, winrate, en forme) ---------- */

export function champHighlights(items, puuid, mastery) {
  const games = gameStats(items, puuid);
  if (!games.length && !mastery?.length) return '';
  const by = {};
  for (const x of games) {
    const c = by[x.me.champ] || (by[x.me.champ] = { id: x.me.champ, n: 0, w: 0, score: 0, k: 0, d: 0, a: 0, seq: [] });
    c.n++;
    c.w += x.win;
    c.score += x.score;
    c.k += x.me.k;
    c.d += x.me.d;
    c.a += x.me.a;
    c.seq.push(x.win);
  }
  const list = Object.values(by);
  const total = games.length;
  const cards = [];
  const main = [...list].sort((a, b) => b.n - a.n)[0];
  const topM = [...(mastery || [])].sort((a, b) => b.pts - a.pts)[0];
  if (main) cards.push(['main', 'Main', `${main.n} partie${main.n > 1 ? 's' : ''}`, `${pct(main.n, total)} des parties · ${champOf(main.id)?.name || ''}`, main.id]);
  else if (topM) cards.push(['main', 'Main', `${num(topM.pts)} pts`, `Maîtrise niveau ${topM.lvl} · ${champOf(topM.c)?.name || ''}`, topM.c]);
  const reliable = list.filter((c) => c.n >= 2);
  const pool = reliable.length ? reliable : list;
  const bestScore = [...pool].sort((a, b) => b.score / b.n - a.score / a.n)[0];
  if (bestScore) cards.push(['score', 'Meilleur score cupcake', `${Math.round(bestScore.score / bestScore.n)}/100`, `${bestScore.n} partie${bestScore.n > 1 ? 's' : ''} · ${champOf(bestScore.id)?.name || ''}`, bestScore.id]);
  const bestWr = [...pool].sort((a, b) => b.w / b.n - a.w / a.n || b.n - a.n)[0];
  if (bestWr) cards.push(['wr', 'Meilleur winrate', pct(bestWr.w, bestWr.n), `${bestWr.w}V-${bestWr.n - bestWr.w}D · ${champOf(bestWr.id)?.name || ''}`, bestWr.id]);
  const bestKda = [...pool].sort((a, b) => kdaRatio(b.k, b.d, b.a) - kdaRatio(a.k, a.d, a.a))[0];
  if (bestKda) cards.push(['kda', 'Meilleur KDA', kdaText(kdaRatio(bestKda.k, bestKda.d, bestKda.a)), `${dec(bestKda.k / bestKda.n)}/${dec(bestKda.d / bestKda.n)}/${dec(bestKda.a / bestKda.n)} · ${champOf(bestKda.id)?.name || ''}`, bestKda.id]);
  // En forme : plus longue série de victoires en cours (parties les plus récentes d'abord).
  const streak = (c) => {
    let s = 0;
    for (const w of c.seq) {
      if (!w) break;
      s++;
    }
    return s;
  };
  const hot = [...list].sort((a, b) => streak(b) - streak(a) || b.w / b.n - a.w / a.n)[0];
  if (hot && streak(hot) >= 1) cards.push(['hot', 'En forme', `${streak(hot)} V d’affilée`, `Dernières parties · ${champOf(hot.id)?.name || ''}`, hot.id]);
  return `<div class="ch-highlights">${cards
    .map(([k, label, big, sub, id]) => {
      const c = champOf(id);
      return `<a class="chh chh-${k}" href="${c ? champHref(c) : '#/champions'}"><span><small>${label}</small><b>${esc(big)}</b><span>${esc(sub)}</span></span>${champImg(id, 64)}</a>`;
    })
    .join('')}</div>`;
}
