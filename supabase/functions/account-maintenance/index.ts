// Edge Function account-maintenance (ADR 019): stündlich von pg_cron per pg_net. verify_jwt = false, nur POST, eigenes
// Geheimnis im Header x-account-maintenance-secret, verglichen in der RPC gegen den Vault. Logs nur Zähler.
import { createClient } from "@supabase/supabase-js";
import { type Deps, handle } from "./handler.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const deps: Deps = {
  candidates: async (secret) => await admin.rpc("maintenance_storage_objects", { p_secret: secret, p_limit: 1000 }),
  remove: async (bucket, names) => await admin.storage.from(bucket).remove(names),
  now: () => Date.now(),
};

Deno.serve(async (request) => {
  const result = await handle(request.method, request.headers.get("x-account-maintenance-secret") ?? "", deps);
  console.log(JSON.stringify({ fn: "account-maintenance", status: result.status, ...result.body }));
  return Response.json(result.body, { status: result.status });
});
