import { getSupabase, isConfigured, logout } from "../auth/supabase.js";
import { toast } from "../auth/ui.js";
import { NAV_GROUPS, canonicalTab, navLabel, readLanguage, writeLanguage } from "./client-nav.mjs";
import { delayError } from "./studio-ops-model.js";
import { practiceDelaySeconds } from "./setter-delay.js";
import { gateSetter, localTry, renderCalendar, renderCommentVoice, renderDashboardHome, renderFollowBoss, renderGrokAgent, renderInstagramConnect, renderModelKey, renderSetter, text as agentText } from "./client-pages.js";
import { bookingLinkFor, promptVersionLabel, resolveOutgoing, voiceCatalog } from "./prompt-tokens.js";
import { keyHint, previewKeys } from "./model-key.js";
import { bindAssistant } from "./assistant.js";
import { sectionText } from "./section-copy.js";
import { bindOps, paintChrome } from "./studio-ops.js";
import { bindSidebar } from "./dock.js";
import { closeOffice } from "./office.js";
import { callSetterEngine, renderEngine } from "./engine-ui.js";
import { businessSync, queueSyncNotice } from "./sync-state.js";
import {
  mountNav,
  pageHeader,
  renderIntro,
  renderConfiguration,
  renderDashboard,
  renderInbound,
  renderOutbound,
  renderPerformance,
  renderStats,
  renderTeam
} from "./home.js";
import { renderBusiness, renderCrm, renderSalesLinks, renderValueContent } from "./studio.js";
import { MAX_CHARS, charCount, collectLeads } from "./studio-model.js";
import { THREAD_PAGE, senderLabel } from "./studio-flow-model.js";
import { prepareOwnerFile } from "./clip-file.js";
import { scorePrompt } from "./workforce-model.js";
import { renderChats, renderCtas, renderFollowups, renderReminders } from "./studio-flow.js";
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
const panelLogout = document.getElementById("panel-logout");
const AUDIO_TYPES = new Set(["audio/webm", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/wav", "audio/ogg", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/wave"]);
const MAX_BYTES = 20 * 1024 * 1024;
const TABS = ["dashboard", "agents", "overview", "inbox", "pipeline", "voice", "reports", "integrations", "billing", "prompts", "controls", "onboarding", "settings", "links", "content", "outbound", "inbound", "stats", "performance", "configuration", "team", "brief", "followups", "reminders", "ctas"];
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
  connectRequests: [],
  openThread: "",
  promptRole: "qualification",
  tab: "dashboard",
  stageFilter: "all",
  openId: "",
  leadFilter: "all",
  configKey: "reply",
  rangeDays: 7,
  memberRows: [],
  memberProfiles: [],
  brief: null,
  briefVersions: [],
  agentCards: [],
  leadNotes: [],
  messageQueue: [],
  offerLinks: [],
  scheduleEndpoints: [],
  valueAssets: [],
  followupSteps: [],
  welcomeSteps: [],
  manualFollowups: [],
  reminders: [],
  commentCtas: [],
  storyCtas: [],
  stateRules: [],
  tagRules: [],
  webhooks: [],
  apiKeys: [],
  invites: [],
  notifications: [],
  origins: [],
  revealedKey: "",
  highlight: "",
  funnelMode: "all",
  flow: null,
  chatDraft: "",
  studio: null,
  studioScore: null,
  agentPrompts: [],
  setterPrompts: [],
  setterCurrentId: "",
  agentTools: [],
  setterOutbox: [],
  openDeskRequest: null,
  agentRoutines: [],
  agentRuns: [],
  agentActions: [],
  agentSettings: [],
  agentPromptScore: null,
  refreshTimer: 0,
  agentSwitches: [],
  setterPrompt: "",
  setterTestedAt: null,
  followupPolicy: null,
  language: "en"
};

