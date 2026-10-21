import { getSupabase, isConfigured, logout } from "../auth/supabase.js";
import { toast } from "../auth/ui.js";
import { callSetterEngine, renderEngine } from "./engine-ui.js";
import {
  ENGINE_HINT,
  JOURNEY,
  LEAD_STATUSES,
  ROLES,
  SLOTS,
  STAGE_LABELS,
  attributedCents,
  dropOffs,
  funnel,
  money,
  percent,
  pickVoiceNote,
  shareCents,
  showUpRate,
  voiceRates
} from "./model.js";

const app = document.getElementById("app");
const sub = document.getElementById("page-sub");
const pick = document.getElementById("biz-pick");
const logoutBtn = document.getElementById("nav-logout");
const AUDIO_TYPES = new Set(["audio/webm", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/wav", "audio/ogg", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/wave"]);
const MAX_BYTES = 20 * 1024 * 1024;
const TABS = ["overview", "inbox", "pipeline", "voice", "reports", "integrations", "billing", "prompts", "controls", "onboarding"];
const ENGINE_TABS = new Set(["inbox", "prompts", "integrations", "billing", "onboarding"]);

const state = {
  supabase: null,
  user: null,
  canEdit: false,
  businesses: [],
  businessId: "",
  settings: null,
  workforce: [],
  targets: [],
  outreach: [],
  steps: [],
  bookings: [],
  deals: [],
  reports: [],
  exceptions: [],
  activity: [],
  voices: [],
  performance: [],
  stats: null,
  leads: [],
  threads: [],
  messages: [],
  ig: null,
  google: null,
  workers: [],
  dnc: [],
  prompts: [],
  members: [],
  isAdmin: false,
  issuedKey: "",
  setterLink: null,
  contacts: [],
  conversations: [],
  engineMessages: [],
  messageCount: 0,
  outbox: [],
  openThread: "",
  promptRole: "qualification",
  tab: "overview",
  stageFilter: "all",
  openId: ""
};

logoutBtn.addEventListener("click", () => logout());
document.getElementById("nav-toggle").addEventListener("click", () => {
  const open = document.body.classList.toggle("nav-open");
  document.getElementById("nav-toggle").setAttribute("aria-expanded", open ? "true" : "false");
  document.getElementById("nav-backdrop").hidden = !open;
});
document.getElementById("nav-backdrop").addEventListener("click", () => {
  document.body.classList.remove("nav-open");
  document.getElementById("nav-backdrop").hidden = true;
});
document.getElementById("acq-nav").addEventListener("click", (event) => {
  const link = event.target.closest("a[data-tab]");
  if (!link) return;
  event.preventDefault();
  go(link.dataset.tab);
});
pick.addEventListener("change", () => {
  const url = new URL(location.href);
  url.searchParams.set("business", pick.value);
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  bootBusiness(pick.value);
});
window.addEventListener("hashchange", () => {
  state.tab = tabFromHash();
  markTab();
  paint();
});

boot();

async function boot() {
  const preview = readPreview();
  if (preview) {
    Object.assign(state, preview, { canEdit: false, tab: tabFromHash() });
    hideBoot();
    sub.textContent = "Preview of the owner dashboard. Sign in to load a live business.";
    paint();
    return;
  }
  if (!isConfigured()) {
    showMessage("Accounts unavailable", "Supabase is not configured in this build.");
    return;
  }
  state.supabase = getSupabase();
  const { data } = await state.supabase.auth.getSession();
  if (!data.session) {
    const next = location.pathname + location.search + location.hash;
    location.replace("/login/?next=" + encodeURIComponent(next || "/account/acquisition/"));
    return;
  }
  state.user = data.session.user;
  logoutBtn.hidden = false;
  const notice = new URLSearchParams(location.search).get("notice");
  if (notice) toast(notice, "bad");
  if (new URLSearchParams(location.search).get("onboarding") === "1" && !location.hash) {
    history.replaceState(null, "", location.pathname + location.search + "#onboarding");
  }
  const adminRes = await state.supabase.from("admins").select("user_id").eq("user_id", state.user.id).maybeSingle();
  state.isAdmin = Boolean(adminRes.data);
  let listed = await state.supabase.from("acq_workspaces").select("id, name, owner_id, join_code").order("created_at", { ascending: true });
  if (listed.error && missing(listed.error)) {
    showMessage("Pipeline is not ready", "Apply the acquisition migrations, then refresh.");
    return;
  }
  if (listed.error) {
    showMessage("Could not load businesses", listed.error.message);
    return;
  }
  const visible = listed.data || [];
  const owns = visible.some((row) => row.owner_id === state.user.id);
  if (!owns) {
    const opened = await state.supabase.rpc("acq_open_workspace", { p_name: "Acquisition" });
    if (opened.error) {
      showMessage("Could not open a workspace", opened.error.message);
      return;
    }
    listed = await state.supabase.from("acq_workspaces").select("id, name, owner_id, join_code").order("created_at", { ascending: true });
  }
  state.businesses = (listed.data || []).map((row) => ({ ...row, agent_name: row.name || "Acquisition" }));
  if (!state.businesses.length) {
    showMessage("No business yet", "Create an account workspace, or join one with its code from Setup.");
    return;
  }
  fillPicker();
  const requested = new URLSearchParams(location.search).get("business");
  const owned = state.businesses.find((row) => row.owner_id === state.user.id);
  const initial = state.businesses.find((row) => row.id === requested) || owned || state.businesses[0];
  await bootBusiness(initial.id);
}

async function bootBusiness(id) {
  state.businessId = id;
  pick.value = id;
  const business = state.businesses.find((row) => row.id === id);
  const members = state.user
    ? await state.supabase.from("acq_members").select("business_id, user_id, role, status").eq("business_id", id).eq("status", "active")
    : { data: [] };
  state.members = members.error ? [] : members.data || [];
  const mine = state.members.find((row) => state.user && row.user_id === state.user.id);
  state.canEdit = state.isAdmin || Boolean(business && state.user && business.owner_id === state.user.id) || Boolean(mine && (mine.role === "owner" || mine.role === "editor"));
  app.innerHTML = '<div class="state" role="status"><span class="skel"></span><p>Loading this business…</p></div>';
  const ensured = await state.supabase.rpc("acq_ensure", { p_agent: id });
  if (ensured.error && !/not allowed/i.test(ensured.error.message || "")) {
    showMessage("Pipeline is not ready", missing(ensured.error) ? "Apply the acquisition migrations, then refresh." : ensured.error.message);
    return;
  }
  const loaded = await loadAll(id);
  if (state.openThread && state.supabase) {
    const messages = await state.supabase.from("ig_messages").select("id, thread_id, direction, body, kind, created_at").eq("thread_id", state.openThread).eq("business_id", id).order("created_at", { ascending: true });
    state.messages = messages.error ? [] : messages.data || [];
  }
  if (loaded) {
    state.tab = tabFromHash();
    sub.textContent = (business && business.agent_name ? business.agent_name + " · " : "") + "Personal voice notes. 10% of attributed growth.";
    paint();
  }
}

