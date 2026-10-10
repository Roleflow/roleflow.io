/* Roleflow Supabase client config.
   Both values are public and are meant to ship in frontend code.
   SUPABASE_URL is the project URL.
   SUPABASE_ANON_KEY is the publishable key (sb_publishable_...).
   supabase-js accepts it in the same place as the legacy anon JWT.
   Do not put the service role or secret key in this file. */
(function (root) {
  "use strict";
  root.ROLEFLOW_SUPABASE = {
    SUPABASE_URL: "https://xrsipofgofvjiskmsgij.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_cpD_4fx1gwQBvUNQfgVlwg_LuAiCb1Y"
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
