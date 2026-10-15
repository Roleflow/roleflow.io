import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applicationsToCsv,
  csvToApplications,
  filterApplications,
  isOverdue,
  sortApplications,
  todayISO
} from "../admin/applications-model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const today = "2026-10-15";
assert.equal(isOverdue({ follow_up_date: "2026-10-14", stage: "Sent" }, today), true);
assert.equal(isOverdue({ follow_up_date: "2026-10-15", stage: "Sent" }, today), false);
assert.equal(isOverdue({ follow_up_date: "2026-10-16", stage: "Not sent" }, today), false);
assert.equal(isOverdue({ follow_up_date: "2026-10-01", stage: "Hired" }, today), false);
assert.equal(isOverdue({ follow_up_date: "2026-10-01", stage: "Rejected" }, today), false);
assert.equal(isOverdue({ follow_up_date: "", stage: "Sent" }, today), false);
assert.equal(todayISO(new Date("2026-10-15T15:00:00Z")), "2026-10-15");

const sample = [
  { id: "1", sort_order: 2, offer: "Beta", owner: "Bea", niche: "Fitness", instagram: "@bea", email: "bea@example.com", channel: "IG DM", ticket: "", setter_ote: "", source_url: "", date_sent: "", video_url: "", stage: "Sent", follow_up_date: "2026-10-10", notes: "late" },
  { id: "2", sort_order: 1, offer: "Alpha", owner: "Ada", niche: "Trading", instagram: "@ada", email: "", channel: "Email", ticket: "", setter_ote: "", source_url: "", date_sent: "2026-10-14", video_url: "", stage: "Not sent", follow_up_date: "", notes: "wait" }
];
assert.deepEqual(sortApplications(sample, "sort_order", "asc").map((row) => row.id), ["2", "1"]);
assert.deepEqual(sortApplications(sample, "offer", "desc").map((row) => row.offer), ["Beta", "Alpha"]);
assert.equal(filterApplications(sample, { query: "ada", today }).length, 1);
assert.equal(filterApplications(sample, { stage: "Sent", today }).length, 1);
assert.equal(filterApplications(sample, { channel: "Email", today }).length, 1);
assert.equal(filterApplications(sample, { overdueOnly: true, today }).length, 1);

const csv = applicationsToCsv([{
  id: "11111111-1111-4111-8111-111111111111",
  offer: 'Offer, "quoted"',
  niche: "Niche",
  owner: "Owner",
  instagram: "@owner",
  email: "a@b.co",
  channel: "IG DM",
  ticket: "$3k",
  setter_ote: "$1k",
  source_url: "https://example.com/a,b",
  date_sent: "2026-10-14",
  video_url: "https://share.descript.com/view/example",
  stage: "Sent",
  follow_up_date: "",
  notes: "line one\nline two"
}]);
const parsed = csvToApplications(csv);
assert.equal(parsed.errors.length, 0);
assert.equal(parsed.rows.length, 1);
assert.equal(parsed.rows[0].row.offer, 'Offer, "quoted"');
assert.equal(parsed.rows[0].row.notes, "line one\nline two");
assert.equal(parsed.rows[0].row.stage, "Sent");
assert.equal(parsed.rows[0].row.instagram, "@owner");
assert.equal(csvToApplications("Offer,Stage\nCoaching,Nope").errors.length, 1);
assert.equal(csvToApplications("Nope\nvalue").errors.length, 1);
assert.equal(csvToApplications("Offer,Instagram handle\nCoaching,melisa").rows[0].row.instagram, "@melisa");

const migration = read("supabase/migrations/20261015120000_setter_applications.sql");
assert.match(migration, /enable row level security/);
assert.match(migration, /using \(\(select public\.is_admin\(\)\)\)/);
assert.match(migration, /with check \(\(select public\.is_admin\(\)\)\)/);
assert.match(migration, /revoke all on table public\.setter_applications from public, anon, authenticated/);
assert.match(migration, /grant select, insert, update, delete on table public\.setter_applications to authenticated/);
assert.doesNotMatch(migration, /grant .+ to anon/i);
assert.match(migration, /@melisaestraday/);
assert.match(migration, /2026-10-14/);
assert.match(migration, /https:\/\/share\.descript\.com\/view\/EQKsq9fa7Jh/);
assert.match(migration, /Jimmy Evans/);
assert.match(migration, /IG @stocknavigators has DMs off; recruiter ian@dmsetting.com/);
assert.match(migration, /https:\/\/share\.descript\.com\/view\/ESvdUvydBxh/);
assert.match(migration, /where not exists/);
const seedSql = migration.slice(migration.indexOf("insert into public.setter_applications"));
assert.doesNotMatch(seedSql, /atelium|schemionek/i);
assert.match(migration, /Atelium Academy/);

const adminJs = read("admin/admin.js");
assert.ok(adminJs.indexOf("!adminRes.data") < adminJs.indexOf("renderApplications("));
assert.match(read("admin/index.html"), /id="tab-applications"[^>]*>Applications Tracker/);
assert.match(read("admin/index.html"), /id="nav-applications" href="\/admin\/#applications" hidden/);
assert.match(read("admin/index.html"), /id="admin-tabs" hidden/);
assert.match(read("account/index.html"), /href="\/admin\/#applications" id="nav-admin-applications" hidden>Applications Tracker/);
assert.match(read("account/account.js"), /navApplications\.hidden = false/);
assert.match(read("auth/ui.js"), /#applications/);
assert.match(read(".vercelignore"), /supabase\/migrations/);

const publicFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "supabase" || entry.name === "test") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(html|js|css)$/.test(entry.name)) publicFiles.push(full);
  }
}
walk(root);
const leaked = publicFiles.filter((file) => /melisaestraday|share\.descript\.com|atelium|schemionek|jamesdadswell@icloud\.com/i.test(read(path.relative(root, file))));
assert.deepEqual(leaked, []);

console.log("applications tracker tests passed");
