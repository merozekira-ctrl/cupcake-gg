// Patch notes : notes officielles découpées par champion / objet, buffs et nerfs, comparaison des données du jeu.
import { S, api, esc, setTitle, loading, errorState, champImg, champOf, champByKey, champHref, itemImg } from '../core.js';

const KINDS = { buff: 'Buff', nerf: 'Nerf', adjust: 'Ajusté', new: 'Nouveau' };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(LOC, { day: 'numeric', month: 'long', year: 'numeric' }) : '');

// « Libellé : avant → après » : l'ancienne valeur barrée, la nouvelle mise en avant.
function fmtLine(t) {
  const s = String(t);
  const i = s.indexOf('→');
  if (i < 0) return esc(s);
  const left = s.slice(0, i).trim();
  const right = s.slice(i + 1).trim();
  const c = left.lastIndexOf(' : ') >= 0 ? left.lastIndexOf(' : ') : left.lastIndexOf(': ');
  const label = c >= 0 ? left.slice(0, c + (left[c] === ' ' ? 2 : 1)).trim() : '';
  const old = c >= 0 ? left.slice(c + (left[c] === ' ' ? 3 : 2)).trim() : left;
  return `${label ? `<span class="lb">${esc(label)}</span> ` : ''}<span class="old">${esc(old)}</span><span class="arr">→</span><span class="new">${esc(right)}</span>`;
}

function entryCard(e, patch) {
  const c = e.champ ? champByKey(e.champ) || (e.key && champOf(e.key)) : null;
  const icon = c ? champImg(c.key, 52) : e.item ? itemImg(e.item, 52) : '';
  const name = c ? c.name : e.item && S.st.items[e.item] ? S.st.items[e.item].name : e.name;
  const head = c ? `<a href="${champHref(c)}">${icon}</a><a href="${champHref(c)}"><h3>${esc(name)}</h3></a>` : `${icon}<h3>${esc(name)}</h3>`;
  const groups = (e.groups || []).filter((g) => g.lines?.length);
  return `<article class="pn-card k-${esc(e.kind || 'adjust')}"${c ? ` id="c-${esc(c.id)}"` : ''} data-kind="${esc(e.kind || 'adjust')}">
    <div class="pn-card-head">${head}${e.kind ? `<span class="kind kind-${esc(e.kind)}">${KINDS[e.kind] || ''}</span>` : ''}</div>
    ${e.summary ? `<p class="pn-sum">${esc(e.summary)}</p>` : ''}
    ${groups.map((g) => `<div class="pn-grp">${g.title ? `<h4>${esc(g.title)}</h4>` : ''}<ul>${g.lines.map((l) => `<li>${fmtLine(l)}</li>`).join('')}</ul></div>`).join('')}
    ${e.context ? `<p class="pn-sum" style="margin-top:8px">${esc(e.context)}</p>` : ''}
  </article>`;
}

function sectionHtml(s, patch) {
  const entries = s.entries || [];
  return `<section class="pn-sec">
    <div class="pn-sec-head"><h2>${esc(s.title)}</h2>${entries.length ? `<span>${entries.length} changement${entries.length > 1 ? 's' : ''}</span>` : ''}</div>
    ${entries.length ? `<div class="pn-grid">${entries.map((e) => entryCard(e, patch)).join('')}</div>` : ''}
    ${s.lines?.length ? `<div class="panel"><ul class="pn-lines">${s.lines.map((l) => `<li>${fmtLine(l)}</li>`).join('')}</ul></div>` : ''}
  </section>`;
}

