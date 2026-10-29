// Edge Function: official-admin
// Uses the service-role key ONLY for Supabase Auth admin calls (invite, ban). Every permission
// decision is made by the database, using the caller's own token.
// Deploy: supabase functions deploy official-admin   (keep "Verify JWT" ON)
// Secrets provided automatically: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Set SITE_URL yourself.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: me } = await caller.auth.getUser();
  if (!me?.user) return json({ error: "Sign in first." }, 401);
  const { data: allowed } = await caller.rpc("rbt_has_perm", { p: "access.manage" });
  if (allowed !== true) return json({ error: "Only the Director can do this." }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const siteUrl = Deno.env.get("SITE_URL") ?? "";

  if (body.action === "approve") {
    const { request_id, role, department } = body;
    if (!request_id || !role) return json({ error: "request_id and role are required." }, 400);
    const { data: reqRow, error: e1 } = await caller.from("account_requests").select("*").eq("id", request_id).single();
    if (e1 || !reqRow) return json({ error: "Request not found." }, 404);
    if (!["pending", "more_info"].includes(reqRow.status)) return json({ error: `Already ${reqRow.status}.` }, 409);

    // Invite through Supabase Auth. If the person already has an Auth account, reuse it.
    let userId: string | undefined;
    const invite = await admin.auth.admin.inviteUserByEmail(reqRow.email, {
      data: { full_name: reqRow.full_name },
      redirectTo: siteUrl ? `${siteUrl}#set-password` : undefined,
    });
    if (invite.error) {
      const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      userId = list.data?.users.find((u) => u.email?.toLowerCase() === reqRow.email.toLowerCase())?.id;
      if (!userId) return json({ error: "Could not send the invitation." }, 502);
    } else userId = invite.data.user?.id;

    // The database re-checks the Director's rights, the email match and the role rules.
    const { data, error } = await caller.rpc("approve_account_request", {
      p_id: request_id, p_user_id: userId, p_role: role, p_department: department ?? "",
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, profile: data });
  }

  if (body.action === "set_access") {
    const { user_id, role, department, status } = body;
    const { data, error } = await caller.rpc("admin_set_official", {
      p_user: user_id, p_role: role ?? null, p_department: department ?? null, p_status: status ?? null,
    });
    if (error) return json({ error: error.message }, 400);
    // Also block new sign-ins and token refreshes for suspended or revoked accounts.
    if (status) {
      await admin.auth.admin.updateUserById(user_id, { ban_duration: status === "active" ? "none" : "876000h" });
    }
    return json({ ok: true, profile: data });
  }

  return json({ error: "Unknown action." }, 400);
});
