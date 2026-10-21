const PROMPT_ROLES = [
  ["comment_to_dm", "Comment-to-DM"],
  ["qualification", "Qualification"],
  ["conversation_recovery", "Conversation recovery"],
  ["appointment_booking", "Appointment booking"]
];

const SECTIONS = [
  ["objective", "Objective"],
  ["personality", "Personality"],
  ["workflow", "Workflow"],
  ["qualification_rules", "Qualification rules"],
  ["followup_logic", "Follow-up logic"],
  ["booking_logic", "Booking logic"],
  ["guardrails", "Guardrails"],
  ["notes", "Notes"]
];

const STEPS = ["instagram", "calendar", "voice", "knowledge", "caps", "live"];

export function renderEngine(tab, host, ctx) {
  host.replaceChildren();
  if (tab === "inbox") paintInbox(host, ctx);
  if (tab === "prompts") paintPrompts(host, ctx);
  if (tab === "integrations") paintIntegrations(host, ctx);
  if (tab === "billing") paintBilling(host, ctx);
  if (tab === "onboarding") paintOnboarding(host, ctx);
}

function paintInbox(host, ctx) {
  const { state, el, button, toast, bootBusiness } = ctx;
  host.append(el("p", { class: "mute", text: "Replies you send from here lock the thread. The assistant stays paused until you unlock it." }));
  const layout = el("div", { class: "inbox" });
  const list = el("div", { class: "thread-list" });
  const threads = state.threads || [];
  if (!threads.length) list.append(el("p", { class: "mute", text: "No Instagram threads yet. They appear after the account is connected and someone messages it." }));
  threads.forEach((thread) => {
    const label = (thread.username ? "@" + thread.username : thread.igsid || "Thread") + " · " + thread.state + (thread.human_locked ? " · you" : "");
    const item = el("button", { type: "button", "aria-pressed": state.openThread === thread.id ? "true" : "false" }, [label]);
    item.addEventListener("click", () => openThread(ctx, thread.id, host));
    list.append(item);
  });
  const pane = el("div", { id: "inbox-pane" });
  layout.append(list, pane);
  host.append(layout);
  if (state.openThread) fillThread(ctx, pane, threads.find((row) => row.id === state.openThread));
  else pane.append(el("p", { class: "mute", text: "Choose a thread." }));
  if (state.canEdit && state.supabase) {
    host.append(button("Refresh inbox", () => bootBusiness(state.businessId)));
  }
  void toast;
}

async function openThread(ctx, id, host) {
  ctx.state.openThread = id;
  if (ctx.state.supabase) {
    const messages = await ctx.state.supabase.from("ig_messages").select("id, direction, body, kind, created_at").eq("thread_id", id).eq("business_id", ctx.state.businessId).order("created_at", { ascending: true });
    ctx.state.messages = messages.error ? [] : messages.data || [];
  }
  renderEngine("inbox", host, ctx);
}

function fillThread(ctx, pane, thread) {
  const { state, el, button, field, toast } = ctx;
  if (!thread) {
    pane.append(el("p", { class: "mute", text: "That thread is not in this business." }));
    return;
  }
  pane.append(el("h3", { text: (thread.username ? "@" + thread.username : "Thread") + " · " + thread.lead_status }));
  pane.append(el("p", { class: "mute", text: "State " + thread.state + (thread.human_locked ? " · locked for you" : " · assistant can reply") + (thread.meet_link ? " · Meet ready" : "") }));
  const bubbles = el("div", { class: "bubbles" });
  (state.messages || []).forEach((message) => {
    bubbles.append(el("div", { class: "bubble " + message.direction, text: message.body || ("(" + message.kind + ")") }));
  });
  if (!(state.messages || []).length) bubbles.append(el("p", { class: "mute", text: "No messages stored for this thread." }));
  pane.append(bubbles);
  if (!state.canEdit || !state.supabase) return;
  const reply = field("Your reply", "", "text");
  reply.input.placeholder = "This sends as you and locks the thread.";
  pane.append(reply.label);
  const row = el("div", { class: "filters" });
  row.append(button(thread.human_locked ? "Unlock for the assistant" : "Lock for me", async () => {
    try {
      await callEngine(ctx, "lock", { thread_id: thread.id, locked: !thread.human_locked });
      toast(thread.human_locked ? "Assistant can reply again." : "Thread locked.");
      await ctx.bootBusiness(state.businessId);
      ctx.go("inbox");
    } catch (error) {
      toast(error.message, "bad");
    }
  }));
  row.append(button("Send reply", async () => {
    try {
      await callEngine(ctx, "inbox_send", { thread_id: thread.id, text: reply.input.value });
      toast("Reply queued. It sends on the next minute if the messaging window allows it.");
      reply.input.value = "";
      await ctx.bootBusiness(state.businessId);
      ctx.go("inbox");
    } catch (error) {
      toast(error.message, "bad");
    }
  }));
  pane.append(row);
}

