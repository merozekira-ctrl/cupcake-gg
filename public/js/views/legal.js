// Politique de confidentialité et cookies (FR / EN, rédigée directement dans les deux langues).
import { S, esc, EN, setTitle } from '../core.js';
import { adsOn } from '../ads.js';

const UPDATED = '2026-11-01';

function fr(contact, ads) {
  return `
  <h1>Confidentialité et cookies</h1>
  <p class="muted">Dernière mise à jour : 1er novembre 2026</p>

  <h2>Qui sommes-nous</h2>
  <p>cupcake.gg est un site gratuit de statistiques League of Legends. Il n’exige aucun compte et ne vend aucune donnée.${contact ? ` Contact : <a href="mailto:${esc(contact)}">${esc(contact)}</a>.` : ''}</p>
  <p>Hébergement : Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis (render.com).</p>

  <h2>Données affichées</h2>
  <p>Les profils, classements et parties proviennent de l’API officielle de Riot Games. Ce sont des données de jeu publiques, associées à un Riot ID. Le serveur en garde une copie temporaire (cache) et un historique de rangs pour afficher les pics et l’évolution des LP.</p>
  <p>Un joueur qui ne veut plus apparaître peut nous écrire : ses données en cache seront supprimées.</p>

  <h2>Données stockées sur ton appareil</h2>
  <p>Tes favoris, recherches récentes, thème et langue sont enregistrés dans le stockage local de ton navigateur (localStorage). Ils ne quittent pas ton appareil. Tu peux les effacer via les réglages de ton navigateur.</p>

  <h2>Journaux techniques</h2>
  <p>Comme tout serveur web, l’hébergeur enregistre des journaux techniques (adresse IP, page demandée, date). Ils servent uniquement à la sécurité et au bon fonctionnement du site.</p>

  <h2>Publicité et cookies</h2>
  ${
    ads
      ? `<p>Le site est financé par la publicité, via Google AdSense. Google et ses partenaires peuvent utiliser des cookies ou identifiants pour afficher des annonces, les personnaliser selon tes visites sur ce site et d’autres sites, et mesurer leur performance.</p>
  <p>Dans l’Espace économique européen, au Royaume-Uni et en Suisse, un message de consentement (plateforme certifiée par Google, standard IAB TCF) te demande ton choix avant tout cookie publicitaire. Si tu refuses, des annonces non personnalisées ou limitées peuvent s’afficher.</p>
  <p><a href="#" class="btn btn-sm" data-cookies>Modifier mes choix de cookies</a></p>
  <p>En savoir plus : <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">comment Google utilise les données des sites partenaires</a> · <a href="https://adssettings.google.com" target="_blank" rel="noopener">paramètres des annonces Google</a>.</p>`
      : `<p>Le site ne dépose actuellement aucun cookie publicitaire ou de mesure d’audience. Si de la publicité est ajoutée, cette page sera mise à jour et ton consentement sera demandé avant tout cookie publicitaire.</p>`
  }

  <h2>Tes droits</h2>
  <p>Conformément au RGPD, tu peux demander l’accès, la rectification ou la suppression des données te concernant${contact ? ` en écrivant à <a href="mailto:${esc(contact)}">${esc(contact)}</a>` : ''}. Tu peux aussi saisir la CNIL (cnil.fr).</p>

  <h2>Riot Games</h2>
  <p>cupcake.gg n’est pas approuvé par Riot Games et ne reflète pas les opinions de Riot Games ni de quiconque officiellement impliqué dans la production ou la gestion des propriétés de Riot Games.</p>`;
}

function en(contact, ads) {
  return `
  <h1>Privacy and cookies</h1>
  <p class="muted">Last updated: November 1, 2026</p>

  <h2>Who we are</h2>
  <p>cupcake.gg is a free League of Legends stats site. It requires no account and sells no data.${contact ? ` Contact: <a href="mailto:${esc(contact)}">${esc(contact)}</a>.` : ''}</p>
  <p>Hosting: Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, USA (render.com).</p>

  <h2>Data shown</h2>
  <p>Profiles, rankings and matches come from the official Riot Games API. They are public game data tied to a Riot ID. The server keeps a temporary copy (cache) and a rank history to show peaks and LP progress.</p>
  <p>A player who no longer wants to appear can contact us: their cached data will be deleted.</p>

  <h2>Data stored on your device</h2>
  <p>Your favorites, recent searches, theme and language are saved in your browser’s local storage (localStorage). They never leave your device. You can clear them in your browser settings.</p>

  <h2>Server logs</h2>
  <p>Like any web server, the host keeps technical logs (IP address, requested page, date). They are used only for security and to keep the site running.</p>

  <h2>Advertising and cookies</h2>
  ${
    ads
      ? `<p>The site is funded by advertising through Google AdSense. Google and its partners may use cookies or identifiers to serve ads, personalise them based on your visits to this and other sites, and measure their performance.</p>
  <p>In the European Economic Area, the UK and Switzerland, a consent message (Google-certified platform, IAB TCF standard) asks for your choice before any advertising cookie. If you decline, non-personalised or limited ads may be shown.</p>
  <p><a href="#" class="btn btn-sm" data-cookies>Change my cookie choices</a></p>
  <p>Learn more: <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">how Google uses data from partner sites</a> · <a href="https://adssettings.google.com" target="_blank" rel="noopener">Google ad settings</a>.</p>`
      : `<p>The site currently sets no advertising or analytics cookies. If advertising is added, this page will be updated and your consent will be asked before any advertising cookie.</p>`
  }

  <h2>Your rights</h2>
  <p>Under the GDPR, you can request access to, correction or deletion of your data${contact ? ` by writing to <a href="mailto:${esc(contact)}">${esc(contact)}</a>` : ''}. You can also contact your data protection authority.</p>

  <h2>Riot Games</h2>
  <p>cupcake.gg isn’t endorsed by Riot Games and doesn’t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties.</p>`;
}

export async function render(view) {
  setTitle(EN ? 'Privacy' : 'Confidentialité');
  const contact = S.cfg?.contact || '';
  view.innerHTML = `<article class="panel legal" data-nt data-updated="${UPDATED}">${EN ? en(contact, adsOn()) : fr(contact, adsOn())}</article>`;
  view.querySelector('[data-cookies]')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('cookieBtn')?.click();
  });
}