logoutBtn.addEventListener("click", () => logout());
if (panelLogout) panelLogout.addEventListener("click", () => logout());
bindProfile();
bindShell();
const sidebar = bindSidebar();
document.getElementById("nav-toggle").addEventListener("click", () => sidebar.setDrawer(!document.body.classList.contains("panel-open")));
document.getElementById("how-close").addEventListener("click", () => { document.getElementById("how-modal").hidden = true; });
document.getElementById("accounts-close").addEventListener("click", () => { document.getElementById("accounts-modal").hidden = true; });
document.getElementById("acq-nav").addEventListener("click", (event) => {
  const link = event.target.closest("a[data-tab]");
  if (!link) return;
  event.preventDefault();
  go(link.dataset.tab);
});
bindAssistant(() => ({
  supabase: state.supabase,
  businessId: state.businessId,
  applyProposal,
  onOpen() {
    state.assistantOpen = true;
    if (state.tab === "assistant" && state.assistantExpanded) return;
    revealAssistantModal();
  },
  onClose() {
    state.assistantOpen = false;
    state.assistantExpanded = false;
    if (state.tab === "assistant") go("home");
    else parkAssistant();
  },
  onExpand() {
    state.assistantOpen = false;
    state.assistantExpanded = true;
    go("assistant");
  },
  language
}));
bindOps({ state, paint });
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
  state.language = readLanguage(safeStorage());
  const preview = readPreview();
  if (preview) {
    Object.assign(state, preview, { tab: tabFromHash(), preview: true });
    const requested = new URLSearchParams(location.search).get("lang");
    if (requested === "es" || requested === "en") {
      state.language = requested;
      writeLanguage(safeStorage(), requested);
    }
    state.canEdit = preview.canEdit === true;
    state.canManageKeys = state.canEdit === true;
    const seed = await import("./setter-seed.js");
    state.setterPrompts = [{ id: "preview-v1", role: "inbound_manager", version: 1, sections: seed.sections, created_at: "2026-10-23T06:00:00Z" }];
    state.setterCurrentId = "preview-v1";
    if (new URLSearchParams(location.search).get("headings") === "1") {
      const titles = {
        exclusion: "Highest Priority Rule (Exclusion)",
        non_negotiables: "Non-Negotiables",
        role: "The Role",
        guardrails: "The Guardrails",
        knowledge: "Context and Knowledge",
        workflow: "Workflow Logic",
        objections: "Objection Handling"
      };
      const headed = {};
      Object.entries(seed.sections).forEach(([key, value]) => {
        const head = titles[key] ? "# " + titles[key] : "";
        const body = String(value || "").trim();
        headed[key] = !head || body === head || body.startsWith(head + "\n") ? body : head + "\n\n" + body;
      });
      state.setterPrompts[0].sections = headed;
    }
    state.agentTools = [
      { id: "tool-voice", agent_role: "inbound_manager", kind: "media", name: "Gap building", config: { media_type: "voice" } },
      { id: "tool-book", agent_role: "inbound_manager", kind: "booking", name: "Calendar", config: { calendar_link: "" } }
    ];
    armEditorRequest();
    fillPicker();
    hideBoot();
    sub.textContent = "Preview of the owner dashboard. Sign in to load a live business.";
    captureInstagramNotice();
    paint();
    settleInstagramNotice();
    if (new URLSearchParams(location.search).get("add") === "1") {
      const adder = await import("./add-business.js");
      adder.openAddBusiness({ supabase: null, preview: true });
    }
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
  logoutBtn.hidden = true;
  if (panelLogout) panelLogout.hidden = true;
  const inviteToken = new URLSearchParams(location.search).get("invite");
  if (inviteToken) {
    const accepted = await state.supabase.rpc("acq_accept_invite", { p_token: inviteToken });
    if (accepted.error) toast(accepted.error.message, "bad");
    else if (accepted.data && accepted.data.business_id) {
      const url = new URL(location.href);
      url.searchParams.delete("invite");
      url.searchParams.set("business", accepted.data.business_id);
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }
  captureInstagramNotice();
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
  let initial = state.businesses.find((row) => row.id === requested);
  if (requested && !initial && /^[0-9a-f-]{36}$/i.test(requested)) {
    const again = await state.supabase.from("acq_workspaces").select("id, name, owner_id, join_code").eq("id", requested).maybeSingle();
    if (again.data && again.data.id) {
      state.businesses = state.businesses.concat([{ ...again.data, agent_name: again.data.name || "Acquisition" }]);
      fillPicker();
      initial = state.businesses.find((row) => row.id === requested);
    }
  }
  if (requested && !initial) {
    showMessage("That business is not on this account", "Choose a business from the list. Instagram connect stays on the business you pick.");
    return;
  }
  const owned = state.businesses.find((row) => row.owner_id === state.user.id);
  initial = initial || owned || state.businesses[0];
  await bootBusiness(initial.id);
}

let bootToken = 0;

async function bootBusiness(id, options) {
  const token = ++bootToken;
  const quiet = Boolean(options && options.quiet);
  if (state.businessId && state.businessId !== id) {
    state.studio = null;
    state.studioScore = null;
    state.flow = null;
    state.chatDraft = "";
    state.openThread = "";
    state.messages = [];
    state.ig = null;
    state.connectError = "";
  }
  state.businessId = id;
  pick.value = id;
  const business = state.businesses.find((row) => row.id === id);
  const members = state.user
    ? await state.supabase.from("acq_members").select("business_id, user_id, role, status, created_at, scopes").eq("business_id", id)
    : { data: [] };
  if (token !== bootToken) return;
  state.memberRows = members.error ? [] : members.data || [];
  state.members = state.memberRows.filter((row) => row.status === "active");
  const profileIds = state.memberRows.map((row) => row.user_id).filter(Boolean);
  if (profileIds.length) {
    const profiles = await state.supabase.from("profiles").select("id, email, full_name").in("id", profileIds);
    if (token !== bootToken) return;
    state.memberProfiles = profiles.error ? [] : profiles.data || [];
  } else state.memberProfiles = [];
  const mine = state.members.find((row) => state.user && row.user_id === state.user.id);
  state.canEdit = state.isAdmin || Boolean(business && state.user && business.owner_id === state.user.id) || Boolean(mine && (mine.role === "owner" || mine.role === "editor"));
  state.canManageKeys = state.isAdmin || Boolean(business && state.user && business.owner_id === state.user.id) || Boolean(mine && mine.role === "owner");
  state.chatsPending = !quiet && state.tab === "chats";
  if (!quiet && state.tab === "chats") {
    app.innerHTML = '<div class="chat-skel" role="status" aria-busy="true"><span class="skel"></span><span class="skel"></span><span class="skel"></span><span class="skel"></span><span class="skel"></span><span class="skel"></span></div>';
  } else if (!quiet) app.innerHTML = '<div class="state" role="status"><span class="skel"></span><p>Loading this business…</p></div>';
  const ensured = await state.supabase.rpc("acq_ensure", { p_agent: id });
  if (token !== bootToken) return;
  if (ensured.error && !/not allowed/i.test(ensured.error.message || "")) {
    showMessage("Pipeline is not ready", missing(ensured.error) ? "Apply the acquisition migrations, then refresh." : ensured.error.message);
    return;
  }
  const loaded = await loadAll(id, token);
  if (token !== bootToken) return;
  if (state.openThread && state.supabase) {
    const messages = await state.supabase.from("ig_messages").select("id, thread_id, direction, body, kind, created_at").eq("thread_id", state.openThread).eq("business_id", id).order("created_at", { ascending: true });
    state.messages = messages.error ? [] : messages.data || [];
  }
  if (loaded) {
    const step = state.settings && state.settings.onboarding_step;
    if (!quiet && step && step !== "live" && !location.hash) {
      history.replaceState(null, "", location.pathname + location.search + "#onboarding");
    }
    state.tab = tabFromHash();
    const adminHome = document.getElementById("nav-admin-home");
    if (adminHome) adminHome.hidden = !state.isAdmin;
    armEditorRequest();
    state.chatsPending = false;
    paint();
    settleInstagramNotice();
  }
}

let editorArmed = false;

function armEditorRequest() {
  if (editorArmed) return;
  const params = new URLSearchParams(location.search);
  if (params.get("editor") !== "1" && params.get("desk") !== "manager") return;
  editorArmed = true;
  state.openDeskRequest = { kind: "inbound", key: "manager" };
  if (state.tab !== "inbound") state.tab = "inbound";
}

async function loadAll(id, token) {
  const live = () => token == null || token === bootToken;
  const q = state.supabase;
  const [settings, workforce, targets, outreach, steps, bookings, deals, reports, exceptions, activity, voices, performance, threads, ig, google, workers, dnc, setterLink, contacts, messages, conversations, outbox, connectRequests] = await Promise.all([
    q.from("acq_settings").select("*").eq("agent_id", id).maybeSingle(),
    q.from("business_workforce").select("role, status, parameters, daily_count, daily_count_on, last_run_at, last_error").eq("agent_id", id),
    q.from("acq_targets").select("id, handle, stage, peak_stage, lead_status, icp_score, source, source_detail, created_at, updated_at, bio, cta_detected, score_summary, score_model, budget, timeline, fit, qual_score, decision_maker, owner_notes, tt_category, followups, crm_state, ai_enabled, assigned_agent, tags, follower_count, is_verified, we_follow, they_follow, message_count").eq("agent_id", id).order("updated_at", { ascending: false }).limit(500),
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
    q.from("acq_contacts").select("id, name, ig_handle, target_id, lead_status, last_message_at, attributes, detail_source, contact, is_converted, followups, source_detail, category, crm_state, ai_enabled, assigned_agent, tags, follower_count, is_verified, we_follow, they_follow, message_count, unread_count, automated, sales_link_id").eq("business_id", id).limit(1000),
    q.from("acq_messages").select("id", { count: "exact", head: true }).eq("business_id", id),
    q.from("acq_conversations").select("id, contact_id").eq("business_id", id).limit(1000),
    q.from("engine_outbox").select("id, kind, status, created_at, error, result_agent_id").eq("business_id", id).order("created_at", { ascending: false }).limit(40),
    q.from("acq_channel_connect_requests").select("id, workspace_id, channel, username, status, notes, requested_by, created_at, updated_at").eq("workspace_id", id).order("created_at", { ascending: false }).limit(10)
  ]);
  if (!live()) return false;
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
  const clips = await q.from("acq_owner_clips").select("id, label, when_to_use, kind, mime_type, byte_size, active, storage_path, speech_provider, created_at").eq("business_id", id).order("created_at", { ascending: false });
  if (!live()) return false;
  state.ownerClips = clips.error ? [] : clips.data || [];
  const hints = await q.rpc("acq_llm_key_hints", { p_business: id });
  if (!live()) return false;
  state.llmKeys = hints.error || !Array.isArray(hints.data) ? [] : hints.data;
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
  state.engineMessages = [];
  state.threadMore = false;
  state.outbox = outbox.error ? [] : outbox.data || [];
  state.connectRequests = connectRequests.error ? [] : connectRequests.data || [];
  const [brief, versions, cards, notes, queue, links, schedules, assets] = await Promise.all([
    q.from("acq_business_briefs").select("business_id, fields, updated_at").eq("business_id", id).maybeSingle(),
    q.from("acq_brief_versions").select("id, fields, cards, char_count, note, created_at").eq("business_id", id).order("created_at", { ascending: false }).limit(30),
    q.from("acq_agent_cards").select("id, role, name, instructions, delegations, updated_at").eq("business_id", id),
    q.from("acq_lead_notes").select("id, contact_id, target_id, body, created_at").eq("business_id", id).order("created_at", { ascending: false }).limit(200),
    q.from("acq_message_queue").select("id, contact_id, target_id, body, status, created_at").eq("business_id", id).order("created_at", { ascending: false }).limit(200),
    q.from("acq_offer_links").select("id, name, body, url, coupon, average_ticket_cents, send_instructions, send_as_button, button_label, agent_roles").eq("business_id", id).order("created_at", { ascending: false }),
    q.from("acq_schedule_endpoints").select("id, provider, name, availability_url, booking_url, condition, has_api_key").eq("business_id", id).order("created_at", { ascending: false }),
    q.from("acq_value_assets").select("id, kind, title, url, label, storage_path, send_instructions, placement, agent_roles").eq("business_id", id).order("created_at", { ascending: false })
  ]);
  if (!live()) return false;
  state.brief = brief.error ? null : brief.data;
  state.briefVersions = versions.error ? [] : versions.data || [];
  state.agentCards = cards.error ? [] : cards.data || [];
  state.leadNotes = notes.error ? [] : notes.data || [];
  state.messageQueue = queue.error ? [] : queue.data || [];
  state.offerLinks = links.error ? [] : links.data || [];
  state.scheduleEndpoints = schedules.error ? [] : schedules.data || [];
  state.valueAssets = assets.error ? [] : assets.data || [];
  const [followups, welcomes, manuals, reminders, commentCtas, storyCtas] = await Promise.all([
    q.from("acq_followup_steps").select("id, hours, mode, body, crm_state, asset_id").eq("business_id", id).order("hours", { ascending: true }),
    q.from("acq_welcome_steps").select("id, position, delay_hours, mode, body").eq("business_id", id).order("position", { ascending: true }),
    q.from("acq_manual_followups").select("id, contact_id, target_id, body, status, created_at").eq("business_id", id).order("created_at", { ascending: false }).limit(100),
    q.from("acq_reminders").select("id, contact_id, target_id, kind, source, title, due_at, status, created_at").eq("business_id", id).order("due_at", { ascending: true }).limit(200),
    q.from("acq_comment_ctas").select("id, keyword, match_mode, dm_text, button_label, button_url, agent_role, reply_to_comments, dm_anyone, public_replies").eq("business_id", id).order("created_at", { ascending: false }),
    q.from("acq_story_ctas").select("id, keyword, agent_role, extra_instructions").eq("business_id", id).order("created_at", { ascending: false })
  ]);
  if (!live()) return false;
  state.followupSteps = followups.error ? [] : followups.data || [];
  state.welcomeSteps = welcomes.error ? [] : welcomes.data || [];
  state.manualFollowups = manuals.error ? [] : manuals.data || [];
  state.reminders = reminders.error ? [] : reminders.data || [];
  state.commentCtas = commentCtas.error ? [] : commentCtas.data || [];
  state.storyCtas = storyCtas.error ? [] : storyCtas.data || [];
  const [stateRules, tagRules, webhooks, apiKeys, invites, notifications, origins] = await Promise.all([
    q.from("acq_state_rules").select("crm_state, condition").eq("business_id", id),
    q.from("acq_tag_rules").select("id, name, rule_kind, rule_text, notify_email").eq("business_id", id).order("created_at", { ascending: false }),
    q.from("acq_webhooks").select("id, url, events, paused, has_secret").eq("business_id", id).order("created_at", { ascending: false }),
    q.from("acq_api_keys").select("id, label, prefix, created_at, revoked_at").eq("business_id", id).order("created_at", { ascending: false }),
    q.from("acq_invites").select("id, email, scopes, token, accepted_at").eq("business_id", id).order("created_at", { ascending: false }).limit(30),
    q.from("acq_notifications").select("id, title, body, created_at, read_at").eq("business_id", id).order("created_at", { ascending: false }).limit(30),
    q.from("acq_origins").select("id, name, keyword").eq("business_id", id).order("created_at", { ascending: false })
  ]);
  if (!live()) return false;
  state.stateRules = stateRules.error ? [] : stateRules.data || [];
  state.tagRules = tagRules.error ? [] : tagRules.data || [];
  state.webhooks = webhooks.error ? [] : webhooks.data || [];
  state.apiKeys = apiKeys.error ? [] : apiKeys.data || [];
  state.invites = invites.error ? [] : invites.data || [];
  state.notifications = notifications.error ? [] : notifications.data || [];
  state.origins = origins.error ? [] : origins.data || [];
  state.sectionErrors = {
    performance: Boolean(origins.error),
    chats: Boolean(contacts.error || targets.error),
    opportunities: Boolean(contacts.error || targets.error),
    calendar: Boolean(bookings.error),
    sops: Boolean(brief.error),
    content: Boolean(assets.error)
  };
  const syncLogs = await q.from("acq_sync_log").select("id, direction, action, result, detail, created_at").eq("business_id", id).order("created_at", { ascending: false }).limit(20);
  if (!live()) return false;
  state.syncLogs = syncLogs.error ? [] : syncLogs.data || [];
  const [agentPrompts, agentRoutines, agentRuns, agentActions, agentSettings] = await Promise.all([
    q.from("agent_prompts").select("id, agent_role, body, note, char_count, score, created_at").eq("business_id", id).order("created_at", { ascending: false }).limit(80),
    q.from("agent_routines").select("id, agent_role, name, cron, timezone, enabled, instructions, last_run_at").eq("business_id", id).order("created_at", { ascending: false }),
    q.from("agent_runs").select("id, agent_role, routine_id, started_at, ended_at, status, summary, error").eq("business_id", id).order("started_at", { ascending: false }).limit(40),
    q.from("agent_actions").select("id, agent_role, run_id, type, target, status, approved_by, error, created_at").eq("business_id", id).order("created_at", { ascending: false }).limit(40),
    q.from("agent_settings").select("agent_role, auto_approve").eq("business_id", id)
  ]);
  if (!live()) return false;
  state.agentPrompts = agentPrompts.error ? [] : agentPrompts.data || [];
  state.agentRoutines = agentRoutines.error ? [] : agentRoutines.data || [];
  state.agentRuns = agentRuns.error ? [] : agentRuns.data || [];
  state.agentActions = agentActions.error ? [] : agentActions.data || [];
  state.agentSettings = agentSettings.error ? [] : agentSettings.data || [];
  const [setterPrompts, setterCurrent, agentTools, setterOutbox] = await Promise.all([
    q.from("acq_prompt_versions").select("id, role, version, sections, created_at").eq("business_id", id).eq("role", "inbound_manager").order("version", { ascending: false }).limit(20),
    q.from("acq_prompt_current").select("version_id").eq("business_id", id).eq("role", "inbound_manager").maybeSingle(),
    q.from("acq_agent_tools").select("id, agent_role, kind, name, config, created_at").eq("business_id", id).order("created_at", { ascending: false }),
    q.from("engine_outbox").select("id, kind, status, created_at, error, result_agent_id").eq("business_id", id).order("created_at", { ascending: false }).limit(40)
  ]);
  if (!live()) return false;
  state.setterPrompts = setterPrompts.error ? [] : setterPrompts.data || [];
  state.setterCurrentId = setterCurrent.error || !setterCurrent.data ? "" : setterCurrent.data.version_id;
  state.agentTools = agentTools.error ? [] : agentTools.data || [];
  state.setterOutbox = setterOutbox.error ? [] : setterOutbox.data || [];
  const [switches, setterPrompt, followPolicy, prefs] = await Promise.all([
    q.from("acq_agent_switches").select("agent_key, enabled").eq("business_id", id),
    q.from("acq_agent_prompts").select("body, tested_at").eq("business_id", id).eq("agent_key", "setter").maybeSingle(),
    q.from("acq_followup_policy").select("*").eq("business_id", id).maybeSingle(),
    state.user ? q.from("acq_user_prefs").select("language").eq("user_id", state.user.id).maybeSingle() : Promise.resolve({ data: null, error: null })
  ]);
  if (!live()) return false;
  state.agentSwitches = switches.error ? [] : switches.data || [];
  state.setterPrompt = setterPrompt.error || !setterPrompt.data ? (state.setterPrompt || "") : setterPrompt.data.body || "";
  state.setterTestedAt = setterPrompt.error || !setterPrompt.data ? null : setterPrompt.data.tested_at;
  state.bookingLink = bookingLinkFor(state.settings && state.settings.booking_fallback_url);
  const [promptVersions, voiceRules, voiceSettings, voiceLog] = await Promise.all([
    q.from("acq_agent_prompt_versions").select("id, version, body, created_at, created_by").eq("business_id", id).order("version", { ascending: false }).limit(30),
    q.from("acq_comment_voice_rules").select("id, keywords, intent, message, clip_id, position").eq("business_id", id).order("position", { ascending: true }),
    q.from("acq_comment_voice_settings").select("daily_cap").eq("business_id", id).maybeSingle(),
    q.from("acq_comment_voice_log").select("id, comment_text, commenter_username, matched, queued, reason, clip_id, created_at").eq("business_id", id).order("created_at", { ascending: false }).limit(40)
  ]);
  if (!live()) return false;
  state.promptVersions = promptVersions.error ? (state.promptVersions || []) : promptVersions.data || [];
  state.commentVoiceRules = voiceRules.error ? [] : voiceRules.data || [];
  state.commentVoiceCap = voiceSettings.error || !voiceSettings.data ? 30 : voiceSettings.data.daily_cap;
  state.commentVoiceLog = voiceLog.error ? [] : voiceLog.data || [];
  state.followupPolicy = followPolicy.error ? null : followPolicy.data;
  if (!prefs.error && prefs.data && (prefs.data.language === "en" || prefs.data.language === "es")) {
    state.language = writeLanguage(safeStorage(), prefs.data.language);
  }
  const selected = state.flow && state.flow.chat && state.flow.chat.startsWith("contact:") ? state.flow.chat.slice("contact:".length) : "";
  const openConversation = selected ? (state.conversations || []).find((row) => row.contact_id === selected) : null;
  if (openConversation) await loadThread(openConversation.id, "newest");
  if (!live()) return false;
  return true;
}

async function loadThread(conversationId, mode) {
  if (!state.supabase || !conversationId) {
    state.engineMessages = [];
    state.threadMore = false;
    state.threadConversationId = "";
    return;
  }
  const offset = mode === "earlier" ? (state.engineMessages || []).length : 0;
  const result = await state.supabase.from("acq_messages")
    .select("id, conversation_id, role, sender, body, sent_at, created_at, metadata")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + THREAD_PAGE - 1);
  const page = result.error ? [] : result.data || [];
  const chronological = page.slice().reverse();
  for (const row of chronological) {
    const path = row.metadata && row.metadata.media_path;
    if (!path) continue;
    const signed = await state.supabase.storage.from("owner-clips").createSignedUrl(path, 3600);
    row.playbackUrl = signed.data && signed.data.signedUrl ? signed.data.signedUrl : "";
    row.mediaKind = row.metadata.media_kind || "audio";
  }
  state.engineMessages = mode === "earlier" ? chronological.concat(state.engineMessages || []) : chronological;
  state.threadMore = page.length === THREAD_PAGE;
  state.threadConversationId = conversationId;
}

