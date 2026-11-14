// Public match page: hero with logos and score, overview (quarter scores), lineups and teams. Refreshes by itself.
(function () {
  'use strict';
  const L = window.RBL, esc = L.esc, root = document.getElementById('page');
  const id = new URLSearchParams(location.search).get('id');
  const S = { m: null, events: [], lineups: [], standings: [], tab: 'overview', got: Date.now(), err: null };
  const msg = (t, sub) => { root.innerHTML = '<div class="rbl-wrap" style="padding:48px 16px;text-align:center"><p class="rbl-h" style="justify-content:center">' + esc(t) + '</p><p style="color:#9ca3af">' + (sub || '') + '</p><p style="margin-top:18px"><a class="rbl-pill up" href="./#match">Back to the Match Centre</a></p></div>'; };
  if (!L.ok || !/^[0-9a-f-]{36}$/i.test(id || '')) return msg('Match not found', 'This match link is not valid.');

  async function load() {
    try {
      const rows = await L.rest('matches?id=eq.' + id + '&select=' + encodeURIComponent(L.MATCH_SEL));
      if (!rows.length) return (S.m = null, S.err = 'missing');
      S.m = L.fixTeams(rows[0]); S.got = Date.now(); S.err = null;
      const ids = [S.m.home_team_id, S.m.away_team_id].filter(Boolean).join(',');
      const [ev, lu, st] = await Promise.all([
        L.rest('match_events?match_id=eq.' + id + '&select=period,home_score_after,away_score_after,created_at&order=created_at.asc').catch(() => []),
        L.loadLineups('or=(match_id.eq.' + id + ',and(match_id.is.null,team_id.in.(' + ids + ')))'),
        L.rest('rpc/get_standings', {}).catch(() => [])
      ]);
      S.events = ev; S.lineups = lu; S.standings = st;
    } catch (e) { S.err = 'net'; }
  }
  const rec = (t) => { const r = S.standings.find((x) => x.team_id === t.id); return r ? r.wins + ' W · ' + r.losses + ' L' : ''; };
  const teamLink = (t) => (t.id ? 'team.html?id=' + encodeURIComponent(t.id) : '#');
  const clockNow = (m) => (m.clock_running ? Math.max(0, m.clock_seconds - Math.floor((Date.now() - S.got) / 1000)) : m.clock_seconds);

  function hero() {
    const m = S.m, done = ['final', 'live', 'under_review'].includes(m.status);
    const hw = m.status === 'final' && m.home_score > m.away_score, aw = m.status === 'final' && m.away_score > m.home_score;
    const pill = m.status === 'live' ? '<span class="rbl-pill live">&#9679; Live</span>' : m.status === 'final' ? '<span class="rbl-pill final">Final</span>' : '<span class="rbl-pill ' + (['postponed', 'cancelled', 'under_review'].includes(m.status) ? 'warn' : 'up') + '">' + esc(L.STATUS[m.status]) + '</span>';
    const mid = done
      ? '<div class="nums"><span class="' + (aw ? 'lose' : '') + '">' + m.home_score + '</span><span style="font-size:.4em;color:#6b7280">-</span><span class="' + (hw ? 'lose' : '') + '">' + m.away_score + '</span></div>'
        + '<div class="state">' + (m.status === 'live' ? L.period(m.period) + ' &middot; <span id="mp-clock">' + L.clock(clockNow(m)) + '</span>' : m.status === 'final' ? 'Full time' : 'Under review') + '</div>' + pill
      : '<div class="state">VS</div><div class="rbl-cd" id="mp-cd">' + (['scheduled', 'ready'].includes(m.status) ? esc(L.countdown(m.scheduled_at)) : '') + '</div><div style="margin-top:6px">' + pill + '</div>';
    const side = (t, win) => '<a class="rbl-side" href="' + teamLink(t) + '" aria-label="Open the ' + esc(t.name) + ' team profile">' + L.badge(t, 96) + '<span class="nm">' + esc(t.name) + '</span><span class="sub">' + esc(t.short_name || '') + (t.short_name && rec(t) ? ' &middot; ' : '') + esc(rec(t)) + '</span></a>';
    return '<section class="rbl-hero"><div class="rbl-wrap rbl-hero-in"><div class="rbl-meta">' + esc(m.round) + '<b>' + esc(L.when(m.scheduled_at)) + '</b></div>'
      + '<div class="rbl-face">' + side(m.home) + '<div class="rbl-score">' + mid + '</div>' + side(m.away) + '</div>'
      + '<div class="rbl-venue">&#128205; ' + esc(m.court || 'Venue to be confirmed') + (m.status_reason && ['postponed', 'cancelled'].includes(m.status) ? ' &middot; ' + esc(m.status_reason) : '') + '</div></div></section>';
  }
  function overview() {
    const m = S.m, q = L.quarters(S.events, m), hasQ = q.length > 0;
    const head = hasQ ? q.map((x) => '<th>' + L.period(x.p) + '</th>').join('') : '';
    const row = (t, key, tot, win) => '<tr><td><a href="' + teamLink(t) + '" style="display:flex;align-items:center;gap:10px">' + L.badge(t, 36) + '<span>' + esc(t.name) + '</span></a></td>' + (hasQ ? q.map((x) => '<td>' + x[key] + '</td>').join('') : '') + '<td class="tot ' + (win ? 'win' : '') + '">' + (['final', 'live', 'under_review'].includes(m.status) ? tot : '&ndash;') + '</td></tr>';
    const fin = m.status === 'final';
    return '<div class="rbl-grid2"><div><h2 class="rbl-h">Match detail <small>Score by period</small></h2><div class="rbl-card"><table class="rbl-q"><thead><tr><th></th>' + head + '<th>Final</th></tr></thead><tbody>'
      + row(m.home, 'h', m.home_score, fin && m.home_score > m.away_score) + row(m.away, 'a', m.away_score, fin && m.away_score > m.home_score) + '</tbody></table>'
      + (hasQ ? '' : '<p style="color:#9ca3af;font-size:13px;margin:12px 0 0">Period scores appear here as the game is scored.</p>') + '</div></div>'
      + '<div><h2 class="rbl-h">Game info</h2><div class="rbl-card" style="display:grid;gap:10px;font-size:14px">'
      + info('Status', L.STATUS[m.status]) + info('Round', m.round) + info('Date and time', L.when(m.scheduled_at)) + info('Venue', m.court || 'To be confirmed') + (m.notes ? info('Notes', m.notes) : '') + '</div></div></div>';
  }
  const info = (k, v) => '<div style="display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #2d3342;padding-bottom:8px"><span style="color:#9ca3af">' + esc(k) + '</span><b style="color:#fff;text-align:right">' + esc(v) + '</b></div>';
  function five(lu, t) {
    const p = (lu && lu.players) || [], st = p.filter((x) => x.role === 'starter').sort((a, b) => a.slot - b.slot), sb = p.filter((x) => x.role === 'substitute').sort((a, b) => a.slot - b.slot);
    const cap = (x) => (lu && lu.captain_player_id && x.player_id === lu.captain_player_id ? '<span class="rbl-cap" title="Captain">C</span>' : '');
    return '<div><a class="rbl-lu-head" href="' + teamLink(t) + '">' + L.badge(t, 48) + '<span class="nm">' + esc(t.name) + '</span></a>'
      + (st.length ? '<div class="rbl-five">' + st.map((x) => '<div class="rbl-pl">' + L.avatar(x, 52) + '<span class="no">' + esc(x.jersey_no == null ? '-' : x.jersey_no) + '</span><div><div class="pn">' + esc(x.player_name) + cap(x) + '</div><div class="pp">' + esc(x.position || '') + '</div></div></div>').join('') + '</div>'
        + '<div class="rbl-subs"><h4>Substitutes</h4>' + (sb.length ? '<div class="rbl-chips">' + sb.map((x) => '<span class="rbl-chip">' + L.avatar(x, 28) + '<b>' + esc(x.jersey_no == null ? '' : x.jersey_no) + '</b> ' + esc(x.player_name) + cap(x) + '</span>').join('') + '</div>' : '<p style="color:#9ca3af;font-size:13px;margin:0">None named.</p>') + '</div>'
        : '<div class="rbl-empty">Starting five not published yet.</div>') + '</div>';
  }
  function lineups() {
    const m = S.m, a = L.lineupFor(S.lineups, m.home_team_id, m.id), b = L.lineupFor(S.lineups, m.away_team_id, m.id);
    return '<h2 class="rbl-h">Lineups <small>' + (a && a.locked_at || b && b.locked_at ? 'Confirmed at tip-off' : 'Starting five and substitutes') + '</small></h2><div class="rbl-lineup">' + five(a, m.home) + five(b, m.away) + '</div>';
  }
  function teams() {
    const card = (t) => '<div class="rbl-card"><div style="display:flex;gap:14px;align-items:center">' + L.badge(t, 72) + '<div><div class="rbl-h" style="margin:0">' + esc(t.name) + '</div><div style="color:#9ca3af;font-size:12px;letter-spacing:.08em;text-transform:uppercase">' + esc(t.pool ? 'Pool ' + t.pool : '') + '</div></div></div>'
      + '<p style="color:#d1d5db;font-size:14px;line-height:1.6">' + esc(t.description || 'Team profile coming soon.') + '</p><a class="rbl-pill up" href="' + teamLink(t) + '">View full team profile</a></div>';
    return '<div class="rbl-grid2">' + card(S.m.home) + card(S.m.away) + '</div>';
  }
  function paint() {
    if (S.err === 'missing' || !S.m) return msg('Match not found', 'It may have been removed or is not published.');
    document.title = S.m.home.name + ' vs ' + S.m.away.name + ' | Rongai Basketball League';
    const tabs = [['overview', 'Overview'], ['lineups', 'Lineups'], ['teams', 'Teams']];
    root.innerHTML = hero() + '<nav class="rbl-tabs" role="tablist" aria-label="Match sections"><div class="rbl-wrap">' + tabs.map((t) => '<button class="rbl-tab" role="tab" data-t="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + '</button>').join('') + '</div></nav>'
      + '<div class="rbl-wrap rbl-panel" role="tabpanel">' + (S.tab === 'lineups' ? lineups() : S.tab === 'teams' ? teams() : overview()) + '</div>'
      + (S.err === 'net' ? '<p style="text-align:center;color:#fcd34d;font-size:12px">Connection problem. Showing the last update.</p>' : '');
    root.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.t; paint(); }));
  }
  let busy = false;
  async function tick() { if (busy || document.hidden) return; busy = true; try { await load(); paint(); } finally { busy = false; } }
  load().then(paint);
  setInterval(tick, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  setInterval(() => {
    if (!S.m) return; const c = document.getElementById('mp-clock'); if (c) c.textContent = L.clock(clockNow(S.m));
    const d = document.getElementById('mp-cd'); if (d) d.textContent = L.countdown(S.m.scheduled_at);
  }, 1000);
})();
