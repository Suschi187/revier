// Edge Function delete-account (ADR 019, Review A1): angestoßen von request_account_deletion per pg_net und von
// pg_cron jede Minute. verify_jwt = false, nur POST, eigenes Geheimnis im Header x-account-deletion-secret, verglichen
// in der Claim-RPC gegen den Vault. Kein Pfad mit Nutzer-JWT. service_role existiert nur hier (CLAUDE.md).
// Logs nur Zähler.
import { createClient } from "@supabase/supabase-js";
import { type Deps, handle } from "./handler.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const RPC = { prepare: "account_deletion_prepare", finalize: "account_deletion_finalize", complete: "account_deletion_complete", fail: "account_deletion_fail" } as const;

const deps: Deps = {
  claim: async (secret, limit) => await admin.rpc("account_deletion_claim", { p_secret: secret, p_limit: limit }),
  objects: async (claimId, userId) => await admin.rpc("account_deletion_objects", { p_claim_id: claimId, p_user_id: userId }),
  step: async (name, claimId, userId) => await admin.rpc(RPC[name], { p_claim_id: claimId, p_user_id: userId }),
  remove: async (bucket, names) => await admin.storage.from(bucket).remove(names),
  deleteUser: async (userId) => {
    const { error } = await admin.auth.admin.deleteUser(userId, false);
    const status = (error as { status?: number } | null)?.status;
    return { error, notFound: status === 404 };
  },
  now: () => Date.now(),
};

Deno.serve(async (request) => {
  const result = await handle(request.method, request.headers.get("x-account-deletion-secret") ?? "", deps);
  console.log(JSON.stringify({ fn: "delete-account", status: result.status, ...result.body }));
  return Response.json(result.body, { status: result.status });
});