async function openChat(lead) {
  if (!state.flow) state.flow = { chat: "", chatQuery: "", chatState: "all", chatTag: "", chatAi: "all", chatUnread: "all", reminderFilter: "open", ctaPreview: "" };
  state.flow.chat = lead ? lead.kind + ":" + lead.id : "";
  const conversation = lead && lead.kind === "contact"
    ? (state.conversations || []).find((row) => row.contact_id === lead.id)
    : null;
  if (!state.supabase) {
    paint();
    return;
  }
  if (conversation) await loadThread(conversation.id, "newest");
  else {
    state.engineMessages = [];
    state.threadMore = false;
    state.threadConversationId = "";
  }
  if (lead && lead.kind === "contact" && Number(lead.unread) > 0) {
    await state.supabase.from("acq_contacts").update({ unread_count: 0 }).eq("id", lead.id).eq("business_id", state.businessId);
    const row = (state.contacts || []).find((item) => item.id === lead.id);
    if (row) row.unread_count = 0;
  }
  paint();
}

async function loadEarlier() {
  if (!state.threadConversationId) return;
  await loadThread(state.threadConversationId, "earlier");
  paint();
}

function paint() {
  parkAssistant();
  if (state.tab !== "assistant") state.assistantExpanded = false;
  markTab();
  app.innerHTML = "";
  const root = el("div", { class: "acq" });
  state.statsEmbedded = false;
  state.embedSetter = false;
  if (state.settings && state.settings.ig_paused) {
    const banner = el("div", { class: "banner", role: "status" });
    banner.append(el("p", { text: "The outreach worker is paused (" + (state.settings.ig_pause_reason || "warning") + "). Official Instagram DMs keep running. " + (state.settings.ig_pause_notes || "") }));
    if (state.canEdit) banner.append(button("Resume", resumeInstagram));
    root.append(banner);
  }
  const step = nextStepCard();
  if (step && state.tab !== "assistant" && state.tab !== "home") root.append(step);
  const ui = pageUi();
  if (state.tab === "home" || (state.tab === "assistant" && !state.assistantExpanded)) root.append(renderPanelHome(ui));
  if (state.tab === "dashboard") root.append(renderDashboardHome(ui));
  if (state.tab === "performance") {
    state.statsEmbedded = true;
    root.append(renderPerformance(ui));
    root.append(renderStats(ui));
  }
  if (state.tab === "assistant" && state.assistantExpanded) root.append(dockAssistant(ui));
  if (state.tab === "chats") root.append(renderChats(ui));
  if (state.tab === "opportunities") root.append(renderCrm(ui));
  if (state.tab === "calendar") root.append(renderCalendar(ui));
  if (state.tab === "sops") {
    state.embedSetter = true;
    const layout = el("div", { class: "prompt-layout" });
    layout.append(renderBusiness(ui), renderSetter(ui));
    root.append(layout);
  }
  if (state.tab === "content") root.append(renderValueContent(ui));
  if (state.tab === "voice") root.append(voiceLibrary());
  if (state.tab === "warmer") root.append(renderGrokAgent(ui, "warmer"));
  if (state.tab === "outreacher") root.append(renderGrokAgent(ui, "outreacher"));
  if (state.tab === "setter") root.append(renderSetter(ui));
  if (state.tab === "commentvoice") root.append(renderCommentVoice(ui));
  if (state.tab === "followup") root.append(renderFollowBoss(ui));
  if (state.tab === "billing") {
    const host = el("div", { id: "billing" });
    root.append(host);
    renderEngine("billing", host, engineCtx());
  }
  if (state.tab === "team") root.append(renderTeam(ui));
  if (state.tab === "instagram") {
    const wrap = el("div", { class: "platform-home" });
    wrap.append(pageHeader(ui, sectionText(language(), "igTitle"), sectionText(language(), "igBody"), "configuration", "link"));
    wrap.append(renderInstagramConnect(ui));
    root.append(wrap);
  }
  if (state.tab === "settings") {
    if (state.settingsFocus === "model") state.configKey = "reply";
    root.append(renderConfiguration(ui));
    root.append(renderSalesLinks(ui));
  }
  if (ENGINE_TABS.has(state.tab) && state.tab !== "inbox" && state.tab !== "billing") {
    const host = el("div");
    root.append(host);
    renderEngine(state.tab, host, engineCtx());
  }
  app.append(root);
  paintChrome(pageUi());
  if ((state.tab === "assistant" || state.assistantOpen) && !state.assistantExpanded) revealAssistantModal();
  if (state.tab === "settings" && state.settingsFocus === "model") {
    const keyCard = document.getElementById("model-key");
    if (keyCard) keyCard.scrollIntoView({ block: "start" });
  }
  const connectCard = document.getElementById("instagram-connect") || document.getElementById("connect-instagram");
  const connectFocus = state.tab === "instagram" || state.tab === "onboarding" || state.configKey === "connect" || new URLSearchParams(location.search).get("connect") === "1";
  if (connectCard && connectFocus) connectCard.scrollIntoView({ block: "start" });
  armRefresh();
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
    uploadVoice: storeVoice,
    recordGrowth
  };
}

function dashboard() {
  return renderDashboard(pageUi());
}

function pageUi() {
  return {
    state,
    el,
    button,
    field,
    go,
    paint,
    toast,
    bootBusiness,
    leadSnapshot,
    instagramLine,
    setterLinkText,
    countToday,
    roleRow,
    roleSwitch,
    setterSwitch,
    when,
    setterPending: () => usesEngine() && (!(state.setterLink) || state.setterLink.status !== "connected"),
    businessSync: currentSync,
    icpAgentCard,
    warmupAgentCard,
    setterAgentCard,
    voiceLibrary,
    renderEngine: (tab, host) => renderEngine(tab, host, engineCtx()),
    mountInstagram: () => renderInstagramConnect(pageUi()),
    mountModelKey: () => renderModelKey(pageUi()),
    roleParams,
    mergeParams,
    enqueueEngine,
    usesEngine,
    patchSettings,
    saveLlm,
    saveShowStatus,
    recordBooking,
    testLlm,
    saveOwnerClip,
    deleteOwnerClip,
    signClip,
    shortTime,
    runChief,
    attributedCents,
    shareCents,
    money,
    percent,
    tabGroup,
    pageHeader,
    targetDetail: leadDetail,
    saveBrief,
    saveAgent,
    restoreBrief,
    studioScore: scoreWithModel,
    studioFix: fixWithModel,
    studioEdit: editWithModel,
    studioSimulate: simulateThread,
    saveLead,
    addLeadNote,
    queueMessage,
    cancelQueued,
    saveOfferLink,
    saveSchedule,
    saveAsset,
    deleteRow,
    collectLeads,
    mountEngineInbox: (host) => renderEngine("inbox", host, engineCtx()),
    saveFollowupOptions,
    saveFollowupStep,
    saveWelcomeStep,
    saveManualFollowup,
    markFollowupSent,
    draftManualFollowup,
    saveReminder,
    finishReminder,
    saveCommentCta,
    saveStoryCta,
    deleteFlowRow,
    draftReply,
    sendInboxReply,
    ignoreHandles,
    importDnc,
    openChat,
    loadEarlier,
    saveStateRule,
    saveTagRule,
    saveWebhook,
    testWebhook,
    createApiKey,
    revokeApiKey,
    cloneBusiness,
    createInvite,
    regenerateJoin,
    saveOrigin,
    markNotification,
    syncSetter,
    saveAgentPrompt,
    restoreAgentPrompt,
    scoreAgentPrompt,
    saveRoutine,
    setRoutineEnabled,
    setAutoApprove,
    approveAction,
    rejectAction,
    language,
    setAgent,
    saveSetterPrompt,
    restoreSetterPrompt,
    saveBookingLink,
    saveReplyDelay,
    sendTrial,
    startTrial,
    restartTrial,
    addCommentRule,
    saveCommentVoice,
    trySetter,
    saveFollowupPolicy
  };
}

function language() {
  return state.language === "es" ? "es" : "en";
}

function safeStorage() {
  try { return localStorage; } catch (_error) { return null; }
}

function parkAssistant() {
  const panel = document.getElementById("assistant-panel");
  const fab = document.getElementById("assistant-open");
  if (panel && panel.parentElement !== document.body) document.body.append(panel);
  if (panel) {
    panel.classList.remove("is-docked", "is-modal");
    panel.hidden = true;
  }
  if (fab) {
    fab.hidden = false;
    fab.setAttribute("aria-expanded", "false");
  }
  document.body.classList.remove("assistant-page", "assistant-modal");
}

function revealAssistantModal() {
  const panel = document.getElementById("assistant-panel");
  const fab = document.getElementById("assistant-open");
  if (panel && panel.parentElement !== document.body) document.body.append(panel);
  if (panel) {
    panel.hidden = false;
    panel.classList.remove("is-docked");
    panel.classList.add("is-modal");
  }
  if (fab) {
    fab.hidden = false;
    fab.setAttribute("aria-expanded", "true");
  }
  document.body.classList.remove("assistant-page");
  document.body.classList.add("assistant-modal");
  paintAssistantFace();
}

function dockAssistant(ui) {
  const lang = language();
  const wrap = ui.el("div", { class: "assistant-dock" });
  wrap.append(ui.pageHeader(ui, sectionText(lang, "assistantTitle"), sectionText(lang, "assistantBody"), "assistant", "clipboard"));
  const panel = document.getElementById("assistant-panel");
  const fab = document.getElementById("assistant-open");
  if (panel) {
    panel.hidden = false;
    panel.classList.remove("is-modal");
    panel.classList.add("is-docked");
    wrap.append(panel);
  }
  if (fab) fab.hidden = true;
  document.body.classList.remove("assistant-modal");
  document.body.classList.add("assistant-page");
  paintAssistantFace();
  return wrap;
}

function paintAssistantFace() {
  const lang = language();
  const es = lang === "es";
  const ready = document.getElementById("assistant-ready");
  const hi = document.getElementById("assistant-hi");
  const hint = document.getElementById("assistant-hint");
  const note = document.getElementById("assistant-disclaimer");
  const guide = document.getElementById("assistant-guide-label");
  if (ready) ready.textContent = es ? "Listo para ayudar" : "Ready to help";
  if (hi) hi.textContent = es ? "Hola, ¿qué hacemos hoy?" : "Hi, what are we doing today?";
  if (hint) hint.textContent = es ? "Enter para enviar" : "Enter to send";
  if (note) note.textContent = es ? "El asistente de Roleflow puede equivocarse. Revisa un cambio antes de guardarlo." : "Roleflow Assistant can be wrong. Check a change before you save it.";
  if (guide) guide.textContent = es ? "Guía automática" : "Auto guide";
  const chips = [
    ["ask", es ? "Responder preguntas" : "Answer questions"],
    ["leads", es ? "Gestionar leads" : "Manage leads"],
    ["ai", es ? "Editar mi IA" : "Edit my AI"],
    ["report", es ? "Informe" : "Report"]
  ];
  chips.forEach(([mode, label]) => {
    const button = document.querySelector('#assistant-chips button[data-mode="' + mode + '"]');
    if (button) button.textContent = label;
  });
  const prompts = es
    ? ["¿Cómo conecto Instagram?", "¿Qué leads necesitan seguimiento?", "Ayúdame a ajustar el prompt del setter.", "Resume este negocio esta semana."]
    : ["How do I connect Instagram?", "Which leads need a follow-up?", "Help me tighten the setter prompt.", "Summarize this business this week."];
  document.querySelectorAll("#assistant-prompts button").forEach((button, index) => {
    const text = prompts[index];
    if (!text) return;
    button.dataset.fill = text;
    button.textContent = text + " →";
  });
  const empty = document.getElementById("assistant-empty");
  const log = document.getElementById("assistant-log");
  if (empty && log) empty.hidden = log.childElementCount > 0;
}

function bindProfile() {
  const open = document.getElementById("profile-open");
  const panel = document.getElementById("profile-panel");
  const settings = document.getElementById("profile-settings");
  const lang = document.getElementById("profile-language");
  const signOut = document.getElementById("profile-logout");
  if (!open || !panel) return;
  open.addEventListener("click", (event) => {
    event.stopPropagation();
    panel.hidden = !panel.hidden;
    open.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
  });
  document.addEventListener("click", (event) => {
    if (panel.hidden) return;
    if (panel.contains(event.target) || open.contains(event.target)) return;
    panel.hidden = true;
    open.setAttribute("aria-expanded", "false");
  });
  if (settings) settings.addEventListener("click", () => { panel.hidden = true; go("settings"); });
  if (lang) {
    lang.value = language();
    lang.addEventListener("change", () => saveLanguage(lang.value));
  }
  if (signOut) signOut.addEventListener("click", () => logout());
}

function bindShell() {
  const theme = document.getElementById("theme-toggle");
  if (theme) theme.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("roleflow.theme", next); } catch (_error) { /* private mode */ }
    theme.setAttribute("aria-label", next === "dark" ? "Switch to light" : "Switch to dark");
  });
  const launch = document.getElementById("command-launch");
  if (launch) launch.addEventListener("click", () => {
    const modal = document.getElementById("command-modal");
    const input = document.getElementById("command-input");
    if (!modal || !input) return;
    modal.hidden = false;
    input.value = "";
    input.dispatchEvent(new Event("input"));
    input.focus();
  });
  const cycle = document.getElementById("lang-cycle");
  if (cycle) cycle.addEventListener("click", () => saveLanguage(language() === "es" ? "en" : "es"));
}

