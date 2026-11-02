// Publicité Google AdSense.
// Rien ne se passe tant que le serveur n'expose pas de configuration (`S.cfg.ads`) :
// pas de script tiers chargé, aucun emplacement rendu.
// Les annonces sont demandées seulement quand l'emplacement approche de l'écran
// (meilleur taux de visibilité, moins de requêtes inutiles).
import { S, esc, EN } from './core.js';

const SCRIPT = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
let started = false;
let io = null;

export const adsOn = () => !!S.cfg?.ads?.client;

// kind : 'banner' (bande horizontale responsive) ou 'rect' (bloc de colonne latérale).
export function adSlot(name, kind = 'banner') {
  const a = S.cfg?.ads;
  const slot = a?.slots?.[name];
  if (!a?.client || !slot) return '';
  return `<div class="ad-slot ad-${kind}" data-nt><span class="ad-label">${EN ? 'Advertisement' : 'Publicité'}</span><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(a.client)}" data-ad-slot="${esc(slot)}" data-ad-format="${kind === 'rect' ? 'rectangle' : 'auto'}" data-full-width-responsive="true"${a.test ? ' data-adtest="on"' : ''}></ins></div>`;
}

function push(ins) {
  if (ins.dataset.pushed || !ins.isConnected || !ins.offsetWidth) return;
  ins.dataset.pushed = '1';
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({ element: ins });
  } catch (e) {
    console.warn('Publicité :', e?.message || e);
  }
}

function watch(root) {
  root.querySelectorAll?.('ins.adsbygoogle:not([data-pushed])').forEach((ins) => {
    if (ins.dataset.watched) return;
    ins.dataset.watched = '1';
    if (io) io.observe(ins);
    else push(ins);
  });
}

export function startAds() {
  if (started || !adsOn()) return;
  started = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `${SCRIPT}?client=${encodeURIComponent(S.cfg.ads.client)}`;
  // Bloqueur de publicité ou réseau coupé : on replie les emplacements vides.
  s.onerror = () => document.body.classList.add('ads-off');
  document.head.append(s);

  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          push(e.target);
        }
      },
      { rootMargin: '400px 0px' }
    );
  }
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) watch(n.matches?.('ins.adsbygoogle') ? n.parentNode : n);
  }).observe(document.body, { childList: true, subtree: true });
  watch(document.body);

  // Lien « Gérer les cookies » : rouvre le message de consentement de Google.
  const btn = document.getElementById('cookieBtn');
  if (btn) {
    btn.hidden = false;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      window.googlefc = window.googlefc || {};
      window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
      window.googlefc.callbackQueue.push(() => window.googlefc.showRevocationMessage?.());
    });
  }
}
