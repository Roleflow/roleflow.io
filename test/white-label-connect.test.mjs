import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normalizeInstagramHandle, scrubChannelCopy, waitingRequest } from "../acquire/connect-instagram.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

assert.equal(normalizeInstagramHandle(" @Preview.Coach "), "preview.coach");
assert.equal(normalizeInstagramHandle("not a handle"), "");
assert.equal(normalizeInstagramHandle(""), "");
assert.equal(scrubChannelCopy("Saved from TailorTalk"), "Saved from Instagram channel");
assert.equal(scrubChannelCopy("See Tailor Talk"), "See Instagram channel");
assert.equal(scrubChannelCopy("https://api.tailortalk.ai/api/v1/get_leads failed"), "Instagram channel failed");
assert.equal(waitingRequest([{ status: "failed" }, { status: "pending", username: "ada" }]).username, "ada");
assert.equal(waitingRequest([{ status: "connected" }]), null);

const sql = read("supabase/migrations/20261023060000_channel_connect_requests.sql");
assert.match(sql, /create table if not exists public\.acq_channel_connect_requests/);
assert.match(sql, /workspace_id uuid not null/);
assert.match(sql, /channel text not null default 'instagram'/);
assert.match(sql, /status in \('pending', 'in_progress', 'connected', 'failed'\)/);
assert.match(sql, /requested_by uuid/);
assert.match(sql, /created_at timestamptz/);
assert.match(sql, /updated_at timestamptz/);
assert.match(sql, /channel_provider text not null default 'tailortalk'/);
assert.match(sql, /channel_provider = 'tailortalk'/);
assert.match(sql, /acq_request_instagram_connection/);
assert.match(sql, /acq_admin_resolve_instagram_connection/);
assert.match(sql, /diego@roleflow.io|acq_notifications/);
assert.match(sql, /provider = 'tailortalk'/);
assert.doesNotMatch(sql, /studio_setter_sync = true/);
assert.doesNotMatch(sql, /META_IG_/);
assert.equal(fs.existsSync(path.join(root, "api/meta")), false);

const panelFiles = [
  "acquire/app.js",
  "acquire/engine-ui.js",
  "acquire/connect-instagram.js",
  "acquire/assistant.js",
  "acquire/studio-ops.js",
  "acquire/home.js",
  "admin/acquisition-admin.js",
  "admin/admin.js",
  "admin/index.html",
  "account/acquisition/index.html"
];
const brand = /tailor\s*talk|tailortalk\.ai/i;
panelFiles.forEach((file) => assert.doesNotMatch(read(file), brand, file));
assert.match(read("acquire/connect-instagram.js"), /Connecting… we'll finish this for you/);
assert.match(read("acquire/engine-ui.js"), /paintInstagramConnect/);
assert.match(read("admin/acquisition-admin.js"), /Mark connected/);
assert.match(read("admin/acquisition-admin.js"), /Mark failed/);
assert.match(read("admin/acquisition-admin.js"), /Connect requests/);
assert.doesNotMatch(read("admin/acquisition-admin.js"), /tailortalk/i);

const mail = read("supabase/functions/roleflow-hooks/index.ts");
assert.match(mail, /notify_connect/);
assert.match(mail, /diego@roleflow.io/);
assert.match(mail, /Instagram connection waiting/);
assert.doesNotMatch(mail.slice(mail.indexOf("async function notifyConnect")), brand);
assert.match(read("supabase/functions/roleflow-setter-sync/index.ts"), /reason: "Instagram channel"/);
assert.doesNotMatch(read("supabase/migrations/20261022240000_studio_phase4.sql"), /studio_setter_sync = true/);

console.log("white-label connect tests passed");