function renderPanelHome(ui) {
  const lang = language();
  const es = lang === "es";
  const wrap = el("div", { class: "start-home" });
  wrap.append(el("h2", { class: "start-title", text: es ? "Configura tu setter de IA para vender por ti 24/7 en menos de 30 minutos" : "Set up your AI setter to sell for you 24/7 in under 30 minutes" }));
  wrap.append(el("p", { class: "start-sub", text: es ? "Conecta Instagram, revisa el negocio y prueba el chat. Los resultados varían." : "Connect Instagram, review the business, and test the chat. Results vary." }));
  const split = el("div", { class: "start-split" });
  const player = el("div", { class: "start-video" });
  const frame = document.createElement("iframe");
  frame.src = "https://share.descript.com/embed/XJIQMjM0Q1N";
  frame.title = es ? "Recorrido de Roleflow" : "Roleflow walkthrough";
  frame.loading = "lazy";
  frame.allow = "fullscreen; picture-in-picture";
  frame.setAttribute("allowfullscreen", "");
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  player.append(frame);
  const fallback = el("p", { class: "mute" });
  fallback.append(el("a", { href: "https://share.descript.com/view/XJIQMjM0Q1N", target: "_blank", rel: "noopener" }, [es ? "Abrir el vídeo" : "Open the video"]));
  player.append(fallback);
  split.append(player, firstSteps(lang));
  wrap.append(split);
  return wrap;
}

function firstSteps(lang) {
  const es = lang === "es";
  const ig = state.ig;
  const igDone = Boolean(ig && ig.status === "connected" && (!ig.business_id || ig.business_id === state.businessId));
  const reviewed = Boolean(state.settings && state.settings.onboarding_step === "live");
  const promptDone = Boolean(String(state.setterPrompt || "").trim());
  const tested = Boolean(state.setterTestedAt);
  const steps = [
    { id: "instagram", done: igDone, title: es ? "Conectar Instagram" : "Connect Instagram", action: es ? "Conectar" : "Connect", go: "instagram" },
    { id: "review", done: reviewed, title: es ? "Revisar tu negocio" : "Review your business", action: es ? "Revisar" : "Review", go: "sops" },
    { id: "prompt", done: promptDone, title: es ? "Configurar prompt y SOP" : "Set up prompt/SOP", action: es ? "Abrir" : "Open", go: "sops" },
    { id: "test", done: tested, title: es ? "Probar el chat" : "Test chat", action: es ? "Probar" : "Test", go: "sops" }
  ];
  const doneCount = steps.filter((step) => step.done).length;
  const active = steps.find((step) => !step.done) || null;
  const card = el("section", { class: "steps-card" });
  card.append(el("h3", { text: es ? "Primeros pasos" : "First steps" }));
  const bar = el("div", { class: "steps-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(steps.length), "aria-valuenow": String(doneCount) });
  const fill = el("span");
  fill.style.width = Math.round((doneCount / steps.length) * 100) + "%";
  bar.append(fill);
  card.append(bar);
  steps.forEach((step, index) => {
    const row = el("div", { class: "step" + (step.done ? " done" : "") + (active && active.id === step.id ? " active" : "") });
    row.append(el("span", { class: "step-mark", text: step.done ? "✓" : String(index + 1) }));
    const copy = el("div", { class: "step-copy" });
    copy.append(el("strong", { text: step.title }));
    if (active && active.id === step.id) copy.append(button(step.action, () => go(step.go)));
    row.append(copy);
    card.append(row);
  });
  return card;
}

function nextStepCard() {
  try { if (localStorage.getItem("roleflow.nextstep") === "hide") return null; } catch (_error) { /* private mode */ }
  const lang = language();
  const ig = state.ig;
  const connected = Boolean(ig && ig.status === "connected" && (!ig.business_id || ig.business_id === state.businessId));
  const step = state.settings && state.settings.onboarding_step;
  const needsBrief = Boolean(step && step !== "live");
  if (connected && !needsBrief) return null;
  const card = el("aside", { class: "next-card", id: "next-card" });
  const copy = el("div");
  copy.append(
    el("strong", { text: sectionText(lang, connected ? "nextBriefTitle" : "nextIgTitle") }),
    el("p", { text: sectionText(lang, connected ? "nextBriefBody" : "nextIgBody") })
  );
  const goNext = button(sectionText(lang, connected ? "nextBriefCta" : "nextIgCta"), () => go(connected ? "sops" : "instagram"));
  const hide = button(sectionText(lang, "nextHide"), () => {
    try { localStorage.setItem("roleflow.nextstep", "hide"); } catch (_error) { /* private mode */ }
    const node = document.getElementById("next-card");
    if (node) node.remove();
  });
  hide.classList.add("ghost");
  card.append(copy, el("div", { class: "filters" }, [goNext, hide]));
  return card;
}

function paintProfile() {
  const lang = document.getElementById("profile-language");
  const open = document.getElementById("profile-open");
  if (lang && document.activeElement !== lang) lang.value = language();
  const avatar = document.getElementById("profile-avatar");
  const business = state.businesses.find((row) => row.id === state.businessId);
  const name = business && business.agent_name ? business.agent_name : "Roleflow";
  const letter = name.trim().charAt(0).toUpperCase() || "R";
  if (avatar) avatar.textContent = letter;
  if (open) open.setAttribute("aria-label", "Account menu for " + name);
}

async function saveLanguage(value) {
  state.language = writeLanguage(safeStorage(), value);
  paint();
  if (!state.supabase || !state.user) return;
  try {
    await dashboardCall({ action: "save_language", language: state.language });
  } catch (error) {
    const saved = await state.supabase.from("acq_user_prefs").upsert({
      user_id: state.user.id,
      language: state.language,
      updated_at: new Date().toISOString()
    });
    if (saved.error && !missing(saved.error)) toast(error.message || saved.error.message, "bad");
  }
}

async function dashboardCall(body) {
  const { data, error } = await state.supabase.functions.invoke("client-dashboard", {
    body: { business_id: state.businessId, ...body }
  });
  if (error) throw new Error(error.message || "The dashboard could not save.");
  if (data && data.ok === false) throw new Error(data.error || "The dashboard could not save.");
  return data || {};
}

async function setAgent(key, enabled) {
  if (!state.canEdit) {
    toast("You can't edit this business.", "bad");
    return;
  }
  if (enabled && key === "setter") {
    const gate = gateSetter(state);
    if (!gate.ok) {
      toast(gate.error, "bad");
      return;
    }
  }
  if (enabled && !window.confirm(agentText(language()).confirm)) return;
  const next = (state.agentSwitches || []).filter((row) => row.agent_key !== key).concat([{ agent_key: key, enabled: enabled === true }]);
  if (!state.supabase) {
    state.agentSwitches = next;
    paint();
    return;
  }
  try {
    const saved = await dashboardCall({ action: "set_agent", agent_key: key, enabled: enabled === true });
    state.agentSwitches = next.map((row) => row.agent_key === key ? { agent_key: key, enabled: saved.enabled === true } : row);
    paint();
  } catch (error) {
    toast(error.message, "bad");
  }
}

function rememberPrompt(body, version, testedAt) {
  state.setterPrompt = body;
  state.setterDraft = body;
  if (testedAt !== undefined) state.setterTestedAt = testedAt;
  if (version) {
    state.promptVersions = [version].concat((state.promptVersions || []).filter((row) => row.id !== version.id && Number(row.version) !== Number(version.version)));
  }
}

async function saveSetterPrompt(value) {
  if (!state.canEdit) {
    toast("You can't edit this business.", "bad");
    return;
  }
  const body = String(value || "").trim();
  if (!state.supabase) {
    const versions = state.promptVersions || [];
    const latest = versions.reduce((max, row) => Math.max(max, Number(row.version) || 0), 0);
    const current = versions.find((row) => Number(row.version) === latest);
    if (!current || current.body !== body) {
      const version = { id: "local-" + (latest + 1), version: latest + 1, body, created_at: new Date().toISOString(), created_by: state.user && state.user.id };
      state.promptVersions = [version].concat(versions);
      state.setterTestedAt = null;
    }
    state.setterPrompt = body;
    toast(agentText(language()).saved);
    paint();
    return;
  }
  try {
    const saved = await dashboardCall({ action: "save_prompt", prompt: body });
    rememberPrompt(saved.prompt || body, saved.version, saved.tested_at);
    toast(agentText(language()).saved);
    paint();
  } catch (error) {
    toast(error.message, "bad");
  }
}

async function restoreSetterPrompt(version) {
  if (!state.canEdit || !version) return;
  if (!state.supabase) {
    await saveSetterPrompt(version.body);
    return;
  }
  try {
    const saved = await dashboardCall({ action: "restore_prompt", version_id: version.id });
    rememberPrompt(saved.prompt || version.body, saved.version, saved.tested_at);
    toast(agentText(language()).saved);
    paint();
  } catch (error) {
    toast(error.message, "bad");
  }
}

async function saveReplyDelay(min, max) {
  const problem = delayError(min, max);
  if (problem) {
    toast(problem, "bad");
    return;
  }
  const patch = {
    reply_delay_seconds: Number(min),
    reply_delay_max_seconds: Number(max)
  };
  if (!state.supabase) {
    state.settings = Object.assign({}, state.settings, patch);
    toast(agentText(language()).saved);
    return;
  }
  await patchSettings(patch);
}

async function saveBookingLink(value) {
  if (!state.canEdit) {
    toast("You can't edit this business.", "bad");
    return;
  }
  const link = String(value || "").trim();
  state.bookingLink = bookingLinkFor(link);
  if (state.settings) state.settings.booking_fallback_url = link;
  if (!state.supabase) {
    toast(agentText(language()).saved);
    return;
  }
  try {
    const saved = await dashboardCall({ action: "save_booking_link", booking_link: link });
    state.bookingLink = saved.booking_link || state.bookingLink;
    if (state.settings) state.settings.booking_fallback_url = link;
    toast(agentText(language()).saved);
  } catch (error) {
    toast(error.message, "bad");
  }
}

function previewToneUrl() {
  const rate = 8000;
  const count = 3200;
  const bytes = new Uint8Array(44 + count);
  const view = new DataView(bytes.buffer);
  bytes.set([82, 73, 70, 70], 0);
  view.setUint32(4, 36 + count, true);
  bytes.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  bytes.set([100, 97, 116, 97], 36);
  view.setUint32(40, count, true);
  for (let i = 0; i < count; i += 1) bytes[44 + i] = 128 + Math.round(28 * Math.sin((2 * Math.PI * 440 * i) / rate));
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

function ensureTrial() {
  if (!state.setterTrial) state.setterTrial = { scenario: "follower", messages: [] };
  return state.setterTrial;
}

function startTrial(scenario) {
  state.setterTrial = { scenario: scenario || "follower", messages: [] };
  paint();
}

function restartTrial() {
  const trial = ensureTrial();
  state.setterTrial = { scenario: trial.scenario || "follower", messages: [] };
  paint();
}

async function sendTrial(prompt, message) {
  const sample = String(message || "").trim();
  const body = String(prompt || "");
  if (!sample) return;
  state.setterDraft = body;
  state.setterPane = "chat";
  const delayMin = document.getElementById("reply-delay-min");
  const delayMax = document.getElementById("reply-delay-max");
  const minValue = delayMin ? delayMin.value : (state.settings && state.settings.reply_delay_seconds);
  const maxValue = delayMax ? delayMax.value : (state.settings && state.settings.reply_delay_max_seconds);
  const trial = ensureTrial();
  const history = (trial.messages || []).filter((item) => item.role === "user" || item.role === "assistant").map((item) => ({
    role: item.role,
    content: item.text || ""
  }));
  trial.messages = (trial.messages || []).concat([{ role: "user", text: sample }]);
  paint();
  let result;
  if (!state.supabase) {
    result = previewPracticeReply({
      prompt: body,
      history,
      inbound: sample,
      voices: state.voices || [],
      bookingLink: state.bookingLink,
      versions: state.promptVersions,
      testedAt: state.setterTestedAt,
      savedPrompt: state.setterPrompt
    });
  } else {
    try {
      result = await dashboardCall({
        action: "preview_setter",
        prompt: body,
        message: sample,
        messages: history,
        scenario: trial.scenario
      });
    } catch (error) {
      result = { ok: false, error: error.message };
    }
  }
  if (!result.ok) {
    const error = safeTrialError(result.error);
    trial.messages = trial.messages.concat([{ role: "assistant", error }]);
    toast(error, "bad");
    paint();
    return;
  }
  if (result.tested_at && body.trim() === String(state.setterPrompt || "").trim()) state.setterTestedAt = result.tested_at;
  const voices = [];
  for (const note of result.voices || []) {
    let playbackUrl = "";
    if (state.supabase && note.path) {
      const signed = await state.supabase.storage.from("acq-voice").createSignedUrl(note.path, 3600);
      playbackUrl = signed.data && signed.data.signedUrl ? signed.data.signedUrl : "";
    } else if (!state.supabase) {
      playbackUrl = previewToneUrl();
    }
    voices.push({ ...note, playbackUrl });
  }
  const label = result.version && result.version.draft
    ? "Unsaved draft" + (result.version.version ? ", after version " + result.version.version : "")
    : "Version " + ((result.version && result.version.version) || 1);
  const waited = practiceDelaySeconds(minValue, maxValue, state.practiceSimulateDelay === true, Math.random);
  if (waited > 0) await new Promise((resolve) => setTimeout(resolve, waited * 1000));
  trial.messages = trial.messages.concat([{
    role: "assistant",
    text: result.reply || "",
    voices,
    modelLine: trialModelLine(result),
    versionLabel: label,
    prompt: result.prompt || body,
    delayLine: waited > 0 ? "Waited " + waited + " seconds." : "Delay skipped."
  }]);
  paint();
}

function previewPracticeReply(input) {
  const body = String(input.prompt || "");
  if (!body.trim()) return { ok: false, error: "Save a system prompt first." };
  const catalog = voiceCatalog(input.voices || []);
  const prior = (input.history || []).filter((item) => item.role === "user").length;
  const voice = (body.match(/\{\{\s*voice\s*:\s*[a-z0-9_-]+\s*\}\}/i) || [""])[0];
  const booking = /\{\{\s*booking_link\s*\}\}/i.test(body) ? "{{booking_link}}" : "";
  let text = "Hey. What are you working on right now?";
  if (prior === 1) text = "That helps. What do you want to change first?";
  if (prior >= 2) text = ["We can look at that together.", voice, booking].filter(Boolean).join(" ");
  const resolved = resolveOutgoing(text, { voices: catalog, bookingLink: input.bookingLink });
  return {
    ok: true,
    reply: resolved.text,
    voices: resolved.voices,
    provider: "gemini",
    provider_label: "Google Gemini",
    model: "gemini-3-flash-preview",
    key_source: "platform",
    version: promptVersionLabel(input.versions, body),
    prompt: body,
    sent: false,
    tested_at: body === input.savedPrompt ? new Date().toISOString() : input.testedAt
  };
}

function trialModelLine(result) {
  if (!result || !result.model) return "";
  const provider = result.provider_label || result.provider || "Model";
  const key = result.key_source === "business" ? "Business key" : "Platform key";
  return provider + " · " + result.model + " · " + key;
}

function safeTrialError(message) {
  const text = String(message || "")
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "")
    .replace(/xai-[A-Za-z0-9_-]{6,}/g, "")
    .replace(/Bearer\s+\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || "The model did not answer.";
}

function addCommentRule() {
  state.commentVoiceRules = (state.commentVoiceRules || []).concat([{ id: "new-" + Date.now(), keywords: [], intent: "", message: "", clip_id: "" }]);
  paint();
}

async function saveCommentVoice(input) {
  if (!state.canEdit) {
    toast("You can't edit this business.", "bad");
    return;
  }
  const dailyCap = Number(input && input.dailyCap) || 30;
  const rules = input && input.rules || [];
  if (!state.supabase) {
    state.commentVoiceCap = dailyCap;
    state.commentVoiceRules = rules;
    toast(agentText(language()).saved);
    paint();
    return;
  }
  try {
    const saved = await dashboardCall({ action: "save_comment_voice", daily_cap: dailyCap, rules });
    state.commentVoiceCap = saved.daily_cap || dailyCap;
    state.commentVoiceRules = saved.rules || [];
    toast(agentText(language()).saved);
    paint();
  } catch (error) {
    toast(error.message, "bad");
  }
}

async function trySetter(prompt, message, logEl) {
  const body = String(prompt || "").trim();
  const sample = String(message || "").trim();
  if (logEl && sample) logEl.append(el("p", { class: "me", text: sample }));
  let result;
  if (!state.supabase) result = localTry(body, sample);
  else {
    try {
      result = await dashboardCall({ action: "preview_setter", prompt: body, message: sample });
    } catch (error) {
      result = { ok: false, error: error.message };
    }
  }
  if (!result.ok) {
    toast(result.error || "The tryout did not run.", "bad");
    if (logEl && result.error) logEl.append(el("p", { text: result.error }));
    return;
  }
  state.setterPrompt = body;
  state.setterTestedAt = result.tested_at || new Date().toISOString();
  if (logEl) logEl.append(el("p", { text: result.reply }));
  toast("Tried. Nothing was sent.");
}

async function saveFollowupPolicy(policy) {
  if (!state.canEdit) {
    toast("You can't edit this business.", "bad");
    return;
  }
  state.followupPolicy = policy;
  if (!state.supabase) {
    toast(agentText(language()).saved);
    return;
  }
  try {
    const saved = await dashboardCall({ action: "save_policy", policy });
    state.followupPolicy = saved.policy || policy;
    toast(agentText(language()).saved);
  } catch (error) {
    toast(error.message, "bad");
  }
}

function armRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = 0;
  }
  if (state.tab !== "opportunities" || !state.supabase || !state.businessId || state.businessId === "preview") return;
  state.refreshTimer = setInterval(() => {
    if (document.hidden || state.tab !== "opportunities") return;
    if (document.querySelector(".crm-filters[data-dirty='1']")) return;
    if (state.studio && state.studio.open) return;
    const active = document.activeElement;
    if (active && active.closest && active.closest("#app input, #app textarea, #app select")) return;
    bootBusiness(state.businessId, { quiet: true });
  }, 22000);
}

function readyToSave() {
  return Boolean(state.supabase && state.businessId && state.businessId !== "preview");
}

async function saveBrief(fields, cards, note) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const count = charCount(fields, cards);
  if (count > MAX_CHARS) return toast("Shorten the text before saving.", "bad");
  const brief = await state.supabase.from("acq_business_briefs").upsert({
    business_id: state.businessId,
    fields,
    updated_at: new Date().toISOString(),
    updated_by: state.user && state.user.id
  });
  if (brief.error) return toast(brief.error.message, "bad");
  const keep = new Set((cards || []).map((card) => card.role));
  for (const card of state.agentCards || []) {
    if (!keep.has(card.role)) {
      const removed = await state.supabase.from("acq_agent_cards").delete().eq("id", card.id).eq("business_id", state.businessId);
      if (removed.error) return toast(removed.error.message, "bad");
    }
  }
  if (cards && cards.length) {
    const saved = await state.supabase.from("acq_agent_cards").upsert(cards.map((card) => ({
      business_id: state.businessId,
      role: card.role,
      name: card.name || "",
      instructions: card.instructions || "",
      delegations: card.delegations || [],
      updated_at: new Date().toISOString()
    })), { onConflict: "business_id,role" });
    if (saved.error) return toast(saved.error.message, "bad");
  }
  const version = await state.supabase.from("acq_brief_versions").insert({
    business_id: state.businessId,
    fields,
    cards: cards || [],
    char_count: count,
    note: note || "Saved",
    created_by: state.user && state.user.id
  });
  if (version.error) return toast(version.error.message, "bad");
  toast("Business saved.");
  state.studioScore = null;
  if (state.studio) state.studio.proposal = null;
  await bootBusiness(state.businessId, { quiet: true });
  await requestSetterSync("push");
}