async function loadAll(id) {
  const q = state.supabase;
  const [settings, workforce, targets, outreach, steps, bookings, deals, reports, exceptions, activity, voices, performance, threads, ig, google, workers, dnc, setterLink, contacts, messages, conversations, threadMessages, outbox] = await Promise.all([
    q.from("acq_settings").select("*").eq("agent_id", id).maybeSingle(),
    q.from("business_workforce").select("role, status, parameters, daily_count, daily_count_on, last_run_at, last_error").eq("agent_id", id),
    q.from("acq_targets").select("id, handle, stage, peak_stage, lead_status, icp_score, source, source_detail, updated_at, bio, cta_detected, score_summary, score_model, budget, timeline, fit, qual_score, decision_maker, owner_notes, tt_category, followups").eq("agent_id", id).order("updated_at", { ascending: false }).limit(500),
    q.from("acq_outreach").select("*").eq("agent_id", id).limit(500),
    q.from("acq_warmup_steps").select("id, target_id, day_number, action, status, scheduled_for, action_count").eq("agent_id", id).limit(1000),
    q.from("acq_bookings").select("*").eq("agent_id", id),
    q.from("acq_deals").select("*").eq("agent_id", id).order("closed_on", { ascending: false }),
    q.from("acq_reports").select("*").eq("agent_id", id).order("period_start", { ascending: false }).limit(24),
    q.from("acq_exceptions").select("*").eq("agent_id", id).is("resolved_at", null).order("created_at", { ascending: false }),
    q.from("acq_activity").select("*").eq("agent_id", id).order("created_at", { ascending: false }).limit(80),
    q.from("acq_voice_library").select("*").eq("agent_id", id).order("updated_at", { ascending: false }),
    q.from("acq_voice_performance").select("*").eq("agent_id", id),
    q.from("ig_threads").select("id, igsid, username, state, lead_status, score, last_user_message_at, human_locked, followup_count, meet_link, updated_at").eq("business_id", id).order("updated_at", { ascending: false }).limit(100),
    q.from("ig_connections").select("business_id, username, expires_at, status, last_error, connected_at").eq("business_id", id).maybeSingle(),
    q.from("google_connections").select("business_id, email, calendar_id, expires_at, status, last_error, connected_at").eq("business_id", id).maybeSingle(),
    q.from("acq_workers").select("id, label, key_prefix, enabled, status, last_heartbeat_at, pause_reason").eq("business_id", id).order("created_at", { ascending: false }),
    q.from("acq_dnc").select("handle, reason, created_at").eq("business_id", id).order("created_at", { ascending: false }),
    q.from("acq_setter_links").select("business_id, provider, agent_hint, external_agent_id, requested_handle, status, last_tested_at, last_test_ok, last_test_error, last_synced_at, last_sync_error, last_sync_counts, webhook_seen_at").eq("business_id", id).maybeSingle(),
    q.from("acq_contacts").select("id, name, ig_handle, target_id, lead_status, last_message_at, attributes, detail_source, contact, is_converted, followups, source_detail, category").eq("business_id", id).limit(1000),
    q.from("acq_messages").select("id", { count: "exact", head: true }).eq("business_id", id),
    q.from("acq_conversations").select("id, contact_id").eq("business_id", id).limit(1000),
    q.from("acq_messages").select("conversation_id, role, body, sent_at, created_at").eq("business_id", id).order("created_at", { ascending: true }).limit(400),
    q.from("engine_outbox").select("id, kind, status, created_at, error").eq("business_id", id).in("status", ["pending", "failed"]).order("created_at", { ascending: false }).limit(20)
  ]);
  const firstError = [settings, workforce, targets, voices].find((res) => res.error);
  if (firstError) {
    showMessage("Could not read the pipeline", missing(firstError.error) ? "Apply the acquisition migration, then refresh." : firstError.error.message);
    return false;
  }
  state.settings = settings.data;
  state.workforce = workforce.data || [];
  state.targets = targets.data || [];
  state.outreach = outreach.error ? [] : outreach.data || [];
  state.steps = steps.error ? [] : steps.data || [];
  state.bookings = bookings.error ? [] : bookings.data || [];
  state.deals = deals.error ? [] : deals.data || [];
  state.reports = reports.error ? [] : reports.data || [];
  state.exceptions = exceptions.error ? [] : exceptions.data || [];
  state.activity = activity.error ? [] : activity.data || [];
  state.voices = voices.data || [];
  state.performance = performance.error ? [] : performance.data || [];
  state.stats = null;
  state.leads = [];
  state.threads = threads.error ? [] : threads.data || [];
  state.ig = ig.error ? null : ig.data;
  state.google = google.error ? null : google.data;
  state.workers = workers.error ? [] : workers.data || [];
  state.dnc = dnc.error ? [] : dnc.data || [];
  state.setterLink = setterLink.error ? null : setterLink.data;
  state.contacts = contacts.error ? [] : contacts.data || [];
  state.messageCount = messages.error ? 0 : messages.count || 0;
  state.conversations = conversations.error ? [] : conversations.data || [];
  state.engineMessages = threadMessages.error ? [] : threadMessages.data || [];
  state.outbox = outbox.error ? [] : outbox.data || [];
  return true;
}

function paint() {
  markTab();
  app.innerHTML = "";
  const root = el("div", { class: "acq" });
  if (state.settings && state.settings.ig_paused) {
    const banner = el("div", { class: "banner", role: "status" });
    banner.append(el("p", { text: "The outreach worker is paused (" + (state.settings.ig_pause_reason || "warning") + "). Official Instagram DMs keep running. " + (state.settings.ig_pause_notes || "") }));
    if (state.canEdit) banner.append(button("Resume", resumeInstagram));
    root.append(banner);
  }
  if (state.tab === "overview") root.append(overview());
  if (state.tab === "pipeline") root.append(pipeline());
  if (state.tab === "voice") root.append(voiceLibrary());
  if (state.tab === "reports") root.append(reports());
  if (state.tab === "controls") root.append(controls());
  if (ENGINE_TABS.has(state.tab)) {
    const host = el("div");
    root.append(host);
    renderEngine(state.tab, host, engineCtx());
  }
  app.append(root);
}

function engineCtx() {
  return {
    state,
    el,
    button,
    field,
    toast,
    bootBusiness,
    go,
    when,
    money,
    shareCents,
    uploadVoice: storeVoice
  };
}

function overview() {
  const wrap = el("div", { class: "acq" });
  const revenue = attributedCents(state.deals);
  const share = shareCents(revenue, state.settings && state.settings.share_bps);
  const show = showUpRate(state.bookings);
  const steps = dropOffs(funnel(state.targets));
  const kpis = el("div", { class: "kpis" });
  [
    ["System", state.settings && state.settings.system_enabled ? "On" : "Off", state.settings && state.settings.daily_cap ? "Daily cap " + state.settings.daily_cap : "Daily cap not set"],
    ["Targets", String(state.targets.length), state.targets.filter((row) => row.stage === "warmup").length + " in warm-up"],
    ["Booked calls", String(state.bookings.length), show.rate == null ? "No show-up data yet" : "Show-up " + percent(show.rate)],
    ["Attributed growth", money(revenue), "Roleflow share " + money(share)]
  ].forEach(([label, value, note]) => {
    const card = el("article", { class: "kpi" });
    card.append(el("span", { text: label }), el("strong", { text: value }), el("em", { text: note }));
    kpis.append(card);
  });
  wrap.append(kpis);
  if (state.settings && state.settings.onboarding_step !== "live") {
    const setup = el("section", { class: "agent" });
    setup.append(el("h3", { text: "Finish setup" }));
    setup.append(el("p", { text: "Add the ICP, offer, Instagram connection, worker key, and voice notes. The CRM stays empty until a worker posts a profile or a setter syncs a lead." }));
    setup.append(el("a", { class: "btn sm", href: "#onboarding" }, ["Open setup"]));
    wrap.append(setup);
  }
  if (!state.targets.length) {
    const empty = el("section", { class: "agent" });
    empty.append(el("h3", { text: "No contacts in the CRM yet" }));
    empty.append(el("p", { text: "Qualified profiles land here at stage Target after Grok scores them. Replies from the Instagram DM engine show on the same contact." }));
    empty.append(el("a", { class: "btn sm", href: "#onboarding" }, ["Set up this business"]));
    wrap.append(empty);
  }

  wrap.append(implementedAgents());

  if (steps.some((step) => step.count > 0)) {
    const funnelBlock = el("section", { class: "agent" });
    funnelBlock.append(el("h3", { text: "Funnel" }));
    const chart = el("div", { class: "funnel" });
    const max = Math.max(1, ...steps.map((step) => step.count));
    steps.forEach((step) => {
      const line = el("div", { class: "funnel-row" });
      line.append(el("span", { text: STAGE_LABELS[step.stage] }));
      const bar = el("div", { class: "bar" });
      const fill = el("i");
      fill.style.width = Math.round((step.count / max) * 100) + "%";
      bar.append(fill);
      line.append(bar, el("span", { text: step.count + (step.dropped ? " · −" + step.dropped : "") }));
      chart.append(line);
    });
    funnelBlock.append(chart);
    wrap.append(funnelBlock);
  }

  const latestSummary = state.reports.find((item) => item.kind === "daily" && item.summary);
  if (latestSummary) {
    const summary = el("section", { class: "agent" });
    summary.append(el("h3", { text: "Daily summary" }));
    summary.append(el("p", { text: latestSummary.summary }));
    summary.append(el("a", { class: "btn sm", href: "#reports" }, ["Open reports"]));
    wrap.append(summary);
  }

  if (state.exceptions.length) {
    const flags = el("section", { class: "agent" });
    flags.append(el("h3", { text: "Exceptions for you" }));
    state.exceptions.forEach((item) => {
      const row = el("p", { text: item.message });
      if (state.canEdit) {
        const resolve = button("Resolve", () => resolveException(item.id));
        resolve.classList.add("sm");
        row.append(" ", resolve);
      }
      flags.append(row);
    });
    wrap.append(flags);
  }

  if (state.activity.length) wrap.append(activityList(state.activity.slice(0, 8), "Latest activity"));
  return wrap;
}