function paintPrompts(host, ctx) {
  const { state, el, button, toast } = ctx;
  host.append(el("p", { class: "mute", text: "Edits are versioned. The test box never sends anything to Instagram." }));
  const role = el("select", { "aria-label": "Agent prompt" });
  PROMPT_ROLES.forEach(([id, label]) => role.append(el("option", { value: id, text: label })));
  role.value = state.promptRole || "qualification";
  const areas = {};
  const form = el("form", { class: "agent" });
  form.append(role);
  SECTIONS.forEach(([key, label]) => {
    const wrap = el("label", { text: label });
    const area = el("textarea", { "aria-label": label });
    wrap.append(area);
    areas[key] = area;
    form.append(wrap);
  });
  const apply = (sections) => {
    SECTIONS.forEach(([key]) => {
      areas[key].value = sections && sections[key] ? sections[key] : "";
    });
  };
  const current = () => (state.prompts || []).find((row) => row.role === role.value);
  apply(current() && current().sections);
  role.addEventListener("change", () => {
    state.promptRole = role.value;
    apply(current() && current().sections);
  });
  if (state.canEdit && state.supabase) {
    form.append(button("Save this version", async (event) => {
      event.preventDefault();
      const sections = {};
      SECTIONS.forEach(([key]) => {
        sections[key] = areas[key].value;
      });
      try {
        const saved = await callEngine(ctx, "prompts_save", { role: role.value, sections });
        toast("Saved version " + (saved.version || "") + ".");
        state.prompts = (await callEngine(ctx, "prompts_get")).roles || [];
      } catch (error) {
        toast(error.message, "bad");
      }
    }));
    form.append(button("Load the seeded prompts", async () => {
      try {
        await callEngine(ctx, "seed_prompts", {});
        state.prompts = (await callEngine(ctx, "prompts_get")).roles || [];
        apply((state.prompts.find((row) => row.role === role.value) || {}).sections);
        toast("Seeded prompts are in place. Existing versions were kept.");
      } catch (error) {
        toast(error.message, "bad");
      }
    }));
  }
  host.append(form);
  const play = el("form", { class: "agent" });
  play.append(el("h3", { text: "Test this agent" }));
  const sample = el("textarea", { "aria-label": "Sample lead message" });
  sample.value = "Are you a bot?";
  const out = el("pre", { text: "The result stays in this panel." });
  play.append(sample, button("Run test", async (event) => {
    event.preventDefault();
    if (!state.supabase) {
      toast("Sign in to run a test. Nothing is sent to Instagram either way.", "bad");
      return;
    }
    try {
      const result = await callEngine(ctx, "playground", { role: role.value, text: sample.value, state: "qualification" });
      out.textContent = JSON.stringify({ sent: result.sent, plan: result.plan }, null, 2);
      toast("Test finished. Nothing was sent.");
    } catch (error) {
      out.textContent = error.message;
      toast(error.message, "bad");
    }
  }), out);
  host.append(play);
  if (state.supabase && !(state.prompts || []).length) {
    callEngine(ctx, "prompts_get").then((result) => {
      state.prompts = result.roles || [];
      apply((state.prompts.find((row) => row.role === role.value) || {}).sections);
    }).catch((error) => toast(error.message, "bad"));
  }
}

