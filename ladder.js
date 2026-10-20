// Classement Challenger / Grand Maître / Maître d'une région.
import { S, api, esc, num, pct, crest, rankText, playerHref, regionOptions, setPlatform, setTitle, loading, errorState, profileImg } from '../core.js';

export async function render(el, { p }, ctx) {
  const platform = S.cfg.platforms[p] ? p : S.platform;
  setPlatform(platform);
  const queue = ctx.query.queue === 'flex' ? 'flex' : 'solo';
  const page = Math.max(1, parseInt(ctx.query.page, 10) || 1);
  const region = S.cfg.platforms[platform];
  setTitle(`Classement ${region.label}`);
  const href = (q, pg, pf = platform) => `#/classement/${pf}?queue=${q}${pg > 1 ? '&page=' + pg : ''}`;

  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Classement ${esc(region.label)}</h1>
        <p>Joueurs Challenger, Grand Maître et Maître de ${esc(region.name)}, triés par palier puis par LP.</p>
      </div>
      <div class="row wrap">
        <nav class="chips" aria-label="File">
          <a class="chip" href="${href('solo', 1)}"${queue === 'solo' ? ' aria-current="page"' : ''}>Solo/Duo</a>
          <a class="chip" href="${href('flex', 1)}"${queue === 'flex' ? ' aria-current="page"' : ''}>Flex</a>
        </nav>
        <label class="sr" for="lRegion">Région</label>
        <select class="select" id="lRegion">${regionOptions(platform)}</select>
      </div>
    </div>
    <div id="ladder">${loading('Chargement du classement…')}</div>`;

  el.querySelector('#lRegion').addEventListener('change', (e) => {
    setPlatform(e.target.value);
    location.hash = href(queue, 1, e.target.value);
  });

  if (!S.cfg.hasKey) {
    el.querySelector('#ladder').innerHTML = '<div class="panel state"><p>Le classement a besoin d’une clé API Riot dans le fichier <code>.env</code>.</p></div>';
    return;
  }

  let data;
  try {
    data = await api(`/ladder/${platform}?queue=${queue}&page=${page}`);
  } catch (e) {
    if (ctx.alive()) el.querySelector('#ladder').innerHTML = errorState(e);
    return;
  }
  if (!ctx.alive()) return;
  const box = el.querySelector('#ladder');
  if (!data.rows.length) {
    box.innerHTML = '<div class="panel state"><p class="state-title">Classement vide</p><p>Aucun joueur Maître ou plus pour cette file. C’est fréquent en début de saison.</p></div>';
    return;
  }

  box.innerHTML = `
    <p class="muted small" style="margin-bottom:10px">${num(data.total)} joueurs classés. Page ${data.page} sur ${data.pages}.</p>
    <div class="panel scroll-x"><table class="table">
      <thead><tr><th scope="col" class="num">Rang</th><th scope="col">Joueur</th><th scope="col">Palier</th><th scope="col" class="num">LP</th><th scope="col" class="num">V / D</th><th scope="col" style="min-width:140px">Taux de victoire</th></tr></thead>
      <tbody>${data.rows
        .map((r) => {
          const n = r.w + r.l;
          const flags = [r.hot ? '<span class="flag hot">En série</span>' : '', r.vet ? '<span class="flag">Vétéran</span>' : '', r.fresh ? '<span class="flag">Nouveau</span>' : ''].join('');
          return `<tr data-puuid="${esc(r.puuid || '')}">
            <td class="num"><b>${r.rank}</b></td>
            <td><div class="lad-player"><span class="lad-ic">${r.icon != null ? profileImg(r.icon, 36, true) : '<span class="skel lad-skel"></span>'}</span><div><div class="pn player-cell">${r.name ? `<a href="${playerHref(platform, r.name, r.tag)}">${esc(r.name)}</a> <span class="muted">#${esc(r.tag)}</span>` : r.puuid ? '<span class="skel name-pending" aria-label="Nom en cours de chargement"></span>' : '<span class="muted">Joueur masqué</span>'}</div>${flags ? `<div style="margin-top:3px">${flags}</div>` : ''}</div></div></td>
            <td><div class="row">${crest({ tier: r.tier }, 'sm')}<span>${rankText({ tier: r.tier })}</span></div></td>
            <td class="num"><b>${num(r.lp)}</b></td>
            <td class="num">${r.w} / ${r.l}</td>
            <td><div class="row"><span style="width:52px" class="num">${pct(r.w, n)}</span><div class="wr-split grow"><i style="width:${n ? (r.w / n) * 100 : 0}%"></i></div></div></td>
          </tr>`;
        })
        .join('')}</tbody>
    </table></div>
    <nav class="pager" aria-label="Pages du classement">
      ${data.page > 1 ? `<a class="btn" href="${href(queue, data.page - 1)}">Page précédente</a>` : ''}
      <span class="muted">${data.page} / ${data.pages}</span>
      ${data.page < data.pages ? `<a class="btn" href="${href(queue, data.page + 1)}">Page suivante</a>` : ''}
    </nav>`;

  // Les noms (Riot ID) ne sont pas fournis par le classement : on les complète ensuite.
  const missing = data.rows.filter((r) => r.puuid && (!r.name || r.icon == null)).map((r) => r.puuid);
  if (!missing.length) return;
  try {
    const names = await api(`/accounts/${platform}?puuids=${missing.join(',')}`);
    if (!ctx.alive()) return;
    box.querySelectorAll('tr[data-puuid]').forEach((tr) => {
      const n = names[tr.dataset.puuid];
      const cell = tr.querySelector('.player-cell');
      const ic = tr.querySelector('.lad-ic');
      if (ic && n?.icon != null) ic.innerHTML = profileImg(n.icon, 36, true);
      else if (ic && ic.querySelector('.lad-skel')) ic.innerHTML = '';
      if (!cell.querySelector('.name-pending')) return;
      cell.innerHTML = n ? `<a href="${playerHref(platform, n.name, n.tag)}">${esc(n.name)}</a> <span class="muted">#${esc(n.tag)}</span>` : '<span class="muted">Nom indisponible</span>';
    });
  } catch {
    box.querySelectorAll('.name-pending').forEach((x) => {
      x.outerHTML = '<span class="muted">Nom indisponible</span>';
    });
  }
}
