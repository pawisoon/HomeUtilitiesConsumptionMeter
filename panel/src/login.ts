/// The login screen comes from the Worker rather than public/, so nothing at
/// all is readable before a session exists.

export function loginPage(): string {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0e5a66">
<title>Liczniki — logowanie</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Manrope:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --paper: #f4f0e8;
    --ink: #12303a;
    --muted: #5d7178;
    --water: #0e7c86;
    --water-deep: #0b5560;
    --line: #d9d2c4;
    --danger: #a4331f;
  }
  @media (prefers-color-scheme: dark) {
    :root { --paper:#0c1a20; --ink:#e8eef0; --muted:#93a8ae; --water:#3fb8c4; --water-deep:#7fd6de; --line:#22383f; --danger:#ff9b86; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 24px;
    background:
      radial-gradient(120% 80% at 50% -10%, color-mix(in oklab, var(--water) 16%, transparent), transparent 60%),
      var(--paper);
    color: var(--ink);
    font: 400 18px/1.5 Manrope, ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .card { width: min(420px, 100%); text-align: center; }
  .drop { width: 56px; height: 56px; margin: 0 auto 20px; display: block; color: var(--water); }
  h1 {
    font: 400 clamp(2.4rem, 9vw, 3.2rem)/1 Fraunces, Georgia, serif;
    font-variation-settings: "opsz" 96; margin: 0 0 6px; letter-spacing: -0.02em;
  }
  p.sub { margin: 0 0 32px; color: var(--muted); font-size: 1rem; }
  label { display: block; text-align: left; font-weight: 600; font-size: 1rem; margin-bottom: 8px; }
  input {
    width: 100%; min-height: 60px; padding: 0 18px; font: inherit; font-size: 1.15rem;
    color: var(--ink); background: color-mix(in oklab, var(--paper) 70%, #fff 30%);
    border: 2px solid var(--line); border-radius: 14px; transition: border-color .15s ease;
  }
  @media (prefers-color-scheme: dark) { input { background: #0f242c; } }
  input:focus { outline: none; border-color: var(--water); }
  button {
    width: 100%; min-height: 60px; margin-top: 16px; font: 700 1.1rem Manrope, sans-serif;
    color: #fff; background: var(--water); border: 0; border-radius: 14px; cursor: pointer;
    transition: transform .12s ease, background .15s ease;
  }
  button:hover { background: var(--water-deep); }
  button:active { transform: translateY(1px) scale(.995); }
  button[disabled] { opacity: .6; cursor: progress; }
  .err { min-height: 26px; margin-top: 14px; color: var(--danger); font-weight: 600; font-size: 1rem; }
</style>
</head>
<body>
  <main class="card">
    <svg class="drop" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <rect x="3.2" y="4.2" width="17.6" height="15.6" rx="3"/>
      <path d="M7.4 15.4V11m4.6 4.4V8.6m4.6 6.8v-2.6"/>
    </svg>
    <h1>Liczniki</h1>
    <p class="sub">Zużycie mediów w domu</p>
    <form id="f" autocomplete="on">
      <label for="p">Hasło rodzinne</label>
      <input id="p" name="password" type="password" autocomplete="current-password" autofocus required>
      <button id="b" type="submit">Zaloguj</button>
      <div class="err" id="e" role="alert"></div>
    </form>
  </main>
<script>
  const f = document.getElementById('f'), p = document.getElementById('p'),
        b = document.getElementById('b'), e = document.getElementById('e');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    e.textContent = ''; b.disabled = true; b.textContent = 'Sprawdzam…';
    try {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: p.value })
      });
      if (r.status === 204) { location.replace('/'); return; }
      const d = await r.json().catch(() => ({}));
      e.textContent = d.error || 'Nie udało się zalogować.';
    } catch { e.textContent = 'Brak połączenia z internetem.'; }
    b.disabled = false; b.textContent = 'Zaloguj'; p.select();
  });
</script>
</body>
</html>`;
}