export async function render(el, { v }, ctx) {
  el.innerHTML = loading('Chargement des patchs…');
  let list;
  try {
    list = await api('/patches');
  } catch (e) {
    if (ctx.alive()) el.innerHTML = errorState(e);
    return;
  }
  if (!ctx.alive()) return;
  const known = list.list;
  const cur = known.find((x) => x.patch === v) || known.find((x) => x.counts) || known[0];
  if (!cur) {
    el.innerHTML = '<div class="panel state"><p class="state-title">Aucun patch connu</p></div>';
    return;
  }
  setTitle(`Patch ${cur.patch}`);
  el.innerHTML = `
    <div class="page-head" style="margin-bottom:16px">
      <div><div class="page-kicker">Patch notes</div><h1 class="grad-title">Notes de patch</h1><p>Les changements de chaque patch, champion par champion : buffs, nerfs et ajustements, avec les anciennes et nouvelles valeurs.</p></div>
    </div>
    <div class="pn-layout">
      <nav class="pn-side" aria-label="Patchs">${known
        .map((x, i) => `<a class="pn-item" href="#/patch/${esc(x.patch)}"${x.patch === cur.patch ? ' aria-current="page"' : ''}><b>Patch ${esc(x.patch)}</b><small>${x.date ? esc(fmtDate(x.date)) : x.counts ? '' : 'Notes officielles'}${x.counts ? `${x.date ? ' · ' : ''}${x.counts.champs} champions` : ''}</small>${i === 0 ? '<span class="nav-new new">NEW</span>' : ''}</a>`)
        .join('')}</nav>
      <div id="pnBody">${loading('Lecture des notes…')}</div>
    </div>`;
  const body = el.querySelector('#pnBody');
  let notes;
  try {
    notes = await api(`/patch-notes/${cur.patch}${document.documentElement.lang === 'en' ? '?lang=en_US' : ''}`);
  } catch (e) {
    if (ctx.alive()) body.innerHTML = errorState(e);
    return;
  }
  if (!ctx.alive()) return;
  const secs = notes.sections || [];
  const champSecs = secs.filter((s) => /champion/i.test(s.title));
  const champs = champSecs.flatMap((s) => s.entries || []);
  const byKind = (k) => champs.filter((e) => e.kind === k);
  const icon = (e) => {
    const c = champByKey(e.champ || '') || (e.key && champOf(e.key));
    return c ? `<a href="#c-${esc(c.id)}" data-jump="c-${esc(c.id)}" title="${esc(c.name)}">${champImg(c.key, 34)}</a>` : '';
  };
  body.innerHTML = `
    <section class="pn-hero">
      ${notes.image ? `<img src="${esc(notes.image)}" alt="" loading="lazy">` : ''}
      <div class="pn-hero-in">
        <div><h1>Patch ${esc(cur.patch)}</h1><p>${esc(fmtDate(notes.date || cur.date))}${champs.length ? ` · ${champs.length} champions modifiés` : ''}</p></div>
        <a class="btn" href="${esc(notes.url || cur.url)}" target="_blank" rel="noopener noreferrer">Notes officielles
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M8 4h8v8M16 4 6 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></a>
      </div>
    </section>
    ${champs.length || notes.highlights?.length ? `<div class="pn-overview">
      ${notes.highlights?.length ? `<section class="panel"><div class="panel-title"><h2>À retenir</h2></div><ul class="pn-hl">${notes.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></section>` : ''}
      ${champs.length ? `<section class="panel"><div class="panel-title"><h2>En un coup d’œil</h2><span class="muted small">Clique pour aller au champion</span></div><div class="pn-counts">${['buff', 'nerf', 'adjust']
        .map((k) => (byKind(k).length ? `<div class="pn-count"><span class="kind kind-${k}">${KINDS[k]}s · ${byKind(k).length}</span><span class="champs">${byKind(k).map(icon).join('')}</span></div>` : ''))
        .join('')}</div></section>` : ''}
    </div>` : ''}
    ${champs.length ? `<div class="pn-filter">
      <div class="chips" role="group" aria-label="Filtrer les champions">
        <button class="chip" type="button" data-k="" aria-pressed="true">Tous</button>
        <button class="chip" type="button" data-k="buff" aria-pressed="false">Buffs</button>
        <button class="chip" type="button" data-k="nerf" aria-pressed="false">Nerfs</button>
        <button class="chip" type="button" data-k="adjust" aria-pressed="false">Ajustements</button>
      </div>
    </div>` : ''}
    ${secs.length ? secs.map((s) => sectionHtml(s, cur.patch)).join('') : `<div class="panel state"><p class="state-title">Notes détaillées indisponibles</p><p>Le site officiel n’a pas pu être lu. Les changements détectés automatiquement dans les données du jeu sont listés ci-dessous.</p></div>`}
    <details class="panel pn-auto pn-sec" id="pnAuto"><summary><span>Changements détectés dans les données du jeu <span class="muted small">(comparaison automatique Data Dragon)</span></span></summary><div id="pnAutoBody">${loading()}</div></details>
    <p class="pn-src">${notes.source === 'riot' ? 'Contenu extrait de l’article officiel de Riot Games.' : notes.source === 'seed' ? 'Résumé rédigé à partir de l’article officiel de Riot Games.' : ''} Valeurs indicatives : la référence reste l’article officiel.</p>`;

  // Version anglaise sans article anglais disponible : le contenu des notes reste en français.
  if (document.documentElement.lang === 'en' && notes.lang === 'fr' && secs.length) {
    body.querySelectorAll('.pn-grid, .pn-hl').forEach((x) => x.setAttribute('data-nt', ''));
    body.querySelector('.pn-hero')?.insertAdjacentHTML('afterend', '<p class="pn-lang-note" data-nt>The official English notes could not be loaded yet: change details are shown in French.</p>');
  }
  body.querySelectorAll('[data-k]').forEach((b) =>
    b.addEventListener('click', () => {
      body.querySelectorAll('[data-k]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      const k = b.dataset.k;
      body.querySelectorAll('.pn-sec .pn-card[id^="c-"]').forEach((card) => {
        card.hidden = !!k && card.dataset.kind !== k;
      });
    })
  );
  body.querySelectorAll('[data-jump]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const t = document.getElementById(a.dataset.jump);
      if (!t) return;
      t.hidden = false;
      t.scrollIntoView({ behavior: 'smooth', block: 'center' });
      t.animate([{ boxShadow: '0 0 0 3px rgba(255,111,174,.9)' }, { boxShadow: '0 0 0 0 rgba(255,111,174,0)' }], { duration: 1400 });
    })
  );
  // Ancre directe (#/patch/26.21#c-Ahri n'est pas possible avec le routeur : on lit ?c= si présent).
  if (ctx.query.c) setTimeout(() => body.querySelector(`[data-jump="c-${CSS.escape(ctx.query.c)}"]`)?.click(), 200);

  const auto = body.querySelector('#pnAuto');
  auto.addEventListener(
    'toggle',
    async () => {
      if (!auto.open || auto.dataset.ready) return;
      auto.dataset.ready = '1';
      const box = auto.querySelector('#pnAutoBody');
      try {
        const d = await api(`/patch-diff/${cur.patch}`);
        const card = (x, isItem) => {
          const c = !isItem && (champByKey(x.id) || champOf(x.key));
          const lines = (x.lines || []).map((l) => (typeof l === 'string' ? { g: '', t: l } : l));
          const groups = {};
          for (const l of lines) (groups[l.g] = groups[l.g] || []).push(l.t);
          return entryCard({ champ: c ? c.id : null, item: isItem ? x.id : null, name: x.name, kind: x.kind, groups: Object.entries(groups).map(([title, ls]) => ({ title, lines: ls })) });
        };
        const blocks = [];
        if (d.newChamps?.length) blocks.push(`<p class="pad-x"><b>Nouveaux champions :</b> ${d.newChamps.map((c) => esc(c.name)).join(', ')}</p>`);
        if (d.champions?.length) blocks.push(`<div class="pn-grid">${d.champions.map((x) => card(x, false)).join('')}</div>`);
        if (d.items?.length) blocks.push(`<div class="pn-grid" style="margin-top:12px">${d.items.map((x) => card(x, true)).join('')}</div>`);
        if (d.newItems?.length) blocks.push(`<p class="pad-x" style="margin-top:12px"><b>Nouveaux objets :</b> ${d.newItems.map((x) => esc(x.name)).join(', ')}</p>`);
        if (d.removedItems?.length) blocks.push(`<p class="pad-x"><b>Objets retirés :</b> ${d.removedItems.map((x) => esc(x.name)).join(', ')}</p>`);
        box.innerHTML = blocks.length ? `${blocks.join('')}<p class="muted small pad">Comparaison des versions ${esc(d.from)} et ${esc(d.to)} : statistiques de base, délais de récupération, coûts, portées et objets.</p>` : '<p class="muted pad">Aucune différence chiffrée détectée entre les deux versions.</p>';
      } catch (e) {
        box.innerHTML = `<p class="muted pad">${esc(e.message)}</p>`;
      }
    },
    false
  );
}
