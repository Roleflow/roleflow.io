import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DASHBOARD_AGENTS,
  dashboardControls,
  instagramConnected,
  recentKeyErrors,
  renderDashboardSwitches,
  switchesText
} from "../acquire/dashboard-switches.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const NOW = new Date("2026-10-31T08:00:00Z");
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60000).toISOString();

function fakeEl(tag, attrs, children) {
  const node = {
    tag,
    attrs: {},
    children: [],
    listeners: {},
    textContent: "",
    classList: { add(name) { node.attrs.class = ((node.attrs.class || "") + " " + name).trim(); } },
    append(...items) { items.forEach((item) => node.children.push(typeof item === "string" ? { tag: "#text", textContent: item, children: [], attrs: {} } : item)); },
    addEventListener(type, fn) { node.listeners[type] = fn; },
    setAttribute(key, value) { node.attrs[key] = String(value); },
    removeAttribute(key) { delete node.attrs[key]; },
    set disabled(value) { if (value) node.attrs.disabled = ""; else delete node.attrs.disabled; },
    get disabled() { return "disabled" in node.attrs; },
    set id(value) { node.attrs.id = value; }
  };
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "text") node.textContent = value;
    else node.attrs[key] = value === true ? "" : String(value);
  });
  (children || []).forEach((child) => node.append(child));
  return node;
}

function all(node, pred, out = []) {
  if (pred(node)) out.push(node);
  (node.children || []).forEach((child) => all(child, pred, out));
  return out;
}

function words(node) {
  return [node.textContent || ""].concat((node.children || []).map(words)).join(" ");
}

function fakeUi(state, language = "en") {
  const calls = [];
  return {
    calls,
    state,
    el: fakeEl,
    button: (label, fn) => { const node = fakeEl("button", { class: "btn sm" }, [label]); if (fn) node.addEventListener("click", fn); return node; },
    language: () => language,
    go: (tab) => calls.push(["go", tab]),
    when: () => "20 min ago",
    setAgent: async (key, value) => calls.push(["setAgent", key, value]),
    setSending: async (value) => calls.push(["setSending", value])
  };
}

const live = {
  businessId: "b1",
  canEdit: true,
  agentSwitches: [{ agent_key: "setter", enabled: true }, { agent_key: "followup", enabled: false }],
  autoDm: { enabled: true, killed: false },
  ig: { business_id: "b1", status: "connected", username: "coach" },
  gatewayIg: { status: "connected" },
  llmErrors: []
};

test("replying is on only when setter and sending are on with no blockers", () => {
  assert.equal(dashboardControls(live, NOW).replying, "on");
  assert.equal(dashboardControls({ ...live, autoDm: { enabled: false } }, NOW).replying, "off");
  assert.deepEqual(dashboardControls({ ...live, autoDm: { enabled: false } }, NOW).blockers, ["needsSending"]);
  assert.equal(dashboardControls({ ...live, agentSwitches: [] }, NOW).replying, "off");
  assert.deepEqual(dashboardControls({ ...live, agentSwitches: [] }, NOW).hints, ["setterOff"]);
  assert.equal(dashboardControls({ ...live, autoDm: { enabled: true, killed: true } }, NOW).sendingOn, false);
});

test("instagram and AI key problems block replying", () => {
  const noIg = dashboardControls({ ...live, ig: null, gatewayIg: { status: "pending" } }, NOW);
  assert.equal(noIg.replying, "blocked");
  assert.deepEqual(noIg.blockers, ["noInstagram"]);
  const badKey = dashboardControls({ ...live, llmErrors: [{ message: "xai demo: Incorrect API key provided.", created_at: ago(30) }] }, NOW);
  assert.equal(badKey.replying, "blocked");
  assert.deepEqual(badKey.blockers, ["keyRejected"]);
});

test("instagram counts as connected through either connection row for this business", () => {
  assert.equal(instagramConnected({ businessId: "b1", ig: { business_id: "b1", status: "connected" } }), true);
  assert.equal(instagramConnected({ businessId: "b1", ig: { business_id: "b2", status: "connected" } }), false);
  assert.equal(instagramConnected({ businessId: "b1", ig: null, gatewayIg: { status: "connected" } }), true);
  assert.equal(instagramConnected({ businessId: "b1" }), false);
});

test("only recent key errors count", () => {
  const rows = [
    { message: "Incorrect API key provided.", created_at: ago(10) },
    { message: "Claude API key was rejected.", created_at: ago(60 * 30) },
    { message: "Model timed out.", created_at: ago(5) },
    { message: "401 Unauthorized", created_at: ago(120) }
  ];
  assert.equal(recentKeyErrors(rows, NOW).length, 2);
  assert.equal(recentKeyErrors([], NOW).length, 0);
  assert.equal(recentKeyErrors(null, NOW).length, 0);
});

