// Public team profile: cover, identity, performance, Starting Five, roster and fixtures. All from Supabase; refreshes itself.
(function () {
  'use strict';
  const L = window.RBL, esc = L.esc, root = document.getElementById('page');
  const id = new URLSearchParams(location.search).get('id');
  const S = { t: null, players: [], matches: [], lineups: [], row: null, err: null };
  const msg = (t, sub) => { root.innerHTML = '<div class="rbl-wrap" style="padding:48px 16px;text-align:center"><p class="rbl-h" style="justify-content:center">' + esc(t) + '</p><p style="color:#9ca3af">' + (sub || '') + '</p><p style="margin-top:18px"><a class="rbl-pill up" href="./#match">Back to the Match Centre</a></p></div>'; };
  if (!L.ok || !/^[0-9a-f-]{36}$/i.test(id || '')) return msg('Team not found', 'This team link is not valid.');

  async function load() {
    try {
      const t = await L.rest('teams?id=eq.' + id + '&select=' + L.TEAM_SEL);
      if (!t.length) { S.t = null; S.err = 'missing'; return; }
      S.t = t[0]; S.err = null;
      const [pl, ms, st, lu] = await Promise.all([
        L.rest('players?team_id=eq.' + id + '&select=id,full_name,jersey_no,position,photo_path,height_cm,nationality,bio&order=jersey_no.asc.nullslast,full_name.asc'),
        L.rest('matches?or=(home_team_id.eq.' + id + ',away_team_id.eq.' + id + ')&select=' + encodeURIComponent(L.MATCH_SEL) + '&order=scheduled_at.asc'),
        L.rest('rpc/get_standings', {}).catch(() => []),
        L.loadLineups('team_id=eq.' + id + '&match_id=is.null')
      ]);
      S.players = pl; S.matches = ms.map(L.fixTeams); S.lineups = lu;
      S.row = st.find((r) => r.team_id === id) || null;
    } catch (e) { S.err = 'net'; }
  }
  const kpi = (v, l, hot) => '<div class="rbl-kpi ' + (hot ? 'hot' : '') + '"><b>' + esc(v) + '</b><span>' + esc(l) + '</span></div>';
  function perf() {
    const r = S.row;
    if (!r) return '<div class="rbl-empty">Performance appears once the team has played.</div>';
    const d = r.diff > 0 ? '+' + r.diff : String(r.diff);
    return '<div class="rbl-kpis">' + kpi(r.rank ? '#' + r.rank : '-', 'Standing', 1) + kpi(r.played, 'Played') + kpi(r.wins, 'Wins') + kpi(r.losses, 'Losses') + kpi(r.points, 'Points', 1) + kpi(r.points_for, 'Points scored') + kpi(r.points_against, 'Points conceded') + kpi(d, 'Difference') + '</div>';
  }
  function five() {
    const lu = S.lineups[0], p = (lu && lu.players) || [], st = p.filter((x) => x.role === 'starter').sort((a, b) => a.slot - b.slot), sb = p.filter((x) => x.role === 'substitute').sort((a, b) => a.slot - b.slot);
    if (!st.length) return '';
    const cap = (x) => (lu.captain_player_id && x.player_id === lu.captain_player_id ? '<span class="rbl-cap" title="Captain">C</span>' : '');
    return '<section><h2 class="rbl-h">Starting five <small>Default lineup</small></h2><div class="rbl-five">' + st.map((x) => '<div class="rbl-pl">' + L.avatar(x, 52) + '<span class="no">' + esc(x.jersey_no == null ? '-' : x.jersey_no) + '</span><div><div class="pn">' + esc(x.player_name) + cap(x) + '</div><div class="pp">' + esc(x.position || '') + '</div></div></div>').join('') + '</div>'
      + (sb.length ? '<div class="rbl-subs"><h4>Substitutes</h4><div class="rbl-chips">' + sb.map((x) => '<span class="rbl-chip">' + L.avatar(x, 28) + '<b>' + esc(x.jersey_no == null ? '' : x.jersey_no) + '</b> ' + esc(x.player_name) + cap(x) + '</span>').join('') + '</div></div>' : '') + '</section>';
  }
  function roster() {
    if (!S.players.length) return '<div class="rbl-empty">No players registered yet.</div>';
    return '<div class="rbl-cards">' + S.players.map((p) => '<article class="rbl-pcard"><div class="ph">' + L.avatar(p, 200) + '<div class="num"><small>#</small>' + esc(p.jersey_no == null ? '-' : p.jersey_no) + '</div></div><div class="in"><b>' + esc(p.full_name) + '</b><span>' + esc(p.position || 'Player') + '</span></div></article>').join('') + '</div>';
  }
  function fx(m) {
    const done = ['live', 'final', 'under_review'].includes(m.status);
    const me = m.home_team_id === id, opp = me ? m.away : m.home;
    const my = me ? m.home_score : m.away_score, th = me ? m.away_score : m.home_score;
    const res = m.status === 'final' ? (my > th ? 'W' : my < th ? 'L' : 'D') + ' ' : '';
    const right = done ? res + m.home_score + ' - ' + m.away_score : (['scheduled', 'ready'].includes(m.status) ? L.when(m.scheduled_at) : L.STATUS[m.status]);
    return '<a class="rbl-fx" href="match.html?id=' + encodeURIComponent(m.id) + '"><span class="tm">' + L.badge(S.t, 28) + '<span>' + esc(S.t.short_name || S.t.name) + '</span><em style="color:#6b7280;font-style:normal">vs</em>' + L.badge(opp, 28) + '<span>' + esc(opp.name) + '</span></span><span class="sc">' + (m.status === 'live' ? '<span class="rbl-pill live">Live</span> ' : '') + esc(right) + '</span></a>';
  }
  function fixtures() {
    const live = S.matches.filter((m) => m.status === 'live'), up = S.matches.filter((m) => ['scheduled', 'ready', 'postponed'].includes(m.status)), past = S.matches.filter((m) => ['final', 'under_review'].includes(m.status)).reverse();
    const grp = (t, a) => a.length ? '<h3 class="rbl-h" style="font-size:15px;margin-top:18px">' + t + '</h3><div class="rbl-list">' + a.map(fx).join('') + '</div>' : '';
    return (live.length || up.length || past.length) ? grp('Live now', live) + grp('Upcoming', up) + grp('Results', past) : '<div class="rbl-empty">No fixtures scheduled yet.</div>';
  }
  function paint() {
    if (S.err === 'missing' || !S.t) return msg('Team not found', 'It may not be published yet.');
    const t = S.t, cover = L.teamPhotoUrl(t);
    document.title = t.name + ' | Rongai Basketball League';
    root.innerHTML = '<div class="rbl-cover" style="' + (cover ? 'background-image:url(\'' + esc(cover) + '\')' : 'background:linear-gradient(135deg,hsl(' + L.hue(t.name) + ' 55% 22%),#0c0e12)') + '"></div>'
      + '<div class="rbl-wrap"><div class="rbl-tid">' + L.badge(t, 128) + '<div><h1>' + esc(t.name) + '</h1><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'
      + (t.short_name ? '<span class="rbl-pill up">' + esc(t.short_name) + '</span>' : '') + (t.pool ? '<span class="rbl-pill final">Pool ' + esc(t.pool) + '</span>' : '') + '<span class="rbl-pill final">' + S.players.length + ' player' + (S.players.length === 1 ? '' : 's') + '</span></div></div></div>'
      + '<p style="color:#d1d5db;line-height:1.7;max-width:720px;margin:14px 0 6px">' + esc(t.description || 'Team introduction coming soon.') + '</p>'
      + (t.coach_name ? '<p style="color:#9ca3af;font-size:13px;margin:0">Coach: <b style="color:#fff">' + esc(t.coach_name) + '</b></p>' : '')
      + '<section class="rbl-panel"><h2 class="rbl-h">Team performance</h2>' + perf() + '</section>'
      + '<section class="rbl-panel">' + five() + '</section>'
      + '<section class="rbl-panel"><h2 class="rbl-h">Roster <small>' + S.players.length + ' registered</small></h2>' + roster() + '</section>'
      + '<section class="rbl-panel" style="padding-bottom:48px"><h2 class="rbl-h">Fixtures and results</h2>' + fixtures() + '</section>'
      + (S.err === 'net' ? '<p style="text-align:center;color:#fcd34d;font-size:12px">Connection problem. Showing the last update.</p>' : '') + '</div>';
  }
  let busy = false;
  async function tick() { if (busy || document.hidden) return; busy = true; try { await load(); paint(); } finally { busy = false; } }
  load().then(paint);
  setInterval(tick, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
})();