function pipeline() {
  const wrap = el("div", { class: "acq" });
  const filters = el("div", { class: "filters", role: "toolbar", "aria-label": "Stage" });
  ["all", ...JOURNEY, "dead", "skipped"].forEach((stage) => {
    const chip = el("button", { type: "button", "aria-pressed": state.stageFilter === stage ? "true" : "false" }, [stage === "all" ? "All" : STAGE_LABELS[stage]]);
    chip.addEventListener("click", () => {
      state.stageFilter = stage;
      paint();
    });
    filters.append(chip);
  });
  wrap.append(filters);
  const rows = state.targets.filter((row) => state.stageFilter === "all" || row.stage === state.stageFilter);
  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", { class: "leads" });
  const head = el("tr");
  ["Handle", "Stage", "Status", "ICP", "Source", "Updated"].forEach((label) => head.append(el("th", { text: label })));
  table.append(el("thead", {}, [head]));
  const body = el("tbody");
  if (!rows.length) {
    const empty = el("td", { colspan: "6" });
    empty.append(document.createTextNode("No contacts in this stage yet. "));
    empty.append(el("a", { href: "#onboarding" }, ["Finish setup"]));
    body.append(el("tr", {}, [empty]));
  }
  rows.forEach((row) => {
    const tr = el("tr");
    tr.append(
      el("td", { text: "@" + row.handle }),
      el("td", { text: STAGE_LABELS[row.stage] || row.stage }),
      el("td", { text: row.lead_status }),
      el("td", { text: row.icp_score == null ? "—" : String(row.icp_score) }),
      el("td", { text: row.source }),
      el("td", { text: when(row.updated_at) })
    );
    tr.addEventListener("click", () => {
      state.openId = state.openId === row.id ? "" : row.id;
      paint();
    });
    body.append(tr);
  });
  table.append(body);
  tableWrap.append(table);
  wrap.append(tableWrap);
  const open = rows.find((row) => row.id === state.openId) || state.targets.find((row) => row.id === state.openId);
  if (open) wrap.append(leadDetail(open));
  return wrap;
}

function leadDetail(target) {
  const outreach = state.outreach.find((row) => row.target_id === target.id);
  const booking = state.bookings.find((row) => row.target_id === target.id);
  const deals = state.deals.filter((row) => row.target_id === target.id);
  const steps = state.steps.filter((row) => row.target_id === target.id);
  const box = el("section", { class: "detail" });
  box.append(el("h2", { text: "@" + target.handle }));
  const chips = el("div", { class: "chips" });
  JOURNEY.forEach((stage) => {
    const rank = JOURNEY.indexOf(stage);
    const current = Math.max(JOURNEY.indexOf(target.stage), JOURNEY.indexOf(target.peak_stage));
    chips.append(el("span", { class: "chip" + (rank <= current && current >= 0 ? " on" : ""), text: STAGE_LABELS[stage] }));
  });
  box.append(chips);
  box.append(el("p", { class: "mute", text: (target.bio || "No bio stored") + (target.cta_detected ? " · CTA detected" : "") }));
  if (steps.length) {
    box.append(el("p", { text: "Warm-up: " + steps.map((step) => "D" + step.day_number + " " + step.action + " " + step.status).join(" · ") }));
  }
  if (target.score_summary) box.append(el("p", { text: "ICP: " + target.score_summary + (target.score_model ? " · " + target.score_model : "") }));
  if (outreach) box.append(el("p", { text: "Outreach " + outreach.decision + (outreach.sent_result ? " · " + outreach.sent_result : "") + (outreach.opener ? " — " + outreach.opener : "") }));
  if (outreach && outreach.handed_off_at) box.append(el("p", { text: "Replies continue with the setter provider." }));
  const contact = (state.contacts || []).find((row) => row.target_id === target.id || (row.ig_handle && String(row.ig_handle).toLowerCase().replace(/^@/, "") === target.handle));
  const conversationIds = (state.conversations || []).filter((row) => contact && row.contact_id === contact.id).map((row) => row.id);
  const thread = (state.engineMessages || []).filter((row) => conversationIds.includes(row.conversation_id));
  box.append(setterDetail(contact, target, thread));
  if (thread.length) {
    const talk = el("div", { class: "audit" });
    talk.append(el("h3", { text: "Conversation" }));
    thread.forEach((message) => {
      const item = el("article");
      item.append(el("strong", { text: message.role === "assistant" ? "Setter" : "Lead" }), el("span", { class: "mute", text: " · " + when(message.sent_at || message.created_at) }));
      item.append(el("p", { text: message.body }));
      talk.append(item);
    });
    box.append(talk);
  }

  const form = el("form", { class: "grid-2" });
  const budget = field("Budget", target.budget || "");
  const timeline = field("Timeline", target.timeline || "");
  const fit = field("Fit", target.fit || "");
  const score = field("Score", target.qual_score == null ? "" : String(target.qual_score), "number");
  const status = el("select", { "aria-label": "Lead status" });
  LEAD_STATUSES.forEach((item) => status.append(el("option", { value: item, text: item })));
  status.value = target.lead_status;
  const maker = el("label", { class: "switch", text: " Decision-maker" });
  const makerInput = el("input", { type: "checkbox" });
  makerInput.checked = target.decision_maker === true;
  maker.prepend(makerInput);
  form.append(budget.label, timeline.label, fit.label, score.label, status, maker);
  if (state.canEdit) form.append(button("Save qualification", (event) => saveQualification(event, target.id, { budget, timeline, fit, score, status, makerInput })));
  box.append(form);

  const show = el("label", { text: "Show-up" });
  const showSelect = el("select", { "aria-label": "Show-up" });
  ["scheduled", "showed", "no_show", "cancelled"].forEach((item) => showSelect.append(el("option", { value: item, text: item })));
  showSelect.value = booking ? booking.show_status : "scheduled";
  show.append(showSelect);
  if (state.canEdit) {
    const saveShow = button("Save show-up", () => saveShowStatus(target, booking, showSelect.value));
    box.append(el("div", { class: "grid-2" }, [show, saveShow]));
  }

  const dealForm = el("form", { class: "grid-2" });
  const amount = field("Closed revenue (USD)", "");
  const note = field("Deal note", "");
  dealForm.append(amount.label, note.label);
  if (state.canEdit) dealForm.append(button("Record attributed revenue", (event) => saveDeal(event, target.id, amount, note)));
  box.append(dealForm);
  if (deals.length) {
    const recorded = deals.reduce((sum, deal) => sum + (Number(deal.amount_cents) || 0), 0);
    box.append(el("p", { text: "Recorded: " + deals.map((deal) => money(deal.amount_cents, deal.currency)).join(", ") + ". Roleflow share " + money(shareCents(recorded, state.settings && state.settings.share_bps)) + "." }));
  }
  const notes = field("Notes", target.owner_notes || "");
  if (state.canEdit) {
    box.append(notes.label, button("Save note", async () => {
      const saved = await state.supabase.from("acq_targets").update({ owner_notes: notes.input.value.trim() }).eq("id", target.id);
      if (saved.error) toast(saved.error.message, "bad");
      else {
        toast("Note saved.");
        await bootBusiness(state.businessId);
      }
    }));
  } else if (target.owner_notes) {
    box.append(el("p", { text: target.owner_notes }));
  }

  const sends = state.activity.filter((row) => row.target_id === target.id);
  if (sends.length) box.append(activityList(sends, "Audit trail"));
  return box;
}

