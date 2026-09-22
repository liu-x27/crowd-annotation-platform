// Apply the saved theme before first paint, so there is no light flash in dark mode.
// A separate file rather than an inline script: the server's CSP allows only 'self'.
try {
  const choice = localStorage.getItem('cap.theme') || 'system';
  const dark =
    choice === 'dark' ||
    (choice === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
} catch {}