function paintIntegrations(host, ctx) {
  const { state, el, button, field, toast, bootBusiness } = ctx;
  const ig = state.ig || { status: "disconnected" };
  const google = state.google || { status: "disconnected" };
  const igCard = el("article", { class: "agent" });
  igCard.append(el("h3", { text: "Instagram" }));
  igCard.append(el("p", { text: "Status: " + ig.status + (ig.username ? " · @" + ig.username : "") + (ig.last_error ? " · " + ig.last_error : "") }));
  igCard.append(el("p", { class: "mute", text: "Official Instagram Login for this business. Passwords are never stored. Comment-to-DM, qualification, recovery, and booking use this connection." }));
  if (state.canEdit && state.supabase) {
    const row = el("div", { class: "filters" });
    row.append(button("Connect Instagram", () => startOauth(ctx, "meta_start")));
    row.append(button("Disconnect", async () => {
      try {
        await callEngine(ctx, "disconnect_instagram", {});
        toast("Instagram disconnected.");
        await bootBusiness(state.businessId);
        ctx.go("integrations");
      } catch (error) {
        toast(error.message, "bad");
      }
    }));
    igCard.append(row);
  }
  host.append(igCard);

  const cal = el("article", { class: "agent" });
  cal.append(el("h3", { text: "Google Calendar" }));
  cal.append(el("p", { text: "Status: " + google.status + (google.email ? " · " + google.email : "") }));
  cal.append(el("p", { class: "mute", text: "Primary booking reads free time and creates a Meet event. If Calendar is not connected, the assistant sends the site booking link once." }));
  if (state.canEdit && state.supabase) {
    const row = el("div", { class: "filters" });
    row.append(button("Connect Google Calendar", () => startOauth(ctx, "google_start")));
    row.append(button("Disconnect", async () => {
      try {
        await callEngine(ctx, "disconnect_google", {});
        toast("Google Calendar disconnected.");
        await bootBusiness(state.businessId);
        ctx.go("integrations");
      } catch (error) {
        toast(error.message, "bad");
      }
    }));
    cal.append(row);
  }
  host.append(cal);

  const worker = el("article", { class: "agent" });
  worker.append(el("h3", { text: "Outreach worker" }));
  worker.append(el("p", { class: "mute", text: "Targeting, warm-up, and cold outreach run on a separate worker. It uses a scoped key, not the Meta app, and it never receives an Instagram password." }));
  const workers = state.workers || [];
  if (!workers.length) worker.append(el("p", { text: "No worker key yet." }));
  workers.forEach((row) => {
    const line = el("p", { text: (row.label || "Worker") + " · " + row.status + " · " + (row.enabled ? "on" : "off") + " · " + row.key_prefix + "… · heartbeat " + ctx.when(row.last_heartbeat_at) });
    worker.append(line);
    if (state.canEdit && state.supabase) {
      worker.append(button(row.enabled ? "Turn worker off" : "Turn worker on", async () => {
        const saved = await state.supabase.rpc("acq_worker_set_enabled", { p_worker: row.id, p_enabled: !row.enabled });
        if (saved.error) toast(saved.error.message, "bad");
        else {
          toast(row.enabled ? "Worker off." : "Worker on. It shows online after the next heartbeat.");
          await bootBusiness(state.businessId);
          ctx.go("integrations");
        }
      }));
    }
  });
  if (state.issuedKey) worker.append(el("p", { class: "key-once", text: "Copy this key now. It is not shown again: " + state.issuedKey }));
  if (state.canEdit && state.supabase) {
    worker.append(button("Issue a new worker key", async () => {
      const issued = await state.supabase.rpc("acq_worker_issue", { p_business: state.businessId });
      if (issued.error) toast(issued.error.message, "bad");
      else {
        state.issuedKey = issued.data && issued.data.api_key;
        toast("New key issued. The previous key no longer works.");
        await bootBusiness(state.businessId);
        ctx.go("integrations");
      }
    }));
  }
  if (state.settings && state.settings.ig_paused) {
    worker.append(el("p", { text: "Safety pause is on for the worker (" + (state.settings.ig_pause_reason || "warning") + "). Official Instagram DMs keep running." }));
  }
  host.append(worker);

  const join = el("article", { class: "agent" });
  const workspace = (state.businesses || []).find((row) => row.id === state.businessId);
  join.append(el("h3", { text: "Workspace" }));
  join.append(el("p", { text: "Join code: " + ((workspace && workspace.join_code) || "—") }));
  const code = field("Join another business", "");
  join.append(code.label);
  if (state.supabase) {
    join.append(button("Join with code", async () => {
      const saved = await state.supabase.rpc("acq_join_workspace", { p_code: code.input.value.trim() });
      if (saved.error) toast(saved.error.message, "bad");
      else if (saved.data && saved.data.ok === false) toast(saved.data.error || "That code did not match.", "bad");
      else {
        toast("You joined that business.");
        location.href = "/account/acquisition/?business=" + encodeURIComponent(saved.data.business_id);
      }
    }));
  }
  host.append(join);
  host.append(dncBlock(ctx));
  host.append(knowledgeBlock(ctx));
}