const PULL_HINT = ENGINE_HINT;

const ATTR_LABELS = [
  ["budget", "Budget"],
  ["timeline", "Timeline"],
  ["decision_maker", "Decision-maker"],
  ["fit", "Fit"],
  ["ig_handle", "Instagram"],
  ["offer", "Offer"],
  ["monthly_revenue", "Monthly revenue"],
  ["niche", "Niche"],
  ["offer_price", "Offer price"],
  ["dm_volume", "DM volume"],
  ["current_dm_handling", "Current DM handling"],
  ["gap", "Gap"],
  ["objections", "Objections"],
  ["time_zone", "Time zone"],
  ["booking_email", "Booking email"],
  ["booking_date", "Booking date"],
  ["voice_note_slot", "Voice note slot"]
];

function setterDetail(contact, target, thread) {
  const wrap = el("div");
  const webhook = contact && contact.detail_source === "webhook";
  if (!webhook) {
    wrap.append(el("p", { class: "mute", text: PULL_HINT }));
    const status = (contact && contact.lead_status) || target.lead_status || "cold";
    const category = (contact && contact.category) || target.tt_category || "no category";
    const followups = contact && contact.followups != null ? contact.followups : (target.followups || 0);
    const source = (contact && contact.source_detail) || target.source_detail || target.source || "";
    const converted = contact && contact.is_converted === true ? " · converted" : "";
    wrap.append(el("p", { text: "Status " + status + " · " + category + " · follow-ups " + followups + (source ? " · " + source : "") + converted }));
    return wrap;
  }
  wrap.append(el("p", { class: "mute", text: "Full history and extracted attributes from the Instagram DM engine." }));
  const attrs = contact.attributes || {};
  if (attrs.chat_summary) wrap.append(el("p", { text: attrs.chat_summary }));
  const lines = ATTR_LABELS.filter(([key]) => attrs[key]).map(([key, label]) => label + ": " + attrs[key]);
  if (lines.length) wrap.append(el("p", { text: lines.join(" · ") }));
  if (!thread.length) wrap.append(el("p", { class: "mute", text: "No chat messages stored for this lead yet." }));
  return wrap;
}

function voiceQueue() {
  const section = el("section", { class: "agent" });
  section.append(el("h3", { text: "Voice notes to record and send" }));
  section.append(el("p", { class: "mute", text: PULL_HINT }));
  const waiting = (state.contacts || []).filter((row) => row.attributes && row.attributes.voice_note_slot);
  if (!waiting.length) {
    section.append(el("p", { text: "No voice notes are waiting. A slot shows up here when the engine sends voice_note_slot." }));
    return section;
  }
  waiting.slice(0, 40).forEach((row) => {
    const raw = String(row.attributes.voice_note_slot);
    const slot = SLOTS.find((item) => item.id === raw || item.label.toLowerCase() === raw.toLowerCase());
    const note = pickVoiceNote(state.voices, slot ? slot.id : raw, row.attributes.niche || "", "");
    const handle = String(row.ig_handle || row.name || "lead").replace(/^@/, "");
    const label = slot ? slot.label : raw;
    const ready = note ? "Recording ready: " + note.title : "Record this note";
    section.append(el("p", { text: "@" + handle + " · " + label + " · " + ready }));
  });
  return section;
}

function voiceLibrary() {
  const wrap = el("div", { class: "acq" });
  wrap.append(el("section", { class: "banner gold" }, [
    el("p", { text: "You record the notes. Agents pick the active recording for the slot — opener, gap, follow-up, booking, reminder. A cloned voice is not used." })
  ]));
  wrap.append(voiceQueue());
  if (state.canEdit && state.supabase) wrap.append(voiceForm());
  const grid = el("div", { class: "agents" });
  if (!state.voices.length) grid.append(el("p", { class: "mute", text: "No personal voice notes yet." }));
  state.voices.forEach((note) => {
    const perf = voiceRates(state.performance.find((row) => row.id === note.id) || {});
    const card = el("article", { class: "voice-card" });
    const slot = SLOTS.find((item) => item.id === note.slot);
    card.append(el("h3", { text: note.title }));
    card.append(el("p", { text: (slot ? slot.label : note.slot) + (note.niche ? " · " + note.niche : "") + (note.variant ? " · " + note.variant : "") + (note.active ? " · active" : " · inactive") }));
    card.append(el("p", { text: perf.sends + " sends · reply " + percent(perf.replyRate) + " · booked " + percent(perf.bookingRate) }));
    if (note.script_hint) card.append(el("p", { class: "mute", text: note.script_hint }));
    const audio = el("audio", { controls: true, preload: "none" });
    card.append(audio);
    signAudio(note.storage_path).then((url) => {
      if (url) audio.src = url;
    });
    if (state.canEdit) {
      const tools = el("div", { class: "filters" });
      tools.append(button(note.active ? "Deactivate" : "Activate", () => setVoiceActive(note, !note.active)));
      tools.append(button("Delete", () => deleteVoice(note)));
      card.append(tools);
    }
    const picked = pickVoiceNote(state.voices, note.slot, note.niche, note.variant);
    if (picked && picked.id === note.id) card.append(el("p", { class: "mute", text: "This is the note the bot would pick for this slot." }));
    grid.append(card);
  });
  wrap.append(grid);
  return wrap;
}

function voiceForm() {
  const form = el("form", { class: "agent" });
  form.append(el("h3", { text: "Add a recording" }));
  const slot = el("select", { "aria-label": "Script slot", required: true });
  SLOTS.forEach((item) => slot.append(el("option", { value: item.id, text: item.label })));
  const title = field("Title", "");
  const niche = field("Niche (optional)", "");
  const variant = field("Variant (optional)", "");
  const hint = field("What you say", "");
  const file = el("input", { type: "file", accept: "audio/*", "aria-label": "Audio file" });
  const record = button("Record", null, "button");
  let recorder = null;
  let stream = null;
  record.addEventListener("click", async () => {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast("The microphone is not available.", "bad");
      return;
    }
    const chunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: "audio/webm" });
      const named = new File([blob], "voice-note.webm", { type: "audio/webm" });
      await storeVoice(named, { slot: slot.value, title: title.input.value, niche: niche.input.value, variant: variant.input.value, hint: hint.input.value });
    };
    recorder.start();
    record.textContent = "Stop";
  });
  form.append(slot, title.label, niche.label, variant.label, hint.label, file, record);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const chosen = file.files && file.files[0];
    if (!chosen) {
      toast("Choose a file or record one.", "bad");
      return;
    }
    await storeVoice(chosen, { slot: slot.value, title: title.input.value, niche: niche.input.value, variant: variant.input.value, hint: hint.input.value });
  });
  form.append(button("Upload", null, "submit"));
  return form;
}

function reports() {
  const wrap = el("div", { class: "acq" });
  if (state.canEdit) {
    const actions = el("div", { class: "filters" });
    actions.append(button("Run daily summary", runChief));
    wrap.append(actions);
  }
  if (!state.reports.length) {
    const empty = el("section", { class: "agent" });
    empty.append(el("h3", { text: "No report yet" }));
    empty.append(el("p", { text: "A daily summary runs each morning: the cap, new targets, warm-up queued, pending openers, and the 10% share." }));
    wrap.append(empty);
  }
  state.reports.forEach((report) => {
    const card = el("article", { class: "report" });
    card.append(el("h3", { text: (report.kind === "weekly" ? "Weekly" : "Daily") + " · " + report.period_start }));
    card.append(el("p", { text: report.summary }));
    card.append(el("pre", { text: JSON.stringify(report.body || {}, null, 2) }));
    wrap.append(card);
  });
  return wrap;
}

