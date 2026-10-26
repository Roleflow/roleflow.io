import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { clientSafeText } from "../supabase/functions/_shared/client-safe.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const ignore = read(".vercelignore").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));

function served(rel) {
  const norm = rel.split(path.sep).join("/");
  let skip = false;
  for (const rule of ignore) {
    const neg = rule.startsWith("!");
    const body = neg ? rule.slice(1) : rule;
    const pattern = body.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
    const re = new RegExp("^" + pattern + (body.endsWith("/") ? "" : "($|/)"));
    const dir = new RegExp("^" + pattern + "(/|$)");
    const hit = body.includes("*") ? re.test(norm) || dir.test(norm) : norm === body || norm.startsWith(body.endsWith("/") ? body : body + "/");
    if (hit) skip = !neg;
  }
  return !skip;
}

function collect(dir, hits, force) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (!force && !served(rel)) continue;
    if (entry.isDirectory()) collect(full, hits, force);
    else if (/\.(html|js|css|mjs|json|md|txt)$/i.test(entry.name) && /zernio/i.test(fs.readFileSync(full, "utf8"))) hits.push(rel.split(path.sep).join("/"));
  }
}

const servedHits = [];
collect(root, servedHits, false);
assert.deepEqual(servedHits, []);

const clientHits = [];
collect(path.join(root, "acquire"), clientHits, true);
collect(path.join(root, "account"), clientHits, true);
assert.deepEqual(clientHits, []);

assert.equal(clientSafeText("Open the Zernio dashboard at https://zernio.com/dashboard"), "Open the dashboard at");
assert.equal(/zernio/i.test(clientSafeText("Instagram is connected through Zernio.")), false);
assert.equal(clientSafeText("Instagram connection is not available right now."), "Instagram connection is not available right now.");

const pages = read("acquire/client-pages.js");
assert.match(pages, /Instagram connection is not available right now\. Contact Roleflow support\./);
assert.doesNotMatch(pages, /https?:\/\//);
assert.match(read("supabase/functions/ig-connect-start/index.ts"), /clientSafeText/);
assert.match(read("supabase/functions/llm-check/index.ts"), /clientSafeText/);
assert.match(read("supabase/functions/client-dashboard/index.ts"), /clientSafeText/);
assert.match(read("supabase/functions/_shared/ig-gateway.js"), /welcome: "false"/);
assert.match(read("docs/client-dashboard.md"), /not white-label/);

console.log("client surface tests passed");
