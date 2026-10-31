// Playful layer for the public site: ambient basketballs, dribble ball, hoop-shot game, teams and results tabs,
// next-game countdown, score pops and card tilt. Reads only public data. Never touches scores or sign-in.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CFG = window.RBT_CONFIG || {};
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const notify = (m) => { if (typeof toast === 'function') toast(m); };
  const ballSVG = (s) => '<svg viewBox="0 0 64 64" width="' + s + '" height="' + s + '" aria-hidden="true"><defs><radialGradient id="fxg" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ff8a3d"/><stop offset="1" stop-color="#d94400"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#fxg)" stroke="#1a0d05" stroke-width="2"/><path d="M32 2v60M2 32h60M9 10c14 10 14 34 0 44M55 10c-14 10-14 34 0 44" fill="none" stroke="#1a0d05" stroke-width="2"/></svg>';
  const live = () => (window.RBT && RBT.live && RBT.live.state) || { matches: [], standings: [] };

  // ---------- 1. Ambient basketballs (behind the content, ignores the pointer, pauses when hidden) ----------
  function ambient() {
    if (reduce) return;
    const cv = document.createElement('canvas'); cv.id = 'fx-balls'; cv.setAttribute('aria-hidden', 'true'); document.body.prepend(cv);
    const cx = cv.getContext('2d'); let W = 0, H = 0, dpr = Math.min(devicePixelRatio || 1, 2);
    const fit = () => { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    fit(); addEventListener('resize', fit);
    const n = W < 640 ? 3 : 5;
    const balls = Array.from({ length: n }, (_, i) => ({ x: Math.random() * W, y: Math.random() * H * .6, r: 20 + Math.random() * 22, vx: (Math.random() < .5 ? -1 : 1) * (.4 + Math.random() * .8), vy: 0, a: Math.random() * 6, spin: (Math.random() - .5) * .05 }));
    function draw(b) {
      cx.save(); cx.translate(b.x, b.y); cx.rotate(b.a);
      cx.beginPath(); cx.arc(0, 0, b.r, 0, 7); cx.fillStyle = '#e25a0d'; cx.fill(); cx.lineWidth = 1.5; cx.strokeStyle = '#2a1206'; cx.stroke();
      cx.beginPath(); cx.moveTo(-b.r, 0); cx.lineTo(b.r, 0); cx.moveTo(0, -b.r); cx.lineTo(0, b.r);
      cx.moveTo(-b.r * .7, -b.r * .7); cx.quadraticCurveTo(-b.r * .2, 0, -b.r * .7, b.r * .7); cx.moveTo(b.r * .7, -b.r * .7); cx.quadraticCurveTo(b.r * .2, 0, b.r * .7, b.r * .7); cx.stroke(); cx.restore();
    }
    let last = performance.now(), run = true;
    document.addEventListener('visibilitychange', () => { run = !document.hidden; if (run) { last = performance.now(); requestAnimationFrame(tick); } });
    function tick(t) {
      if (!run) return; const dt = Math.min(40, t - last) / 16.7; last = t;
      cx.clearRect(0, 0, W, H);
      for (const b of balls) {
        b.vy += .22 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.spin * dt;
        if (b.y + b.r > H) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * .86; if (Math.abs(b.vy) < 4) b.vy = -(9 + Math.random() * 6); }
        if (b.x < b.r || b.x > W - b.r) { b.vx *= -1; b.x = Math.max(b.r, Math.min(W - b.r, b.x)); }
        draw(b);
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ---------- 2. Markup for new tabs and widgets ----------
  function addTabs() {
    const nav = document.querySelector('nav.bg-rbtCard\\/90'); const host = document.querySelector('#ptab-overview') && $('ptab-overview').parentNode;
    if (!nav || !host || $('ptab-teams')) return;
    const mk = (tab, icon, label) => { const b = document.createElement('button'); b.setAttribute('data-tab', tab); b.setAttribute('onclick', "switchPublicTab('" + tab + "')"); b.className = 'public-tab-btn px-4 py-2 rounded text-xs font-heading font-bold uppercase transition flex items-center gap-2 text-gray-400 hover:text-white hover:bg-rbtBorder/50'; b.innerHTML = '<i data-lucide="' + icon + '" class="w-4 h-4"></i> ' + label; return b; };
    const brackets = nav.querySelector('[data-tab="brackets"]');
    nav.insertBefore(mk('teams', 'shield', 'Teams'), brackets);
    nav.insertBefore(mk('results', 'list-checks', 'Results'), brackets);
    const teams = document.createElement('div'); teams.id = 'ptab-teams'; teams.className = 'public-tab-content hidden space-y-6 max-w-7xl mx-auto';
    teams.innerHTML = '<div class="flex flex-col md:flex-row md:items-end justify-between gap-4"><div><p class="text-rbtOrange font-heading font-bold text-xs tracking-[.2em] uppercase">The squads</p><h3 class="font-heading font-bold text-2xl uppercase text-white">Teams</h3><p class="text-gray-400 text-sm">Tap a team for its profile, record and games.</p></div><div class="flex flex-wrap items-center gap-2"><input id="fx-team-q" type="search" placeholder="Find a team" class="bg-black/50 border border-rbtBorder rounded px-3 py-2 text-xs text-white w-40"><div id="fx-pools" class="flex gap-2"></div></div></div><div id="fx-teams" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"><p class="text-sm text-gray-400 col-span-full">Loading teams…</p></div>';
    const results = document.createElement('div'); results.id = 'ptab-results'; results.className = 'public-tab-content hidden space-y-6 max-w-7xl mx-auto';
    results.innerHTML = '<div class="flex flex-col md:flex-row md:items-end justify-between gap-4"><div><p class="text-rbtOrange font-heading font-bold text-xs tracking-[.2em] uppercase">Final scores</p><h3 class="font-heading font-bold text-2xl uppercase text-white">Results</h3><p class="text-gray-400 text-sm">Every finished game, newest first.</p></div><select id="fx-res-team" class="bg-black/50 border border-rbtBorder rounded px-3 py-2 text-xs text-white"><option value="">All teams</option></select></div><div id="fx-results" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>';
    host.insertBefore(teams, $('ptab-brackets')); host.insertBefore(results, $('ptab-brackets'));

    // Overview extras: countdown, leaders, numbers, dribble ball
    const ov = $('ptab-overview'), hero = ov.firstElementChild;
    const extra = document.createElement('div'); extra.className = 'grid grid-cols-1 lg:grid-cols-3 gap-6';
    extra.innerHTML = '<div class="fx-card bg-rbtCard border border-rbtBorder rounded-xl p-5"><p class="text-[10px] uppercase tracking-widest text-rbtOrange font-bold">Next tip-off</p><div id="fx-next" class="mt-2 text-sm text-gray-400">Waiting for the schedule…</div></div>'
      + '<div class="fx-card bg-rbtCard border border-rbtBorder rounded-xl p-5"><p class="text-[10px] uppercase tracking-widest text-rbtGold font-bold">Table top 3</p><div id="fx-leaders" class="mt-2 text-sm text-gray-400">No results yet.</div></div>'
      + '<div class="fx-card bg-rbtCard border border-rbtBorder rounded-xl p-5 flex items-center justify-between gap-3"><div><p class="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">Tournament in numbers</p><div id="fx-stats" class="mt-2 flex gap-5 text-center"></div></div><button id="fx-dribble" class="fx-dribble" title="Dribble!" aria-label="Dribble the ball"><div class="shadow"></div><div class="ball">' + ballSVG(64) + '</div></button></div>';
    ov.insertBefore(extra, hero.nextSibling);

    // Fan zone: hoop shot
    const fz = $('ptab-fanzone'); if (fz) {
      const card = document.createElement('div'); card.className = 'fx-card bg-rbtCard border border-rbtBorder rounded-xl p-5 space-y-3';
      card.innerHTML = '<div class="flex items-center justify-between gap-3"><div><h4 class="font-heading font-bold text-lg uppercase text-white">Hoop Shot</h4><p class="text-xs text-gray-400">Tap where you want the ball to land. 30 seconds. The hoop speeds up as you score.</p></div><div class="text-right"><p class="text-xs text-gray-400">Best <b id="fx-best" class="text-rbtGold">0</b></p><button id="fx-start" class="mt-1 bg-rbtOrange text-black font-heading font-bold text-xs uppercase px-4 py-2 rounded">Start</button></div></div><canvas id="fx-hoop" width="360" height="440" aria-label="Hoop shot game"></canvas>';
      fz.insertBefore(card, fz.children[1] || null);
    }
    const m = document.createElement('div'); m.id = 'fx-modal'; m.innerHTML = '<div id="fx-modal-body" class="bg-rbtCard border border-rbtBorder rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto p-6 relative"></div>'; document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.classList.remove('open'); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape') m.classList.remove('open'); });
    if (window.lucide) lucide.createIcons();
  }

  // ---------- 3. Data ----------
  let teams = [], teamsLoaded = false;
  async function loadTeams() {
    if (!CFG.SUPABASE_URL) return;
    try {
      const r = await fetch(CFG.SUPABASE_URL + '/rest/v1/teams?select=id,name,short_name,pool,logo_path,description,coach_name,manager_name&is_published=eq.true&registration_status=eq.approved&order=name', { headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY } });
      if (!r.ok) throw 0; teams = await r.json(); teamsLoaded = true; renderTeams(); fillResultsFilter(); renderResults();
    } catch (e) { const el = $('fx-teams'); if (el && !teamsLoaded) el.innerHTML = '<p class="text-sm text-gray-400 col-span-full">Teams could not be loaded. Reload to try again.</p>'; }
  }
  const logoUrl = (p) => (p ? CFG.SUPABASE_URL + '/storage/v1/object/public/team-logos/' + String(p).split('/').map(encodeURIComponent).join('/') : '');
  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const initials = (n) => String(n || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const badge = (t, size) => (t.logo_path ? '<img src="' + esc(logoUrl(t.logo_path)) + '" alt="" loading="lazy" style="width:' + size + 'px;height:' + size + 'px" class="rounded-full object-cover bg-black/40">' : '<div style="width:' + size + 'px;height:' + size + 'px;background:hsl(' + hue(t.name) + ' 55% 32%)" class="rounded-full flex items-center justify-center font-heading font-black text-white text-sm">' + esc(initials(t.short_name || t.name)) + '</div>');
  const finals = () => live().matches.filter((m) => m.status === 'final').sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
  const form = (teamId) => finals().filter((m) => m.home_team_id === teamId || m.away_team_id === teamId).slice(0, 5).map((m) => { const home = m.home_team_id === teamId, w = home ? m.home_score > m.away_score : m.away_score > m.home_score; const d = m.home_score === m.away_score; return '<span class="fx-form ' + (d ? 'bg-gray-400' : w ? 'bg-emerald-500' : 'bg-red-500') + '" title="' + (d ? 'D' : w ? 'W' : 'L') + '"></span>'; }).join(' ');
  const standingFor = (t) => live().standings.find((s) => s.team_id === t.id || s.team_name === t.name);

  // ---------- 4. Renderers ----------
  let poolFilter = '', teamQ = '';
  function renderTeams() {
    const el = $('fx-teams'); if (!el) return;
    const pools = [...new Set(teams.map((t) => t.pool).filter(Boolean))].sort();
    const pc = $('fx-pools'); if (pc) pc.innerHTML = pools.length > 1 ? ['', ...pools].map((p) => '<button data-pool="' + esc(p) + '" class="fx-chip px-3 py-1.5 rounded text-xs font-heading font-bold uppercase ' + (p === poolFilter ? 'bg-rbtOrange text-black' : 'bg-rbtCard border border-rbtBorder text-gray-300') + '">' + (p ? 'Pool ' + esc(p) : 'All') + '</button>').join('') : '';
    const list = teams.filter((t) => (!poolFilter || t.pool === poolFilter) && (!teamQ || t.name.toLowerCase().includes(teamQ)));
    el.innerHTML = list.length ? list.map((t) => { const s = standingFor(t); return '<button data-team="' + esc(t.id) + '" class="fx-card text-left bg-rbtCard border border-rbtBorder rounded-xl p-4 hover:border-rbtOrange flex flex-col items-center text-center gap-2">' + badge(t, 64) + '<span class="font-heading font-bold text-white leading-tight">' + esc(t.name) + '</span><span class="text-[10px] uppercase tracking-wider text-gray-400">' + (t.pool ? 'Pool ' + esc(t.pool) + ' · ' : '') + (s ? s.wins + 'W ' + s.losses + 'L' : 'No games yet') + '</span><span class="h-2">' + form(t.id) + '</span></button>'; }).join('') : '<p class="text-sm text-gray-400 col-span-full">' + (teamsLoaded ? 'No teams match.' : 'Loading teams…') + '</p>';
  }
  function teamModal(id) {
    const t = teams.find((x) => x.id === id); if (!t) return; const s = standingFor(t), ms = live().matches.filter((m) => m.home_team_id === id || m.away_team_id === id).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    const when = (d) => new Date(d).toLocaleString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    $('fx-modal-body').innerHTML = '<button data-close class="absolute right-4 top-4 text-gray-400 hover:text-white text-xl leading-none" aria-label="Close">×</button><div class="flex items-center gap-4">' + badge(t, 72) + '<div><h4 class="font-heading font-black text-2xl text-white leading-tight">' + esc(t.name) + '</h4><p class="text-xs text-gray-400 uppercase tracking-wider">' + (t.pool ? 'Pool ' + esc(t.pool) : 'Rongai Basketball League') + '</p></div></div>'
      + (t.description ? '<p class="text-sm text-gray-300 mt-4">' + esc(t.description) + '</p>' : '')
      + '<div class="grid grid-cols-3 gap-2 mt-4 text-center">' + [['Played', s ? s.played : 0], ['Won', s ? s.wins : 0], ['Lost', s ? s.losses : 0]].map((x) => '<div class="bg-black/40 rounded-lg py-2"><div class="font-heading font-black text-xl text-rbtOrange">' + x[1] + '</div><div class="text-[10px] uppercase text-gray-400">' + x[0] + '</div></div>').join('') + '</div>'
      + ((t.coach_name || t.manager_name) ? '<p class="text-xs text-gray-400 mt-4">' + (t.coach_name ? 'Coach: <span class="text-gray-200">' + esc(t.coach_name) + '</span>' : '') + (t.coach_name && t.manager_name ? ' · ' : '') + (t.manager_name ? 'Manager: <span class="text-gray-200">' + esc(t.manager_name) + '</span>' : '') + '</p>' : '')
      + '<h5 class="font-heading font-bold text-xs uppercase text-rbtGold mt-5 mb-2">Games</h5>' + (ms.length ? '<div class="space-y-2">' + ms.map((m) => '<div class="bg-black/30 rounded-lg p-3 text-xs flex justify-between gap-2"><span class="text-white">' + esc(m.home.name) + (m.status === 'final' ? ' ' + m.home_score + ' - ' + m.away_score + ' ' : ' vs ') + esc(m.away.name) + '</span><span class="text-gray-400 text-right">' + (m.status === 'final' ? 'Final' : m.status === 'postponed' ? 'Postponed' : esc(when(m.scheduled_at))) + '</span></div>').join('') + '</div>' : '<p class="text-xs text-gray-400">No games published yet.</p>');
    $('fx-modal').classList.add('open');
  }
  function fillResultsFilter() { const sel = $('fx-res-team'); if (!sel || sel.options.length > 1) return; teams.forEach((t) => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; sel.appendChild(o); }); }
  function renderResults() {
    const el = $('fx-results'); if (!el) return; const f = $('fx-res-team') && $('fx-res-team').value;
    const list = finals().filter((m) => !f || m.home_team_id === f || m.away_team_id === f);
    const sched = live().matches.filter((m) => ['scheduled', 'ready', 'postponed'].includes(m.status)).length;
    el.innerHTML = list.length ? list.map((m) => { const hw = m.home_score > m.away_score, aw = m.away_score > m.home_score; return '<div class="fx-card bg-rbtCard border border-rbtBorder rounded-xl p-4"><div class="flex justify-between text-[10px] uppercase tracking-wider text-gray-400 mb-2"><span>' + esc(m.round) + '</span><span>' + new Date(m.scheduled_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) + '</span></div><div class="flex justify-between items-center ' + (hw ? 'text-white font-bold' : 'text-gray-400') + '"><span>' + esc(m.home.name) + '</span><span class="font-heading text-xl">' + m.home_score + '</span></div><div class="flex justify-between items-center ' + (aw ? 'text-white font-bold' : 'text-gray-400') + '"><span>' + esc(m.away.name) + '</span><span class="font-heading text-xl">' + m.away_score + '</span></div></div>'; }).join('') : '<div class="md:col-span-2 bg-rbtCard border border-rbtBorder rounded-xl p-8 text-center text-sm text-gray-400">' + (live().fetchedOnce ? 'No finished games yet' + (sched ? ' — ' + sched + ' game' + (sched > 1 ? 's' : '') + ' still to play.' : '.') : 'Loading results…') + '</div>';
  }

  // Count-up numbers, countdown, leaders
  function renderOverview() {
    const st = live(), ms = st.matches;
    const stats = $('fx-stats'); if (stats) { const vals = [['Teams', teams.length || st.standings.length], ['Played', ms.filter((m) => m.status === 'final').length], ['To play', ms.filter((m) => ['scheduled', 'ready'].includes(m.status)).length]]; stats.innerHTML = vals.map((v) => '<div><div class="font-heading font-black text-2xl text-white" data-count="' + v[1] + '">' + v[1] + '</div><div class="text-[10px] uppercase text-gray-400">' + v[0] + '</div></div>').join(''); }
    const ld = $('fx-leaders'); if (ld) { const top = st.standings.filter((s) => s.played > 0).slice(0, 3); ld.innerHTML = top.length ? top.map((s, i) => '<div class="flex justify-between py-1 ' + (i === 0 ? 'text-white font-bold' : 'text-gray-300') + '"><span>' + (i + 1) + '. ' + esc(s.team_name) + '</span><span class="text-rbtOrange">' + s.points + ' pts</span></div>').join('') : '<span>The table fills in after the first final score.</span>'; }
  }
  let nextAt = null;
  function tickCountdown() {
    const el = $('fx-next'); if (!el) return; const st = live();
    const lv = st.matches.find((m) => m.status === 'live');
    if (lv) { el.innerHTML = '<span class="text-red-400 font-bold">LIVE NOW</span> · ' + esc(lv.home.name) + ' ' + lv.home_score + ' - ' + lv.away_score + ' ' + esc(lv.away.name); return; }
    const nx = st.matches.filter((m) => ['scheduled', 'ready'].includes(m.status) && new Date(m.scheduled_at) > Date.now()).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0];
    if (!nx) { el.textContent = st.fetchedOnce ? 'No upcoming games scheduled yet.' : 'Waiting for the schedule…'; return; }
    let d = Math.max(0, Math.floor((new Date(nx.scheduled_at) - Date.now()) / 1000)); const parts = [['d', Math.floor(d / 86400)], ['h', Math.floor(d % 86400 / 3600)], ['m', Math.floor(d % 3600 / 60)], ['s', d % 60]];
    el.innerHTML = '<div class="font-heading font-bold text-white">' + esc(nx.home.name) + ' vs ' + esc(nx.away.name) + '</div><div class="flex gap-3 mt-2">' + parts.map((p) => '<div class="bg-black/40 rounded-lg px-2.5 py-1.5 text-center min-w-[44px]"><div class="font-heading font-black text-xl text-rbtOrange">' + String(p[1]).padStart(2, '0') + '</div><div class="text-[9px] uppercase text-gray-400">' + p[0] + '</div></div>').join('') + '</div>';
  }

  // Score pop when a live score changes
  const seen = {};
  function scorePop() {
    const st = live(); let changed = null;
    st.matches.forEach((m) => { const k = m.home_score + '-' + m.away_score; if (seen[m.id] != null && seen[m.id] !== k && m.status === 'live') { const o = seen[m.id].split('-').map(Number); changed = { m, home: m.home_score > o[0], away: m.away_score > o[1] }; } seen[m.id] = k; });
    if (!changed) return;
    document.querySelectorAll('#live-spotlight .font-heading.font-black').forEach((n, i) => { if ((i === 0 && changed.home) || (i === 1 && changed.away)) n.classList.add('fx-pop'); });
    notify('🏀 ' + (changed.home ? changed.m.home.name : changed.m.away.name) + ' scores!');
  }

  // ---------- 5. Interactions ----------
  function wire() {
    document.addEventListener('click', (e) => {
      const tm = e.target.closest('[data-team]'); if (tm) return teamModal(tm.getAttribute('data-team'));
      const pl = e.target.closest('[data-pool]'); if (pl) { poolFilter = pl.getAttribute('data-pool'); renderTeams(); }
    });
    document.addEventListener('input', (e) => { if (e.target.id === 'fx-team-q') { teamQ = e.target.value.trim().toLowerCase(); renderTeams(); } });
    document.addEventListener('change', (e) => { if (e.target.id === 'fx-res-team') renderResults(); });
    // Dribble counter
    let n = Number(store.get('rbt-dribbles') || 0), timer;
    const db = $('fx-dribble'); if (db) db.addEventListener('click', () => { n++; store.set('rbt-dribbles', n); db.classList.add('fast'); clearTimeout(timer); timer = setTimeout(() => db.classList.remove('fast'), 1400); if ([10, 25, 50, 100, 250].includes(n)) notify('🏀 ' + n + ' dribbles! Handles for days.'); });
    // Gentle tilt on cards (mouse only)
    if (!reduce && matchMedia('(hover:hover)').matches) {
      document.addEventListener('pointermove', (e) => {
        const c = e.target.closest && e.target.closest('#ballers-roster article, #ballers-cards article, #merch-products article, #fx-teams .fx-card'); if (!c) return;
        const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        c.style.transform = 'perspective(700px) rotateY(' + (x * 6) + 'deg) rotateX(' + (-y * 6) + 'deg)';
      });
      document.addEventListener('pointerout', (e) => { const c = e.target.closest && e.target.closest('#ballers-roster article, #ballers-cards article, #merch-products article, #fx-teams .fx-card'); if (c) c.style.transform = ''; });
    }
  }

  // ---------- 6. Hoop Shot ----------
  function hoopGame() {
    const cv = $('fx-hoop'); if (!cv) return; const g = cv.getContext('2d'), W = 360, H = 440, G = 1400;
    const rimY = 120, rimW = 54; let hx = W / 2, dir = 1, speed = 70;
    let ball = null, score = 0, tleft = 0, playing = false, fx = [], best = Number(store.get('rbt-hoop-best') || 0), last = 0, raf = 0;
    $('fx-best').textContent = best;
    function start() { score = 0; tleft = 30; speed = 70; playing = true; ball = null; fx = []; last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); $('fx-start').textContent = 'Restart'; }
    function shoot(tx, ty) {
      if (!playing || ball) return; const T = .75, x0 = W / 2, y0 = H - 40;
      ball = { x: x0, y: y0, vx: (tx - x0) / T, vy: (ty - y0 - .5 * G * T * T) / T, prevY: y0, scored: false, r: 15 };
    }
    cv.addEventListener('pointerdown', (e) => { const r = cv.getBoundingClientRect(); shoot((e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height); });
    $('fx-start').addEventListener('click', start);
    function pop(txt, x, y, col) { fx.push({ txt, x, y, life: 1, col }); }
    function loop(t) {
      const dt = Math.min(.04, (t - last) / 1000); last = t;
      if (playing) { tleft -= dt; if (tleft <= 0) { playing = false; tleft = 0; if (score > best) { best = score; store.set('rbt-hoop-best', best); $('fx-best').textContent = best; notify('🏆 New Hoop Shot best: ' + best + '!'); } else notify('Time! You scored ' + score + '.'); } }
      hx += dir * speed * dt; if (hx > W - 70) { hx = W - 70; dir = -1; } if (hx < 70) { hx = 70; dir = 1; }
      if (ball) {
        ball.prevY = ball.y; ball.vy += G * dt; ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        if (!ball.scored && ball.vy > 0 && ball.prevY < rimY && ball.y >= rimY && Math.abs(ball.x - hx) < rimW / 2 - 4) { ball.scored = true; score += 2; speed = Math.min(220, speed + 12); pop('+2', hx, rimY - 10, '#ffb700'); }
        if (ball.y > H + 30 || ball.x < -40 || ball.x > W + 40) ball = null;
      }
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#161a22'; g.fillRect(0, H - 22, W, 22); g.fillStyle = '#ff5500'; g.fillRect(0, H - 22, W, 2);
      g.fillStyle = '#e5e7eb'; g.fillRect(hx - 36, rimY - 66, 72, 56); g.strokeStyle = '#ff5500'; g.lineWidth = 2; g.strokeRect(hx - 18, rimY - 36, 36, 26);
      g.strokeStyle = '#ff5500'; g.lineWidth = 4; g.beginPath(); g.moveTo(hx - rimW / 2, rimY); g.lineTo(hx + rimW / 2, rimY); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1; for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(hx + i * 10, rimY); g.lineTo(hx + i * 6, rimY + 26); g.stroke(); }
      const b = ball || { x: W / 2, y: H - 40, r: 15 }; g.beginPath(); g.arc(b.x, b.y, b.r, 0, 7); g.fillStyle = '#e25a0d'; g.fill(); g.strokeStyle = '#2a1206'; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.moveTo(b.x - b.r, b.y); g.lineTo(b.x + b.r, b.y); g.moveTo(b.x, b.y - b.r); g.lineTo(b.x, b.y + b.r); g.stroke();
      fx = fx.filter((f) => (f.life -= dt * 1.4) > 0); fx.forEach((f) => { g.globalAlpha = Math.max(0, f.life); g.fillStyle = f.col; g.font = '800 22px Chakra Petch, sans-serif'; g.textAlign = 'center'; g.fillText(f.txt, f.x, f.y - (1 - f.life) * 40); g.globalAlpha = 1; });
      g.fillStyle = '#f3f4f6'; g.font = '700 16px Chakra Petch, sans-serif'; g.textAlign = 'left'; g.fillText('Score ' + score, 12, 24); g.textAlign = 'right'; g.fillText(Math.ceil(tleft) + 's', W - 12, 24);
      if (!playing) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '800 22px Chakra Petch, sans-serif'; g.fillText(score ? 'Final: ' + score : 'Ready to shoot?', W / 2, H / 2 - 6); g.font = '500 13px Inter, sans-serif'; g.fillStyle = '#9ca3af'; g.fillText('Press Start', W / 2, H / 2 + 18); }
      if (!document.hidden) raf = requestAnimationFrame(loop);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); } });
    last = performance.now(); raf = requestAnimationFrame(loop);
  }

  // ---------- start ----------
  function init() {
    ambient(); addTabs(); wire(); hoopGame(); loadTeams();
    const refresh = () => { renderOverview(); renderTeams(); renderResults(); scorePop(); };
    if (window.RBT && RBT.live) RBT.live.onRender = refresh;
    refresh(); setInterval(tickCountdown, 1000); tickCountdown();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