function setterSummary() {
  const contacts = state.contacts || [];
  if (!contacts.length && !(state.messageCount > 0) && !state.bookings.some((row) => row.source === "engine")) return "";
  const count = (status) => contacts.filter((row) => row.lead_status === status).length;
  const bookings = state.bookings.filter((row) => row.source === "engine").length;
  const converted = contacts.filter((row) => row.is_converted === true || row.lead_status === "converted").length;
  return count("cold") + " cold · " + count("warm") + " warm · " + count("hot") + " hot · " + (state.messageCount || 0) + " messages · " + bookings + " bookings · " + converted + " converted";
}

function implementedAgents() {
  const agents = el("div", { class: "agents" });
  agents.append(icpAgentCard(), warmupAgentCard(), setterAgentCard());
  return agents;
}

function icpAgentCard() {
  const row = roleRow("icp_acquisition");
  const provisioned = state.workforce.some((item) => item.role === "icp_acquisition");
  const card = el("article", { class: "agent" });
  const head = el("header");
  head.append(el("h3", { text: "ICP Target Acquisition" }));
  if (provisioned) head.append(roleSwitch("icp_acquisition", "ICP Target Acquisition"));
  card.append(head);
  card.append(el("p", { text: "The browser worker finds profiles. Grok scores them into the CRM." }));
  card.append(el("p", { text: capLine(row) }));
  card.append(el("p", { text: activityLine([row.last_run_at].concat((state.workers || []).map((item) => item.last_heartbeat_at))) }));
  card.append(el("p", { text: instagramLine() }));
  card.append(el("p", { text: workerLine() }));
  if (provisioned) card.append(el("p", { text: state.targets.filter((item) => item.stage === "target").length + " contacts at Target" }));
  else card.append(el("p", { text: "Not provisioned" }));
  return card;
}

function warmupAgentCard() {
  const warmup = roleRow("engagement_warmup");
  const outreach = roleRow("personalised_outreach");
  const card = el("article", { class: "agent" });
  card.append(el("h3", { text: "Warm-up and outreach" }));
  card.append(el("p", { text: "The same browser worker warms the profile, then sends or skips a personal opener." }));
  card.append(roleSwitchRow("engagement_warmup", "Engagement warm-up"));
  card.append(el("p", { text: "Warm-up today " + countToday(warmup) + " · " + activityLine([warmup.last_run_at]) }));
  card.append(roleSwitchRow("personalised_outreach", "Personalised outreach"));
  const pending = state.outreach.filter((item) => item.decision === "pending" && item.opener).length;
  card.append(el("p", { text: "Outreach today " + countToday(outreach) + " · " + activityLine([outreach.last_run_at]) }));
  if (pending) card.append(el("p", { text: pending + " pending openers" }));
  if (!state.workforce.some((item) => item.role === "engagement_warmup" || item.role === "personalised_outreach")) {
    card.append(el("p", { text: "Not provisioned" }));
  }
  return card;
}

function setterAgentCard() {
  const rows = SETTER_ROLES.map((role) => roleRow(role));
  const provisioned = SETTER_ROLES.filter((role) => state.workforce.some((item) => item.role === role));
  const card = el("article", { class: "agent" });
  const head = el("header");
  head.append(el("h3", { text: "Roleflow Setter Engine" }));
  head.append(setterSwitch(provisioned));
  card.append(head);
  card.append(el("p", { text: "Instagram DM engine. Qualification, comment and story DMs, follow-ups, and booking through the calendar link." }));
  const pendingEngine = usesEngine() && (!(state.setterLink) || state.setterLink.status !== "connected");
  card.append(el("p", { text: pendingEngine ? "Pending activation" : setterBundleLabel(provisioned) }));
  card.append(el("p", { text: setterLinkText() }));
  card.append(el("p", { text: activityLine(rows.map((row) => row.last_run_at).concat([
    state.setterLink && state.setterLink.last_synced_at,
    state.setterLink && state.setterLink.webhook_seen_at
  ])) }));
  const summary = setterSummary();
  if (summary) card.append(el("p", { text: summary }));
  if ((state.outbox || []).some((row) => row.status === "pending")) card.append(el("p", { text: "Syncing…" }));
  if (usesEngine()) card.append(el("p", { class: "mute", text: "Pausing sends the pause to the Instagram DM engine. Roleflow stops applying updates while the setter is off." }));
  return card;
}

function roleSwitchRow(roleId, label) {
  const row = el("div", { class: "roster-head" });
  row.append(el("span", { text: label }), roleSwitch(roleId, label));
  return row;
}

function roleSwitch(roleId, label) {
  const row = roleRow(roleId);
  const provisioned = state.workforce.some((item) => item.role === roleId);
  const toggle = el("label", { class: "switch" });
  const input = el("input", { type: "checkbox", "aria-label": "Turn " + label + " on" });
  input.checked = provisioned && row.status === "active";
  input.disabled = !state.canEdit || !state.supabase || !provisioned;
  input.addEventListener("change", () => setRole(roleId, input.checked));
  toggle.append(input, document.createTextNode(!provisioned ? "Not provisioned" : input.checked ? "On" : "Off"));
  return toggle;
}

function setterSwitch(provisioned) {
  const activeCount = provisioned.filter((role) => roleRow(role).status === "active").length;
  const allOn = provisioned.length > 0 && activeCount === provisioned.length;
  const mixed = activeCount > 0 && activeCount < provisioned.length;
  const toggle = el("label", { class: "switch" });
  const input = el("input", { type: "checkbox", "aria-label": "Turn the Roleflow Setter Engine on" });
  input.checked = allOn;
  input.indeterminate = mixed;
  input.disabled = !state.canEdit || !state.supabase || !provisioned.length;
  input.addEventListener("change", () => setSetterBundle(input.checked));
  toggle.append(input, document.createTextNode(!provisioned.length ? "Not provisioned" : mixed ? "Mixed" : allOn ? "On" : "Off"));
  return toggle;
}

function setterBundleLabel(provisioned) {
  if (!provisioned.length) return "Not provisioned";
  const activeCount = provisioned.filter((role) => roleRow(role).status === "active").length;
  if (activeCount === provisioned.length) return "Active";
  if (activeCount === 0) return "Paused";
  return "Mixed";
}

function roleRow(roleId) {
  return state.workforce.find((item) => item.role === roleId) || { status: "paused", daily_count: 0, daily_count_on: null, last_run_at: null };
}

function countToday(row) {
  if (!row || row.daily_count_on == null) return 0;
  return String(row.daily_count_on).slice(0, 10) === localToday(state.settings && state.settings.timezone) ? Number(row.daily_count) || 0 : 0;
}

function capLine(row) {
  const cap = state.settings && state.settings.daily_cap;
  if (!cap) return "Daily cap not set";
  return "Today " + countToday(row) + " / " + cap;
}

function activityLine(values) {
  const times = (values || []).filter(Boolean).map((value) => new Date(value).getTime()).filter((time) => !Number.isNaN(time));
  if (!times.length) return "No activity yet";
  return "Last activity " + when(new Date(Math.max(...times)).toISOString());
}

function instagramLine() {
  const ig = state.ig;
  if (ig && ig.username && ig.status === "connected") return "Instagram @" + String(ig.username).replace(/^@/, "");
  if (ig && ig.username && ig.status && ig.status !== "disconnected") return "Instagram @" + String(ig.username).replace(/^@/, "") + " · " + ig.status;
  const handle = state.setterLink && state.setterLink.requested_handle;
  if (handle) return "Instagram not connected · requested @" + String(handle).replace(/^@/, "");
  return "Instagram not connected";
}

function workerLine() {
  const workers = state.workers || [];
  if (!workers.length) return "No worker key yet";
  const live = workers.find((row) => row.enabled) || workers[0];
  const beat = live.last_heartbeat_at ? "Last heartbeat " + when(live.last_heartbeat_at) : "No heartbeat yet";
  if (!live.enabled || live.status === "paused") return "Worker paused · " + beat;
  return "Worker " + (live.status || "offline") + " · " + beat;
}

