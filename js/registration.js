// Team registration with an individual profile and photo for every player.
(function () {
  'use strict';
  const CFG = window.RBT_CONFIG || {}, MIN = 5, MAX = 20;
  const POS = ['Point Guard', 'Shooting Guard', 'Small Forward', 'Power Forward', 'Centre'];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const regId = uid();
  let players = [], seq = 0;
  const inp = 'w-full bg-black/50 border border-rbtBorder rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-rbtOrange';
  const fld = (l, body, k, i) => '<div><label class="block text-[11px] font-bold uppercase text-gray-300 mb-1">' + l + '</label>' + body + '<p class="text-[11px] text-red-300 mt-1" data-err="' + k + '"></p></div>';

  function add(quiet) {
    if (players.length >= MAX) return;
    players.push({ key: ++seq, open: true, full_name: '', jersey_no: '', position: '', height_cm: '', date_of_birth: '', bio: '', photo_path: '', preview: '', up: 0, upErr: '', errs: {} });
    render(quiet !== true);
  }
  function render(focusLast) {
    const box = $('reg-players'); if (!box) return;
    box.innerHTML = players.map((p, i) => {
      const done = p.full_name && p.jersey_no !== '' && p.position && p.photo_path;
      const head = '<button type="button" data-tog="' + p.key + '" class="w-full flex items-center gap-3 text-left" aria-expanded="' + p.open + '">'
        + (p.preview ? '<img src="' + p.preview + '" alt="" class="w-11 h-11 rounded-full object-cover border border-rbtBorder">' : '<span class="w-11 h-11 rounded-full bg-black/50 border border-rbtBorder flex items-center justify-center text-gray-500 text-lg">+</span>')
        + '<span class="min-w-0 flex-1"><span class="block font-heading font-bold text-white truncate">' + esc(p.full_name || 'Player ' + (i + 1)) + '</span><span class="block text-[11px] text-gray-400">' + (p.jersey_no !== '' ? '#' + esc(p.jersey_no) + ' &middot; ' : '') + esc(p.position || 'Position not set') + '</span></span>'
        + '<span class="text-[10px] font-bold uppercase px-2 py-1 rounded ' + (done ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rbtOrange/15 text-rbtOrange') + '">' + (done ? 'Ready' : 'Incomplete') + '</span></button>';
      const body = !p.open ? '' : '<div class="mt-4 grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-4" data-card="' + p.key + '">'
        + '<div><div class="relative w-[120px] h-[150px] rounded-xl overflow-hidden bg-black/50 border-2 border-dashed ' + (p.errs.photo_path ? 'border-red-500' : 'border-rbtBorder') + ' flex items-center justify-center">'
        + (p.preview ? '<img src="' + p.preview + '" alt="Player photo preview" class="w-full h-full object-cover">' : '<span class="text-[11px] text-gray-400 text-center px-2">Player photo</span>')
        + (p.up > 0 && p.up < 100 ? '<div class="absolute inset-x-0 bottom-0 bg-black/70 text-[10px] text-center py-1 text-white">Uploading ' + p.up + '%</div>' : '') + '</div>'
        + '<label class="mt-2 block text-center cursor-pointer bg-black/50 border border-rbtBorder hover:border-rbtOrange rounded-lg py-1.5 text-[11px] font-bold uppercase text-gray-200">' + (p.preview ? 'Change photo' : 'Upload photo') + '<input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" data-file="' + p.key + '"></label>'
        + '<p class="text-[11px] text-red-300 mt-1" data-err="photo_path">' + esc(p.upErr || p.errs.photo_path || '') + '</p></div>'
        + '<div class="grid grid-cols-2 gap-3">'
        + '<div class="col-span-2">' + fld('Full name', '<input data-f="full_name" value="' + esc(p.full_name) + '" maxlength="120" autocomplete="off" class="' + inp + '" placeholder="e.g. Brian Otieno">', 'full_name') + '</div>'
        + fld('Jersey number', '<input data-f="jersey_no" value="' + esc(p.jersey_no) + '" inputmode="numeric" maxlength="2" class="' + inp + '" placeholder="0 - 99">', 'jersey_no')
        + fld('Position', '<select data-f="position" class="' + inp + '"><option value="">Select</option>' + POS.map((o) => '<option ' + (o === p.position ? 'selected' : '') + '>' + o + '</option>').join('') + '</select>', 'position')
        + fld('Height cm (optional)', '<input data-f="height_cm" value="' + esc(p.height_cm) + '" inputmode="numeric" maxlength="3" class="' + inp + '" placeholder="e.g. 185">', 'height_cm')
        + fld('Date of birth (optional)', '<input type="date" data-f="date_of_birth" value="' + esc(p.date_of_birth) + '" class="' + inp + '">', 'date_of_birth')
        + '<div class="col-span-2">' + fld('Short bio (optional)', '<textarea data-f="bio" rows="2" maxlength="300" class="' + inp + '" placeholder="A line or two about the player">' + esc(p.bio) + '</textarea>', 'bio') + '</div></div>'
        + '<div class="sm:col-span-2 flex justify-end"><button type="button" data-rm="' + p.key + '" class="text-[11px] font-bold uppercase text-red-300 hover:text-red-200">Remove player</button></div></div>';
      return '<div class="bg-black/30 border ' + (Object.keys(p.errs).length ? 'border-red-500/60' : 'border-rbtBorder') + ' rounded-xl p-3">' + head + body + '</div>';
    }).join('');
    // errors beside fields
    players.forEach((p) => Object.keys(p.errs).forEach((k) => { const el = box.querySelector('[data-card="' + p.key + '"] [data-err="' + k + '"]'); if (el && k !== 'photo_path') el.textContent = p.errs[k]; }));
    const n = players.length; $('reg-count').textContent = n; $('reg-bar').style.width = Math.min(100, n / MIN * 100) + '%';
    $('reg-add').textContent = '+ Add Player' + (n ? ' (' + n + ' added)' : '');
    $('reg-add').disabled = n >= MAX;
    if (focusLast) { const last = box.lastElementChild; if (last) last.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  }
  const find = (k) => players.find((p) => p.key === +k);

  // shrink big phone photos before upload
  function resize(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const max = 900, r = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read this image.'))), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('This file is not a readable image.')); };
      img.src = url;
    });
  }
  function upload(blob, path, onp) {
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open('POST', CFG.SUPABASE_URL + '/storage/v1/object/player-photos/' + path);
      x.setRequestHeader('apikey', CFG.SUPABASE_ANON_KEY); x.setRequestHeader('Authorization', 'Bearer ' + CFG.SUPABASE_ANON_KEY);
      x.setRequestHeader('Content-Type', 'image/jpeg'); x.timeout = 45000;
      x.upload.onprogress = (e) => e.lengthComputable && onp(Math.round(e.loaded / e.total * 100));
      x.onload = () => (x.status < 300 ? res() : rej(new Error('Upload failed (' + x.status + '). Try again.')));
      x.onerror = () => rej(new Error('Network problem while uploading. Try again.')); x.ontimeout = () => rej(new Error('Upload timed out. Try again.'));
      x.send(blob);
    });
  }
  async function pick(p, file) {
    p.upErr = ''; delete p.errs.photo_path;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { p.upErr = 'Use a JPG, PNG or WebP photo.'; return render(); }
    if (file.size > 15 * 1024 * 1024) { p.upErr = 'Photo is too large (15 MB max).'; return render(); }
    try {
      const blob = await resize(file); p.preview = URL.createObjectURL(blob); p.photo_path = ''; p.up = 1; render();
      const path = 'pending/' + regId + '/' + p.key + '-' + Math.random().toString(36).slice(2, 10) + '.jpg';
      await upload(blob, path, (v) => { p.up = v; const el = document.querySelector('[data-card="' + p.key + '"] .absolute'); if (el) el.textContent = 'Uploading ' + v + '%'; });
      p.photo_path = path; p.up = 100;
    } catch (e) { p.upErr = e.message; p.up = 0; p.photo_path = ''; }
    render();
  }

  function validate() {
    let ok = true; const jer = {}, nm = {};
    players.forEach((p) => {
      p.errs = {}; const e = p.errs;
      if (p.full_name.trim().length < 2) e.full_name = 'Enter the full name.';
      if (!/^\d{1,2}$/.test(p.jersey_no)) e.jersey_no = 'Enter 0 to 99.';
      if (!p.position) e.position = 'Choose a position.';
      if (p.height_cm !== '' && !(/^\d{3}$/.test(p.height_cm) && +p.height_cm >= 120 && +p.height_cm <= 250)) e.height_cm = '120 to 250 cm.';
      if (p.date_of_birth && !(p.date_of_birth > '1950-01-01' && new Date(p.date_of_birth) < new Date())) e.date_of_birth = 'Check the date.';
      if (p.up > 0 && p.up < 100) e.photo_path = 'Photo is still uploading.'; else if (!p.photo_path) e.photo_path = 'Upload a photo.';
      if (/^\d{1,2}$/.test(p.jersey_no)) { const j = +p.jersey_no; (jer[j] = jer[j] || []).push(p); }
      const n = p.full_name.trim().toLowerCase(); if (n) (nm[n] = nm[n] || []).push(p);
    });
    Object.values(jer).forEach((a) => a.length > 1 && a.forEach((p) => (p.errs.jersey_no = 'Jersey number already used.')));
    Object.values(nm).forEach((a) => a.length > 1 && a.forEach((p) => (p.errs.full_name = 'This player is listed twice.')));
    players.forEach((p) => { if (Object.keys(p.errs).length) { ok = false; p.open = true; } });
    return ok;
  }

  window.handleTeamRegistration = async function (e) {
    e.preventDefault();
    const err = $('reg-error'), ok = $('reg-success-box'), btn = $('reg-submit'), rerr = $('reg-roster-err');
    err.classList.add('hidden'); ok.classList.add('hidden'); rerr.classList.add('hidden');
    const v = (id) => $(id).value.trim();
    const probs = [];
    if (v('reg-team-name').length < 2) probs.push('the team name'); if (v('reg-captain').length < 2) probs.push('the captain name');
    if (v('reg-phone').replace(/\D/g, '').length < 9) probs.push('a valid captain phone'); if (v('reg-mpesa').length < 6) probs.push('the M-Pesa transaction ID');
    if (players.length < MIN) { rerr.textContent = 'Add at least ' + MIN + ' players. You have ' + players.length + '.'; rerr.classList.remove('hidden'); }
    const good = validate(); render();
    if (probs.length || !good || players.length < MIN) {
      err.textContent = 'Please complete ' + (probs.length ? probs.join(', ') : 'the highlighted player details') + '.'; err.classList.remove('hidden');
      const bad = document.querySelector('#reg-players .border-red-500\\/60'); (bad || err).scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
    }
    if (!window.RBT || !RBT.sb) { err.textContent = 'Registration is unavailable right now. Try again later.'; err.classList.remove('hidden'); return; }
    btn.disabled = true; btn.textContent = 'Submitting...';
    const { error } = await RBT.sb.rpc('submit_team_registration', {
      p_team_name: v('reg-team-name'), p_captain: v('reg-captain'), p_phone: v('reg-phone'), p_mpesa: v('reg-mpesa'),
      p_players: players.map((p) => ({ full_name: p.full_name.trim(), jersey_no: p.jersey_no, position: p.position, photo_path: p.photo_path, height_cm: p.height_cm, date_of_birth: p.date_of_birth, bio: p.bio.trim() }))
    });
    btn.disabled = false; btn.textContent = 'Submit Team Application';
    if (error) { err.textContent = RBT.friendly(error); err.classList.remove('hidden'); return; }   // nothing is cleared on failure
    ok.classList.remove('hidden'); e.target.reset(); players = []; for (let i = 0; i < MIN; i++) add(true); ok.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  document.addEventListener('DOMContentLoaded', () => {
    const box = $('reg-players'); if (!box) return;
    $('reg-add').addEventListener('click', () => add());
    box.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tog]'); if (t) { const p = find(t.dataset.tog); p.open = !p.open; return render(); }
      const r = e.target.closest('[data-rm]'); if (r) { if (confirm('Remove this player?')) { players = players.filter((p) => p.key !== +r.dataset.rm); render(); } }
    });
    box.addEventListener('input', (e) => {
      const f = e.target.dataset.f; if (!f) return; const p = find(e.target.closest('[data-card]').dataset.card);
      p[f] = e.target.value; delete p.errs[f];
      const h = box.querySelector('[data-tog="' + p.key + '"]'); if (h && (f === 'full_name' || f === 'jersey_no' || f === 'position')) { h.querySelector('.truncate').textContent = p.full_name || 'Player'; }
      if (f === 'position') render();
    });
    box.addEventListener('change', (e) => { const k = e.target.dataset.file; if (k && e.target.files[0]) pick(find(k), e.target.files[0]); });
    for (let i = 0; i < MIN; i++) add(true); players.forEach((p, i) => (p.open = i === 0)); render();
  });
})();