async function saveAgent(card) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const saved = await state.supabase.from("acq_agent_cards").upsert({
    business_id: state.businessId,
    role: card.role,
    name: card.name || "",
    instructions: card.instructions || "",
    delegations: card.delegations || [],
    updated_at: new Date().toISOString()
  }, { onConflict: "business_id,role" });
  if (saved.error) return toast(saved.error.message, "bad");
  const fields = (state.brief && state.brief.fields) || {};
  const next = (state.agentCards || []).filter((item) => item.role !== card.role).concat([card]);
  const version = await state.supabase.from("acq_brief_versions").insert({
    business_id: state.businessId,
    fields,
    cards: next,
    char_count: charCount(fields, next),
    note: "Agent settings",
    created_by: state.user && state.user.id
  });
  if (version.error) return toast(version.error.message, "bad");
  toast("Agent saved.");
  await bootBusiness(state.businessId, { quiet: true });
}

async function restoreBrief(id) {
  const version = (state.briefVersions || []).find((row) => row.id === id);
  if (!version) return toast("That version is not loaded.", "bad");
  await saveBrief(version.fields || {}, Array.isArray(version.cards) ? version.cards : [], "Restored");
}

async function callStudio(action, extra) {
  if (!readyToSave()) {
    toast("Sign in to use the model.", "bad");
    return null;
  }
  const invoked = await state.supabase.functions.invoke("roleflow-studio", {
    body: { action, business_id: state.businessId, ...extra }
  });
  if (invoked.error) {
    let message = invoked.error.message || "The model did not answer.";
    if (invoked.error.context && typeof invoked.error.context.json === "function") {
      const body = await invoked.error.context.json().catch(() => null);
      if (body && body.error) message = String(body.error);
    }
    toast(message, "bad");
    return null;
  }
  if (invoked.data && invoked.data.error) {
    toast(String(invoked.data.error), "bad");
    return null;
  }
  return invoked.data;
}

async function scoreWithModel(fields) {
  const data = await callStudio("score", { fields });
  if (!data) return;
  state.studioScore = { score: Number(data.score), items: Array.isArray(data.items) ? data.items : [] };
  paint();
}

async function fixWithModel(fields, items) {
  const data = await callStudio("fix", { fields, items });
  if (!data || !data.fields) return;
  if (!state.studio) state.studio = {};
  state.studio.proposal = { fields: data.fields };
  paint();
}

async function editWithModel(fields, instruction) {
  const data = await callStudio("edit", { fields, instruction });
  if (!data || !data.fields) return;
  if (!state.studio) state.studio = {};
  state.studio.proposal = { fields: data.fields };
  paint();
}

async function simulateThread(sim) {
  const version = (state.briefVersions || []).find((row) => row.id === sim.version);
  const fields = version && version.fields ? version.fields : ((state.brief && state.brief.fields) || {});
  const data = await callStudio("simulate", {
    fields,
    as: sim.as,
    lead_state: sim.state,
    lines: (sim.lines || []).slice(-12)
  });
  if (data && data.reply) sim.lines.push({ role: "assistant", text: String(data.reply) });
  paint();
}

async function saveLead(lead, patch) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const table = lead.kind === "contact" ? "acq_contacts" : "acq_targets";
  const saved = await state.supabase.from(table).update({
    crm_state: patch.crm_state,
    assigned_agent: patch.assigned_agent || "",
    ai_enabled: patch.ai_enabled !== false,
    tags: patch.tags || []
  }).eq("id", lead.id);
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Lead saved.");
    await bootBusiness(state.businessId, { quiet: true });
    await requestSetterSync("push");
  }
}

async function addLeadNote(lead, body) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const text = String(body || "").trim();
  if (!text) return toast("Write a note first.", "bad");
  const saved = await state.supabase.from("acq_lead_notes").insert({
    business_id: state.businessId,
    contact_id: lead.kind === "contact" ? lead.id : null,
    target_id: lead.kind === "target" ? lead.id : null,
    body: text,
    created_by: state.user && state.user.id
  });
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Note saved.");
    await bootBusiness(state.businessId, { quiet: true });
  }
}

async function queueMessage(lead, body, sendAt) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const text = String(body || "").trim();
  if (!text) return toast("Write the message first.", "bad");
  const saved = await state.supabase.from("acq_message_queue").insert({
    business_id: state.businessId,
    contact_id: lead.kind === "contact" ? lead.id : null,
    target_id: lead.kind === "target" ? lead.id : null,
    body: text,
    status: "pending",
    send_at: sendAt || null
  });
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Queued. Nothing is sent.");
    await bootBusiness(state.businessId, { quiet: true });
  }
}

async function cancelQueued(id) {
  if (!readyToSave()) return;
  const saved = await state.supabase.from("acq_message_queue").update({ status: "cancelled" }).eq("id", id).eq("business_id", state.businessId);
  if (saved.error) toast(saved.error.message, "bad");
  else await bootBusiness(state.businessId, { quiet: true });
}

async function saveOfferLink(row) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const saved = await state.supabase.from("acq_offer_links").insert({ ...row, business_id: state.businessId });
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Link saved.");
    await bootBusiness(state.businessId, { quiet: true });
  }
}

async function saveSchedule(row) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const apiKey = String(row.apiKey || "");
  const saved = await state.supabase.from("acq_schedule_endpoints").insert({
    business_id: state.businessId,
    provider: row.provider,
    name: row.name || "",
    availability_url: row.availability_url || "",
    booking_url: row.booking_url || "",
    condition: row.condition || ""
  }).select("id").single();
  if (saved.error) return toast(saved.error.message, "bad");
  if (apiKey.trim()) {
    const secret = await state.supabase.rpc("acq_set_schedule_secret", { p_endpoint: saved.data.id, p_key: apiKey.trim() });
    if (secret.error) return toast(secret.error.message, "bad");
  }
  toast("Endpoint saved.");
  await bootBusiness(state.businessId, { quiet: true });
}

async function saveAsset(row) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  let storagePath = "";
  if (row.file) {
    const safe = String(row.file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    storagePath = state.businessId + "/" + crypto.randomUUID() + "/" + safe;
    const uploaded = await state.supabase.storage.from("acq-value").upload(storagePath, row.file, { upsert: false });
    if (uploaded.error) return toast(uploaded.error.message, "bad");
  }
  const saved = await state.supabase.from("acq_value_assets").insert({
    business_id: state.businessId,
    kind: row.kind,
    title: row.title || "",
    url: row.url || "",
    label: row.label || "",
    storage_path: storagePath,
    send_instructions: row.send_instructions || "",
    placement: row.placement || "ai",
    agent_roles: row.agent_roles || []
  });
  if (saved.error) {
    if (storagePath) await state.supabase.storage.from("acq-value").remove([storagePath]);
    return toast(saved.error.message, "bad");
  }
  toast("Content saved.");
  await bootBusiness(state.businessId, { quiet: true });
}

async function saveFollowupOptions(patch) {
  await patchSettings(patch);
}

async function saveFollowupStep(row) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const saved = await state.supabase.from("acq_followup_steps").insert({ ...row, business_id: state.businessId });
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Step saved.");
    await bootBusiness(state.businessId, { quiet: true });
  }
}

