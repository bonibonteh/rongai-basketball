// Official Portal core: helpers, sign-in / request / recovery pages, session handling,
// workspace shell, dashboard and profile. Feature modules live in portal-modules.js.
(function () {
  'use strict';
  const RB = window.RBT;
  const sb = RB.sb;
  const P = (RB.P = { modules: {}, nav: [] });

  // ---------- helpers ----------
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const icons = () => { try { if (window.lucide) window.lucide.createIcons(); } catch (e) {} };
  const root = () => $('#root');
  const fmtTime = (t) => (t ? new Date(t).toLocaleString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const fmtClock = (s) => { s = Math.max(0, Math.floor(s || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const periodLabel = (p) => (p <= 4 ? 'Q' + p : 'OT' + (p - 4));
  const toLocalInput = (t) => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  Object.assign(P, { $, $$, esc, sleep, icons, fmtTime, fmtClock, periodLabel, toLocalInput, initials });

  const ROLE_LABELS = {
    director: 'Tournament Director', fixture_manager: 'Competition / Fixture Manager', scorekeeper: 'Courtside Scorekeeper',
    referee: 'Referee / Match Official', registration_officer: 'Team Registration Officer', stats_officer: 'Statistics and Results Officer',
    media_officer: 'Media / Communications Officer', read_only: 'Read-Only Official'
  };
  P.ROLE_LABELS = ROLE_LABELS;

  const S = (P.S = { session: null, profile: null, role: null, perms: [], prefs: null, module: 'dashboard', conn: 'SYNCING', lastSync: null, avatarUrl: null, loading: false, badges: {} });
  const can = (p) => S.perms.includes('*') || S.perms.includes(p);
  P.can = can;

  async function q(promise) { const r = await promise; if (r.error) throw r.error; return r.data; }
  P.q = q;

  function toast(msg, kind) {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg;
    t.className = 'fixed left-1/2 -translate-x-1/2 z-[100] text-xs font-semibold px-4 py-2.5 rounded-lg shadow-2xl max-w-[90vw] text-center border ' +
      (kind === 'error' ? 'bg-red-950 border-red-500 text-red-100' : 'bg-rbtCard border-rbtOrange text-white');
    t.style.bottom = 'calc(16px + env(safe-area-inset-bottom, 0px))';
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), kind === 'error' ? 6000 : 3200);
  }
  P.toast = toast;
  P.fail = (e) => toast(RB.friendly(e), 'error');

  // ---------- dialogs (confirm() and prompt() are unavailable in some viewers; these always work) ----------
  function dialog({ title, intro, fields = [], submit = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/70 p-4';
      wrap.innerHTML = `<form class="bg-rbtCard border border-rbtBorder rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h3 class="font-heading font-bold text-lg text-white">${esc(title)}</h3>
        ${intro ? `<p class="text-sm text-gray-300">${esc(intro)}</p>` : ''}
        ${fields.map((f, i) => `<label class="block text-xs font-bold uppercase text-gray-300">${esc(f.label)}
          ${f.type === 'textarea' ? `<textarea name="${f.name}" rows="3" ${f.required ? 'required' : ''} minlength="${f.min || 0}" class="mt-1 w-full bg-black/50 border border-rbtBorder rounded-lg p-2.5 text-sm text-white normal-case font-normal">${esc(f.value || '')}</textarea>`
          : f.type === 'select' ? `<select name="${f.name}" class="mt-1 w-full bg-black/50 border border-rbtBorder rounded-lg p-2.5 text-sm text-white normal-case font-normal">${f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
          : `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" ${f.required ? 'required' : ''} class="mt-1 w-full bg-black/50 border border-rbtBorder rounded-lg p-2.5 text-sm text-white normal-case font-normal">`}
          ${f.hint ? `<span class="block mt-1 text-[11px] font-normal normal-case text-gray-500">${esc(f.hint)}</span>` : ''}</label>`).join('')}
        <p class="dlg-err hidden text-xs text-red-300" role="alert"></p>
        <div class="flex gap-2 justify-end pt-1">
          <button type="button" class="dlg-cancel px-4 py-2 rounded-lg border border-rbtBorder text-gray-300 text-xs font-heading font-bold uppercase">Cancel</button>
          <button type="submit" class="px-4 py-2 rounded-lg text-xs font-heading font-bold uppercase ${danger ? 'bg-red-600 text-white' : 'bg-rbtOrange text-black'}">${esc(submit)}</button>
        </div></form>`;
      document.body.appendChild(wrap);
      const form = $('form', wrap); const first = $('input,textarea,select', form); if (first) first.focus(); else $('button[type=submit]', form).focus();
      const done = (v) => { wrap.remove(); resolve(v); };
      $('.dlg-cancel', wrap).onclick = () => done(null);
      wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
      form.onsubmit = (e) => {
        e.preventDefault();
        const out = {};
        for (const f of fields) {
          const v = form.elements[f.name].value.trim();
          if (f.min && v.length < f.min) { const er = $('.dlg-err', form); er.textContent = f.label + ' needs at least ' + f.min + ' characters.'; er.classList.remove('hidden'); return; }
          out[f.name] = v;
        }
        done(out);
      };
    });
  }
  P.dialog = dialog;
  P.askReason = async (title, intro, min = 5, submit = 'Confirm', danger = false) => {
    const r = await dialog({ title, intro, submit, danger, fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true, min }] });
    return r ? r.reason : null;
  };

  // ---------- shared UI pieces ----------
  const STATUS_STYLE = {
    live: 'bg-red-600 text-white', final: 'bg-emerald-500/15 text-emerald-300', scheduled: 'bg-rbtGold/15 text-rbtGold', ready: 'bg-sky-500/15 text-sky-300',
    postponed: 'bg-amber-500/15 text-amber-300', cancelled: 'bg-gray-500/20 text-gray-300', under_review: 'bg-purple-500/20 text-purple-300',
    pending: 'bg-rbtGold/15 text-rbtGold', approved: 'bg-emerald-500/15 text-emerald-300', rejected: 'bg-red-500/15 text-red-300', more_info: 'bg-sky-500/15 text-sky-300',
    active: 'bg-emerald-500/15 text-emerald-300', suspended: 'bg-amber-500/15 text-amber-300', revoked: 'bg-red-500/15 text-red-300',
    open: 'bg-rbtGold/15 text-rbtGold', in_progress: 'bg-sky-500/15 text-sky-300', done: 'bg-emerald-500/15 text-emerald-300', blocked: 'bg-red-500/15 text-red-300',
    draft: 'bg-gray-500/20 text-gray-300', pending_approval: 'bg-rbtGold/15 text-rbtGold', published: 'bg-emerald-500/15 text-emerald-300', archived: 'bg-gray-500/20 text-gray-300'
  };
  P.chip = (s) => `<span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[s] || 'bg-gray-500/20 text-gray-300'}">${esc(String(s).replace('_', ' '))}</span>`;
  P.card = (title, body, extra = '') => `<section class="bg-rbtCard border border-rbtBorder rounded-xl p-4 md:p-5 min-w-0 ${extra}">${title ? `<h3 class="font-heading font-bold text-sm uppercase tracking-wider text-rbtOrange mb-3">${title}</h3>` : ''}${body}</section>`;
  P.empty = (msg) => `<p class="text-sm text-gray-400 py-4">${esc(msg)}</p>`;
  P.btn = (label, attrs = '', kind = 'ghost') => {
    const k = { ghost: 'border border-rbtBorder text-gray-200 hover:border-rbtOrange', primary: 'bg-rbtOrange text-black hover:bg-orange-600', danger: 'bg-red-600/90 text-white hover:bg-red-500', good: 'bg-emerald-600 text-white hover:bg-emerald-500' }[kind];
    return `<button type="button" ${attrs} class="px-3 py-1.5 rounded-lg text-[11px] font-heading font-bold uppercase transition disabled:opacity-40 disabled:cursor-not-allowed ${k}">${label}</button>`;
  };
  P.input = 'w-full bg-black/50 border border-rbtBorder rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500';
  P.label = 'block text-xs font-bold uppercase text-gray-300 mb-1';

  // ---------- auth pages ----------
  const eye = (id) => `<button type="button" data-eye="${id}" aria-label="Show password" aria-pressed="false" class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-white rounded"><i data-lucide="eye" class="w-4 h-4"></i></button>`;
  function wireEyes(scope) {
    $$('[data-eye]', scope).forEach((b) => b.addEventListener('click', () => {
      const i = $('#' + b.dataset.eye); const show = i.type === 'password';
      i.type = show ? 'text' : 'password'; // the typed value is untouched
      b.setAttribute('aria-pressed', String(show)); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      b.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}" class="w-4 h-4"></i>`; icons();
    }));
  }
  function authShell(subtitle, inner, wide) {
    root().innerHTML = `<main class="min-h-full flex items-center justify-center gut py-8 overflow-y-auto h-full">
      <div class="w-full ${wide ? 'max-w-lg' : 'max-w-md'} space-y-5">
        <div class="text-center space-y-3">
          <img src="assets/rongai-basketball-logo.svg" alt="Rongai Basketball League crest" width="72" height="72" class="mx-auto h-[72px] w-[72px]">
          <h1 class="font-heading font-extrabold text-3xl uppercase text-white">Official Portal</h1>
          <p class="text-sm text-gray-400">${subtitle}</p>
        </div>
        <div class="bg-rbtCard border border-rbtBorder rounded-2xl p-6 space-y-4 shadow-2xl">${inner}</div>
        <p class="text-center"><a href="index.html" class="text-xs text-gray-400 hover:text-rbtOrange">&larr; Back to the tournament website</a></p>
      </div></main>`;
    wireEyes(root()); icons();
  }
  const errBox = (id) => `<p id="${id}" class="hidden text-xs text-red-200 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5" role="alert"></p>`;
  const okBox = (id) => `<p id="${id}" class="hidden text-xs text-emerald-200 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2.5" role="status"></p>`;
  const showMsg = (id, msg) => { const e = $('#' + id); if (!e) return; e.textContent = msg; e.classList.toggle('hidden', !msg); };
  function busy(btn, on, label) { btn.disabled = on; btn.dataset.l = btn.dataset.l || btn.textContent; btn.textContent = on ? label : btn.dataset.l; }
  const fieldCls = P.input;
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function viewSignIn(msg) {
    authShell('Sign in to access your tournament workspace.', `
      <form id="f-signin" class="space-y-4" novalidate>
        ${msg ? `<p class="text-xs text-gray-200 bg-white/5 border border-rbtBorder rounded-lg p-2.5" role="status">${esc(msg)}</p>` : ''}
        ${errBox('e-signin')}
        <div><label class="${P.label}" for="si-email">Email address</label><input id="si-email" type="email" autocomplete="username" required class="${fieldCls}" placeholder="you@example.com"></div>
        <div><label class="${P.label}" for="si-pw">Password</label><div class="relative"><input id="si-pw" type="password" autocomplete="current-password" required class="${fieldCls} pr-11">${eye('si-pw')}</div></div>
        <label class="flex items-center gap-2 text-xs text-gray-300"><input id="si-remember" type="checkbox" ${RB.getRemember() ? 'checked' : ''} class="accent-orange-500"> Keep me signed in on this device</label>
        <button id="b-signin" type="submit" class="w-full bg-rbtOrange hover:bg-orange-600 text-black font-heading font-bold uppercase text-sm py-3 rounded-lg transition disabled:opacity-60">Sign In</button>
        <div class="flex justify-between text-xs"><a href="#forgot" class="text-gray-300 hover:text-rbtOrange">Forgot password?</a><a href="#request" class="text-gray-300 hover:text-rbtOrange">Request an account</a></div>
      </form>`);
    $('#f-signin').onsubmit = async (e) => {
      e.preventDefault();
      const email = $('#si-email').value.trim(), password = $('#si-pw').value, btn = $('#b-signin');
      if (!EMAIL_RE.test(email)) return showMsg('e-signin', 'Enter a valid email address.');
      if (!password) return showMsg('e-signin', 'Enter your password.');
      showMsg('e-signin', ''); busy(btn, true, 'Signing in…');
      RB.setRemember($('#si-remember').checked);
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { busy(btn, false); return showMsg('e-signin', RB.friendly(error)); }
      await loadWorkspace();
    };
  }

  const REQUEST_ROLES = ['fixture_manager', 'scorekeeper', 'referee', 'registration_officer', 'stats_officer', 'media_officer', 'read_only'];
  function viewRequest() {
    authShell('Request access. The Tournament Director reviews every request.', `
      <form id="f-req" class="space-y-3" novalidate>
        ${errBox('e-req')}
        <div><label class="${P.label}" for="rq-name">Full name</label><input id="rq-name" required maxlength="120" autocomplete="name" class="${fieldCls}"></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="${P.label}" for="rq-email">Email</label><input id="rq-email" type="email" required autocomplete="email" class="${fieldCls}"></div>
          <div><label class="${P.label}" for="rq-phone">Phone number</label><input id="rq-phone" type="tel" maxlength="30" autocomplete="tel" class="${fieldCls}" placeholder="0712 345 678"></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="${P.label}" for="rq-dept">Department</label><input id="rq-dept" maxlength="60" class="${fieldCls}" placeholder="e.g. Courtside table"></div>
          <div><label class="${P.label}" for="rq-role">Official role</label><select id="rq-role" class="${fieldCls}">${REQUEST_ROLES.map((r) => `<option value="${r}">${esc(ROLE_LABELS[r])}</option>`).join('')}</select></div>
        </div>
        <div><label class="${P.label}" for="rq-reason">Why do you need access?</label><textarea id="rq-reason" rows="3" required minlength="10" maxlength="900" class="${fieldCls}" placeholder="Describe your responsibilities at the tournament."></textarea></div>
        <p class="text-[11px] text-gray-500">There is no password here. If you are approved, you receive an email with a secure link to set your own password.</p>
        <button id="b-req" type="submit" class="w-full bg-rbtOrange hover:bg-orange-600 text-black font-heading font-bold uppercase text-sm py-3 rounded-lg transition disabled:opacity-60">Submit Request</button>
        <p class="text-center text-xs"><a href="#signin" class="text-gray-300 hover:text-rbtOrange">I already have an account</a></p>
      </form>`, true);
    $('#f-req').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('#rq-name').value.trim(), email = $('#rq-email').value.trim(), phone = $('#rq-phone').value.trim(), dept = $('#rq-dept').value.trim(), role = $('#rq-role').value, reason = $('#rq-reason').value.trim(), btn = $('#b-req');
      if (name.length < 2) return showMsg('e-req', 'Enter your full name.');
      if (!EMAIL_RE.test(email)) return showMsg('e-req', 'Enter a valid email address.');
      if (reason.length < 10) return showMsg('e-req', 'Tell us a little more about why you need access (10 characters or more).');
      showMsg('e-req', ''); busy(btn, true, 'Submitting…');
      const full = (dept ? '[Department: ' + dept + '] ' : '') + reason;
      const { error } = await sb.rpc('submit_account_request', { p_full_name: name, p_email: email, p_phone: phone || null, p_requested_role: role, p_reason: full });
      if (error) { busy(btn, false); return showMsg('e-req', RB.friendly(error)); }
      authShell('Request received.', `<div class="space-y-4 text-center"><i data-lucide="check-circle-2" class="w-10 h-10 text-emerald-400 mx-auto"></i>
        <p class="text-sm text-gray-200">Your account request has been submitted. You will receive further instructions after the Tournament Director reviews your request.</p>
        <a href="#signin" class="inline-block bg-rbtOrange text-black font-heading font-bold uppercase text-xs px-5 py-2.5 rounded-lg">Back to sign in</a></div>`);
    };
  }

  function viewForgot() {
    authShell('Enter your email and we will send a reset link.', `
      <form id="f-forgot" class="space-y-4" novalidate>${errBox('e-fg')}${okBox('o-fg')}
        <div><label class="${P.label}" for="fg-email">Registered email</label><input id="fg-email" type="email" required autocomplete="email" class="${fieldCls}"></div>
        <button id="b-fg" type="submit" class="w-full bg-rbtOrange hover:bg-orange-600 text-black font-heading font-bold uppercase text-sm py-3 rounded-lg transition disabled:opacity-60">Send Reset Link</button>
        <p class="text-center text-xs"><a href="#signin" class="text-gray-300 hover:text-rbtOrange">Back to sign in</a></p>
      </form>`);
    $('#f-forgot').onsubmit = async (e) => {
      e.preventDefault();
      const email = $('#fg-email').value.trim(), btn = $('#b-fg');
      if (!EMAIL_RE.test(email)) return showMsg('e-fg', 'Enter a valid email address.');
      showMsg('e-fg', ''); busy(btn, true, 'Sending…');
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      busy(btn, false);
      if (error && !/not found/i.test(error.message)) return showMsg('e-fg', RB.friendly(error));
      showMsg('o-fg', 'If that email belongs to an official account, a reset link is on its way. The link expires, so use it soon.');
    };
  }

  function viewSetPassword(kind) {
    authShell(kind === 'invite' ? 'Welcome. Choose a password to activate your account.' : 'Choose a new password.', `
      <form id="f-pw" class="space-y-4" novalidate>${errBox('e-pw')}
        <div><label class="${P.label}" for="pw-new">New password</label><div class="relative"><input id="pw-new" type="password" autocomplete="new-password" required minlength="10" class="${fieldCls} pr-11">${eye('pw-new')}</div><p class="text-[11px] text-gray-500 mt-1">At least 10 characters.</p></div>
        <div><label class="${P.label}" for="pw-conf">Confirm password</label><div class="relative"><input id="pw-conf" type="password" autocomplete="new-password" required class="${fieldCls} pr-11">${eye('pw-conf')}</div></div>
        <button id="b-pw" type="submit" class="w-full bg-rbtOrange hover:bg-orange-600 text-black font-heading font-bold uppercase text-sm py-3 rounded-lg transition disabled:opacity-60">Save Password</button>
      </form>`);
    $('#f-pw').onsubmit = async (e) => {
      e.preventDefault();
      const a = $('#pw-new').value, b = $('#pw-conf').value, btn = $('#b-pw');
      if (a.length < 10) return showMsg('e-pw', 'Use at least 10 characters.');
      if (a !== b) return showMsg('e-pw', 'The two passwords do not match.');
      showMsg('e-pw', ''); busy(btn, true, 'Saving…');
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) { busy(btn, false); return showMsg('e-pw', RB.friendly(error)); }
      toast('Password saved.');
      await loadWorkspace('Password saved. You are signed in.');
    };
  }

  function viewMessage(title, text, withSignOut) {
    authShell(title, `<div class="space-y-4 text-center"><p class="text-sm text-gray-200">${esc(text)}</p>
      ${withSignOut ? '<button id="b-so" class="bg-rbtOrange text-black font-heading font-bold uppercase text-xs px-5 py-2.5 rounded-lg">Sign out</button>' : '<a href="#signin" class="inline-block bg-rbtOrange text-black font-heading font-bold uppercase text-xs px-5 py-2.5 rounded-lg">Back to sign in</a>'}</div>`);
    const b = $('#b-so'); if (b) b.onclick = signOut;
  }

  function showSplash(text) {
    root().innerHTML = `<div class="h-full flex items-center justify-center"><div class="text-center space-y-3"><img src="assets/rongai-basketball-logo.svg" alt="" width="56" height="56" class="mx-auto animate-pulse"><p class="text-xs uppercase tracking-widest text-gray-400">${esc(text || 'Restoring your session…')}</p></div></div>`;
  }

  // ---------- session and workspace ----------
  async function signOut() {
    try { await sb.auth.signOut(); } catch (e) { /* local session is cleared below regardless */ }
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {}
    resetState();
    viewSignIn('You have been signed out.');
  }
  P.signOut = signOut;

  function resetState() {
    stopRealtime(); clearInterval(P.recheckTimer);
    Object.assign(S, { session: null, profile: null, role: null, perms: [], prefs: null, avatarUrl: null, badges: {}, loading: false });
  }

  async function loadWorkspace(note) {
    if (S.loading) return; S.loading = true; P.setpw = false;
    showSplash('Opening your workspace…');
    try {
      // getUser asks the server, so a deleted, banned or signed-out-elsewhere user is caught here.
      const { data: ud, error: ue } = await sb.auth.getUser();
      if (ue || !ud || !ud.user) { await sb.auth.signOut({ scope: 'local' }).catch(() => {}); resetState(); return viewSignIn('Your session has expired. Sign in again.'); }
      const profile = (await sb.from('profiles').select('*').eq('id', ud.user.id).maybeSingle()).data;
      if (!profile) { S.loading = false; return viewMessage('No official access', 'This account has not been approved for the Official Portal. If you applied, the Tournament Director has not approved your request yet.', true); }
      if (profile.status !== 'active') { S.loading = false; return viewMessage('Access ' + profile.status, 'Your official access is ' + profile.status + '. Contact the Tournament Director.', true); }
      const role = await q(sb.from('official_roles').select('*').eq('key', profile.role).single());
      const prefs = (await sb.from('user_dashboard_preferences').select('*').eq('user_id', profile.id).maybeSingle()).data;
      Object.assign(S, { session: ud.user, profile, role, perms: role.permissions || [], prefs: prefs || { layout: {}, notifications: {}, welcome_dismissed: false, welcome_message: null } });
      await loadAvatar();
      renderShell(note);
      startRealtime(); startRecheck(); refreshBadges();
      go(moduleFromHash() || 'dashboard');
    } catch (e) {
      viewMessage('Could not open the workspace', RB.friendly(e), true);
    } finally { S.loading = false; }
  }
  P.reload = () => loadWorkspace();

  async function loadAvatar() {
    S.avatarUrl = null;
    if (!S.profile.avatar_path) return;
    const { data } = await sb.storage.from('avatars').createSignedUrl(S.profile.avatar_path, 3600);
    S.avatarUrl = data ? data.signedUrl : null;
  }
  P.loadAvatar = loadAvatar;

  // Access can be revoked while a browser still holds a valid token. Re-check on a timer, on focus and on reconnect.
  async function recheck() {
    if (!S.profile) return;
    const { data: ud, error } = await sb.auth.getUser();
    if (error && !RB.isNetworkError(error)) { resetState(); return viewSignIn('Your session has ended. Sign in again.'); }
    if (!ud || !ud.user) return;
    const { data: p } = await sb.from('profiles').select('status, role').eq('id', S.profile.id).maybeSingle();
    if (p && (p.status !== 'active')) { await sb.auth.signOut({ scope: 'local' }).catch(() => {}); resetState(); viewSignIn('Your access has been ' + p.status + '. Contact the Tournament Director.'); }
    else if (p && p.role !== S.profile.role) { loadWorkspace('Your role was updated.'); }
  }
  function startRecheck() {
    clearInterval(P.recheckTimer); P.recheckTimer = setInterval(recheck, 4 * 60 * 1000);
    if (!P.listenersOn) {
      P.listenersOn = true;
      document.addEventListener('visibilitychange', () => { if (!document.hidden) recheck(); });
      window.addEventListener('online', () => { recheck(); setConn('SYNCING'); });
      window.addEventListener('offline', () => setConn('OFFLINE'));
    }
  }

  // ---------- realtime ----------
  function setConn(state) {
    const was = S.conn; S.conn = state; if (state === 'LIVE') S.lastSync = new Date();
    const el = $('#conn'); if (el) {
      const col = { LIVE: 'bg-emerald-500', SYNCING: 'bg-amber-400', RECONNECTING: 'bg-amber-400', OFFLINE: 'bg-red-500' }[state];
      el.innerHTML = `<span class="w-2 h-2 rounded-full ${col} ${state === 'LIVE' ? 'animate-pulse' : ''}"></span><span>${state}${state === 'LIVE' && S.lastSync ? '' : ''}</span>`;
      el.title = S.lastSync ? 'Last synced ' + S.lastSync.toLocaleTimeString() : 'Not synced yet';
    }
    if (state === 'LIVE' && was !== 'LIVE' && S.profile) { refreshBadges(); refreshModule(); }
  }
  function startRealtime() {
    stopRealtime();
    const ch = sb.channel('rbt-portal-' + S.profile.id);
    ['matches', 'announcements', 'tasks', 'account_requests'].forEach((t) => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, (p) => onChange(t, p)));
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') setConn('LIVE');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConn('RECONNECTING');
      else if (status === 'CLOSED') setConn(navigator.onLine ? 'RECONNECTING' : 'OFFLINE');
    });
    P.channel = ch;
  }
  function stopRealtime() { try { if (P.channel) sb.removeChannel(P.channel); } catch (e) {} P.channel = null; }
  function onChange(table, payload) {
    S.lastSync = new Date();
    refreshBadges();
    const m = P.modules[S.module];
    if (m && m.watch && m.watch.includes(table)) { clearTimeout(P.rt); P.rt = setTimeout(() => (m.onChange ? m.onChange(table, payload) : refreshModule()), 300); }
  }
  P.setConn = setConn;

  async function refreshBadges() {
    const b = {};
    try {
      if (can('access.manage')) b.officials = (await sb.from('account_requests').select('id', { count: 'exact', head: true }).in('status', ['pending', 'more_info'])).count || 0;
      if (can('teams.review')) b.teams = (await sb.from('teams').select('id', { count: 'exact', head: true }).eq('registration_status', 'pending')).count || 0;
      if (can('content.publish')) b.announcements = (await sb.from('announcements').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval')).count || 0;
      b.tasks = (await sb.from('tasks').select('id', { count: 'exact', head: true }).eq('assigned_to', S.profile.id).neq('status', 'done')).count || 0;
      if (can('matches.correct')) b.controls = (await sb.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'under_review')).count || 0;
    } catch (e) { /* badges are a convenience */ }
    S.badges = b;
    $$('[data-badge]').forEach((el) => { const n = b[el.dataset.badge] || 0; el.textContent = n; el.classList.toggle('hidden', !n); });
  }
  P.refreshBadges = refreshBadges;

  // ---------- shell and navigation ----------
  function navItems() {
    return [
      { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', show: true },
      { id: 'courtside', label: 'Courtside', icon: 'activity', show: can('matches.score') },
      { id: 'fixtures', label: 'Fixtures', icon: 'calendar-days', show: can('matches.manage') || can('matches.view_all') },
      { id: 'standings', label: 'Standings & Results', icon: 'trophy', show: can('matches.correct') || can('matches.manage') || can('audit.read') || can('standings.manage') || can('results.record') },
      { id: 'teams', label: 'Teams', icon: 'users', show: can('teams.review'), badge: 'teams' },
      { id: 'reports', label: 'Reports', icon: 'clipboard-list', show: can('reports.submit') || can('reports.review') },
      { id: 'announcements', label: 'Announcements', icon: 'megaphone', show: can('content.manage') || can('content.publish'), badge: 'announcements' },
      { id: 'tasks', label: 'Tasks', icon: 'list-checks', show: true, badge: 'tasks' },
      { id: 'officials', label: 'Official Access', icon: 'shield-check', show: can('access.manage'), badge: 'officials' },
      { id: 'controls', label: 'Tournament Controls', icon: 'sliders-horizontal', show: can('audit.read') || can('matches.correct'), badge: 'controls' },
      { id: 'profile', label: 'Profile', icon: 'user-round', show: true }
    ].filter((n) => n.show);
  }
  function avatarHtml(size) {
    const px = size || 36;
    return S.avatarUrl
      ? `<img src="${esc(S.avatarUrl)}" alt="" class="rounded-full object-cover border border-rbtBorder" style="width:${px}px;height:${px}px">`
      : `<span class="rounded-full bg-rbtOrange/20 border border-rbtOrange/50 text-rbtOrange font-heading font-bold flex items-center justify-center" style="width:${px}px;height:${px}px;font-size:${px / 2.6}px">${esc(initials(S.profile.display_name || S.profile.full_name))}</span>`;
  }
  P.avatarHtml = avatarHtml;
  const prefName = () => S.profile.display_name || String(S.profile.full_name).split(/\s+/)[0];
  P.prefName = prefName;

  function renderShell(note) {
    root().innerHTML = `<div class="h-full flex flex-col">
      <header class="bg-rbtCard border-b border-rbtBorder gut py-2.5 flex items-center justify-between shrink-0 gap-3">
        <a href="index.html" class="flex items-center gap-3 min-w-0"><img src="assets/rongai-basketball-logo.svg" alt="Rongai Basketball League" width="40" height="40" class="h-10 w-10 shrink-0">
          <span class="font-heading font-bold text-sm uppercase tracking-wider text-white truncate hidden sm:block">Official Portal</span></a>
        <div class="flex items-center gap-3">
          <span id="conn" class="hidden sm:flex items-center gap-1.5 text-[11px] font-bold uppercase text-gray-300 bg-black/40 border border-rbtBorder rounded px-2.5 py-1"></span>
          <a href="index.html" class="hidden md:inline text-xs text-gray-400 hover:text-rbtOrange">Public site</a>
          <div class="relative">
            <button id="b-menu" class="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/5" aria-haspopup="true" aria-expanded="false">${avatarHtml(34)}
              <span class="text-left hidden sm:block leading-tight"><span class="block text-xs font-semibold text-white">${esc(prefName())}</span><span class="block text-[10px] text-gray-400">${esc(S.role.label)}</span></span></button>
            <div id="menu" class="hidden absolute right-0 mt-2 w-52 bg-rbtCard border border-rbtBorder rounded-xl shadow-2xl z-40 p-1.5 text-sm">
              <button data-go="profile" class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-gray-200">My profile</button>
              <button id="b-signout" class="w-full text-left px-3 py-2 rounded-lg hover:bg-red-500/10 text-red-300">Sign out</button></div>
          </div>
        </div>
      </header>
      <nav aria-label="Workspace" class="bg-black/60 border-b border-rbtBorder gut py-1.5 flex items-center gap-1 shrink-0 overflow-x-auto text-xs">
        ${navItems().map((n) => `<button data-go="${n.id}" class="nav-btn shrink-0 px-3 py-2 rounded font-heading font-bold uppercase transition flex items-center gap-1.5 text-gray-400 hover:text-white"><i data-lucide="${n.icon}" class="w-3.5 h-3.5"></i>${esc(n.label)}${n.badge ? `<span data-badge="${n.badge}" class="hidden bg-rbtOrange text-black rounded-full px-1.5 text-[10px]">0</span>` : ''}</button>`).join('')}
      </nav>
      <div id="note" class="${note ? '' : 'hidden'} gut py-2 text-xs text-emerald-200 bg-emerald-500/10 border-b border-emerald-500/20">${esc(note || '')}</div>
      <main id="main" class="gut flex-1 overflow-y-auto py-4 md:py-6" tabindex="-1"></main></div>`;
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => { $('#menu').classList.add('hidden'); location.hash = '#' + b.dataset.go; }));
    $('#b-menu').onclick = () => { const m = $('#menu'); m.classList.toggle('hidden'); $('#b-menu').setAttribute('aria-expanded', String(!m.classList.contains('hidden'))); };
    $('#b-signout').onclick = signOut;
    setConn(S.conn); icons();
    if (note) setTimeout(() => { const n = $('#note'); if (n) n.classList.add('hidden'); }, 5000);
  }
  const moduleFromHash = () => { const h = location.hash.replace('#', ''); return navItems().some((n) => n.id === h) ? h : null; };
  async function go(id) {
    if (!S.profile) return;
    if (!navItems().some((n) => n.id === id)) id = 'dashboard';
    S.module = id;
    $$('.nav-btn').forEach((b) => { const on = b.dataset.go === id; b.classList.toggle('bg-rbtOrange', on); b.classList.toggle('text-black', on); b.classList.toggle('text-gray-400', !on); });
    refreshBadges();
    await refreshModule();
  }
  async function refreshModule() {
    const m = P.modules[S.module]; const main = $('#main'); if (!m || !main) return;
    try { await m.render(main); } catch (e) { main.innerHTML = P.card('', `<p class="text-sm text-red-300">${esc(RB.friendly(e))}</p>`); }
    icons();
  }
  P.go = (id) => { location.hash = '#' + id; };
  P.refresh = refreshModule;

  // ---------- dashboard ----------
  const DEFAULT_WIDGETS = ['tasks', 'games', 'reviews', 'activity'];
  const WIDGET_TITLES = { tasks: 'My tasks', games: 'Upcoming games', reviews: 'Pending reviews', activity: 'Recent activity' };
  const MOTIVATION = 'Every great game starts with a prepared table. Thank you for running this one.';
  let customizing = false;

  async function savePrefs(patch) {
    const next = Object.assign({}, S.prefs, patch);
    const row = { user_id: S.profile.id, layout: next.layout || {}, welcome_dismissed: !!next.welcome_dismissed, welcome_message: next.welcome_message || null, notifications: next.notifications || {} };
    const { error } = await sb.from('user_dashboard_preferences').upsert(row, { onConflict: 'user_id' });
    if (error) return P.fail(error);
    S.prefs = Object.assign(next, row); return true;
  }
  P.savePrefs = savePrefs;

  async function dashRender(main) {
    const uid = S.profile.id;
    const SEL = '*, home:teams!matches_home_team_id_fkey(name), away:teams!matches_away_team_id_fkey(name)';
    const run = (p) => p.then((r) => r.data || [], () => []);
    const [tasks, games, activity, assignedCount] = await Promise.all([
      run(sb.from('tasks').select('*').eq('assigned_to', uid).neq('status', 'done').order('due_at', { ascending: true, nullsFirst: false }).limit(8)),
      run(sb.from('matches').select(SEL).is('archived_at', null).in('status', ['scheduled', 'ready', 'live', 'under_review', 'postponed']).order('scheduled_at').limit(8)),
      can('audit.read') ? run(sb.from('audit_logs').select('*').order('at', { ascending: false }).limit(8)) : run(sb.from('match_events').select('*').eq('created_by', uid).order('created_at', { ascending: false }).limit(6)),
      sb.from('official_assignments').select('id', { count: 'exact', head: true }).eq('user_id', uid).then((r) => r.count || 0, () => 0)
    ]);
    await refreshBadges();
    const b = S.badges;
    const layout = S.prefs.layout || {};
    const order = (layout.order || DEFAULT_WIDGETS).filter((w) => DEFAULT_WIDGETS.includes(w)); DEFAULT_WIDGETS.forEach((w) => { if (!order.includes(w)) order.push(w); });
    const hidden = layout.hidden || [];

    const notes = [];
    if (b.officials) notes.push(`${b.officials} account request${b.officials > 1 ? 's' : ''} waiting for your decision`);
    if (b.teams) notes.push(`${b.teams} team registration${b.teams > 1 ? 's' : ''} to review`);
    if (b.announcements) notes.push(`${b.announcements} announcement${b.announcements > 1 ? 's' : ''} waiting to be published`);
    if (b.controls) notes.push(`${b.controls} game${b.controls > 1 ? 's' : ''} under review`);
    tasks.filter((t) => t.due_at && new Date(t.due_at) - Date.now() < 864e5).forEach((t) => notes.push(`Task due soon: ${t.title}`));

    const W = {
      tasks: () => tasks.length ? `<ul class="divide-y divide-rbtBorder/60">${tasks.map((t) => `<li class="py-2.5 flex items-start justify-between gap-3"><div class="min-w-0"><p class="text-sm text-white">${esc(t.title)}</p><p class="text-[11px] text-gray-400">${esc(t.priority)} priority${t.due_at ? ' · due ' + esc(fmtTime(t.due_at)) : ''}</p></div>${P.chip(t.status)}</li>`).join('')}</ul>` : P.empty('Nothing assigned to you right now.'),
      games: () => games.length ? `<ul class="divide-y divide-rbtBorder/60">${games.map((g) => `<li class="py-2.5 flex items-center justify-between gap-3"><div class="min-w-0"><p class="text-sm text-white truncate">${esc(g.home && g.home.name)} vs ${esc(g.away && g.away.name)}</p><p class="text-[11px] text-gray-400">${esc(g.court)} · ${esc(fmtTime(g.scheduled_at))}</p></div>${P.chip(g.status)}</li>`).join('')}</ul>` : P.empty('No upcoming games you can see.'),
      reviews: () => notes.length ? `<ul class="space-y-2">${notes.map((n) => `<li class="text-sm text-gray-200 flex gap-2"><i data-lucide="bell" class="w-4 h-4 text-rbtOrange shrink-0 mt-0.5"></i>${esc(n)}</li>`).join('')}</ul>` : P.empty('Nothing is waiting for you.'),
      activity: () => activity.length ? `<ul class="divide-y divide-rbtBorder/60">${activity.map((a) => a.action
        ? `<li class="py-2 text-xs text-gray-300"><span class="text-white font-semibold">${esc(a.action)}</span> · ${esc(a.actor_role || 'system')} · ${esc(fmtTime(a.at))}</li>`
        : `<li class="py-2 text-xs text-gray-300"><span class="text-white font-semibold">${esc(a.event_type)}</span> ${esc(a.team || '')} ${a.value != null ? esc(a.value) : ''} · ${esc(fmtTime(a.created_at))}</li>`).join('')}</ul>` : P.empty('No recent activity yet.')
    };
    const actions = [
      ['matches.score', 'courtside', 'Open courtside', 'activity'], ['matches.manage', 'fixtures', 'Create a fixture', 'calendar-plus'],
      ['teams.review', 'teams', 'Review teams', 'users'], ['access.manage', 'officials', 'Review account requests', 'shield-check'],
      ['content.manage', 'announcements', 'Write an announcement', 'megaphone'], ['tasks.manage', 'tasks', 'Assign a task', 'list-checks'], ['reports.submit', 'reports', 'Submit a match report', 'clipboard-list']
    ].filter((a) => can(a[0]));

    const showWelcome = !S.prefs.welcome_dismissed;
    main.innerHTML = `<div class="max-w-6xl mx-auto space-y-4">
      ${showWelcome ? `<section class="relative bg-gradient-to-r from-rbtCard via-[#1f2633] to-rbtCard border border-rbtBorder rounded-xl p-4 md:p-5 flex items-center gap-4">
        ${avatarHtml(56)}
        <div class="min-w-0 flex-1"><h2 class="font-heading font-extrabold text-xl md:text-2xl text-white">Welcome back, ${esc(prefName())}.</h2>
          <p class="text-sm text-gray-300">Happy to have you back in your tournament workspace.</p>
          <p class="text-xs text-gray-400 mt-1">${esc(S.role.label)}${S.profile.department ? ' · ' + esc(S.profile.department) : ''} · ${assignedCount} game assignment${assignedCount === 1 ? '' : 's'} · ${S.badges.tasks || 0} open task${(S.badges.tasks || 0) === 1 ? '' : 's'}</p>
          <p class="text-xs text-rbtGold mt-1.5">${esc(S.prefs.welcome_message || MOTIVATION)}</p></div>
        <button id="b-dismiss" class="absolute top-2 right-2 p-1.5 text-gray-500 hover:text-white" aria-label="Dismiss welcome"><i data-lucide="x" class="w-4 h-4"></i></button></section>` : ''}
      ${actions.length ? `<div class="flex flex-wrap gap-2">${actions.map((a) => `<button data-go="${a[1]}" class="flex items-center gap-1.5 bg-rbtOrange/10 border border-rbtOrange/40 text-rbtOrange hover:bg-rbtOrange hover:text-black rounded-lg px-3 py-2 text-xs font-heading font-bold uppercase transition"><i data-lucide="${a[3]}" class="w-3.5 h-3.5"></i>${esc(a[2])}</button>`).join('')}</div>` : ''}
      <div class="flex items-center justify-between"><h2 class="font-heading font-bold text-base uppercase text-white">Your workspace</h2>
        <button id="b-custom" class="text-xs text-gray-300 hover:text-rbtOrange">${customizing ? 'Done' : 'Customize layout'}</button></div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        ${order.filter((w) => customizing || !hidden.includes(w)).map((w, i, arr) => P.card(`<span class="flex items-center justify-between">${esc(WIDGET_TITLES[w])}${customizing ? `<span class="flex gap-1 normal-case">
          <button data-mv="${w}" data-d="-1" ${i === 0 ? 'disabled' : ''} class="px-1.5 text-gray-300 disabled:opacity-30" aria-label="Move up">&uarr;</button>
          <button data-mv="${w}" data-d="1" ${i === arr.length - 1 ? 'disabled' : ''} class="px-1.5 text-gray-300 disabled:opacity-30" aria-label="Move down">&darr;</button>
          <button data-hide="${w}" class="px-1.5 text-gray-300">${hidden.includes(w) ? 'Show' : 'Hide'}</button></span>` : ''}</span>`, hidden.includes(w) ? P.empty('Hidden. Choose Show to bring it back.') : W[w]())).join('')}
      </div></div>`;
    $$('[data-go]', main).forEach((b) => b.addEventListener('click', () => P.go(b.dataset.go)));
    const dm = $('#b-dismiss'); if (dm) dm.onclick = async () => { if (await savePrefs({ welcome_dismissed: true })) dashRender(main); };
    $('#b-custom').onclick = () => { customizing = !customizing; dashRender(main).then(icons); };
    $$('[data-mv]', main).forEach((b) => b.onclick = async () => {
      const w = b.dataset.mv, d = +b.dataset.d, o = order.slice(), i = o.indexOf(w), j = i + d; if (j < 0 || j >= o.length) return;
      [o[i], o[j]] = [o[j], o[i]]; if (await savePrefs({ layout: Object.assign({}, layout, { order: o }) })) dashRender(main).then(icons);
    });
    $$('[data-hide]', main).forEach((b) => b.onclick = async () => {
      const w = b.dataset.hide, h = hidden.includes(w) ? hidden.filter((x) => x !== w) : hidden.concat(w);
      if (await savePrefs({ layout: Object.assign({}, layout, { order, hidden: h }) })) dashRender(main).then(icons);
    });
  }
  P.modules.dashboard = { render: dashRender, watch: ['matches', 'tasks', 'account_requests', 'announcements'] };

  // ---------- profile ----------
  async function profileRender(main) {
    const p = S.profile, pr = S.prefs, n = pr.notifications || {};
    main.innerHTML = `<div class="max-w-3xl mx-auto space-y-4">
      ${P.card('Your profile', `<form id="f-prof" class="space-y-3">
        <div class="flex items-center gap-4"><div id="av">${avatarHtml(72)}</div>
          <div><label class="${P.label}" for="av-file">Profile photo</label><input id="av-file" type="file" accept="image/jpeg,image/png,image/webp" class="text-xs text-gray-300"><p class="text-[11px] text-gray-500 mt-1">JPG, PNG or WebP, up to 2 MB.</p></div></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="${P.label}" for="pf-full">Full name</label><input id="pf-full" required minlength="2" maxlength="120" value="${esc(p.full_name)}" class="${P.input}"></div>
          <div><label class="${P.label}" for="pf-disp">Preferred name</label><input id="pf-disp" maxlength="60" value="${esc(p.display_name || '')}" class="${P.input}"></div>
          <div><label class="${P.label}" for="pf-phone">Phone</label><input id="pf-phone" maxlength="30" value="${esc(p.phone || '')}" class="${P.input}"></div>
          <div><label class="${P.label}">Email</label><input value="${esc(p.email)}" disabled class="${P.input} opacity-60"></div>
          <div><label class="${P.label}">Role</label><input value="${esc(S.role.label)}" disabled class="${P.input} opacity-60"></div>
          <div><label class="${P.label}">Department</label><input value="${esc(p.department || '')}" disabled class="${P.input} opacity-60"></div></div>
        <div><label class="${P.label}" for="pf-bio">Short biography</label><textarea id="pf-bio" rows="3" maxlength="500" class="${P.input}">${esc(p.bio || '')}</textarea></div>
        <p class="text-[11px] text-gray-500">Your role, department and access are set by the Tournament Director and cannot be changed here.</p>
        <button type="submit" class="bg-rbtOrange text-black font-heading font-bold uppercase text-xs px-5 py-2.5 rounded-lg">Save profile</button></form>`)}
      ${P.card('Workspace preferences', `<form id="f-prefs" class="space-y-3">
        <div><label class="${P.label}" for="pp-msg">Welcome message</label><input id="pp-msg" maxlength="160" value="${esc(pr.welcome_message || '')}" placeholder="${esc(MOTIVATION)}" class="${P.input}"></div>
        <label class="flex items-center gap-2 text-sm text-gray-200"><input id="pp-welcome" type="checkbox" ${pr.welcome_dismissed ? '' : 'checked'} class="accent-orange-500"> Show the welcome card on my dashboard</label>
        <label class="flex items-center gap-2 text-sm text-gray-200"><input id="pp-n-tasks" type="checkbox" ${n.tasks === false ? '' : 'checked'} class="accent-orange-500"> Notify me about new tasks and assignments</label>
        <label class="flex items-center gap-2 text-sm text-gray-200"><input id="pp-n-reviews" type="checkbox" ${n.reviews === false ? '' : 'checked'} class="accent-orange-500"> Notify me about pending reviews</label>
        <button type="submit" class="bg-rbtOrange text-black font-heading font-bold uppercase text-xs px-5 py-2.5 rounded-lg">Save preferences</button></form>`)}
      ${P.card('Account security', `<div class="space-y-3"><form id="f-pass" class="space-y-3">
        <div><label class="${P.label}" for="ps-new">New password</label><div class="relative"><input id="ps-new" type="password" minlength="10" autocomplete="new-password" class="${P.input} pr-11">${eye('ps-new')}</div></div>
        <div><label class="${P.label}" for="ps-conf">Confirm new password</label><div class="relative"><input id="ps-conf" type="password" autocomplete="new-password" class="${P.input} pr-11">${eye('ps-conf')}</div></div>
        <button type="submit" class="border border-rbtBorder text-gray-100 hover:border-rbtOrange font-heading font-bold uppercase text-xs px-5 py-2.5 rounded-lg">Change password</button></form>
        <div class="flex flex-wrap gap-2 pt-2 border-t border-rbtBorder"><button id="b-reset" class="text-xs text-gray-300 hover:text-rbtOrange">Email me a reset link instead</button><span class="text-gray-600">·</span><button id="b-so2" class="text-xs text-red-300 hover:text-red-200">Sign out of this device</button></div></div>`)}</div>`;
    wireEyes(main);
    $('#f-prof').onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await sb.from('profiles').update({ full_name: $('#pf-full').value.trim(), display_name: $('#pf-disp').value.trim() || null, phone: $('#pf-phone').value.trim() || null, bio: $('#pf-bio').value.trim() }).eq('id', p.id);
      if (error) return P.fail(error);
      S.profile = (await sb.from('profiles').select('*').eq('id', p.id).single()).data || S.profile; toast('Profile saved.'); renderShell(); go('profile');
    };
    $('#av-file').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast('Choose a JPG, PNG or WebP image.', 'error');
      if (f.size > 2 * 1024 * 1024) return toast('That image is over 2 MB.', 'error');
      const ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${p.id}/avatar-${Date.now()}.${ext}`;
      const up = await sb.storage.from('avatars').upload(path, f, { contentType: f.type, upsert: true });
      if (up.error) return P.fail(up.error);
      const { error } = await sb.from('profiles').update({ avatar_path: path }).eq('id', p.id);
      if (error) return P.fail(error);
      if (p.avatar_path) sb.storage.from('avatars').remove([p.avatar_path]).catch(() => {});
      S.profile.avatar_path = path; await loadAvatar(); toast('Photo updated.'); renderShell(); go('profile');
    };
    $('#f-prefs').onsubmit = async (e) => {
      e.preventDefault();
      const ok = await savePrefs({ welcome_message: $('#pp-msg').value.trim() || null, welcome_dismissed: !$('#pp-welcome').checked, notifications: { tasks: $('#pp-n-tasks').checked, reviews: $('#pp-n-reviews').checked } });
      if (ok) toast('Preferences saved.');
    };
    $('#f-pass').onsubmit = async (e) => {
      e.preventDefault();
      const a = $('#ps-new').value, c = $('#ps-conf').value;
      if (a.length < 10) return toast('Use at least 10 characters.', 'error');
      if (a !== c) return toast('The two passwords do not match.', 'error');
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) return P.fail(error); e.target.reset(); toast('Password changed.');
    };
    $('#b-reset').onclick = async () => { const { error } = await sb.auth.resetPasswordForEmail(p.email, { redirectTo: location.origin + location.pathname }); error ? P.fail(error) : toast('Reset link sent to ' + p.email + '.'); };
    $('#b-so2').onclick = signOut;
  }
  P.modules.profile = { render: profileRender };

  // ---------- boot ----------
  async function boot() {
    if (!RB.configured) return authShell('Setup needed.', '<p class="text-sm text-gray-200">The portal cannot reach its database. Check <code>js/config.js</code> and your internet connection.</p>');
    showSplash();
    const hp = new URLSearchParams(location.hash.replace(/^#/, '').replace(/^\//, ''));
    const linkType = hp.get('type'); const linkError = hp.get('error_description') || hp.get('error');

    sb.auth.onAuthStateChange((event) => {
      // Do not call Supabase from inside this callback; defer to avoid a deadlock.
      setTimeout(() => {
        if (event === 'SIGNED_OUT' && S.profile) { resetState(); viewSignIn('You have been signed out.'); }
        else if (event === 'PASSWORD_RECOVERY') viewSetPassword('recovery');
        else if (event === 'SIGNED_IN' && !S.profile && !S.loading && !P.booting && !P.setpw) loadWorkspace();
      }, 0);
    });
    window.addEventListener('hashchange', () => { if (S.profile) { const m = moduleFromHash(); if (m) go(m); } else routePublic(); });

    P.booting = true;
    // getSession waits for supabase-js to finish restoring storage or reading a link in the URL,
    // so the sign-in page never flashes while a valid session is being restored.
    const { data } = await sb.auth.getSession();
    const session = data && data.session;
    P.booting = false;

    if (linkError) { history.replaceState(null, '', location.pathname); return viewSignIn('That link has expired or is not valid. Request a new one from Forgot password.'); }
    if (session && (linkType === 'recovery' || linkType === 'invite' || linkType === 'signup' || linkType === 'magiclink')) {
      P.setpw = true; history.replaceState(null, '', location.pathname);
      return viewSetPassword(linkType === 'invite' ? 'invite' : 'recovery');
    }
    if (session) return loadWorkspace();
    routePublic();
  }
  function routePublic() {
    const h = location.hash.replace('#', '');
    if (h === 'request') return viewRequest();
    if (h === 'forgot') return viewForgot();
    return viewSignIn();
  }
  P.boot = boot;
})();