function setterLinkText() {
  const link = state.setterLink;
  if (!link) return "Setter link: Not linked";
  if (link.status === "pending") return "Setter link: Pending activation";
  if (link.status === "connected") return "Setter link: Connected";
  if (link.status === "error") return "Setter link: Needs attention";
  return "Setter link: Not linked";
}

function localToday(timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
}

function usesEngine() {
  return Boolean(state.settings && state.settings.setter_provider === "engine");
}

const SETTER_ROLES = ["comment_to_dm", "qualification", "conversation_recovery", "appointment_booking"];

async function enqueueEngine(kind, payload) {
  const saved = await state.supabase.rpc("acq_engine_enqueue", {
    p_business: state.businessId,
    p_kind: kind,
    p_payload: payload || {}
  });
  if (saved.error) throw new Error(saved.error.message);
}

function controls() {
  const settings = state.settings || {};
  const form = el("form", { class: "agent" });
  form.append(el("h3", { text: "System" }));
  const providerWrap = el("label", { text: "Setter" });
  const provider = el("select", { "aria-label": "Setter provider" });
  [["roleflow_meta", "Roleflow Meta engine"], ["engine", "Roleflow Setter Engine"]].forEach(([value, label]) => {
    const option = el("option", { value, text: label });
    if ((settings.setter_provider || "roleflow_meta") === value) option.setAttribute("selected", "");
    provider.append(option);
  });
  provider.disabled = !state.canEdit;
  providerWrap.append(provider);
  form.append(providerWrap, el("p", { class: "mute", text: "The Roleflow Setter Engine handles qualification, comment and story DMs, follow-ups, and booking from the calendar link. Connect Instagram on Integrations or Setup. Switching back to the Meta engine keeps the engine link until an admin disconnects it. Pausing the setter sends that pause to the engine." }));
  const enabled = el("label", { class: "switch", text: " System on" });
  const enabledInput = el("input", { type: "checkbox" });
  enabledInput.checked = settings.system_enabled === true;
  enabledInput.disabled = !state.canEdit;
  enabled.prepend(enabledInput);
  const cap = field("Daily cap (20–30)", settings.daily_cap || 30, "number");
  const tz = field("Timezone", settings.timezone || "Europe/Madrid");
  const quietStart = field("Quiet hours start", shortTime(settings.quiet_start, "22:00"), "time");
  const quietEnd = field("Quiet hours end", shortTime(settings.quiet_end, "08:00"), "time");
  const likes = field("Warm-up likes per post step (1–2)", settings.warmup_like_count || 2, "number");
  const spacing = field("Days between warm-up steps", settings.warmup_spacing_days || 1, "number");
  const delay = field("Reply delay seconds (0–300)", settings.reply_delay_seconds == null ? 60 : settings.reply_delay_seconds, "number");
  const followHours = field("Hours between recovery follow-ups", settings.followup_hours || 6, "number");
  const followCount = field("Recovery follow-ups inside 24h", settings.followup_count || 3, "number");
  const fallback = field("Booking link if Calendar is off", settings.booking_fallback_url || "https://calendar.app.google/8i1gomkozavqYU5b8");
  const publicReplies = el("label", { class: "switch", text: " Public comment replies" });
  const publicInput = el("input", { type: "checkbox" });
  publicInput.checked = settings.public_comment_replies === true;
  publicInput.disabled = !state.canEdit;
  publicReplies.prepend(publicInput);
  const comment = roleParams("comment_to_dm");
  const qual = roleParams("qualification");
  const keywords = field("Comment trigger keywords", comment.trigger_keywords || "");
  const triggerMessage = field("Comment-to-DM message", comment.trigger_message || "");
  const budgetRule = field("Budget rule", qual.budget_rule || "");
  const timelineRule = field("Timeline rule", qual.timeline_rule || "");
  const makerRule = field("Decision-maker rule", qual.decision_maker_rule || "");
  const fitRule = field("Fit rule", qual.fit_rule || "");
  const statuses = field("Lead statuses", qual.lead_statuses || LEAD_STATUSES.join(", "));
  form.append(enabled, cap.label, tz.label, quietStart.label, quietEnd.label, likes.label, spacing.label, delay.label, followHours.label, followCount.label, fallback.label, publicReplies, keywords.label, triggerMessage.label, budgetRule.label, timelineRule.label, makerRule.label, fitRule.label, statuses.label);
  form.append(el("p", { class: "mute", text: "Voice-note slots are the recordings on the Voice tab: " + SLOTS.map((slot) => slot.label).join(", ") + "." }));
  if (state.canEdit) form.append(button("Save controls", (event) => saveControls(event, { enabledInput, cap, tz, quietStart, quietEnd, likes, spacing, delay, followHours, followCount, fallback, publicInput, provider, keywords, triggerMessage, budgetRule, timelineRule, makerRule, fitRule, statuses })));
  const chief = state.workforce.find((row) => row.role === "chief_of_staff");
  const stuck = field("Days before a stage is stuck", (chief && chief.parameters && chief.parameters.stuck_days) || 3, "number");
  const hint = field("Reel comment hint", (state.workforce.find((row) => row.role === "engagement_warmup") || {}).parameters?.comment_hint || "");
  const minScore = field("Outreach minimum ICP score", (state.workforce.find((row) => row.role === "personalised_outreach") || {}).parameters?.min_score || 70, "number");
  const extra = el("div", { class: "grid-2" });
  extra.append(stuck.label, hint.label, minScore.label);
  form.append(extra);
  if (state.canEdit) form.append(button("Save agent parameters", (event) => saveParams(event, { stuck, hint, minScore })));
  return form;
}

function activityList(rows, title) {
  const block = el("section", { class: "agent" });
  block.append(el("h3", { text: title }));
  const list = el("div", { class: "audit" });
  rows.forEach((row) => {
    const item = el("article");
    item.append(el("strong", { text: row.action }), el("span", { class: "mute", text: " · " + (row.result || "") + " · " + row.actor + " · " + when(row.created_at) }));
    if (row.notes) item.append(el("p", { text: row.notes }));
    list.append(item);
  });
  block.append(list);
  return block;
}

function roleParams(role) {
  const row = state.workforce.find((item) => item.role === role);
  return (row && row.parameters) || {};
}

async function setSetterBundle(on) {
  const saved = await state.supabase.from("business_workforce").update({
    status: on ? "active" : "paused",
    updated_at: new Date().toISOString()
  }).eq("agent_id", state.businessId).in("role", SETTER_ROLES);
  if (saved.error) {
    toast(saved.error.message, "bad");
    await bootBusiness(state.businessId);
    return;
  }
  if (usesEngine()) {
    try {
      for (const role of SETTER_ROLES) {
        await enqueueEngine("pause_agent", { role, status: on ? "active" : "paused" });
      }
      toast("Syncing…");
    } catch (error) {
      toast(error.message, "bad");
    }
  } else toast(on ? "Setter on." : "Setter off.");
  await bootBusiness(state.businessId);
}

async function setRole(role, on) {
  const saved = await state.supabase.from("business_workforce").update({ status: on ? "active" : "paused", updated_at: new Date().toISOString() }).eq("agent_id", state.businessId).eq("role", role);
  if (saved.error) {
    toast(saved.error.message, "bad");
    await bootBusiness(state.businessId);
    return;
  }
  if (usesEngine() && SETTER_ROLES.includes(role)) {
    try {
      await enqueueEngine("pause_agent", { role, status: on ? "active" : "paused" });
      toast("Syncing…");
    } catch (error) {
      toast(error.message, "bad");
    }
  } else toast(on ? "Agent on." : "Agent off.");
  await bootBusiness(state.businessId);
}