test("dashboard lists every agent switch plus sending", () => {
  const ui = fakeUi(live);
  const card = renderDashboardSwitches(ui, NOW);
  const switches = all(card, (node) => node.attrs && node.attrs.role === "switch");
  assert.deepEqual(switches.map((node) => node.attrs["data-switch"]), ["sending"].concat(DASHBOARD_AGENTS));
  assert.deepEqual(DASHBOARD_AGENTS, ["setter", "followup", "comment_voice", "warmer", "outreacher"]);
  const setter = switches.find((node) => node.attrs["data-switch"] === "setter");
  assert.equal(setter.attrs["aria-checked"], "true");
  assert.match(words(card), /Replying to DMs:\s+On/);
});

test("switches write through setAgent and setSending", async () => {
  const ui = fakeUi(live);
  const card = renderDashboardSwitches(ui, NOW);
  const byKey = (key) => all(card, (node) => node.attrs && node.attrs["data-switch"] === key)[0];
  await byKey("setter").listeners.click();
  await byKey("followup").listeners.click();
  await byKey("sending").listeners.click();
  assert.deepEqual(ui.calls, [["setAgent", "setter", false], ["setAgent", "followup", true], ["setSending", false]]);
  assert.equal(byKey("warmer").attrs.disabled, "");
  assert.equal(byKey("warmer").listeners.click, undefined);
});

test("viewers see state but cannot flip switches", () => {
  const ui = fakeUi({ ...live, canEdit: false });
  const card = renderDashboardSwitches(ui, NOW);
  const switches = all(card, (node) => node.attrs && node.attrs.role === "switch");
  assert.ok(switches.every((node) => "disabled" in node.attrs && !node.listeners.click));
  assert.match(words(card), /Only an owner, editor or admin/);
});

test("key hint shows to everyone, raw error detail only to admins", () => {
  const state = { ...live, llmErrors: [{ provider: "xai", message: "Incorrect API key provided.", created_at: ago(5) }] };
  const member = renderDashboardSwitches(fakeUi(state), NOW);
  assert.match(words(member), /AI key rejected, check Settings/);
  assert.match(words(member), /Replying to DMs:\s+Blocked/);
  assert.doesNotMatch(words(member), /Incorrect API key/);
  const admin = renderDashboardSwitches(fakeUi({ ...state, isAdmin: true }), NOW);
  assert.match(words(admin), /Admin: last AI error/);
});

test("hint links open the right settings section", () => {
  const ui = fakeUi({ ...live, ig: null, gatewayIg: null, llmErrors: [{ message: "Incorrect API key provided.", created_at: ago(5) }] });
  const card = renderDashboardSwitches(ui, NOW);
  const links = all(card, (node) => node.attrs && node.attrs["data-open"]);
  links.forEach((node) => node.listeners.click());
  assert.deepEqual(ui.calls, [["go", "settings/connect"], ["go", "settings"]]);
  assert.equal(ui.state.settingsFocus, "model");
});

test("copy exists in English and Spanish with the same keys and no provider name", () => {
  const en = switchesText("en");
  const es = switchesText("es");
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  assert.deepEqual(Object.keys(es.agents).sort(), Object.keys(en.agents).sort());
  assert.equal(es.replying, "Respondiendo DMs");
  const spanish = renderDashboardSwitches(fakeUi(live, "es"), NOW);
  assert.match(words(spanish), /Respondiendo DMs:\s+Activo/);
  assert.doesNotMatch(read("acquire/dashboard-switches.js"), /zernio/i);
});

test("dashboard mounts the switches for every business and writes through RLS paths", () => {
  const pages = read("acquire/client-pages.js");
  const home = pages.slice(pages.indexOf("export function renderDashboardHome"), pages.indexOf("export function renderCalendar"));
  assert.match(home, /renderDashboardSwitches\(ui\)/);
  assert.doesNotMatch(home, /businessId ===|agent_name ===/);
  const app = read("acquire/app.js");
  const fn = app.slice(app.indexOf("async function setSending"), app.indexOf("async function saveAutoDm"));
  assert.match(fn, /from\("acq_dm_controls"\)\.upsert/);
  const payload = fn.slice(fn.indexOf(".upsert({"), fn.indexOf("}, { onConflict"));
  assert.doesNotMatch(payload, /killed/);
  assert.match(fn, /window\.confirm/);
  assert.doesNotMatch(app, /service_role|SERVICE_ROLE/);
  assert.match(app, /setSending,\n/);
});
