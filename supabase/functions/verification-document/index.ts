// Edge Function verification-document (ADR 020, QA M9b F6): Aufruf nur aus dem Web-Server mit dem Access Token des
// Admins (verify_jwt = true). Der Download läuft mit service_role, weil Admins keine Storage-Policy mehr haben.
import { createClient } from "@supabase/supabase-js";
import { handle, type Deps } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

const deps: Deps = {
  open: async (token, id) => {
    const user = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await user.rpc("admin_open_verification_document", { p_id: id });
    return { data: typeof data === "string" ? data : null, error };
  },
  download: async (path) => {
    const { data } = await admin.storage.from("verification-docs").download(path);
    return data ? new Uint8Array(await data.arrayBuffer()) : null;
  },
};

Deno.serve(async (request) => {
  const started = performance.now();
  const { response, result } = await handle(request, deps);
  console.log(JSON.stringify({ fn: "verification-document", result, ms: Math.round(performance.now() - started) }));
  return response;
});
