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
