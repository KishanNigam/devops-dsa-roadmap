/* Runs before the stylesheet paints so the page never flashes the wrong theme.
   Plain script (not a module) on purpose: modules are deferred. */
(function () {
  var theme = null;
  try { theme = localStorage.getItem('roadmap.theme'); } catch (e) { /* storage blocked: fall through */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