async function saveControls(event, fields) {
  event.preventDefault();
  const cap = Number(fields.cap.input.value);
  if (cap < 20 || cap > 30) {
    toast("Daily cap stays between 20 and 30.", "bad");
    return;
  }
  const saved = await state.supabase.from("acq_settings").update({
    system_enabled: fields.enabledInput.checked,
    daily_cap: cap,
    timezone: fields.tz.input.value.trim() || "Europe/Madrid",
    quiet_start: fields.quietStart.input.value || "22:00",
    quiet_end: fields.quietEnd.input.value || "08:00",
    warmup_like_count: Math.min(2, Math.max(1, Number(fields.likes.input.value) || 2)),
    warmup_spacing_days: Math.min(3, Math.max(1, Number(fields.spacing.input.value) || 1)),
    reply_delay_seconds: Math.min(300, Math.max(0, Number(fields.delay.input.value) || 0)),
    followup_hours: Math.min(23, Math.max(1, Number(fields.followHours.input.value) || 6)),
    followup_count: Math.min(5, Math.max(1, Number(fields.followCount.input.value) || 3)),
    booking_fallback_url: fields.fallback.input.value.trim() || "https://calendar.app.google/8i1gomkozavqYU5b8",
    public_comment_replies: fields.publicInput.checked,
    setter_provider: fields.provider.value === "engine" ? "engine" : "roleflow_meta"
  }).eq("agent_id", state.businessId);
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Controls saved.");
    if (fields.provider.value === "engine") {
      try {
        await mergeParams("comment_to_dm", {
          trigger_keywords: fields.keywords.input.value.trim(),
          trigger_message: fields.triggerMessage.input.value.trim()
        });
        await mergeParams("qualification", {
          budget_rule: fields.budgetRule.input.value.trim(),
          timeline_rule: fields.timelineRule.input.value.trim(),
          decision_maker_rule: fields.makerRule.input.value.trim(),
          fit_rule: fields.fitRule.input.value.trim(),
          lead_statuses: fields.statuses.input.value.trim() || LEAD_STATUSES.join(", ")
        });
        await enqueueEngine("update_settings", {
          timezone: fields.tz.input.value.trim() || "Europe/Madrid",
          reply_delay_seconds: Math.min(300, Math.max(0, Number(fields.delay.input.value) || 0)),
          followup_hours: Math.min(23, Math.max(1, Number(fields.followHours.input.value) || 6)),
          followup_count: Math.min(5, Math.max(1, Number(fields.followCount.input.value) || 3)),
          booking_link: fields.fallback.input.value.trim() || "https://calendar.app.google/8i1gomkozavqYU5b8",
          trigger_keywords: fields.keywords.input.value.trim(),
          trigger_message: fields.triggerMessage.input.value.trim(),
          budget_rule: fields.budgetRule.input.value.trim(),
          timeline_rule: fields.timelineRule.input.value.trim(),
          decision_maker_rule: fields.makerRule.input.value.trim(),
          fit_rule: fields.fitRule.input.value.trim(),
          lead_statuses: fields.statuses.input.value.trim() || LEAD_STATUSES.join(", "),
          voice_note_slots: SLOTS.map((slot) => slot.id)
        });
        toast("Syncing…");
      } catch (error) {
        toast(error.message, "bad");
      }
    }
    await bootBusiness(state.businessId);
  }
}

async function saveParams(event, fields) {
  event.preventDefault();
  await mergeParams("chief_of_staff", { stuck_days: Number(fields.stuck.input.value) || 3 });
  await mergeParams("engagement_warmup", { comment_hint: fields.hint.input.value.trim() });
  await mergeParams("personalised_outreach", { min_score: Number(fields.minScore.input.value) || 70 });
  toast("Agent parameters saved.");
  await bootBusiness(state.businessId);
}

async function mergeParams(role, patch) {
  const current = state.workforce.find((row) => row.role === role);
  const parameters = { ...(current && current.parameters ? current.parameters : {}), ...patch };
  await state.supabase.from("business_workforce").update({ parameters, updated_at: new Date().toISOString() }).eq("agent_id", state.businessId).eq("role", role);
}

async function saveQualification(event, id, fields) {
  event.preventDefault();
  const qual = fields.score.input.value === "" ? null : Number(fields.score.input.value);
  const saved = await state.supabase.from("acq_targets").update({
    budget: fields.budget.input.value.trim() || null,
    timeline: fields.timeline.input.value.trim() || null,
    fit: fields.fit.input.value.trim() || null,
    qual_score: Number.isFinite(qual) ? qual : null,
    lead_status: fields.status.value,
    decision_maker: fields.makerInput.checked
  }).eq("id", id);
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Qualification saved.");
    if (usesEngine()) {
      try {
        await enqueueEngine("update_settings", {
          target_id: id,
          budget: fields.budget.input.value.trim(),
          timeline: fields.timeline.input.value.trim(),
          fit: fields.fit.input.value.trim(),
          qual_score: Number.isFinite(qual) ? qual : null,
          lead_status: fields.status.value,
          decision_maker: fields.makerInput.checked
        });
        toast("Syncing…");
      } catch (error) {
        toast(error.message, "bad");
      }
    }
    await bootBusiness(state.businessId);
  }
}

async function saveShowStatus(target, booking, showStatus) {
  const saved = booking
    ? await state.supabase.from("acq_bookings").update({ show_status: showStatus }).eq("id", booking.id)
    : await state.supabase.from("acq_bookings").insert({ agent_id: state.businessId, target_id: target.id, show_status: showStatus, source: "owner" });
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Show-up saved.");
    if (usesEngine() && (showStatus === "scheduled" || showStatus === "showed")) {
      try {
        await callSetterEngine(engineCtx(), "mark_booked", { target_id: target.id });
        toast("The Instagram DM engine marked this lead booked.");
      } catch (error) {
        toast(error.message, "bad");
      }
    }
    await bootBusiness(state.businessId);
  }
}

async function saveDeal(event, targetId, amount, note) {
  event.preventDefault();
  const dollars = Number(amount.input.value);
  if (!Number.isFinite(dollars) || dollars < 0) {
    toast("Enter the cash collected.", "bad");
    return;
  }
  const saved = await state.supabase.from("acq_deals").insert({
    agent_id: state.businessId,
    target_id: targetId,
    amount_cents: Math.round(dollars * 100),
    currency: "USD",
    notes: note.input.value.trim(),
    attributed: true,
    entered_by: state.user.id
  }).select("id").single();
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Revenue recorded. The 10% share updates with it.");
    if (usesEngine()) {
      try {
        await callSetterEngine(engineCtx(), "mark_won", { deal_id: saved.data.id });
        toast("The Instagram DM engine marked this lead converted.");
      } catch (error) {
        toast(error.message, "bad");
      }
    }
    await bootBusiness(state.businessId);
  }
}

async function storeVoice(file, meta) {
  if (!file || file.size > MAX_BYTES) {
    toast("Keep the recording under 20 MB.", "bad");
    return;
  }
  const mime = mimeOf(file);
  if (!AUDIO_TYPES.has(mime)) {
    toast("Use mp3, m4a, wav, ogg, or webm.", "bad");
    return;
  }
  const id = crypto.randomUUID();
  const ext = mime.includes("webm") ? "webm" : mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : "m4a";
  const path = state.businessId + "/" + id + "." + ext;
  const uploaded = await state.supabase.storage.from("acq-voice").upload(path, file, { contentType: mime, upsert: false });
  if (uploaded.error) {
    toast(uploaded.error.message, "bad");
    return;
  }
  const saved = await state.supabase.from("acq_voice_library").insert({
    id,
    agent_id: state.businessId,
    slot: meta.slot,
    title: (meta.title || "").trim() || "Voice note",
    niche: (meta.niche || "").trim() || null,
    variant: (meta.variant || "").trim() || null,
    script_hint: (meta.hint || "").trim(),
    storage_path: path,
    mime_type: mime,
    byte_size: file.size,
    active: true,
    created_by: state.user.id
  });
  if (saved.error) {
    await state.supabase.storage.from("acq-voice").remove([path]);
    toast(saved.error.message, "bad");
    return;
  }
  toast("Voice note saved.");
  await bootBusiness(state.businessId);
}

async function setVoiceActive(note, active) {
  const saved = await state.supabase.from("acq_voice_library").update({ active }).eq("id", note.id);
  if (saved.error) toast(saved.error.message, "bad");
  else await bootBusiness(state.businessId);
}

async function deleteVoice(note) {
  await state.supabase.storage.from("acq-voice").remove([note.storage_path]);
  const saved = await state.supabase.from("acq_voice_library").delete().eq("id", note.id);
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Voice note deleted.");
    await bootBusiness(state.businessId);
  }
}

