// One shared Supabase client for the public site and the Official Portal.
// Both pages live on the same origin, so they share one persisted session.
(function () {
  'use strict';
  const cfg = window.RBT_CONFIG || {};
  const RBT = (window.RBT = window.RBT || {});
  RBT.configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);

  // "Keep me signed in" decides which browser storage holds the session that supabase-js manages.
  // Passwords are never stored. Tokens are written and refreshed only by supabase-js itself.
  const REMEMBER_KEY = 'rbt-remember';
  const storage = {
    getItem(k) { try { return window.sessionStorage.getItem(k) ?? window.localStorage.getItem(k); } catch (e) { return null; } },
    setItem(k, v) {
      try {
        const remember = window.localStorage.getItem(REMEMBER_KEY) !== '0';
        (remember ? window.localStorage : window.sessionStorage).setItem(k, v);
        (remember ? window.sessionStorage : window.localStorage).removeItem(k);
      } catch (e) { /* storage blocked: session lasts for this page only */ }
    },
    removeItem(k) { try { window.localStorage.removeItem(k); window.sessionStorage.removeItem(k); } catch (e) {} }
  };
  RBT.setRemember = (on) => { try { window.localStorage.setItem(REMEMBER_KEY, on ? '1' : '0'); } catch (e) {} };
  RBT.getRemember = () => { try { return window.localStorage.getItem(REMEMBER_KEY) !== '0'; } catch (e) { return true; } };

  if (RBT.configured) {
    RBT.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage, storageKey: 'rbt-auth' },
      realtime: { params: { eventsPerSecond: 10 } }
    });
  }

  // Turn database and network errors into plain sentences. Internal details are never shown.
  RBT.friendly = function (err) {
    const m = String((err && (err.message || err.error_description)) || err || '');
    if (/Invalid login credentials/i.test(m)) return 'Email or password is incorrect.';
    if (/Email not confirmed/i.test(m)) return 'Confirm your email first. Check your inbox for the link.';
    if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(m)) return 'Cannot reach the server. Check your connection and try again.';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
    if (/User banned|user is banned/i.test(m)) return 'This account is suspended. Contact the Tournament Director.';
    if (/JWT|permission denied|row-level security|violates|syntax|relation|column|schema cache/i.test(m)) return 'You are not allowed to do that.';
    return m.replace(/^version_conflict:\s*/, '') || 'Something went wrong. Try again.';
  };
  RBT.isNetworkError = (err) => /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(String((err && err.message) || err || ''));
})();
