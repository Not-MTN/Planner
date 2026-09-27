// Apply the saved theme before first paint. Keep this tiny and dependency-free so
// production CSP can allow only scripts served by this origin.
try {
  var mode = localStorage.getItem('planner-theme') || 'system';
  var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.accent = localStorage.getItem('planner-accent') || 'sage';
  root.style.colorScheme = dark ? 'dark' : 'light';
  var lang = localStorage.getItem('planner-lang') === 'fa' ? 'fa' : 'en';
  root.lang = lang;
  root.dir = lang === 'fa' ? 'rtl' : 'ltr';
} catch (error) {
  /* storage can be blocked; the light default is fine */
}