async function saveWelcomeStep(row) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const saved = await state.supabase.from("acq_welcome_steps").insert({ ...row, business_id: state.businessId });
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Welcome message saved.");
    await bootBusiness(state.businessId, { quiet: true });
  }
}

async function saveManualFollowup(row) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const saved = await state.supabase.from("acq_manual_followups").insert({
    business_id: state.businessId,
    body: row.body,
    status: "pending"
  });
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Draft saved. Nothing is sent.");
    await bootBusiness(state.businessId, { quiet: true });
  }
}

async function markFollowupSent(id) {
  if (!readyToSave()) return;
  const saved = await state.supabase.from("acq_manual_followups").update({ status: "sent_by_human" }).eq("id", id).eq("business_id", state.businessId);
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Marked sent by you. The lead was not messaged from here.");
    await bootBusiness(state.businessId, { quiet: true });
  }
}

async function draftManualFollowup() {
  const data = await callStudio("draft", {
    fields: (state.brief && state.brief.fields) || {},
    lines: [{ role: "user", text: "Draft a short follow-up a person will send within 7 days." }]
  });
  if (data && data.reply) await saveManualFollowup({ body: String(data.reply) });
}

async function saveReminder(row) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const saved = await state.supabase.from("acq_reminders").insert({ ...row, business_id: state.businessId, status: "open" });
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Reminder saved.");
    await bootBusiness(state.businessId, { quiet: true });
  }
}

async function finishReminder(id) {
  if (!readyToSave()) return;
  const saved = await state.supabase.from("acq_reminders").update({ status: "done" }).eq("id", id).eq("business_id", state.businessId);
  if (saved.error) toast(saved.error.message, "bad");
  else await bootBusiness(state.businessId, { quiet: true });
}

async function saveCommentCta(row) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const saved = await state.supabase.from("acq_comment_ctas").insert({ ...row, business_id: state.businessId });
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Keyword saved.");
    await bootBusiness(state.businessId, { quiet: true });
  }
}

async function saveStoryCta(row) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const saved = await state.supabase.from("acq_story_ctas").insert({ ...row, business_id: state.businessId });
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Story keyword saved.");
    await bootBusiness(state.businessId, { quiet: true });
  }
}

async function deleteFlowRow(table, id) {
  const allowed = new Set(["acq_followup_steps", "acq_welcome_steps", "acq_comment_ctas", "acq_story_ctas"]);
  if (!allowed.has(table) || !readyToSave()) return;
  const saved = await state.supabase.from(table).delete().eq("id", id).eq("business_id", state.businessId);
  if (saved.error) toast(saved.error.message, "bad");
  else await bootBusiness(state.businessId, { quiet: true });
}

async function sendInboxReply(lead, text) {
  const body = String(text || "").trim();
  if (!body) return toast("Write a reply first.", "bad");
  if (!lead || lead.kind !== "contact") return toast("This chat has no Instagram thread yet.", "bad");
  if (!readyToSave()) {
    state.chatDraft = body;
    toast("Preview only. Nothing was sent.");
    paint();
    return;
  }
  const invoked = await state.supabase.functions.invoke("inbox-reply", {
    body: { business_id: state.businessId, contact_id: lead.id, text: body }
  });
  const payload = invoked.data || {};
  if (invoked.error || payload.ok !== true) return toast(payload.error || "The reply was not sent.", "bad");
  state.chatDraft = "";
  toast("Reply sent.");
  await bootBusiness(state.businessId, { quiet: true });
}

async function draftReply(lead, messages) {
  const data = await callStudio("draft", {
    fields: (state.brief && state.brief.fields) || {},
    lines: messages || [],
    lead_state: lead && lead.state
  });
  if (data && data.reply) {
    state.chatDraft = String(data.reply);
    paint();
  }
}

async function deleteRow(table, id) {
  if (!readyToSave()) return;
  if (table !== "acq_offer_links" && table !== "acq_value_assets") return;
  if (table === "acq_value_assets") {
    const asset = (state.valueAssets || []).find((row) => row.id === id);
    if (asset && asset.storage_path) await state.supabase.storage.from("acq-value").remove([asset.storage_path]);
  }
  const saved = await state.supabase.from(table).delete().eq("id", id).eq("business_id", state.businessId);
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Removed.");
    await bootBusiness(state.businessId, { quiet: true });
  }
}

async function saveAgentPrompt(role, body, note) {
  if (!readyToSave()) {
    toast("This preview does not save.", "bad");
    return false;
  }
  const text = String(body || "");
  if (!text.trim()) {
    toast("Write a prompt before saving.", "bad");
    return false;
  }
  if (text.length > MAX_CHARS) {
    toast("Shorten the prompt before saving.", "bad");
    return false;
  }
  const saved = await state.supabase.from("agent_prompts").insert({
    business_id: state.businessId,
    agent_role: role,
    body: text,
    note: note || "",
    char_count: text.length,
    score: scorePrompt(text).score
  });
  if (saved.error) {
    toast(saved.error.message, "bad");
    return false;
  }
  toast("Prompt saved.");
  await bootBusiness(state.businessId, { quiet: true });
  return true;
}

async function restoreAgentPrompt(role, body) {
  return saveAgentPrompt(role, body, "Restored");
}

async function scoreAgentPrompt(role, text) {
  const data = await callStudio("score", { fields: {}, prompt: text });
  if (!data) return;
  state.agentPromptScore = Object.assign({}, state.agentPromptScore, {
    [role]: { score: Number(data.score), items: Array.isArray(data.items) ? data.items : [] }
  });
  paint();
}

async function saveRoutine(row) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const payload = {
    business_id: state.businessId,
    agent_role: row.agent_role,
    name: String(row.name || "").trim(),
    cron: String(row.cron || "").trim(),
    timezone: String(row.timezone || "").trim(),
    enabled: row.enabled !== false,
    instructions: String(row.instructions || ""),
    updated_at: new Date().toISOString()
  };
  const saved = row.id
    ? await state.supabase.from("agent_routines").update(payload).eq("id", row.id).eq("business_id", state.businessId)
    : await state.supabase.from("agent_routines").insert(payload);
  if (saved.error) {
    toast(saved.error.message, "bad");
    return false;
  }
  toast("Routine saved.");
  await bootBusiness(state.businessId, { quiet: true });
  return true;
}

async function setRoutineEnabled(row, enabled) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const saved = await state.supabase.from("agent_routines").update({ enabled: Boolean(enabled), updated_at: new Date().toISOString() }).eq("id", row.id).eq("business_id", state.businessId);
  if (saved.error) toast(saved.error.message, "bad");
  else await bootBusiness(state.businessId, { quiet: true });
}

async function setAutoApprove(role, enabled) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const saved = await state.supabase.from("agent_settings").upsert({
    business_id: state.businessId,
    agent_role: role,
    auto_approve: Boolean(enabled),
    updated_at: new Date().toISOString()
  }, { onConflict: "business_id,agent_role" });
  if (saved.error) toast(saved.error.message, "bad");
  else await bootBusiness(state.businessId, { quiet: true });
}

async function approveAction(row) {
  return decideAction(row, "approved");
}

async function rejectAction(row) {
  return decideAction(row, "rejected");
}

async function decideAction(row, status) {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const saved = await state.supabase.from("agent_actions").update({ status }).eq("id", row.id).eq("business_id", state.businessId).eq("status", "proposed");
  if (saved.error) toast(saved.error.message, "bad");
  else await bootBusiness(state.businessId, { quiet: true });
}

async function requestSetterSync(direction) {
  if (!state.settings || state.settings.studio_setter_sync !== true || !readyToSave()) return;
  const invoked = await state.supabase.functions.invoke("roleflow-setter-sync", {
    body: { action: direction || "push", business_id: state.businessId }
  });
  if (invoked.error) toast("Sync did not finish.", "bad");
}

async function syncSetter() {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const pushed = await state.supabase.functions.invoke("roleflow-setter-sync", {
    body: { action: "push", business_id: state.businessId }
  });
  const pulled = await state.supabase.functions.invoke("roleflow-setter-sync", {
    body: { action: "pull", business_id: state.businessId }
  });
  if (pushed.error || pulled.error) toast("Sync did not finish.", "bad");
  else if ((pushed.data && pushed.data.result) === "skipped") toast("Sync is off. Nothing was sent.");
  else toast("Sync finished.");
  await bootBusiness(state.businessId, { quiet: true });
}

async function saveLlm(patch, secrets) {
  const checked = previewKeys(state.llmKeys, secrets);
  if (!checked.ok) return toast(checked.error, "bad");
  if (!readyToSave()) {
    state.llmKeys = checked.hints;
    if (patch) state.settings = { ...(state.settings || {}), ...patch };
    toast("Saved. Only the last 4 characters stay on this page.");
    paint();
    return;
  }
  const saved = await state.supabase.from("acq_settings").update(patch).eq("agent_id", state.businessId);
  if (saved.error) return toast(saved.error.message, "bad");
  for (const secret of secrets || []) {
    if (!secret) continue;
    if (secret.clear) {
      const cleared = await state.supabase.rpc("acq_llm_clear_key", { p_business: state.businessId, p_provider: secret.provider });
      if (cleared.error) return toast("The key was not removed.", "bad");
      continue;
    }
    if (!secret.apiKey) continue;
    const stored = await state.supabase.rpc("acq_llm_save_key", {
      p_business: state.businessId,
      p_provider: secret.provider,
      p_key: secret.apiKey,
      p_base_url: secret.baseUrl || ""
    });
    if (stored.error || !stored.data || stored.data.ok !== true) return toast("The key was not saved.", "bad");
  }
  toast("Saved.");
  await bootBusiness(state.businessId);
}

async function testLlm(body) {
  const typed = String(body && body.api_key || "").trim();
  if (typed && (typed.length < 8 || typed.length > 400)) return failLlm("That key is not a usable length.");
  if (!state.supabase) {
    if (!typed && !keyHint(state.llmKeys, body && body.provider)) return failLlm("No key is saved for that provider.");
    return failLlm("This preview does not call a model.");
  }
  const invoked = await state.supabase.functions.invoke("llm-check", {
    body: { ...body, business_id: state.businessId }
  });
  const data = invoked.data || {};
  if (invoked.error || data.ok === false) return failLlm(data.error || "The connection did not answer.");
  toast("OK");
  return "OK";
}

function failLlm(message) {
  toast(message, "bad");
  return message;
}

async function saveOwnerClip(file, meta) {
  if (!readyToSave()) return;
  if (!file) return toast("Choose a file.", "bad");
  let prepared;
  try {
    prepared = await prepareOwnerFile(file);
  } catch (error) {
    return toast(error.message || "This file could not be prepared.", "bad");
  }
  if (prepared.blob.size > 4500000) return toast("Keep the recording under 4.5 MB so it can be sent.", "bad");
  const id = crypto.randomUUID();
  const ext = prepared.mime.includes("wav") ? "wav" : prepared.mime.includes("png") ? "png" : prepared.mime.includes("jpeg") ? "jpg" : prepared.kind === "video" ? "mp4" : "m4a";
  const path = state.businessId + "/" + id + "." + ext;
  const uploaded = await state.supabase.storage.from("owner-clips").upload(path, prepared.blob, { contentType: prepared.mime, upsert: false });
  if (uploaded.error) return toast(uploaded.error.message, "bad");
  const saved = await state.supabase.from("acq_owner_clips").insert({
    id,
    business_id: state.businessId,
    label: String(meta.label || "").trim().slice(0, 120),
    when_to_use: String(meta.when || "").trim().slice(0, 500),
    kind: prepared.kind,
    storage_path: path,
    mime_type: prepared.mime,
    delivery_path: path,
    delivery_mime: prepared.mime,
    byte_size: prepared.blob.size,
    active: true,
    speech_provider: "recording",
    created_by: state.user.id
  });
  if (saved.error) {
    await state.supabase.storage.from("owner-clips").remove([path]);
    return toast(saved.error.message, "bad");
  }
  toast(prepared.converted ? "Recording saved as a voice note Instagram can play." : "Recording saved.");
  await bootBusiness(state.businessId);
}

async function deleteOwnerClip(clip) {
  if (!clip) return;
  await state.supabase.storage.from("owner-clips").remove([clip.storage_path]);
  const saved = await state.supabase.from("acq_owner_clips").delete().eq("id", clip.id).eq("business_id", state.businessId);
  if (saved.error) return toast(saved.error.message, "bad");
  toast("Recording removed.");
  await bootBusiness(state.businessId);
}

async function signClip(path) {
  if (!state.supabase || !path) return "";
  const signed = await state.supabase.storage.from("owner-clips").createSignedUrl(path, 3600);
  return signed.data && signed.data.signedUrl ? signed.data.signedUrl : "";
}

async function patchSettings(patch, enginePayload) {
  const saved = await state.supabase.from("acq_settings").update(patch).eq("agent_id", state.businessId);
  if (saved.error) {
    toast(saved.error.message, "bad");
    return;
  }
  try {
    if (usesEngine() && Object.prototype.hasOwnProperty.call(patch, "system_enabled")) {
      await enqueueEngine(patch.system_enabled ? "resume_agent" : "pause_agent", {
        scope: "setter",
        system_enabled: patch.system_enabled === true
      });
      toast("Syncing");
    } else if (enginePayload && usesEngine()) {
      await enqueueEngine("update_settings", enginePayload);
      toast("Syncing…");
    } else toast("Saved.");
  } catch (error) {
    toast(error.message, "bad");
  }
  await bootBusiness(state.businessId);
}