async function signAudio(path) {
  if (!state.supabase || !path) return "";
  const signed = await state.supabase.storage.from("acq-voice").createSignedUrl(path, 3600);
  return signed.data && signed.data.signedUrl ? signed.data.signedUrl : "";
}

async function resumeInstagram() {
  const saved = await state.supabase.from("acq_settings").update({
    ig_paused: false,
    ig_pause_reason: null,
    ig_pause_notes: null,
    ig_paused_at: null
  }).eq("agent_id", state.businessId);
  if (saved.error) {
    toast(saved.error.message, "bad");
    return;
  }
  await state.supabase.from("acq_exceptions").update({ resolved_at: new Date().toISOString() }).eq("agent_id", state.businessId).eq("kind", "instagram_pause").is("resolved_at", null);
  toast("Queue resumed.");
  await bootBusiness(state.businessId);
}

async function resolveException(id) {
  const saved = await state.supabase.from("acq_exceptions").update({ resolved_at: new Date().toISOString() }).eq("id", id);
  if (saved.error) toast(saved.error.message, "bad");
  else await bootBusiness(state.businessId);
}

async function runChief() {
  const session = await state.supabase.auth.getSession();
  const token = session.data.session && session.data.session.access_token;
  const root = globalThis.ROLEFLOW_SUPABASE || {};
  let payload = {};
  try {
    const response = await fetch(String(root.SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/acquisition-bot", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + (token || ""),
        apikey: root.SUPABASE_ANON_KEY || "",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "chief", business_id: state.businessId })
    });
    payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The daily summary did not run.");
  } catch (error) {
    toast(error.message, "bad");
    return;
  }
  if (payload.summary) toast(payload.summary);
  else toast("Daily summary saved.");
  await bootBusiness(state.businessId);
}

function fillPicker() {
  pick.hidden = false;
  pick.innerHTML = "";
  state.businesses.forEach((row) => pick.append(el("option", { value: row.id, text: row.agent_name || "Business" })));
}

function go(tab) {
  const url = new URL(location.href);
  url.hash = tab;
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  state.tab = tab;
  markTab();
  paint();
  document.body.classList.remove("nav-open");
  document.getElementById("nav-backdrop").hidden = true;
}

function markTab() {
  document.querySelectorAll("#acq-nav a").forEach((link) => {
    if (link.dataset.tab === state.tab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function tabFromHash() {
  const tab = location.hash.replace("#", "");
  return TABS.includes(tab) ? tab : "overview";
}

function field(label, value, type) {
  const wrap = el("label", { text: label });
  const input = el("input", { type: type || "text", value: value == null ? "" : String(value) });
  wrap.append(input);
  return { label: wrap, input };
}

function button(text, onClick, type) {
  const node = el("button", { type: type || "button", class: "btn sm" }, [text]);
  if (onClick && type !== "submit") node.addEventListener("click", onClick);
  return node;
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  (children || []).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function when(value) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "never";
  return date.toLocaleString();
}

function shortTime(value, fallback) {
  return String(value || fallback || "22:00").slice(0, 5);
}

function mimeOf(file) {
  const raw = String(file.type || "").split(";")[0].trim().toLowerCase();
  if (raw && raw !== "application/octet-stream") return raw === "audio/mp3" ? "audio/mpeg" : raw;
  const ext = String(file.name || "").split(".").pop().toLowerCase();
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "wav") return "audio/wav";
  if (ext === "ogg") return "audio/ogg";
  return "audio/webm";
}

function missing(error) {
  return error && /schema cache|does not exist|PGRST205|PGRST202|acq_/i.test(error.message || "");
}

function sourceLine(bySource) {
  if (!bySource || typeof bySource !== "object") return "not synced";
  return Object.entries(bySource).map(([key, count]) => key + " " + count).join(", ") || "none";
}

function statusLine(leads) {
  const counts = { cold: 0, warm: 0, hot: 0, converted: 0, dead: 0 };
  (leads || []).forEach((lead) => {
    const key = String(lead.stage || "").toLowerCase();
    if (counts[key] != null) counts[key] += 1;
  });
  return "Cold " + counts.cold + " · Warm " + counts.warm + " · Hot " + counts.hot + " · Converted " + counts.converted + " · Dead " + counts.dead;
}

function hideBoot() {
  const bootNode = document.getElementById("boot-state");
  if (bootNode) bootNode.remove();
}

function showMessage(title, text) {
  app.innerHTML = "";
  const box = el("div", { class: "state" });
  box.append(el("h2", { text: title }), el("p", { text }));
  if (/business/i.test(title)) box.append(el("a", { class: "btn", href: "/businesses/" }, ["Open businesses"]));
  app.append(box);
}

function readPreview() {
  const host = location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return null;
  if (new URLSearchParams(location.search).get("preview") !== "1") return null;
  return {
    businessId: "preview",
    businesses: [{ id: "preview", agent_name: "Preview coaching" }],
    settings: { system_enabled: true, daily_cap: 30, timezone: "Europe/Madrid", quiet_start: "22:00", quiet_end: "08:00", warmup_like_count: 2, warmup_spacing_days: 1, ig_paused: false, share_bps: 1000, ai_voice_future: false },
    workforce: ROLES.map((role) => ({ role: role.id, status: role.id === "chief_of_staff" ? "active" : "paused", parameters: {}, daily_count: role.id === "icp_acquisition" ? 12 : 0, last_run_at: "2026-10-21T09:00:00Z" })),
    targets: [
      { id: "t1", handle: "northstar", stage: "outreach", peak_stage: "outreach", lead_status: "warm", icp_score: 90, source: "competitor_followers", bio: "Coach. DM me to apply.", cta_detected: true, updated_at: "2026-10-21T09:00:00Z", budget: "", timeline: "", fit: "", qual_score: null, decision_maker: null },
      { id: "t2", handle: "slowreply", stage: "booked", peak_stage: "booked", lead_status: "hot", icp_score: 85, source: "keyword", bio: "Agency systems.", cta_detected: true, updated_at: "2026-10-20T09:00:00Z" }
    ],
    outreach: [{ id: "o1", target_id: "t1", decision: "send", opener: "Hey northstar — saw the CTA.", sent_result: null }],
    steps: [],
    bookings: [{ id: "b1", target_id: "t2", show_status: "scheduled" }],
    deals: [{ id: "d1", target_id: "t2", amount_cents: 1000000, currency: "USD", attributed: true }],
    reports: [{ id: "r1", kind: "daily", period_start: "2026-10-21", summary: "Cap 30. New targets today: 12.", body: { cap: 30 } }],
    exceptions: [{ id: "e1", message: "4 leads stuck in warmup for more than 3 days." }],
    activity: [{ id: "a1", target_id: "t1", action: "voice.sent", result: "sent", actor: "bot", notes: "Opener", created_at: "2026-10-21T09:05:00Z" }],
    voices: [{ id: "v1", slot: "outreach_opener", title: "Opener — coaching", niche: "coaching", variant: null, active: true, script_hint: "Hey, I listened to the reel.", storage_path: "", updated_at: "2026-10-21" }],
    performance: [{ id: "v1", sends: 8, replies: 3, bookings: 1 }],
    stats: null,
    leads: [],
    threads: [{ id: "th1", igsid: "1", username: "northstar", state: "qualification", lead_status: "warm", human_locked: false, followup_count: 0, meet_link: "", updated_at: "2026-10-21T09:10:00Z" }],
    messages: [{ id: "m1", thread_id: "th1", direction: "in", body: "Are you a bot?", kind: "text", created_at: "2026-10-21T09:10:00Z" }],
    ig: { status: "connected", username: "previewcoach" },
    google: { status: "disconnected" },
    workers: [{ id: "w1", label: "Outreach worker", key_prefix: "rfw_preview", enabled: true, status: "offline", last_heartbeat_at: null, pause_reason: null }],
    dnc: [{ handle: "donotcontact", reason: "asked to stop" }],
    prompts: [],
    members: [],
    isAdmin: false,
    openThread: "th1",
    promptRole: "qualification"
  };
}