function dncBlock(ctx) {
  const { state, el, button, field, toast, bootBusiness } = ctx;
  const card = el("article", { class: "agent" });
  card.append(el("h3", { text: "Do not contact" }));
  const rows = state.dnc || [];
  if (!rows.length) card.append(el("p", { class: "mute", text: "No handles on the list." }));
  rows.forEach((row) => {
    const line = el("p", { text: "@" + row.handle + (row.reason ? " · " + row.reason : "") });
    if (state.canEdit && state.supabase) {
      line.append(" ");
      line.append(button("Remove", async () => {
        const saved = await state.supabase.from("acq_dnc").delete().eq("business_id", state.businessId).eq("handle", row.handle);
        if (saved.error) toast(saved.error.message, "bad");
        else {
          await bootBusiness(state.businessId);
          ctx.go("integrations");
        }
      }));
    }
    card.append(line);
  });
  if (state.canEdit && state.supabase) {
    const handle = field("Instagram handle", "");
    const reason = field("Reason", "");
    card.append(handle.label, reason.label, button("Add handle", async () => {
      const name = handle.input.value.trim().replace(/^@/, "").toLowerCase();
      const saved = await state.supabase.from("acq_dnc").insert({ business_id: state.businessId, handle: name, reason: reason.input.value.trim() });
      if (saved.error) toast(saved.error.message, "bad");
      else {
        toast("Handle added.");
        await bootBusiness(state.businessId);
        ctx.go("integrations");
      }
    }));
  }
  return card;
}

function knowledgeBlock(ctx) {
  const { state, el, button, toast, bootBusiness } = ctx;
  const settings = state.settings || {};
  const card = el("form", { class: "agent" });
  card.append(el("h3", { text: "Offer and knowledge" }));
  const offer = area(ctx, "Offer", settings.offer_summary || "");
  const icp = area(ctx, "Who you sell to", settings.icp_notes || "");
  const knowledge = area(ctx, "Facts the assistant may use", settings.knowledge_base || "");
  card.append(offer.label, icp.label, knowledge.label);
  if (state.canEdit && state.supabase) {
    card.append(button("Save knowledge", async (event) => {
      event.preventDefault();
      const saved = await state.supabase.from("acq_settings").update({
        offer_summary: offer.input.value,
        icp_notes: icp.input.value,
        knowledge_base: knowledge.input.value
      }).eq("agent_id", state.businessId);
      if (saved.error) toast(saved.error.message, "bad");
      else {
        toast("Knowledge saved.");
        await bootBusiness(state.businessId);
        ctx.go("integrations");
      }
    }));
  }
  return card;
}

function paintBilling(host, ctx) {
  const { state, el, money, shareCents } = ctx;
  const revenue = (state.deals || []).filter((deal) => deal.attributed !== false).reduce((sum, deal) => sum + (Number(deal.amount_cents) || 0), 0);
  const share = shareCents(revenue, state.settings && state.settings.share_bps);
  const kpis = el("div", { class: "kpis" });
  [["Recorded growth", money(revenue), "Cash you entered on sourced deals"], ["Roleflow share", money(share), "10% · no setup fee · no retainer"]].forEach(([label, value, note]) => {
    const card = el("article", { class: "kpi" });
    card.append(el("span", { text: label }), el("strong", { text: value }), el("em", { text: note }));
    kpis.append(card);
  });
  host.append(kpis);
  host.append(el("p", { class: "mute", text: "Record a deal from the pipeline when the lead pays. The share follows that amount. Nothing is owed for a deal you do not record." }));
  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", { class: "leads" });
  table.append(el("thead", {}, [el("tr", {}, [el("th", { text: "When" }), el("th", { text: "Amount" }), el("th", { text: "Share" }), el("th", { text: "Note" })])]));
  const body = el("tbody");
  const deals = state.deals || [];
  if (!deals.length) body.append(el("tr", {}, [el("td", { colspan: "4", text: "No attributed revenue recorded yet." })]));
  deals.forEach((deal) => {
    body.append(el("tr", {}, [
      el("td", { text: ctx.when(deal.closed_on || deal.created_at) }),
      el("td", { text: money(deal.amount_cents, deal.currency) }),
      el("td", { text: money(shareCents(deal.amount_cents, state.settings && state.settings.share_bps), deal.currency) }),
      el("td", { text: deal.notes || "" })
    ]));
  });
  table.append(body);
  tableWrap.append(table);
  host.append(tableWrap);
  host.append(el("a", { class: "btn sm", href: "#pipeline" }, ["Open the pipeline"]));
}

