// Official Portal feature modules. Every action calls the database; the database decides whether it is allowed.
(function () {
  'use strict';
  const RB = window.RBT, sb = RB.sb, P = RB.P;
  const { $, $$, esc, icons, fmtTime, fmtClock, periodLabel, toLocalInput, can, q, toast, chip, card, empty, btn } = P;
  const SEL = '*, home:teams!matches_home_team_id_fkey(name), away:teams!matches_away_team_id_fkey(name)';
  const vs = (m) => `${esc(m.home && m.home.name)} vs ${esc(m.away && m.away.name)}`;
  const inputCls = P.input, labelCls = P.label;
  const fail = P.fail;
  const rpc = async (name, args) => { const r = await sb.rpc(name, args); if (r.error) throw r.error; return r.data; };
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { fail(e); } };

  // =====================================================================================
  // COURTSIDE: score assigned games. Every tap is one database call with a unique event id.
  // =====================================================================================
  const C = { id: null, m: null, matches: [], events: [], recv: 0, busy: false, tick: null };
  const clockNow = () => (C.m && C.m.clock_running ? Math.max(0, C.m.clock_seconds - Math.floor((Date.now() - C.recv) / 1000)) : C.m ? C.m.clock_seconds : 0);
  const shotNow = () => (C.m && C.m.clock_running ? Math.max(0, C.m.shot_clock_seconds - Math.floor((Date.now() - C.recv) / 1000)) : C.m ? C.m.shot_clock_seconds : 0);

  async function courtsideRender(main) {
    C.matches = await q(sb.from('matches').select(SEL).is('archived_at', null).in('status', ['ready', 'live', 'under_review']).order('scheduled_at'));
    if (!C.matches.some((m) => m.id === C.id)) C.id = C.matches[0] ? C.matches[0].id : null;
    C.m = C.matches.find((m) => m.id === C.id) || null; C.recv = Date.now();
    if (C.m) C.events = await q(sb.from('match_events').select('*').eq('match_id', C.id).order('created_at', { ascending: false }).limit(12));
    paintCourtside(main);
  }
  function paintCourtside(main) {
    if (!C.m) { main.innerHTML = `<div class="max-w-3xl mx-auto">${card('Courtside console', empty('No games are ready or live for you. A fixture manager marks a game Ready and assigns you to it.'))}</div>`; return; }
    const m = C.m, live = m.status === 'live', dis = C.busy || !live ? 'disabled' : '';
    const sideBtns = (t) => `<div class="grid grid-cols-3 gap-2">${[1, 2, 3].map((v) => btn('+' + v, `data-ev="score" data-t="${t}" data-v="${v}" ${dis}`, 'primary')).join('')}</div>
      <div class="grid grid-cols-3 gap-2">${btn('Foul', `data-ev="foul" data-t="${t}" ${dis}`)}${btn('Timeout', `data-ev="timeout" data-t="${t}" ${dis}`)}${btn('Undo…', `data-undo="${t}" ${dis}`)}</div>`;
    main.innerHTML = `<div class="max-w-5xl mx-auto space-y-4">
      <div class="flex flex-wrap items-center gap-3"><label class="${labelCls} mb-0" for="c-pick">Game</label>
        <select id="c-pick" class="${inputCls} max-w-xs">${C.matches.map((x) => `<option value="${x.id}" ${x.id === C.id ? 'selected' : ''}>${esc(x.home && x.home.name)} vs ${esc(x.away && x.away.name)} (${esc(x.status)})</option>`).join('')}</select>${chip(m.status)}</div>
      ${m.status !== 'live' ? `<p class="text-sm text-gray-300 bg-white/5 border border-rbtBorder rounded-lg p-3">${m.status === 'ready' ? 'This game is ready. Start it when the teams are on court.' : 'This game is under review. Scoring is paused until the Director decides.'}</p>` : ''}
      ${card('', `<div class="grid grid-cols-3 items-center text-center gap-2">
        <div><p class="text-xs uppercase font-heading font-bold text-gray-300">${esc(m.home && m.home.name)}</p><p id="s-home" class="font-heading font-black text-5xl md:text-7xl text-white">${m.home_score}</p><p class="text-xs text-gray-400">Fouls ${m.home_fouls} · Timeouts ${m.home_timeouts}</p></div>
        <div><p class="text-xs uppercase text-gray-500 font-bold">${periodLabel(m.period)}</p><p id="c-clock" class="font-mono font-bold text-2xl text-rbtGold">${fmtClock(clockNow())}</p><p class="text-[10px] uppercase text-gray-400">Shot clock</p><p id="c-shot" class="font-mono font-black text-xl text-rbtOrange">${shotNow()}s</p></div>
        <div><p class="text-xs uppercase font-heading font-bold text-gray-300">${esc(m.away && m.away.name)}</p><p id="s-away" class="font-heading font-black text-5xl md:text-7xl text-gray-300">${m.away_score}</p><p class="text-xs text-gray-400">Fouls ${m.away_fouls} · Timeouts ${m.away_timeouts}</p></div></div>`)}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${card('Home: ' + esc(m.home && m.home.name), sideBtns('home'))}${card('Away: ' + esc(m.away && m.away.name), sideBtns('away'))}</div>
      ${card('Clock and period', `<div class="flex flex-wrap items-end gap-2">
        ${btn(m.clock_running ? 'Stop clock' : 'Start clock', `data-ev="${m.clock_running ? 'clock_stop' : 'clock_start'}" ${dis}`, m.clock_running ? 'danger' : 'good')}
        <div><label class="${labelCls}" for="c-set">Set clock (mm:ss)</label><input id="c-set" value="10:00" class="${inputCls} w-24" ${dis}></div>${btn('Set', 'id="b-setclock" ' + dis)}
        ${btn('Shot 24', `data-ev="shot_clock" data-v="24" ${dis}`)}${btn('Shot 14', `data-ev="shot_clock" data-v="14" ${dis}`)}
        <div><label class="${labelCls}" for="c-per">Period</label><select id="c-per" class="${inputCls} w-24" ${dis}>${[1, 2, 3, 4, 5, 6, 7, 8].map((p) => `<option value="${p}" ${p === m.period ? 'selected' : ''}>${periodLabel(p)}</option>`).join('')}</select></div></div>`)}
      ${card('Game status', `<div class="flex flex-wrap gap-2">
        ${m.status === 'ready' ? btn('Start game (go live)', 'data-tr="live"', 'good') : ''}
        ${live && can('matches.finalize') ? btn('Finish game', 'data-tr="final"', 'primary') : ''}
        ${live ? btn('Flag for review', 'data-tr="under_review"') : ''}
        ${live && can('matches.lifecycle') ? btn('Suspend game', 'data-tr="postponed"') : ''}
        ${live && can('matches.cancel_live') ? btn('Cancel game', 'data-tr="cancelled"', 'danger') : ''}
        ${m.status === 'under_review' && can('matches.lifecycle') ? btn('Resume game', 'data-tr="live"', 'good') : ''}</div>`)}
      ${card('Recent events', C.events.length ? `<ul class="divide-y divide-rbtBorder/60 text-xs">${C.events.map((e) => `<li class="py-1.5 text-gray-300"><span class="text-white font-semibold">${esc(e.event_type)}</span> ${esc(e.team || '')} ${e.value != null ? esc(e.value) : ''} → ${e.home_score_after}-${e.away_score_after} · ${esc(fmtTime(e.created_at))}${e.reason ? ' · ' + esc(e.reason) : ''}</li>`).join('')}</ul>` : empty('No events yet.'))}</div>`;
    $('#c-pick').onchange = (e) => { C.id = e.target.value; courtsideRender(main).then(icons); };
    $$('[data-ev]', main).forEach((b) => b.onclick = () => sendEvent(main, b.dataset.ev, b.dataset.t, b.dataset.v ? +b.dataset.v : null));
    $$('[data-undo]', main).forEach((b) => b.onclick = async () => {
      const r = await P.dialog({ title: 'Remove points', intro: 'This is a correction. It is recorded with your name and the reason.', submit: 'Remove points', fields: [
        { name: 'v', label: 'Points to remove', type: 'select', value: '2', options: [1, 2, 3].map((n) => ({ value: n, label: n + (n === 1 ? ' point' : ' points') })) },
        { name: 'reason', label: 'Reason', type: 'textarea', required: true, min: 5 }] });
      if (r) sendEvent(main, 'undo_score', b.dataset.undo, +r.v, r.reason);
    });
    $('#b-setclock') && ($('#b-setclock').onclick = () => {
      const mt = /^(\d{1,2}):([0-5]\d)$/.exec($('#c-set').value.trim()); if (!mt) return toast('Enter the clock as mm:ss, for example 07:30.', 'error');
      sendEvent(main, 'clock_set', null, +mt[1] * 60 + +mt[2], null, true);
    });
    $('#c-per') && ($('#c-per').onchange = (e) => sendEvent(main, 'period', null, +e.target.value, null, true));
    $$('[data-tr]', main).forEach((b) => b.onclick = () => transition(main, b.dataset.tr));
    icons();
    clearInterval(C.tick); C.tick = setInterval(() => { const a = $('#c-clock'), s = $('#c-shot'); if (!a) return clearInterval(C.tick); a.textContent = fmtClock(clockNow()); s.textContent = shotNow() + 's'; }, 500);
  }
  async function sendEvent(main, type, team, value, reason, withVersion) {
    if (C.busy) return; C.busy = true;
    const id = crypto.randomUUID(); // a retry reuses this id, so the database counts the event once
    const args = { p_match_id: C.id, p_client_event_id: id, p_event_type: type, p_team: team || null, p_value: value, p_expected_version: withVersion ? C.m.version : null, p_reason: reason || null };
    try {
      let r = await sb.rpc('record_match_event', args);
      if (r.error && RB.isNetworkError(r.error)) { await P.sleep(900); r = await sb.rpc('record_match_event', args); }
      if (r.error) throw r.error;
      Object.assign(C.m, r.data); C.recv = Date.now();
      C.events = await q(sb.from('match_events').select('*').eq('match_id', C.id).order('created_at', { ascending: false }).limit(12));
    } catch (e) { fail(e); if (/version_conflict|another official/i.test(String(e.message))) await courtsideRender(main); }
    C.busy = false; paintCourtside(main);
  }
  async function transition(main, to) {
    const m = C.m; let reason = null;
    if (to === 'final') { const ok = await P.dialog({ title: 'Finish this game?', intro: `Final score ${m.home_score} - ${m.away_score}. Scoring stops and the result is published to standings.`, submit: 'Finish game' }); if (!ok) return; }
    else if (to !== 'live') {
      reason = await P.askReason({ under_review: 'Flag for review', postponed: 'Suspend game', cancelled: 'Cancel this live game' }[to], to === 'cancelled' ? 'This stops the game. The score history is kept.' : 'Explain what happened.', to === 'cancelled' ? 10 : 5, 'Confirm', to === 'cancelled'); if (!reason) return;
    }
    try { await rpc('transition_match', { p_match_id: C.id, p_to: to, p_reason: reason, p_expected_version: m.version }); toast('Game status updated.'); } catch (e) { fail(e); }
    await courtsideRender(main);
  }
  P.modules.courtside = { render: courtsideRender, watch: ['matches'], onChange: (t, p) => { if (p.new && p.new.id === C.id && p.new.version === (C.m && C.m.version)) return; P.refresh(); } };

  // =====================================================================================
  // FIXTURES
  // =====================================================================================
  const F = { showArchived: false };
  async function fixturesRender(main) {
    const mg = can('matches.manage');
    const [matches, teams, officials, assigns] = await Promise.all([
      q(sb.from('matches').select(SEL).order('scheduled_at', { ascending: false }).limit(200)),
      q(sb.from('teams').select('id,name,registration_status').eq('registration_status', 'approved').order('name')),
      mg ? sb.rpc('list_assignable_officials').then((r) => r.data || []) : [],
      mg ? q(sb.from('official_assignments').select('*')) : []
    ]);
    const shown = matches.filter((m) => F.showArchived || !m.archived_at);
    const nameOf = (id) => (officials.find((o) => o.id === id) || {}).name || 'Official';
    main.innerHTML = `<div class="max-w-6xl mx-auto space-y-4">
      ${mg ? card('Create a fixture', `<form id="f-fx" class="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div class="md:col-span-2"><label class="${labelCls}" for="fx-h">Home team</label><select id="fx-h" required class="${inputCls}">${teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
        <div class="md:col-span-2"><label class="${labelCls}" for="fx-a">Away team</label><select id="fx-a" required class="${inputCls}">${teams.map((t, i) => `<option value="${t.id}" ${i === 1 ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
        <div><label class="${labelCls}" for="fx-r">Round</label><input id="fx-r" value="Pool" maxlength="40" class="${inputCls}"></div>
        <div><label class="${labelCls}" for="fx-c">Court</label><input id="fx-c" value="Court 1" maxlength="40" class="${inputCls}"></div>
        <div class="md:col-span-2"><label class="${labelCls}" for="fx-t">Tip-off</label><input id="fx-t" type="datetime-local" required class="${inputCls}"></div>
        <label class="flex items-center gap-2 text-xs text-gray-300 md:col-span-2"><input id="fx-p" type="checkbox" class="accent-orange-500"> Publish to the public site</label>
        <div class="md:col-span-2"><button class="bg-rbtOrange text-black font-heading font-bold uppercase text-xs px-5 py-2.5 rounded-lg">Create fixture</button></div></form>
        ${teams.length < 2 ? '<p class="text-xs text-amber-300 mt-2">You need at least two approved teams. Add or approve teams first.</p>' : ''}`) : ''}
      ${card(`<span class="flex items-center justify-between">All fixtures ${can('matches.restore') ? `<label class="normal-case text-xs text-gray-300 font-normal flex items-center gap-1.5"><input id="fx-arch" type="checkbox" ${F.showArchived ? 'checked' : ''} class="accent-orange-500"> Show archived</label>` : ''}</span>`,
        shown.length ? `<div class="overflow-x-auto"><table class="w-full text-left text-xs min-w-[720px]"><thead><tr class="text-gray-400 border-b border-rbtBorder"><th class="pb-2">Game</th><th class="pb-2">When</th><th class="pb-2">Status</th><th class="pb-2">Score</th><th class="pb-2">Scorekeeper</th><th class="pb-2">Actions</th></tr></thead><tbody class="divide-y divide-rbtBorder/50">
        ${shown.map((m) => { const sk = assigns.filter((a) => a.match_id === m.id && a.assignment_role === 'scorekeeper'); const editable = ['scheduled', 'ready', 'postponed'].includes(m.status) && !m.archived_at;
          return `<tr class="align-top text-gray-200"><td class="py-2.5 pr-2"><span class="text-white font-semibold">${vs(m)}</span><br><span class="text-gray-400">${esc(m.round)} · ${esc(m.court)}</span>${m.archived_at ? '<br><span class="text-amber-300">Archived</span>' : ''}</td>
          <td class="pr-2">${esc(fmtTime(m.scheduled_at))}</td><td class="pr-2">${chip(m.status)}${m.is_published ? '' : '<br><span class="text-gray-500">not public</span>'}</td>
          <td class="pr-2">${m.home_score}-${m.away_score}</td>
          <td class="pr-2">${sk.map((a) => `<span class="inline-flex items-center gap-1 mr-1">${esc(nameOf(a.user_id))}${mg ? `<button data-unassign="${a.id}" class="text-red-300" aria-label="Remove">×</button>` : ''}</span>`).join('') || '<span class="text-gray-500">none</span>'}</td>
          <td><div class="flex flex-wrap gap-1.5">${mg && !m.archived_at ? `
            ${editable ? btn('Edit', `data-edit="${m.id}"`) : ''}${btn(m.is_published ? 'Unpublish' : 'Publish', `data-pub="${m.id}" data-to="${!m.is_published}"`)}
            ${editable ? btn('Assign', `data-assign="${m.id}"`) : ''}
            ${m.status === 'scheduled' ? btn('Ready', `data-tr="${m.id}" data-to="ready"`, 'good') : ''}${m.status === 'ready' ? btn('Unready', `data-tr="${m.id}" data-to="scheduled"`) : ''}
            ${m.status === 'postponed' ? btn('Reschedule', `data-tr="${m.id}" data-to="scheduled"`) : ''}
            ${['scheduled', 'ready'].includes(m.status) ? btn('Postpone', `data-tr="${m.id}" data-to="postponed" data-reason="1"`) : ''}
            ${['scheduled', 'ready', 'postponed'].includes(m.status) ? btn('Cancel', `data-tr="${m.id}" data-to="cancelled" data-reason="1"`, 'danger') : ''}
            ${m.status === 'scheduled' ? btn('Delete', `data-del="${m.id}"`, 'danger') : ''}` : ''}
            ${m.status === 'cancelled' && can('matches.restore') && !m.archived_at ? btn('Restore', `data-tr="${m.id}" data-to="scheduled"`, 'good') : ''}
            ${m.archived_at && can('matches.restore') ? btn('Restore from archive', `data-unarch="${m.id}"`, 'good') : ''}
            ${!m.archived_at && can('matches.archive') && m.status !== 'live' ? btn('Archive', `data-arch="${m.id}"`) : ''}
            ${['live', 'final', 'under_review'].includes(m.status) ? '<span class="text-gray-500">Locked: use Courtside or Tournament Controls</span>' : ''}
          </div></td></tr>`; }).join('')}</tbody></table></div>` : empty('No fixtures yet.'))}</div>`;

    const f = $('#f-fx'); if (f) f.onsubmit = guard(async (e) => {
      e.preventDefault();
      if ($('#fx-h').value === $('#fx-a').value) return toast('Choose two different teams.', 'error');
      const { error } = await sb.from('matches').insert({ home_team_id: $('#fx-h').value, away_team_id: $('#fx-a').value, round: $('#fx-r').value.trim() || 'Pool', court: $('#fx-c').value.trim() || 'Court 1', scheduled_at: new Date($('#fx-t').value).toISOString(), is_published: $('#fx-p').checked });
      if (error) throw error; toast('Fixture created.'); fixturesRender(main).then(icons);
    });
    const ar = $('#fx-arch'); if (ar) ar.onchange = () => { F.showArchived = ar.checked; fixturesRender(main).then(icons); };
    const again = () => fixturesRender(main).then(icons);
    $$('[data-pub]', main).forEach((b) => b.onclick = guard(async () => { const { error } = await sb.from('matches').update({ is_published: b.dataset.to === 'true' }).eq('id', b.dataset.pub); if (error) throw error; again(); }));
    $$('[data-tr]', main).forEach((b) => b.onclick = guard(async () => {
      let reason = null; if (b.dataset.reason) { reason = await P.askReason(b.dataset.to === 'cancelled' ? 'Cancel fixture' : 'Postpone fixture', 'Say why. Everyone with access can see this.', b.dataset.to === 'cancelled' ? 10 : 5, 'Confirm', b.dataset.to === 'cancelled'); if (!reason) return; }
      await rpc('transition_match', { p_match_id: b.dataset.tr, p_to: b.dataset.to, p_reason: reason }); toast('Fixture updated.'); again();
    }));
    $$('[data-del]', main).forEach((b) => b.onclick = guard(async () => { if (!(await P.dialog({ title: 'Delete this fixture?', intro: 'Only an untouched scheduled game can be deleted. This cannot be undone.', submit: 'Delete', danger: true }))) return; await rpc('delete_draft_match', { p_match_id: b.dataset.del }); toast('Fixture deleted.'); again(); }));
    $$('[data-arch]', main).forEach((b) => b.onclick = guard(async () => { const r = await P.askReason('Archive this game', 'Archived games leave the public site and standings. The history is kept and can be restored.', 5, 'Archive'); if (!r) return; await rpc('archive_match', { p_match_id: b.dataset.arch, p_reason: r }); toast('Game archived.'); again(); }));
    $$('[data-unarch]', main).forEach((b) => b.onclick = guard(async () => { await rpc('restore_match', { p_match_id: b.dataset.unarch }); toast('Game restored.'); again(); }));
    $$('[data-unassign]', main).forEach((b) => b.onclick = guard(async () => { const { error } = await sb.from('official_assignments').delete().eq('id', b.dataset.unassign); if (error) throw error; again(); }));
    $$('[data-assign]', main).forEach((b) => b.onclick = guard(async () => {
      const sks = officials.filter((o) => ['scorekeeper', 'director'].includes(o.role)); if (!sks.length) return toast('No active scorekeepers yet. Approve one in Official Access.', 'error');
      const r = await P.dialog({ title: 'Assign a scorekeeper', submit: 'Assign', fields: [{ name: 'u', label: 'Scorekeeper', type: 'select', options: sks.map((o) => ({ value: o.id, label: o.name })) }] }); if (!r) return;
      const { error } = await sb.from('official_assignments').insert({ match_id: b.dataset.assign, user_id: r.u, assignment_role: 'scorekeeper' }); if (error) throw error; toast('Scorekeeper assigned.'); again();
    }));
    $$('[data-edit]', main).forEach((b) => b.onclick = guard(async () => {
      const m = matches.find((x) => x.id === b.dataset.edit);
      if (!m) return toast('This fixture could not be found. Refresh and try again.', 'error');
      // Fixture managers can correct the matchup as well as the date, court and round.
      const teamOptions = teams.map((t) => ({ value: t.id, label: t.name }));
      const r = await P.dialog({
        title: 'Edit fixture',
        intro: 'Update the teams, tip-off time, court or round. Changes are saved to the tournament database and reflected on the public fixtures when published.',
        submit: 'Save fixture',
        fields: [
          { name: 'h', label: 'Home team', type: 'select', options: teamOptions, value: m.home_team_id, required: true },
          { name: 'a', label: 'Away team', type: 'select', options: teamOptions, value: m.away_team_id, required: true },
          { name: 't', label: 'Tip-off', type: 'datetime-local', value: toLocalInput(m.scheduled_at), required: true },
          { name: 'c', label: 'Court', value: m.court || 'Court 1', required: true },
          { name: 'r', label: 'Round / pool', value: m.round || 'Pool', required: true }
        ]
      });
      if (!r) return;
      if (r.h === r.a) return toast('Choose two different teams.', 'error');
      if (!r.t || Number.isNaN(new Date(r.t).getTime())) return toast('Enter a valid tip-off date and time.', 'error');
      const { error } = await sb.from('matches').update({
        home_team_id: r.h,
        away_team_id: r.a,
        scheduled_at: new Date(r.t).toISOString(),
        court: (r.c || '').trim() || 'Court 1',
        round: (r.r || '').trim() || 'Pool'
      }).eq('id', m.id);
      if (error) throw error;
      toast('Fixture saved. Public fixtures will update automatically when published.');
      again();
    }));
  }
  P.modules.fixtures = { render: fixturesRender, watch: ['matches'] };

  // =====================================================================================
  // TEAMS
  // =====================================================================================
  async function teamsRender(main) {
    const teams = await q(sb.from('teams').select('*').order('created_at', { ascending: false }));
    const pending = teams.filter((t) => t.registration_status === 'pending'), rest = teams.filter((t) => t.registration_status !== 'pending');
    main.innerHTML = `<div class="max-w-5xl mx-auto space-y-4">
      ${card('Pending registrations', pending.length ? pending.map((t) => `<div class="py-3 border-b border-rbtBorder/50 last:border-0 flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div class="min-w-0 text-sm"><p class="text-white font-semibold">${esc(t.name)}</p><p class="text-xs text-gray-400">Captain ${esc(t.captain_name || '-')} · ${esc(t.contact_phone || '-')} · ${esc(t.contact_email || '-')}</p><p class="text-xs text-gray-300 mt-1 break-words">${esc(t.roster_notes || '')}</p></div>
        <div class="flex gap-2 shrink-0">${btn('Approve', `data-rv="${t.id}" data-d="approved"`, 'good')}${btn('Reject', `data-rv="${t.id}" data-d="rejected"`, 'danger')}</div></div>`).join('') : empty('No registrations are waiting.'))}
      ${card('Add a team directly', `<form id="f-team" class="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"><div class="sm:col-span-2"><label class="${labelCls}" for="tm-n">Team name</label><input id="tm-n" required maxlength="80" class="${inputCls}"></div>
        <div><label class="${labelCls}" for="tm-p">Pool</label><input id="tm-p" maxlength="20" placeholder="A" class="${inputCls}"></div><button class="bg-rbtOrange text-black font-heading font-bold uppercase text-xs px-4 py-2.5 rounded-lg">Add approved team</button></form>`)}
      ${card('Reviewed teams', rest.length ? `<ul class="divide-y divide-rbtBorder/50 text-sm">${rest.map((t) => `<li class="py-2 flex items-center justify-between gap-3"><span class="text-white">${esc(t.name)}${t.pool ? ' · Pool ' + esc(t.pool) : ''}</span>${chip(t.registration_status)}</li>`).join('')}</ul>` : empty('No teams yet.'))}</div>`;
    $$('[data-rv]', main).forEach((b) => b.onclick = guard(async () => {
      const r = await P.dialog({ title: b.dataset.d === 'approved' ? 'Approve team' : 'Reject team', submit: b.dataset.d === 'approved' ? 'Approve' : 'Reject', danger: b.dataset.d === 'rejected', fields: [{ name: 'n', label: 'Notes (optional)', type: 'textarea' }] }); if (!r) return;
      await rpc('review_team', { p_team: b.dataset.rv, p_decision: b.dataset.d, p_notes: r.n || null }); toast('Team ' + b.dataset.d + '.'); teamsRender(main).then(icons); P.refreshBadges();
    }));
    $('#f-team').onsubmit = guard(async (e) => {
      e.preventDefault(); const { error } = await sb.from('teams').insert({ name: $('#tm-n').value.trim(), pool: $('#tm-p').value.trim() || null, registration_status: 'approved', is_published: true });
      if (error) throw error; toast('Team added.'); teamsRender(main).then(icons);
    });
  }
  P.modules.teams = { render: teamsRender };

  // =====================================================================================
  // REPORTS (referees submit, reviewers read)
  // =====================================================================================
  async function reportsRender(main) {
    const sub = can('reports.submit');
    const [matches, reports] = await Promise.all([sub ? q(sb.from('matches').select(SEL).order('scheduled_at', { ascending: false }).limit(50)) : [], q(sb.from('match_reports').select('*, match:matches(home:teams!matches_home_team_id_fkey(name), away:teams!matches_away_team_id_fkey(name))').order('created_at', { ascending: false }).limit(50))]);
    main.innerHTML = `<div class="max-w-4xl mx-auto space-y-4">
      ${sub ? card('Submit a match report', matches.length ? `<form id="f-rep" class="space-y-3"><div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label class="${labelCls}" for="rp-m">Game</label><select id="rp-m" class="${inputCls}">${matches.map((m) => `<option value="${m.id}">${esc(m.home && m.home.name)} vs ${esc(m.away && m.away.name)}</option>`).join('')}</select></div>
        <div><label class="${labelCls}" for="rp-k">Type</label><select id="rp-k" class="${inputCls}"><option value="report">Match report</option><option value="incident">Disciplinary incident</option></select></div></div>
        <div><label class="${labelCls}" for="rp-b">Details</label><textarea id="rp-b" rows="4" required minlength="5" maxlength="4000" class="${inputCls}"></textarea></div>
        <button class="bg-rbtOrange text-black font-heading font-bold uppercase text-xs px-5 py-2.5 rounded-lg">Submit report</button><p class="text-[11px] text-gray-500">Reports cannot be edited after submission.</p></form>` : empty('You have no assigned games to report on yet.')) : ''}
      ${card(can('reports.review') ? 'All reports' : 'My reports', reports.length ? `<ul class="divide-y divide-rbtBorder/50">${reports.map((r) => `<li class="py-3 text-sm"><p class="text-white font-semibold">${chip(r.kind)} ${esc(r.match && r.match.home && r.match.home.name)} vs ${esc(r.match && r.match.away && r.match.away.name)}</p><p class="text-gray-300 mt-1 break-words">${esc(r.body)}</p><p class="text-[11px] text-gray-500 mt-1">${esc(fmtTime(r.created_at))}</p></li>`).join('')}</ul>` : empty('No reports yet.'))}</div>`;
    const f = $('#f-rep'); if (f) f.onsubmit = guard(async (e) => { e.preventDefault(); const { error } = await sb.from('match_reports').insert({ match_id: $('#rp-m').value, kind: $('#rp-k').value, body: $('#rp-b').value.trim() }); if (error) throw error; toast('Report submitted.'); reportsRender(main).then(icons); });
  }
  P.modules.reports = { render: reportsRender };

  // =====================================================================================
  // ANNOUNCEMENTS
  // =====================================================================================
  async function announcementsRender(main) {
    const list = await q(sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(60));
    const pub = can('content.publish'), mg = can('content.manage');
    main.innerHTML = `<div class="max-w-4xl mx-auto space-y-4">
      ${mg ? card('Write an announcement', `<form id="f-an" class="space-y-3"><div><label class="${labelCls}" for="an-t">Title</label><input id="an-t" required minlength="3" maxlength="140" class="${inputCls}"></div>
        <div><label class="${labelCls}" for="an-b">Message</label><textarea id="an-b" rows="3" required maxlength="4000" class="${inputCls}"></textarea></div>
        <label class="flex items-center gap-2 text-xs text-gray-300"><input id="an-bn" type="checkbox" class="accent-orange-500"> Show as a banner at the top of the public site</label>
        <button class="bg-rbtOrange text-black font-heading font-bold uppercase text-xs px-5 py-2.5 rounded-lg">Save draft</button></form>`) : ''}
      ${card('Announcements', list.length ? `<ul class="divide-y divide-rbtBorder/50">${list.map((a) => `<li class="py-3"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="text-white font-semibold text-sm">${esc(a.title)} ${a.is_banner ? '<span class="text-[10px] text-rbtGold uppercase">banner</span>' : ''}</p><p class="text-xs text-gray-300 mt-1 break-words">${esc(a.body)}</p></div>${chip(a.status)}</div>
        <div class="flex flex-wrap gap-2 mt-2">${a.status === 'draft' && mg ? btn('Submit for approval', `data-st="${a.id}" data-to="pending_approval"`) : ''}
          ${pub && a.status !== 'published' ? btn('Publish', `data-st="${a.id}" data-to="published"`, 'good') : ''}${pub && a.status === 'published' ? btn('Take down', `data-st="${a.id}" data-to="archived"`, 'danger') : ''}
          ${a.status === 'draft' && mg ? btn('Delete draft', `data-dd="${a.id}"`, 'danger') : ''}</div></li>`).join('')}</ul>` : empty('No announcements yet.'))}</div>`;
    const f = $('#f-an'); if (f) f.onsubmit = guard(async (e) => { e.preventDefault(); const { error } = await sb.from('announcements').insert({ title: $('#an-t').value.trim(), body: $('#an-b').value.trim(), is_banner: $('#an-bn').checked }); if (error) throw error; toast('Draft saved.'); announcementsRender(main).then(icons); });
    $$('[data-st]', main).forEach((b) => b.onclick = guard(async () => { await rpc('set_announcement_status', { p_id: b.dataset.st, p_to: b.dataset.to }); toast('Announcement updated.'); announcementsRender(main).then(icons); P.refreshBadges(); }));
    $$('[data-dd]', main).forEach((b) => b.onclick = guard(async () => { const { error } = await sb.from('announcements').delete().eq('id', b.dataset.dd); if (error) throw error; announcementsRender(main).then(icons); }));
  }
  P.modules.announcements = { render: announcementsRender, watch: ['announcements'] };

  // =====================================================================================
  // TASKS
  // =====================================================================================
  async function tasksRender(main) {
    const mg = can('tasks.manage'), uid = P.S.profile.id;
    const [tasks, officials, matches] = await Promise.all([
      q(sb.from('tasks').select('*').order('created_at', { ascending: false }).limit(100)),
      mg ? sb.rpc('list_assignable_officials').then((r) => r.data || []) : [],
      mg ? q(sb.from('matches').select(SEL).is('archived_at', null).order('scheduled_at', { ascending: false }).limit(40)) : []
    ]);
    const who = (id) => (officials.find((o) => o.id === id) || {}).name || (id === uid ? 'You' : 'Official');
    main.innerHTML = `<div class="max-w-5xl mx-auto space-y-4">
      ${mg ? card('Assign a task', `<form id="f-tk" class="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div class="md:col-span-3"><label class="${labelCls}" for="tk-t">Title</label><input id="tk-t" required minlength="3" maxlength="140" class="${inputCls}" placeholder="e.g. Verify Rongai Heat roster"></div>
        <div class="md:col-span-3"><label class="${labelCls}" for="tk-u">Assign to</label><select id="tk-u" required class="${inputCls}">${officials.map((o) => `<option value="${o.id}">${esc(o.name)} (${esc(P.ROLE_LABELS[o.role] || o.role)})</option>`).join('')}</select></div>
        <div class="md:col-span-2"><label class="${labelCls}" for="tk-m">Related game</label><select id="tk-m" class="${inputCls}"><option value="">None</option>${matches.map((m) => `<option value="${m.id}">${esc(m.home && m.home.name)} vs ${esc(m.away && m.away.name)}</option>`).join('')}</select></div>
        <div><label class="${labelCls}" for="tk-p">Priority</label><select id="tk-p" class="${inputCls}"><option>normal</option><option>low</option><option>high</option><option>urgent</option></select></div>
        <div><label class="${labelCls}" for="tk-d">Due</label><input id="tk-d" type="datetime-local" class="${inputCls}"></div>
        <div class="md:col-span-2"><button class="bg-rbtOrange text-black font-heading font-bold uppercase text-xs px-5 py-2.5 rounded-lg w-full">Assign task</button></div></form>`) : ''}
      ${card(mg ? 'All tasks' : 'My tasks', tasks.length ? `<ul class="divide-y divide-rbtBorder/50">${tasks.map((t) => `<li class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div class="min-w-0"><p class="text-white text-sm font-semibold">${esc(t.title)}</p><p class="text-[11px] text-gray-400">${mg ? esc(who(t.assigned_to)) + ' · ' : ''}${esc(t.priority)}${t.due_at ? ' · due ' + esc(fmtTime(t.due_at)) : ''}${t.notes ? ' · ' + esc(t.notes) : ''}</p></div>
        <div class="flex items-center gap-2 shrink-0">${chip(t.status)}<select data-ts="${t.id}" class="bg-black/50 border border-rbtBorder rounded text-xs text-white p-1" aria-label="Change status">${['open', 'in_progress', 'blocked', 'done'].map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select>${mg ? btn('Delete', `data-td="${t.id}"`, 'danger') : ''}</div></li>`).join('')}</ul>` : empty('No tasks.'))}</div>`;
    const f = $('#f-tk'); if (f) f.onsubmit = guard(async (e) => { e.preventDefault(); const { error } = await sb.from('tasks').insert({ title: $('#tk-t').value.trim(), assigned_to: $('#tk-u').value, match_id: $('#tk-m').value || null, priority: $('#tk-p').value, due_at: $('#tk-d').value ? new Date($('#tk-d').value).toISOString() : null }); if (error) throw error; toast('Task assigned.'); tasksRender(main).then(icons); });
    $$('[data-ts]', main).forEach((s) => s.onchange = guard(async () => { await rpc('update_task_status', { p_id: s.dataset.ts, p_status: s.value }); toast('Task updated.'); tasksRender(main).then(icons); P.refreshBadges(); }));
    $$('[data-td]', main).forEach((b) => b.onclick = guard(async () => { const { error } = await sb.from('tasks').delete().eq('id', b.dataset.td); if (error) throw error; tasksRender(main).then(icons); }));
  }
  P.modules.tasks = { render: tasksRender, watch: ['tasks'] };

  // =====================================================================================
  // OFFICIAL ACCESS (Director): requests, officials, role permissions, history
  // =====================================================================================
  const PERMS = [['matches.view_all', 'See all matches'], ['matches.manage', 'Create and edit fixtures'], ['matches.lifecycle', 'Suspend or resume live games'], ['matches.score', 'Score assigned games'], ['matches.finalize', 'Finish assigned games'],
    ['matches.correct', 'Correct final results'], ['matches.cancel_live', 'Cancel live games'], ['matches.archive', 'Archive games'], ['matches.restore', 'Restore games'], ['reports.submit', 'Submit match reports'], ['reports.review', 'Read all reports'],
    ['teams.review', 'Review team registrations'], ['stats.verify', 'Verify statistics'], ['content.manage', 'Draft announcements'], ['content.publish', 'Publish announcements'], ['tasks.manage', 'Assign tasks'], ['audit.read', 'Read the audit log'], ['access.manage', 'Manage official access']];
  const O = { tab: 'requests' };
  async function fnCall(body) {
    const { data, error } = await sb.functions.invoke('official-admin', { body });
    if (error) { let msg = error.message; try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) {} throw new Error(msg); }
    if (data && data.error) throw new Error(data.error);
    return data;
  }
  async function officialsRender(main) {
    const [reqs, profiles, roles] = await Promise.all([q(sb.from('account_requests').select('*').order('requested_at', { ascending: false }).limit(100)), q(sb.from('profiles').select('*').order('created_at')), q(sb.from('official_roles').select('*').order('key'))]);
    const me = P.S.profile.id, isDir = P.S.profile.role === 'director';
    const open = reqs.filter((r) => ['pending', 'more_info'].includes(r.status)), done = reqs.filter((r) => !['pending', 'more_info'].includes(r.status));
    const tabs = [['requests', 'Requests' + (open.length ? ' (' + open.length + ')' : '')], ['officials', 'Officials'], ['roles', 'Roles and permissions'], ['history', 'Decisions']];
    const body = {
      requests: () => open.length ? open.map((r) => `<div class="py-3 border-b border-rbtBorder/50 last:border-0 flex flex-col lg:flex-row lg:items-start justify-between gap-3">
        <div class="min-w-0 text-sm"><p class="text-white font-semibold">${esc(r.full_name)} ${chip(r.status)}</p><p class="text-xs text-gray-400">${esc(r.email)} · ${esc(r.phone || 'no phone')} · wants ${esc(P.ROLE_LABELS[r.requested_role] || r.requested_role)} · ${esc(fmtTime(r.requested_at))}</p><p class="text-xs text-gray-300 mt-1 break-words">${esc(r.reason)}</p>${r.review_notes ? `<p class="text-xs text-sky-300 mt-1">Your note: ${esc(r.review_notes)}</p>` : ''}</div>
        <div class="flex flex-wrap gap-2 shrink-0">${btn('Approve', `data-ap="${r.id}"`, 'good')}${btn('Ask for info', `data-rq="${r.id}" data-d="more_info"`)}${btn('Reject', `data-rq="${r.id}" data-d="rejected"`, 'danger')}</div></div>`).join('') : empty('No requests are waiting. New requests appear here as they arrive.'),
      officials: () => profiles.length ? `<div class="overflow-x-auto"><table class="w-full text-left text-xs min-w-[640px]"><thead><tr class="text-gray-400 border-b border-rbtBorder"><th class="pb-2">Official</th><th class="pb-2">Role</th><th class="pb-2">Department</th><th class="pb-2">Status</th><th class="pb-2">Approved</th><th class="pb-2">Actions</th></tr></thead><tbody class="divide-y divide-rbtBorder/50">
        ${profiles.map((p) => `<tr class="text-gray-200 align-top"><td class="py-2.5 pr-2"><span class="text-white font-semibold">${esc(p.full_name)}</span><br><span class="text-gray-400">${esc(p.email)}</span></td><td class="pr-2">${esc(P.ROLE_LABELS[p.role] || p.role)}</td><td class="pr-2">${esc(p.department || '-')}</td><td class="pr-2">${chip(p.status)}</td><td class="pr-2">${p.approved_at ? esc(fmtTime(p.approved_at)) : '-'}</td>
        <td>${p.id === me ? '<span class="text-gray-500">You</span>' : `<div class="flex flex-wrap gap-1.5">${btn('Change role', `data-ch="${p.id}"`)}${p.status === 'active' ? btn('Suspend', `data-st="${p.id}" data-to="suspended"`, 'danger') + btn('Revoke', `data-st="${p.id}" data-to="revoked"`, 'danger') : btn('Reactivate', `data-st="${p.id}" data-to="active"`, 'good')}</div>`}</td></tr>`).join('')}</tbody></table></div>` : empty('No officials yet.'),
      roles: () => `<p class="text-xs text-gray-400 mb-3">${isDir ? 'Tick what each role may do, then save that role. The database enforces these rules; hiding a button never replaces them.' : 'Only the Director can change these.'} The Director role always has full access.</p>
        <div class="overflow-x-auto"><table class="w-full text-xs min-w-[640px]"><thead><tr class="text-gray-400 border-b border-rbtBorder"><th class="pb-2 text-left">Permission</th>${roles.filter((r) => r.key !== 'director').map((r) => `<th class="pb-2 px-1 text-center font-semibold">${esc(r.label.split(' / ')[0].replace('Courtside ', '').replace('Team ', '').replace(' Official', '').replace(' Officer', ''))}</th>`).join('')}</tr></thead><tbody class="divide-y divide-rbtBorder/50">
        ${PERMS.map(([k, label]) => `<tr><td class="py-1.5 text-gray-200">${esc(label)}</td>${roles.filter((r) => r.key !== 'director').map((r) => `<td class="text-center"><input type="checkbox" data-rp="${r.key}" value="${k}" ${r.permissions.includes(k) ? 'checked' : ''} ${isDir ? '' : 'disabled'} class="accent-orange-500" aria-label="${esc(label)} for ${esc(r.label)}"></td>`).join('')}</tr>`).join('')}
        <tr><td class="pt-3"></td>${roles.filter((r) => r.key !== 'director').map((r) => `<td class="pt-3 text-center">${isDir ? btn('Save', `data-rs="${r.key}"`, 'primary') : ''}</td>`).join('')}</tr></tbody></table></div>`,
      history: () => done.length ? `<ul class="divide-y divide-rbtBorder/50">${done.map((r) => `<li class="py-2.5 text-sm flex items-center justify-between gap-3"><div class="min-w-0"><p class="text-white">${esc(r.full_name)} <span class="text-gray-400 text-xs">${esc(r.email)}</span></p><p class="text-[11px] text-gray-400">${r.reviewed_at ? esc(fmtTime(r.reviewed_at)) : ''}${r.approved_role ? ' · ' + esc(P.ROLE_LABELS[r.approved_role] || r.approved_role) : ''}${r.review_notes ? ' · ' + esc(r.review_notes) : ''}</p></div>${chip(r.status)}</li>`).join('')}</ul>` : empty('No decisions yet.')
    };
    main.innerHTML = `<div class="max-w-6xl mx-auto space-y-4"><div class="flex gap-1 overflow-x-auto" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${O.tab === k}" class="shrink-0 px-3 py-2 rounded-lg text-xs font-heading font-bold uppercase ${O.tab === k ? 'bg-rbtOrange text-black' : 'bg-rbtCard border border-rbtBorder text-gray-300'}">${l}</button>`).join('')}</div>
      ${card('', body[O.tab]())}</div>`;
    const again = () => officialsRender(main).then(icons);
    $$('[data-tab]', main).forEach((b) => b.onclick = () => { O.tab = b.dataset.tab; again(); });
    $$('[data-ap]', main).forEach((b) => b.onclick = guard(async () => {
      const r = reqs.find((x) => x.id === b.dataset.ap);
      const v = await P.dialog({ title: 'Approve ' + r.full_name, intro: 'They receive an email with a secure link to set their own password. Choose what they can do.', submit: 'Approve and invite', fields: [
        { name: 'role', label: 'Role', type: 'select', value: r.requested_role, options: roles.filter((x) => isDir || !x.permissions.some((p) => p === '*' || p === 'access.manage')).map((x) => ({ value: x.key, label: x.label })) },
        { name: 'dept', label: 'Department', value: (/^\[Department: ([^\]]*)\]/.exec(r.reason) || [])[1] || '' }] }); if (!v) return;
      b.disabled = true; await fnCall({ action: 'approve', request_id: r.id, role: v.role, department: v.dept }); toast('Approved. An invitation email is on its way to ' + r.email + '.'); again(); P.refreshBadges();
    }));
    $$('[data-rq]', main).forEach((b) => b.onclick = guard(async () => {
      const more = b.dataset.d === 'more_info';
      const v = await P.dialog({ title: more ? 'Ask for more information' : 'Reject request', submit: more ? 'Save note' : 'Reject', danger: !more, fields: [{ name: 'n', label: more ? 'What do you need to know?' : 'Reason (kept on record)', type: 'textarea', required: true, min: 3 }] }); if (!v) return;
      await rpc('review_account_request', { p_id: b.dataset.rq, p_decision: b.dataset.d, p_notes: v.n }); toast(more ? 'Note saved. Contact them by email for the details.' : 'Request rejected.'); again(); P.refreshBadges();
    }));
    $$('[data-st]', main).forEach((b) => b.onclick = guard(async () => {
      const to = b.dataset.to, p = profiles.find((x) => x.id === b.dataset.st);
      if (to !== 'active' && !(await P.dialog({ title: (to === 'suspended' ? 'Suspend ' : 'Revoke ') + p.full_name + '?', intro: 'They lose access to protected data immediately, even if they are signed in.', submit: to === 'suspended' ? 'Suspend' : 'Revoke', danger: true }))) return;
      await fnCall({ action: 'set_access', user_id: p.id, status: to }); toast('Access updated.'); again();
    }));
    $$('[data-ch]', main).forEach((b) => b.onclick = guard(async () => {
      const p = profiles.find((x) => x.id === b.dataset.ch);
      const v = await P.dialog({ title: 'Change role for ' + p.full_name, submit: 'Save', fields: [{ name: 'role', label: 'Role', type: 'select', value: p.role, options: roles.filter((x) => isDir || !x.permissions.some((q2) => q2 === '*' || q2 === 'access.manage')).map((x) => ({ value: x.key, label: x.label })) }, { name: 'dept', label: 'Department', value: p.department }] }); if (!v) return;
      await fnCall({ action: 'set_access', user_id: p.id, role: v.role, department: v.dept }); toast('Role updated.'); again();
    }));
    $$('[data-rs]', main).forEach((b) => b.onclick = guard(async () => {
      const perms = $$(`[data-rp="${b.dataset.rs}"]:checked`, main).map((i) => i.value);
      await rpc('set_role_permissions', { p_role: b.dataset.rs, p_permissions: perms }); toast('Permissions saved. They apply immediately.');
    }));
  }
  P.modules.officials = { render: officialsRender, watch: ['account_requests'] };

  // =====================================================================================
  // TOURNAMENT CONTROLS (Director): live health, disputes, archive, audit
  // =====================================================================================
  async function controlsRender(main) {
    const run = (p) => p.then((r) => r.data || [], () => []);
    const [rawMatches, teams, events, audit] = await Promise.all([
      q(sb.from('matches').select(SEL).order('scheduled_at', { ascending: false }).limit(200)),
      q(sb.from('teams').select('id,name')),
      run(sb.from('match_events').select('*, match:matches(home:teams!matches_home_team_id_fkey(name), away:teams!matches_away_team_id_fkey(name))').in('event_type', ['score', 'undo_score', 'correction']).order('created_at', { ascending: false }).limit(20)),
      can('audit.read') ? run(sb.from('audit_logs').select('*').order('at', { ascending: false }).limit(50)) : []
    ]);
    // Resolve names from the teams table as a fallback if a relationship embed is null.
    const teamById = new Map(teams.map((t) => [String(t.id), t]));
    const matches = rawMatches.map((m) => ({
      ...m,
      home: m.home || teamById.get(String(m.home_team_id)) || { name: 'Home team name unavailable' },
      away: m.away || teamById.get(String(m.away_team_id)) || { name: 'Away team name unavailable' }
    }));
    const live = matches.filter((m) => m.status === 'live' && !m.archived_at), disputed = matches.filter((m) => m.status === 'under_review' && !m.archived_at);
    // Include every completed game, including older results beyond the previous 15.
    const finals = matches.filter((m) => m.status === 'final' && !m.archived_at);
    const gone = matches.filter((m) => m.archived_at || m.status === 'cancelled');
    const S = P.S;
    main.innerHTML = `<div class="max-w-6xl mx-auto space-y-4">
      ${card('Synchronization health', `<p class="text-sm text-gray-200">Connection: <b>${esc(S.conn)}</b>${S.lastSync ? ' · last change received ' + esc(S.lastSync.toLocaleTimeString()) : ''}. ${live.length} live game${live.length === 1 ? '' : 's'}. Public pages update from the same database, so a confirmed score reaches them within moments.</p>`)}
      ${card('Live matches', live.length ? live.map((m) => `<div class="py-2 flex flex-wrap items-center justify-between gap-2 border-b border-rbtBorder/50 last:border-0 text-sm"><span class="text-white font-semibold">${vs(m)}</span><span class="font-mono text-rbtGold">${m.home_score}-${m.away_score} · ${periodLabel(m.period)}</span><span class="text-[11px] text-gray-400">v${m.version} · ${m.clock_running ? 'clock running' : 'clock stopped'}</span><span class="flex gap-2">${btn('Flag for review', `data-flag="${m.id}"`)}${btn('Cancel game', `data-cl="${m.id}"`, 'danger')}</span></div>`).join('') : empty('No games are live.'))}
      ${card('Disputed results (under review)', disputed.length ? disputed.map((m) => `<div class="py-2 flex flex-wrap items-center justify-between gap-2 border-b border-rbtBorder/50 last:border-0 text-sm"><span class="text-white font-semibold">${vs(m)}</span><span class="font-mono text-rbtGold">${m.home_score}-${m.away_score}</span><span class="text-xs text-gray-400">${esc(m.status_reason || '')}</span><span class="flex gap-2">${btn('Correct score', `data-cs="${m.id}"`, 'primary')}${btn('Approve as final', `data-ok="${m.id}"`, 'good')}${btn('Resume live', `data-rs="${m.id}"`)}</span></div>`).join('') : empty('Nothing is under review.'))}
      ${card('Previous games — edit results and standings', finals.length ? `<p class="text-xs text-gray-400 mb-3">To correct a previous game, select Edit result, enter the verified score and reason, then approve the corrected result. Published standings are based on approved final results.</p>` + finals.map((m) => `<div class="py-2 flex flex-wrap items-center justify-between gap-2 border-b border-rbtBorder/50 last:border-0 text-sm"><span class="text-white">${vs(m)}</span><span class="font-mono text-rbtGold">${m.home_score}-${m.away_score}</span><span class="flex gap-2">${btn('Edit result', `data-cs="${m.id}"`, 'primary')}${btn('Reopen for review', `data-ro="${m.id}"`)}${btn('Archive', `data-ar="${m.id}"`)}</span></div>`).join('') : empty('No final results yet.'))}
      ${card('Cancelled and archived games', gone.length ? gone.map((m) => `<div class="py-2 flex flex-wrap items-center justify-between gap-2 border-b border-rbtBorder/50 last:border-0 text-sm"><span class="text-white">${vs(m)}</span>${chip(m.archived_at ? 'archived' : m.status)}<span class="text-xs text-gray-400">${esc(m.archive_reason || m.status_reason || '')}</span>${btn('Restore', `data-rest="${m.id}" data-a="${m.archived_at ? 1 : 0}"`, 'good')}</div>`).join('') : empty('Nothing cancelled or archived.'))}
      ${card('Recent score changes', events.length ? `<ul class="divide-y divide-rbtBorder/50 text-xs">${events.map((e) => `<li class="py-1.5 text-gray-300"><span class="text-white font-semibold">${esc(e.event_type)}</span> ${esc(e.team || '')} ${e.value != null ? esc(e.value) : ''} · ${esc(e.match && e.match.home && e.match.home.name)} vs ${esc(e.match && e.match.away && e.match.away.name)} → ${e.home_score_after}-${e.away_score_after} · ${esc(fmtTime(e.created_at))}${e.reason ? ' · ' + esc(e.reason) : ''}</li>`).join('')}</ul>` : empty('No score changes yet.'))}
      ${can('audit.read') ? card('Official activity and access changes', audit.length ? `<div class="overflow-x-auto"><table class="w-full text-xs min-w-[560px]"><thead><tr class="text-gray-400 border-b border-rbtBorder text-left"><th class="pb-2">When</th><th class="pb-2">Action</th><th class="pb-2">By</th><th class="pb-2">Details</th></tr></thead><tbody class="divide-y divide-rbtBorder/50">${audit.map((a) => `<tr class="text-gray-300 align-top"><td class="py-1.5 pr-2 whitespace-nowrap">${esc(fmtTime(a.at))}</td><td class="pr-2 text-white">${esc(a.action)}</td><td class="pr-2">${esc(a.actor_role || 'system')}</td><td class="break-words">${esc(JSON.stringify(a.details || {}))}</td></tr>`).join('')}</tbody></table></div>` : empty('The audit log is empty.')) : ''}</div>`;
    const again = () => controlsRender(main).then(icons);
    $$('[data-flag]', main).forEach((b) => b.onclick = guard(async () => { const r = await P.askReason('Flag for review', 'Explain the dispute.', 5); if (!r) return; await rpc('transition_match', { p_match_id: b.dataset.flag, p_to: 'under_review', p_reason: r }); toast('Game flagged.'); again(); }));
    $$('[data-cl]', main).forEach((b) => b.onclick = guard(async () => { const r = await P.askReason('Cancel this live game', 'The game stops. Every score event is kept.', 10, 'Cancel game', true); if (!r) return; await rpc('transition_match', { p_match_id: b.dataset.cl, p_to: 'cancelled', p_reason: r }); toast('Game cancelled.'); again(); }));
    $$('[data-ro]', main).forEach((b) => b.onclick = guard(async () => { const r = await P.askReason('Reopen final result', 'Standings update only after you approve the corrected result.', 5); if (!r) return; await rpc('transition_match', { p_match_id: b.dataset.ro, p_to: 'under_review', p_reason: r }); toast('Result reopened for review.'); again(); }));
    $$('[data-ok]', main).forEach((b) => b.onclick = guard(async () => { const r = await P.askReason('Approve as final', 'Confirm the score is correct.', 5, 'Approve'); if (!r) return; await rpc('transition_match', { p_match_id: b.dataset.ok, p_to: 'final', p_reason: r }); toast('Result approved.'); again(); }));
    $$('[data-rs]', main).forEach((b) => b.onclick = guard(async () => { const r = await P.askReason('Resume game', 'Say why play can continue.', 5); if (!r) return; await rpc('transition_match', { p_match_id: b.dataset.rs, p_to: 'live', p_reason: r }); toast('Game resumed.'); again(); }));
    $$('[data-cs]', main).forEach((b) => b.onclick = guard(async () => {
      const m = matches.find((x) => x.id === b.dataset.cs);
      const v = await P.dialog({ title: 'Correct the score', intro: vs(m).replace(/&amp;/g, '&'), submit: 'Save correction', fields: [{ name: 'h', label: 'Home score', type: 'number', value: m.home_score, required: true }, { name: 'a', label: 'Away score', type: 'number', value: m.away_score, required: true }, { name: 'r', label: 'Reason', type: 'textarea', required: true, min: 5 }] }); if (!v) return;
      await rpc('correct_match_score', { p_match_id: m.id, p_home: +v.h, p_away: +v.a, p_reason: v.r }); toast('Score corrected. Approve it as final when ready.'); again();
    }));
    $$('[data-ar]', main).forEach((b) => b.onclick = guard(async () => { const r = await P.askReason('Archive this game', 'It leaves the public site and standings. History is kept.', 5, 'Archive'); if (!r) return; await rpc('archive_match', { p_match_id: b.dataset.ar, p_reason: r }); toast('Game archived.'); again(); }));
    $$('[data-rest]', main).forEach((b) => b.onclick = guard(async () => { if (b.dataset.a === '1') await rpc('restore_match', { p_match_id: b.dataset.rest }); else await rpc('transition_match', { p_match_id: b.dataset.rest, p_to: 'scheduled' }); toast('Game restored.'); again(); }));
  }
  P.modules.controls = { render: controlsRender, watch: ['matches'] };
  // Standings & Results is a direct navigation shortcut to the verified previous-results
  // workflow. Approved final scores drive the public standings automatically.
})();