async function importDnc() {
  if (!readyToSave()) return toast("This preview does not save.", "bad");
  const invoked = await state.supabase.functions.invoke("roleflow-setter-sync", {
    body: { action: "import_dnc", business_id: state.businessId }
  });
  if (invoked.error || !invoked.data || invoked.data.ok === false) return toast("The do-not-contact list did not import.", "bad");
  if (invoked.data.result === "skipped") return toast(invoked.data.detail || "Nothing was imported.");
  toast((invoked.data.imported || 0) + " handles imported.");
  await bootBusiness(state.businessId, { quiet: true });
}

async function ignoreHandles(handles) {
  if (!readyToSave()) return;
  const existing = new Set((state.dnc || []).map((row) => row.handle));
  const rows = handles.filter((handle) => !existing.has(handle)).map((handle) => ({ business_id: state.businessId, handle, reason: "Ignored in configuration" }));
  const saved = rows.length ? await state.supabase.from("acq_dnc").insert(rows) : { error: null };
  if (saved.error) toast(saved.error.message, "bad");
  else toast("Saved.");
  await bootBusiness(state.businessId);
}

async function saveStateRule(row) {
  if (!readyToSave()) return;
  const saved = await state.supabase.from("acq_state_rules").upsert({
    business_id: state.businessId,
    crm_state: row.crm_state,
    condition: row.condition || ""
  }, { onConflict: "business_id,crm_state" });
  if (saved.error) toast(saved.error.message, "bad");
  else toast("Saved.");
  await bootBusiness(state.businessId, { quiet: true });
}

async function saveTagRule(row) {
  if (!readyToSave()) return;
  const saved = await state.supabase.from("acq_tag_rules").insert({
    business_id: state.businessId,
    name: row.name.trim(),
    rule_kind: row.rule_kind,
    rule_text: String(row.rule_text || "").slice(0, 400),
    notify_email: row.notify_email || ""
  });
  if (saved.error) toast(saved.error.message, "bad");
  else toast("Tag saved.");
  await bootBusiness(state.businessId, { quiet: true });
}

async function saveWebhook(row) {
  if (!readyToSave()) return;
  if (row.id) {
    const saved = await state.supabase.from("acq_webhooks").update({ paused: row.paused }).eq("id", row.id).eq("business_id", state.businessId);
    if (saved.error) toast(saved.error.message, "bad");
    else toast(row.paused ? "Paused." : "Resumed.");
    await bootBusiness(state.businessId, { quiet: true });
    return;
  }
  const saved = await state.supabase.from("acq_webhooks").insert({
    business_id: state.businessId,
    url: row.url,
    events: row.events
  }).select("id").single();
  if (saved.error) {
    toast(saved.error.message, "bad");
    return;
  }
  if (row.secret) {
    const secret = await state.supabase.rpc("acq_set_webhook_secret", { p_webhook: saved.data.id, p_secret: row.secret });
    if (secret.error) toast(secret.error.message, "bad");
  }
  toast("Webhook saved.");
  await bootBusiness(state.businessId, { quiet: true });
}

async function testWebhook(id) {
  if (!readyToSave()) return;
  const { data, error } = await state.supabase.functions.invoke("roleflow-hooks", { body: { action: "test", webhook_id: id } });
  if (error) toast(error.message, "bad");
  else if (data && data.error) toast(String(data.error), "bad");
  else toast("Test sent" + (data && data.status ? " · " + data.status : "") + ".");
}

async function createApiKey(label) {
  if (!readyToSave()) return;
  const saved = await state.supabase.rpc("acq_create_api_key", { p_business: state.businessId, p_label: label });
  if (saved.error) {
    toast(saved.error.message, "bad");
    return;
  }
  const token = saved.data && saved.data.token ? saved.data.token : "";
  toast("Key created. Copy it now.");
  await bootBusiness(state.businessId, { quiet: true });
  state.revealedKey = token;
  paint();
}

