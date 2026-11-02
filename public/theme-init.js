// Applique le thème avant le premier rendu pour éviter un flash.
(function () {
  var t = null;
  try {
    t = localStorage.getItem('rs-theme');
  } catch (e) {}
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', t);
})();

// Langue du site (fr ou en) : choix enregistré, sinon langue du navigateur.
(function () {
  var l = null;
  try {
    l = localStorage.getItem('rs-lang');
  } catch (e) {}
  if (l !== 'fr' && l !== 'en') l = /^fr\b/i.test(navigator.language || 'fr') ? 'fr' : 'en';
  document.documentElement.lang = l;
  window.LOC = l === 'en' ? 'en-US' : 'fr-FR';
})();
