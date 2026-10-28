// Supabase REST calls from the box. The service role key stays in the request header and is not logged.

export function restRequest(env, path, options = {}) {
  const root = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!root || !key || !path) return null;
  const headers = {
    apikey: key,
    authorization: "Bearer " + key,
    accept: "application/json"
  };
  const init = { method: options.method || "GET", headers };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  return { url: root + "/rest/v1/" + path, init };
}