async function revokeApiKey(id) {
  if (!readyToSave()) return;
  const saved = await state.supabase.from("acq_api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("business_id", state.businessId);
  if (saved.error) toast(saved.error.message, "bad");
  else toast("Key revoked.");
  await bootBusiness(state.businessId, { quiet: true });
}

async function cloneBusiness(name) {
  if (!readyToSave()) return;
  const saved = await state.supabase.rpc("acq_clone_business", { p_source: state.businessId, p_name: name });
  if (saved.error) {
    toast(saved.error.message, "bad");
    return;
  }
  const id = saved.data && saved.data.business_id;
  toast("Business cloned. The AI is off on the copy.");
  if (id) {
    const url = new URL(location.href);
    url.searchParams.set("business", id);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    await boot();
  }
}

async function createInvite(row) {
  if (!readyToSave()) return;
  const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
  const saved = await state.supabase.from("acq_invites").insert({
    business_id: state.businessId,
    email: row.email.toLowerCase(),
    scopes: row.scopes,
    token
  });
  if (saved.error) {
    toast(saved.error.message, "bad");
    return;
  }
  await state.supabase.from("acq_notifications").insert({
    business_id: state.businessId,
    title: "Invite created",
    body: row.email + " can open " + row.scopes.join(", ") + "."
  });
  const mailed = await state.supabase.functions.invoke("roleflow-hooks", {
    body: { action: "invite", email: row.email, token, business_id: state.businessId }
  });
  const mailedError = mailed.data && mailed.data.error;
  toast(mailedError ? "Invite saved. " + mailedError : "Invite saved.");
  await bootBusiness(state.businessId, { quiet: true });
}

async function regenerateJoin() {
  if (!readyToSave()) return;
  const saved = await state.supabase.rpc("acq_regenerate_join_code", { p_business: state.businessId });
  if (saved.error) toast(saved.error.message, "bad");
  else {
    const code = saved.data && saved.data.join_code;
    const business = state.businesses.find((item) => item.id === state.businessId);
    if (business && code) business.join_code = code;
    toast("Invite link regenerated.");
    paint();
  }
}

async function saveOrigin(row) {
  if (!readyToSave()) return;
  const name = String(row.name || "").trim();
  const keyword = String(row.keyword || "").trim();
  if (!name || !keyword || name.length > 40 || keyword.length > 40) {
    toast("Name and keyword stay within 40 characters.", "bad");
    return;
  }
  const saved = await state.supabase.from("acq_origins").insert({ business_id: state.businessId, name, keyword });
  if (saved.error) toast(saved.error.message, "bad");
  else toast("Origin saved.");
  await bootBusiness(state.businessId, { quiet: true });
}

async function markNotification(id) {
  if (!state.supabase || !state.businessId) return;
  await state.supabase.from("acq_notifications").update({ read_at: new Date().toISOString() }).eq("id", id).eq("business_id", state.businessId);
  const row = (state.notifications || []).find((item) => item.id === id);
  if (row) row.read_at = new Date().toISOString();
  paintChrome(pageUi());
}

async function applyProposal(proposal) {
  if (!proposal || !readyToSave()) return;
  if (proposal.type === "setting") {
    await patchSettings(proposal.patch);
    return;
  }
  if (proposal.type === "lead") {
    const contact = (state.contacts || []).find((row) => String(row.ig_handle || "").replace(/^@/, "").toLowerCase() === proposal.handle);
    const target = (state.targets || []).find((row) => String(row.handle || "") === proposal.handle);
    const table = contact ? "acq_contacts" : "acq_targets";
    const id = contact ? contact.id : target && target.id;
    if (!id) {
      toast("No lead with that handle is stored here.", "bad");
      return;
    }
    const column = "crm_state";
    const saved = await state.supabase.from(table).update({ [column]: proposal.crm_state.toLowerCase() }).eq("id", id);
    if (saved.error) toast(saved.error.message, "bad");
    else toast("Lead updated.");
    await bootBusiness(state.businessId, { quiet: true });
  }
}

function agentsHome() {
  const wrap = el("div", { class: "acq" });
  wrap.append(el("p", { class: "roster-note", text: "These are the agents this business is running. Status, today's count, and the last activity come from this workspace." }));
  wrap.append(implementedAgents());
  return wrap;
}

function settingsHome() {
  const wrap = el("div", { class: "acq" });
  wrap.append(el("p", { class: "roster-note", text: "Instagram, the setter link, the worker key, and billing for this business." }));
  const integrations = el("div");
  const billing = el("div");
  wrap.append(integrations, billing);
  renderEngine("integrations", integrations, engineCtx());
  renderEngine("billing", billing, engineCtx());
  const more = el("div", { class: "filters" });
  more.append(el("a", { class: "btn sm", href: "#controls" }, ["Daily cap and rules"]));
  more.append(el("a", { class: "btn sm ghost", href: "#voice" }, ["Voice notes"]));
  more.append(el("a", { class: "btn sm ghost", href: "#prompts" }, ["Setter prompts"]));
  wrap.append(more);
  return wrap;
}

function leadSnapshot() {
  const counts = { cold: 0, warm: 0, hot: 0, converted: 0 };
  const contacts = state.contacts || [];
  const rows = contacts.length ? contacts : state.targets;
  rows.forEach((row) => {
    if (row.is_converted === true || row.lead_status === "converted") counts.converted += 1;
    else if (counts[row.lead_status] != null) counts[row.lead_status] += 1;
  });
  return counts;
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
  const leads = el("div", { class: "filters", role: "toolbar", "aria-label": "Lead status" });
  ["all", "cold", "warm", "hot", "converted", "dead"].forEach((status) => {
    const chip = el("button", { type: "button", "aria-pressed": state.leadFilter === status ? "true" : "false" }, [status === "all" ? "All" : status.toUpperCase()]);
    chip.addEventListener("click", () => {
      state.leadFilter = status;
      paint();
    });
    leads.append(chip);
  });
  wrap.append(leads);
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
  const rows = state.targets.filter((row) => (state.stageFilter === "all" || row.stage === state.stageFilter) && (state.leadFilter === "all" || row.lead_status === state.leadFilter));
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
      item.append(el("strong", { text: senderLabel(message) }), el("span", { class: "mute", text: " · " + when(message.sent_at || message.created_at) }));
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
  if (provisioned) card.append(el("p", { text: "Profiles found today: " + countToday(row) }));
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
  if (ig && ig.username && ig.status === "connected") return "Instagram: @" + String(ig.username).replace(/^@/, "");
  return "Instagram: not connected";
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

function currentSync() {
  return businessSync({
    previewSync: state.previewSync || "",
    previewError: state.previewError || "",
    outbox: state.outbox || [],
    igStatus: state.ig && state.ig.status,
    systemEnabled: Boolean(state.settings && state.settings.system_enabled),
    externalAgentId: state.setterLink && state.setterLink.external_agent_id
  });
}

const SETTER_ROLES = ["comment_to_dm", "qualification", "conversation_recovery", "appointment_booking"];

async function enqueueEngine(kind, payload) {
  const saved = await state.supabase.rpc("acq_engine_enqueue", {
    p_business: state.businessId,
    p_kind: kind,
    p_payload: payload || {}
  });
  if (saved.error) throw new Error(saved.error.message);
  queueSyncNotice(state.supabase, state.businessId);
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
  const fallback = field("Booking link for this business", settings.booking_fallback_url || "");
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
      await enqueueEngine(on ? "resume_agent" : "pause_agent", {
        roles: SETTER_ROLES,
        status: on ? "active" : "paused"
      });
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
      await enqueueEngine(on ? "resume_agent" : "pause_agent", { role, status: on ? "active" : "paused" });
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
    booking_fallback_url: fields.fallback.input.value.trim(),
    public_comment_replies: fields.publicInput.checked,
    setter_provider: fields.provider.value === "engine" ? "engine" : "roleflow_meta"
  }).eq("agent_id", state.businessId);
  if (saved.error) toast(saved.error.message, "bad");
  else {
    toast("Controls saved.");
    if (fields.provider.value === "engine") {
      try {
        const nextOn = fields.enabledInput.checked === true;
        const prevOn = Boolean(state.settings && state.settings.system_enabled);
        if (nextOn !== prevOn) {
          await enqueueEngine(nextOn ? "resume_agent" : "pause_agent", { scope: "setter", system_enabled: nextOn });
        }
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
          booking_link: fields.fallback.input.value.trim(),
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

function bookingHandle(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

async function recordBooking(handle) {
  if (!state.canEdit) return toast("You can't edit this business.", "bad");
  if (!state.supabase) return toast("This preview does not save.", "bad");
  const name = bookingHandle(handle);
  if (!/^[a-z0-9._]{1,30}$/.test(name)) return toast("Use an Instagram handle: letters, numbers, dots, or underscores.", "bad");
  const existing = (state.targets || []).find((row) => row.handle === name);
  let targetId = existing && existing.id;
  if (!targetId) {
    const inserted = await state.supabase.from("acq_targets").insert({
      agent_id: state.businessId,
      handle: name,
      source: "manual",
      stage: "booked",
      peak_stage: "booked",
      lead_status: "hot"
    }).select("id").single();
    if (inserted.error) return toast(inserted.error.message, "bad");
    targetId = inserted.data.id;
  }
  const already = (state.bookings || []).find((row) => row.target_id === targetId);
  if (!already) {
    const saved = await state.supabase.from("acq_bookings").insert({
      agent_id: state.businessId,
      target_id: targetId,
      show_status: "scheduled",
      source: "manual",
      scheduled_at: new Date().toISOString()
    });
    if (saved.error) return toast(saved.error.message, "bad");
  }
  toast("Booking recorded.");
  await bootBusiness(state.businessId);
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

async function recordGrowth(dollars, note) {
  if (!state.canEdit) return toast("You can't edit this business.", "bad");
  if (!state.supabase) return toast("This preview does not save.", "bad");
  const amount = Number(dollars);
  if (!Number.isFinite(amount) || amount < 0) return toast("Enter the cash collected.", "bad");
  const saved = await state.supabase.from("acq_deals").insert({
    agent_id: state.businessId,
    amount_cents: Math.round(amount * 100),
    currency: "USD",
    notes: String(note || "").trim().slice(0, 500),
    attributed: true,
    entered_by: state.user && state.user.id
  });
  if (saved.error) return toast(saved.error.message, "bad");
  toast("Revenue recorded. The 10% share updates with it.");
  await bootBusiness(state.businessId);
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

function setPanel(open) {
  sidebar.setDrawer(open);
}

function go(tab) {
  closeOffice();
  const next = canonicalTab(tab);
  const url = new URL(location.href);
  url.hash = next;
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  state.tab = next;
  markTab();
  paint();
  if (sidebar.isMobile()) setPanel(false);
}

function markTab() {
  mountNav(pageUi());
  paintProfile();
  const title = document.getElementById("page-title");
  const item = NAV_GROUPS.flatMap((group) => group.items).find((row) => row.tab === state.tab);
  const label = state.tab === "onboarding"
    ? (language() === "es" ? "Configuración" : "Setup")
    : (item ? navLabel(item, language()) : "Dashboard");
  if (title) title.textContent = label;
  const command = document.getElementById("command-label");
  if (command) command.textContent = sectionText(language(), "command");
  const cycle = document.getElementById("lang-cycle");
  if (cycle) cycle.textContent = language() === "es" ? "ES" : "EN";
  const business = state.businesses.find((row) => row.id === state.businessId);
  const name = business && business.agent_name ? business.agent_name : "This business";
  if (sub) sub.textContent = name;
  const avatar = document.getElementById("biz-avatar");
  if (avatar) avatar.textContent = name.trim().charAt(0).toUpperCase() || "R";
  document.title = label + " · Roleflow";
}

function tabGroup(tab) {
  return canonicalTab(tab);
}

function captureInstagramNotice() {
  const url = new URL(location.href);
  const flag = url.searchParams.get("ig");
  const notice = url.searchParams.get("notice");
  if (flag !== "connected" && !notice) return;
  if (flag === "connected") state.connectFlag = "connected";
  if (notice) state.connectError = notice;
  url.searchParams.delete("ig");
  url.searchParams.delete("notice");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}

function settleInstagramNotice() {
  if (state.connectFlag === "connected") {
    const ig = state.ig;
    const mine = Boolean(ig && ig.status === "connected" && (!ig.business_id || ig.business_id === state.businessId));
    if (mine) {
      state.connectError = "";
      toast("Instagram connected.");
    } else {
      state.connectError = "Instagram didn't finish connecting for this business. You can try again.";
      toast(state.connectError, "bad");
    }
  } else if (state.connectError) toast(state.connectError, "bad");
  state.connectFlag = "";
}

function tabFromHash() {
  const parts = location.hash.replace("#", "").split("/");
  const raw = parts[0];
  const tab = canonicalTab(raw);
  state.settingsFocus = tab === "settings" && parts[1] === "model" ? "model" : "";
  const connectQuery = new URLSearchParams(location.search).get("connect") === "1";
  if (tab === "settings" && (parts[1] === "connect" || raw === "integrations" || connectQuery)) state.configKey = "connect";
  else if (tab === "settings" && (raw === "configuration" || raw === "settings" || raw === "controls")) state.configKey = state.configKey || "reply";
  return tab;
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
  const time = date.getTime();
  if (Number.isNaN(time)) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + " min ago";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + " h ago";
  const days = Math.round(hours / 24);
  if (days < 14) return days + " d ago";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
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

function previewCallAt() {
  const date = new Date();
  date.setHours(15, 0, 0, 0);
  return date.toISOString();
}

function readPreview() {
  const host = location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1" && !host.endsWith(".vercel.app")) return null;
  const params = new URLSearchParams(location.search);
  if (params.get("preview") !== "1") return null;
  const pending = params.get("pending") === "1";
  const connect = params.get("connect") === "1" || pending;
  const many = params.get("many") === "1";
  const selected = many && params.get("business") === "second" ? "second" : "preview";
  const igStatus = params.get("igstatus") || "";
  const ig = igStatus === "error"
    ? { business_id: selected, status: "error", username: "", last_error: "Instagram didn't finish connecting. You can try again." }
    : igStatus === "connected"
      ? { business_id: selected, status: "connected", username: params.get("handle") || "northstudio" }
      : connect
        ? { business_id: selected, status: "disconnected" }
        : { business_id: selected, status: "connected", username: "previewcoach" };
  return {
    preview: true,
    businessId: selected,
    businesses: many
      ? [{ id: "preview", agent_name: "First business", owner_id: "owner" }, { id: "second", agent_name: "North studio", owner_id: "owner" }]
      : [{ id: "preview", agent_name: "Preview coaching" }],
    canEdit: params.get("edit") === "1",
    previewSync: params.get("sync") || "",
    previewError: params.get("sync") === "failed" ? "The workflow was rejected." : "",
    settings: { system_enabled: params.get("sync") === "ready" ? false : true, daily_cap: 30, timezone: "Europe/Madrid", quiet_start: "22:00", quiet_end: "08:00", warmup_like_count: 2, warmup_spacing_days: 1, ig_paused: false, share_bps: 1000, ai_voice_future: false, onboarding_step: params.get("step") || "profile", studio_setter_sync: false, booking_fallback_url: "", reply_delay_seconds: 30, reply_delay_max_seconds: 120 },
    setterLink: params.get("sync") === "ready" ? { status: "connected", external_agent_id: "preview-agent", provider: "engine" } : null,
    outbox: [],
    workforce: ROLES.map((role) => ({ role: role.id, status: role.id === "chief_of_staff" ? "active" : "paused", parameters: {}, daily_count: role.id === "icp_acquisition" ? 12 : 0, last_run_at: "2026-10-21T09:00:00Z" })),
    targets: [
      { id: "t1", handle: "northstar", stage: "outreach", peak_stage: "outreach", lead_status: "warm", icp_score: 90, source: "competitor_followers", bio: "Coach. DM me to apply.", cta_detected: true, updated_at: "2026-10-21T09:00:00Z", budget: "", timeline: "", fit: "", qual_score: null, decision_maker: null },
      { id: "t2", handle: "slowreply", stage: "booked", peak_stage: "booked", lead_status: "hot", icp_score: 85, source: "keyword", bio: "Agency systems.", cta_detected: true, updated_at: "2026-10-20T09:00:00Z" }
    ],
    outreach: [{ id: "o1", target_id: "t1", decision: "send", opener: "Hey northstar — saw the CTA.", sent_result: null }],
    steps: [],
    bookings: [{ id: "b1", target_id: "t2", show_status: "scheduled", scheduled_at: previewCallAt() }],
    deals: [{ id: "d1", target_id: "t2", amount_cents: 1000000, currency: "USD", attributed: true }],
    reports: [{ id: "r1", kind: "daily", period_start: "2026-10-21", summary: "Cap 30. New targets today: 12.", body: { cap: 30 } }],
    exceptions: [{ id: "e1", message: "4 leads stuck in warmup for more than 3 days." }],
    activity: [{ id: "a1", target_id: "t1", action: "voice.sent", result: "sent", actor: "bot", notes: "Opener", created_at: "2026-10-21T09:05:00Z" }],
    voices: [{ id: "v1", slot: "outreach_opener", title: "Opener — coaching", niche: "coaching", variant: null, active: true, script_hint: "Hey, I listened to the reel.", storage_path: "", updated_at: "2026-10-21" }],
    contacts: [
      { id: "c-ada", name: "Ada North", ig_handle: "adanorth", crm_state: "discovering", ai_enabled: true, automated: true, is_verified: true, tags: ["warm"], unread_count: 1, message_count: 2, follower_count: 1200, they_follow: true, we_follow: false, last_message_at: "2026-10-25T18:00:00Z", attributes: { summary: "Asked how the offer works." } },
      { id: "c-sam", name: "Sam Quiet", ig_handle: "samquiet", crm_state: "lost", ai_enabled: false, automated: false, tags: [], unread_count: 0, message_count: 1, last_message_at: "2026-10-21T12:00:00Z", attributes: { summary: "Went quiet after the first reply." } }
    ],
    conversations: [{ id: "cv-ada", contact_id: "c-ada" }, { id: "cv-sam", contact_id: "c-sam" }],
    engineMessages: [
      { id: "m-ada-1", conversation_id: "cv-ada", role: "user", sender: "adanorth", body: "How does the offer work?", sent_at: "2026-10-25T18:00:00Z" },
      { id: "m-ada-2", conversation_id: "cv-ada", role: "assistant", sender: "ai", body: "Happy to walk you through it on a call.", sent_at: "2026-10-25T18:04:00Z" }
    ],
    performance: [{ id: "v1", sends: 8, replies: 3, bookings: 1 }],
    stats: null,
    leads: [],
    threads: [{ id: "th1", igsid: "1", username: "northstar", state: "qualification", lead_status: "warm", human_locked: false, followup_count: 0, meet_link: "", updated_at: "2026-10-21T09:10:00Z" }],
    messages: [{ id: "m1", thread_id: "th1", direction: "in", body: "Are you a bot?", kind: "text", created_at: "2026-10-21T09:10:00Z" }],
    ig,
    connectRequests: pending ? [{ id: "preview-request", workspace_id: "preview", channel: "instagram", username: "previewcoach", status: "pending", notes: "Business account" }] : [],
    google: { status: "disconnected" },
    agentSwitches: [],
    setterPrompt: "You are the setter for this business. Ask one question at a time. Do not promise a growth number.\nWhen they ask about the system, send {{voice:opener_coaching}} and share {{booking_link}}.",
    setterTestedAt: null,
    bookingLink: bookingLinkFor(""),
    promptVersions: [
      { id: "preview-prompt-1", version: 1, body: "You are the setter for this business. Ask one question at a time.", created_at: "2026-10-23T06:00:00Z", created_by: null },
      { id: "preview-prompt-2", version: 2, body: "You are the setter for this business. Ask one question at a time. Do not promise a growth number.\nWhen they ask about the system, send {{voice:opener_coaching}} and share {{booking_link}}.", created_at: "2026-10-26T08:00:00Z", created_by: null }
    ],
    setterTrial: { scenario: "comment", messages: [] },
    commentVoiceCap: 30,
    commentVoiceRules: [{ id: "rule-1", keywords: ["SYSTEM", "SYSTEMS", "SISTEM"], intent: "Someone asking how the system works", message: "Thanks for the comment.", clip_id: "v1" }],
    commentVoiceLog: [{ id: "log-1", matched: false, queued: false, reason: "no_match", comment_text: "Nice post", commenter_username: "ada", created_at: "2026-10-26T09:00:00Z" }],
    followupPolicy: null,
    workers: [{ id: "w1", label: "Outreach worker", key_prefix: "rfw_preview", enabled: true, status: "offline", last_heartbeat_at: null, pause_reason: null }],
    dnc: [{ handle: "donotcontact", reason: "asked to stop" }],
    prompts: [],
    members: [],
    isAdmin: false,
    openThread: "th1",
    promptRole: "qualification",
    ...(params.get("inbox") === "1" ? inboxPreview() : {}),
    ...(params.get("empty") === "1" ? {
      targets: [],
      contacts: [],
      bookings: [],
      origins: [],
      valueAssets: [],
      brief: null,
      messageCount: 0,
      threads: [],
      messages: [],
      deals: [],
      outreach: []
    } : {}),
    ...(params.get("fail") === "1" ? {
      sectionErrors: {
        performance: true,
        chats: true,
        opportunities: true,
        calendar: true,
        sops: true,
        content: true
      }
    } : {})
  };
}

function inboxPreview() {
  return {
    messageCount: 4,
    contacts: [
      { id: "c-unread", name: "Ada North", ig_handle: "adanorth", crm_state: "qualifying", ai_enabled: true, tags: ["hot"], unread_count: 2, message_count: 4, last_message_at: "2026-10-22T18:00:00Z" },
      { id: "c-paused", name: "Sam Quiet", ig_handle: "samquiet", crm_state: "open", ai_enabled: false, tags: [], unread_count: 0, message_count: 1, last_message_at: "2026-10-21T12:00:00Z" }
    ],
    conversations: [
      { id: "cv-unread", contact_id: "c-unread", external_id: "thread-ada" },
      { id: "cv-paused", contact_id: "c-paused", external_id: "thread-sam" }
    ],
    engineMessages: [
      { id: "m-ada", conversation_id: "cv-unread", role: "user", sender: "adanorth", body: "What does the program include?", sent_at: "2026-10-22T18:00:00Z", created_at: "2026-10-22T18:00:00Z" }
    ],
    reminders: [
      { id: "rem-1", contact_id: "c-unread", title: "Send the calendar link", due_at: "2026-10-23T15:00:00Z", status: "open", kind: "task", source: "manual" }
    ],
    flow: { chat: "contact:c-unread", chatQuery: "", chatState: "all", chatTag: "", chatAi: "all", chatUnread: "all", reminderFilter: "open", ctaPreview: "" }
  };
}