function paintOnboarding(host, ctx) {
  const { state, el, button, toast, bootBusiness } = ctx;
  const settings = state.settings || {};
  const step = STEPS.includes(settings.onboarding_step) ? settings.onboarding_step : "instagram";
  const progress = el("div", { class: "steps" });
  STEPS.forEach((id) => {
    const labels = { instagram: "Instagram", calendar: "Calendar", voice: "Voice notes", knowledge: "Offer", caps: "Daily cap", live: "Go live" };
    progress.append(el("span", { class: id === step ? "now" : "", text: labels[id] }));
  });
  host.append(progress);
  const card = el("article", { class: "agent" });
  if (step === "instagram") {
    card.append(el("h3", { text: "Connect the professional Instagram account" }), el("p", { text: "This business authorizes Roleflow’s Meta app. The token stays on the server." }));
    if (state.canEdit && state.supabase) card.append(button("Connect Instagram", () => startOauth(ctx, "meta_start")));
  }
  if (step === "calendar") {
    card.append(el("h3", { text: "Connect Google Calendar" }), el("p", { text: "Slot booking uses free time on this calendar. You can skip and use the public booking link until Calendar is connected." }));
    if (state.canEdit && state.supabase) card.append(button("Connect Google Calendar", () => startOauth(ctx, "google_start")));
  }
  if (step === "voice") {
    card.append(el("h3", { text: "Record the voice notes" }), el("p", { text: "Upload a recording for the opener, the gap, recovery, and the booking confirmation. The assistant sends those files. It does not clone a voice." }));
    card.append(el("a", { class: "btn sm", href: "#voice" }, ["Open voice notes"]));
  }
  if (step === "knowledge") {
    card.append(el("h3", { text: "Offer, audience, and facts" }), el("p", { text: "Save these on Integrations. The assistant may use only what you write there." }));
    card.append(el("a", { class: "btn sm", href: "#integrations" }, ["Edit knowledge"]));
  }
  if (step === "caps") {
    card.append(el("h3", { text: "Daily cap" }), el("p", { text: "New targets stay between 20 and 30 a day. The default is 30. Quiet hours hold automated sends." }));
    card.append(el("a", { class: "btn sm", href: "#controls" }, ["Open settings"]));
  }
  if (step === "live") {
    card.append(el("h3", { text: "Go live" }), el("p", { text: "Turns the system on and loads the seeded prompts. Each agent still has its own on/off switch on Workforce." }));
    if (state.canEdit && state.supabase) {
      card.append(button("Go live", async () => {
        try {
          await callEngine(ctx, "seed_prompts", {});
        } catch (error) {
          toast(error.message, "bad");
        }
        const saved = await state.supabase.from("acq_settings").update({
          system_enabled: true,
          onboarding_step: "live",
          live_at: new Date().toISOString()
        }).eq("agent_id", state.businessId);
        if (saved.error) toast(saved.error.message, "bad");
        else {
          toast("This business is live. Agents stay paused until you turn each one on.");
          await bootBusiness(state.businessId);
          ctx.go("overview");
        }
      }));
    }
  }
  host.append(card);
  if (state.canEdit && state.supabase && step !== "live") {
    const index = STEPS.indexOf(step);
    host.append(button(step === "caps" ? "Continue to go live" : "Mark this step done", async () => {
      const next = STEPS[Math.min(index + 1, STEPS.length - 1)];
      const saved = await state.supabase.from("acq_settings").update({ onboarding_step: next }).eq("agent_id", state.businessId);
      if (saved.error) toast(saved.error.message, "bad");
      else {
        await bootBusiness(state.businessId);
        ctx.go("onboarding");
      }
    }));
  }
}

async function startOauth(ctx, action) {
  try {
    const result = await callEngine(ctx, action, {});
    if (result.url) location.href = result.url;
  } catch (error) {
    ctx.toast(error.message, "bad");
  }
}

async function callEngine(ctx, action, extra) {
  if (!ctx.state.supabase) throw new Error("Sign in to use this.");
  const session = await ctx.state.supabase.auth.getSession();
  const token = session.data.session && session.data.session.access_token;
  const root = globalThis.ROLEFLOW_SUPABASE || {};
  const base = String(root.SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/roleflow-acquisition";
  const path = action === "meta_start" ? "/meta/start" : action === "google_start" ? "/google/start" : "";
  const body = path ? { business_id: ctx.state.businessId } : { action, business_id: ctx.state.businessId, ...extra };
  const response = await fetch(base + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + (token || ""),
      apikey: root.SUPABASE_ANON_KEY || "",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function area(ctx, label, value) {
  const wrap = ctx.el("label", { text: label });
  const input = ctx.el("textarea", { "aria-label": label });
  input.value = value;
  wrap.append(input);
  return { label: wrap, input };
}
