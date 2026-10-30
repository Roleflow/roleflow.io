// Every business gets the same page header: a short status pill that cannot
// squeeze the title column, and no backend error text as the client-facing label.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { businessSync, SYNC_FAILED, SYNC_LIVE, SYNC_READY } from "../acquire/sync-state.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

const blocked = {
  kind: "connect_instagram",
  status: "failed",
  error: "Not applied: this would change the agent in the external engine, which is read-only. Needs explicit go-ahead.",
  created_at: "2026-10-29T10:00:00Z"
};

// Roleflow setter (the default provider): a stale engine failure does not change the header.
assert.equal(businessSync({ engine: false, outbox: [blocked], igStatus: "connected", systemEnabled: true, externalAgentId: "a" }).label, SYNC_LIVE);
assert.equal(businessSync({ engine: false, outbox: [blocked], igStatus: "error", systemEnabled: true, externalAgentId: "a" }).label, SYNC_READY);
assert.equal(businessSync({ engine: false, outbox: [{ ...blocked, kind: "create_agent" }], igStatus: "connected", systemEnabled: true }).label, SYNC_LIVE);

// Engine setter or the full admin view: the failure still shows, as a short label with the reason kept as detail.
const engine = businessSync({ engine: true, outbox: [blocked], igStatus: "connected", systemEnabled: true, externalAgentId: "a" });
assert.equal(engine.key, "failed");
assert.equal(engine.label, SYNC_FAILED);
assert.match(engine.detail, /read-only/);
assert.equal(businessSync({ outbox: [blocked] }).label, SYNC_FAILED);

// Labels stay short for every state, so the pill never dominates the header.
[
  {},
  { outbox: [blocked] },
  { outbox: [{ kind: "create_agent", status: "pending" }] },
  { outbox: [{ kind: "deploy", status: "pending" }] },
  { previewSync: "failed", previewError: "x".repeat(400) }
].forEach((input) => assert.ok(businessSync(input).label.length <= 30, JSON.stringify(input)));

// Header pill: no per-workspace branching, label text only, raw detail only as an admin tooltip.
const home = read("acquire/home.js");
assert.match(home, /text: sync\.label, title: \(ui\.state && ui\.state\.isAdmin && sync\.detail\) \|\| sync\.label/);
assert.doesNotMatch(home, /businessId ===|business_id ===|1351d2ac|840b08a9/);

// Header layout: the actions column is bounded and the status pill truncates.
const css = read("acquire/acquire.css");
assert.match(css, /body\.platform \.page-card\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,max-content\)/);
assert.match(css, /\.page-actions\{min-width:0;max-width:22rem\}/);
assert.match(css, /\.page-actions \.integration-status\{[^}]*text-overflow:ellipsis/);

// Header status follows the business's setter provider, not the business id.
const app = read("acquire/app.js");
assert.match(app, /function currentSync\(options\) \{\n  const full = Boolean\(options && options\.full\);\n  return businessSync\(\{\n    engine: full \|\| usesEngine\(\),/);
assert.match(read("acquire/setter-workflow.js"), /ui\.businessSync\(\{ full: true \}\)/);

// Client-facing copy never names the engine vendors.
assert.doesNotMatch(read("acquire/sync-state.js"), /zernio|tailortalk/i);
