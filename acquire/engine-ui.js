import { ENGINE_HINT, SLOTS } from "./model.js";

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
      const text = reply.input.value;
      if (state.settings && state.settings.setter_provider === "engine") {
        const queued = await state.supabase.rpc("acq_engine_enqueue", {
          p_business: state.businessId,
          p_kind: "message_lead_draft",
          p_payload: { thread_id: thread.id, text }
        });
        if (queued.error) throw new Error(queued.error.message);
        toast("Syncing…");
      } else {
        await callEngine(ctx, "inbox_send", { thread_id: thread.id, text });
        toast("Reply queued. It sends on the next minute if the messaging window allows it.");
      }
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
        if (state.settings && state.settings.setter_provider === "engine" && PROMPT_ROLES.some(([id]) => id === role.value)) {
          const queued = await state.supabase.rpc("acq_engine_enqueue", {
            p_business: state.businessId,
            p_kind: "update_workflow",
            p_payload: { role: role.value, sections, voice_note_slots: SLOTS.map((slot) => slot.id) }
          });
          if (queued.error) throw new Error(queued.error.message);
          toast("Syncing…");
        } else toast("Saved version " + (saved.version || "") + ".");
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

function activationLabel(status) {
  if (status === "pending") return "Pending activation";
  if (status === "connected") return "Connected";
  if (status === "error") return "Needs attention";
  return "Not connected";
}

function paintSetterEngine(host, ctx) {
  const { state, el, button, field, toast, bootBusiness } = ctx;
  const link = state.setterLink || { status: "disconnected" };
  const card = el("article", { class: "agent" });
  card.append(el("h3", { text: "Roleflow Setter Engine" }));
  card.append(el("p", { class: "mute", text: "Instagram DM engine" }));
  const handle = link.requested_handle ? " · @" + link.requested_handle : "";
  const tested = link.last_test_error ? " · " + link.last_test_error : "";
  card.append(el("p", { text: activationLabel(link.status) + handle + tested }));
  card.append(el("p", { class: "mute", text: "Comment-to-DM, qualification, recovery, and booking run here until a Meta app is connected. Enter the Instagram handle. An admin links the engine agent on the server. The access token is not shown again." }));
  card.append(el("p", { class: "mute", text: ENGINE_HINT }));
  if ((state.outbox || []).some((row) => row.status === "pending")) card.append(el("p", { text: "Syncing…" }));
  const failed = (state.outbox || []).find((row) => row.status === "failed" && row.error);
  if (failed) card.append(el("p", { text: failed.error }));
  if (link.webhook_seen_at) {
    card.append(el("p", { text: "Full history and extracted attributes are arriving. Last event " + ctx.when(link.webhook_seen_at) + "." }));
  }
  if (link.last_synced_at) {
    const counts = link.last_sync_counts || {};
    const note = counts.reason === "paused" ? "Last sync skipped because those four agents are off." : "Last sync " + ctx.when(link.last_synced_at) + (link.last_sync_error ? " · " + link.last_sync_error : "");
    card.append(el("p", { text: note }));
  }
  if (state.canEdit && state.supabase) {
    const igHandle = field("Instagram handle", link.requested_handle || "");
    igHandle.input.autocomplete = "off";
    card.append(igHandle.label);
    const row = el("div", { class: "filters" });
    row.append(button("Request activation", async () => {
      try {
        await callSetterEngine(ctx, "request_activation", { ig_handle: igHandle.input.value.trim() });
        toast("Pending activation");
        await bootBusiness(state.businessId);
        ctx.go(state.tab || "integrations");
      } catch (error) {
        toast(error.message, "bad");
      }
    }));
    if (link.status === "connected") {
      row.append(button("Sync now", async () => {
        try {
          await callSetterEngine(ctx, "sync_one", {});
          toast("Sync finished.");
          await bootBusiness(state.businessId);
          ctx.go(state.tab || "integrations");
        } catch (error) {
          toast(error.message, "bad");
        }
      }));
    }
    row.append(button("Disconnect", async () => {
      try {
        await callSetterEngine(ctx, "disconnect", {});
        toast("Instagram DM engine disconnected. The setter is the Meta engine.");
        await bootBusiness(state.businessId);
        ctx.go(state.tab || "integrations");
      } catch (error) {
        toast(error.message, "bad");
      }
    }));
    card.append(row);
    if (state.isAdmin) {
      const agentId = field("Engine agent id", link.external_agent_id || "");
      const token = field("Engine access token", "");
      token.input.type = "password";
      token.input.autocomplete = "off";
      agentId.input.autocomplete = "off";
      card.append(el("h3", { text: "Admin link" }));
      card.append(agentId.label, token.label);
      card.append(button("Link engine", async () => {
        try {
          await callSetterEngine(ctx, "link_agent", { agent_id: agentId.input.value.trim(), api_key: token.input.value });
          token.input.value = "";
          toast("Engine linked.");
          await bootBusiness(state.businessId);
          ctx.go(state.tab || "integrations");
        } catch (error) {
          toast(error.message, "bad");
        }
      }));
    }
  }
  host.append(card);
}

function paintIntegrations(host, ctx) {
  const { state, el, button, field, toast, bootBusiness } = ctx;
  paintSetterEngine(host, ctx);
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

const WIZARD = ["profile", "offer", "connect", "worker", "voice", "live"];

function wizardStep(settings) {
  const raw = (settings && settings.onboarding_step) || "profile";
  if (WIZARD.includes(raw)) return raw;
  if (raw === "knowledge") return "offer";
  if (raw === "voice") return "voice";
  if (raw === "live") return "live";
  return "connect";
}

function paintOnboarding(host, ctx) {
  const { state, el, button, field, toast, bootBusiness } = ctx;
  const settings = state.settings || {};
  const step = wizardStep(settings);
  const progress = el("div", { class: "steps" });
  const labels = { profile: "Business", offer: "Offer", connect: "Instagram", worker: "Worker", voice: "Voice notes", live: "Go live" };
  WIZARD.forEach((id) => progress.append(el("span", { class: id === step ? "now" : "", text: labels[id] })));
  host.append(progress);
  const card = el("article", { class: "agent" });

  if (step === "profile") {
    card.append(el("h3", { text: "Business and ICP" }));
    card.append(el("p", { text: "Grok scores discovered profiles against this niche, follower range, and the CTA keywords in the bio." }));
    const business = (state.businesses || []).find((row) => row.id === state.businessId);
    const name = field("Business name", (business && business.agent_name) || "");
    const niche = field("Niche", settings.niche || "");
    const min = field("Follower minimum", settings.follower_min || 5000, "number");
    const max = field("Follower maximum", settings.follower_max || 200000, "number");
    const keywords = field("CTA keywords", settings.cta_keywords || "");
    min.input.min = "5000";
    min.input.max = "200000";
    max.input.min = "5000";
    max.input.max = "200000";
    keywords.input.placeholder = "DM me, book a call, link in bio";
    card.append(name.label, niche.label, min.label, max.label, keywords.label);
    if (state.canEdit && state.supabase) {
      card.append(button("Save and continue", async () => {
        const followerMin = Number(min.input.value);
        const followerMax = Number(max.input.value);
        if (followerMin < 5000 || followerMax > 200000 || followerMax < followerMin) {
          toast("Followers stay between 5,000 and 200,000, and the maximum is at least the minimum.", "bad");
          return;
        }
        if (name.input.value.trim()) {
          const label = name.input.value.trim();
          await state.supabase.from("acq_workspaces").update({ name: label }).eq("id", state.businessId);
          if (business) {
            business.name = label;
            business.agent_name = label;
          }
        }
        const saved = await state.supabase.from("acq_settings").update({
          niche: niche.input.value.trim(),
          follower_min: followerMin,
          follower_max: followerMax,
          cta_keywords: keywords.input.value.trim(),
          onboarding_step: "offer"
        }).eq("agent_id", state.businessId);
        if (saved.error) toast(saved.error.message, "bad");
        else {
          toast("ICP saved.");
          await bootBusiness(state.businessId);
          ctx.go("onboarding");
        }
      }));
    }
  }

  if (step === "offer") {
    card.append(el("h3", { text: "Offer and booking link" }));
    card.append(el("p", { text: "The opener and the setter may use only this offer. The booking link is sent when Google Calendar is not connected." }));
    const offer = area(ctx, "Offer", settings.offer_summary || "");
    const booking = field("Booking link", settings.booking_fallback_url || "https://calendar.app.google/8i1gomkozavqYU5b8");
    card.append(offer.label, booking.label);
    if (state.canEdit && state.supabase) {
      card.append(button("Save and continue", async () => {
        const saved = await state.supabase.from("acq_settings").update({
          offer_summary: offer.input.value.trim(),
          booking_fallback_url: booking.input.value.trim() || "https://calendar.app.google/8i1gomkozavqYU5b8",
          onboarding_step: "connect"
        }).eq("agent_id", state.businessId);
        if (saved.error) toast(saved.error.message, "bad");
        else {
          toast("Offer saved.");
          await bootBusiness(state.businessId);
          ctx.go("onboarding");
        }
      }));
    }
  }

  if (step === "connect") {
    card.append(el("h3", { text: "Connect Instagram" }));
    card.append(el("p", { text: "Enter the Instagram handle. Status stays on Pending activation until an admin links the engine agent. The Roleflow Meta app is the other path when that app is available." }));
    host.append(card);
    paintSetterEngine(host, ctx);
    const meta = el("article", { class: "agent" });
    meta.append(el("h3", { text: "Roleflow Meta engine" }));
    meta.append(el("p", { text: "Connect the professional Instagram account when the Meta app is available. The token stays on the server." }));
    if (state.canEdit && state.supabase) {
      meta.append(button("Connect Instagram", () => startOauth(ctx, "meta_start")));
      meta.append(button("Continue to the worker", () => advanceWizard(ctx, "worker")));
    }
    host.append(meta);
    return;
  }

  if (step === "worker") {
    card.append(el("h3", { text: "Browser worker" }));
    card.append(el("p", { text: "Generate the rfw_ worker key in this panel. It is shown once. The assistant on its own computer uses it to fetch today's queue and post discovered profiles. Instagram passwords are not stored." }));
    const workers = state.workers || [];
    if (!workers.length) card.append(el("p", { text: "No worker key yet." }));
    workers.forEach((row) => card.append(el("p", { text: (row.label || "Worker") + " · " + row.key_prefix + "…" })));
    if (state.issuedKey) card.append(el("p", { class: "key-once", text: "Copy this key now. It is not shown again: " + state.issuedKey }));
    if (state.canEdit && state.supabase) {
      card.append(button("Generate worker key", async () => {
        const issued = await state.supabase.rpc("acq_worker_issue", { p_business: state.businessId });
        if (issued.error) toast(issued.error.message, "bad");
        else {
          state.issuedKey = issued.data && issued.data.api_key;
          toast("Worker key generated. Copy it now. It is shown once.");
          await bootBusiness(state.businessId);
          ctx.go("onboarding");
        }
      }));
      card.append(button("Continue to voice notes", () => advanceWizard(ctx, "voice")));
    }
  }

  if (step === "voice") {
    card.append(el("h3", { text: "Voice notes" }));
    card.append(el("p", { text: "Upload your own recordings. The opener is the one Personalised Outreach sends. A cloned voice is not used." }));
    const slot = el("select", { "aria-label": "Voice note slot" });
    [["outreach_opener", "Outreach opener"], ["gap_building", "Gap building"], ["booking_confirmation", "Booking confirmation"], ["reminder", "Reminder"]].forEach(([value, label]) => {
      slot.append(el("option", { value, text: label }));
    });
    const title = field("Title", "Opener");
    const file = el("input", { type: "file", accept: "audio/*", "aria-label": "Voice recording" });
    card.append(slot, title.label, file);
    if (state.canEdit && state.supabase && ctx.uploadVoice) {
      card.append(button("Upload recording", async () => {
        const chosen = file.files && file.files[0];
        if (!chosen) {
          toast("Choose a recording.", "bad");
          return;
        }
        await ctx.uploadVoice(chosen, { slot: slot.value, title: title.input.value, niche: settings.niche || "", variant: "", hint: "" });
      }));
    }
    card.append(el("a", { class: "btn sm", href: "#voice" }, ["Open all voice-note slots"]));
    if (state.canEdit && state.supabase) card.append(button("Continue to go live", () => advanceWizard(ctx, "live")));
  }

  if (step === "live") {
    card.append(el("h3", { text: "Go live" }));
    card.append(el("p", { text: "Turns the system on and turns each of the eight agents on. You can switch any agent off on Workforce. Chief of Staff writes a daily summary and fills the worker queue under the daily cap." }));
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
        if (saved.error) {
          toast(saved.error.message, "bad");
          return;
        }
        const roles = ["chief_of_staff", "icp_acquisition", "engagement_warmup", "personalised_outreach", "comment_to_dm", "qualification", "conversation_recovery", "appointment_booking"];
        await Promise.all(roles.map((role) => state.supabase.from("business_workforce").update({ status: "active" }).eq("agent_id", state.businessId).eq("role", role)));
        toast("This business is live.");
        await bootBusiness(state.businessId);
        ctx.go("overview");
      }));
    }
  }

  host.append(card);
}

async function advanceWizard(ctx, next) {
  const saved = await ctx.state.supabase.from("acq_settings").update({ onboarding_step: next }).eq("agent_id", ctx.state.businessId);
  if (saved.error) ctx.toast(saved.error.message, "bad");
  else {
    await ctx.bootBusiness(ctx.state.businessId);
    ctx.go("onboarding");
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

export async function callSetterEngine(ctx, action, extra) {
  if (!ctx.state.supabase) throw new Error("Sign in to use this.");
  const session = await ctx.state.supabase.auth.getSession();
  const token = session.data.session && session.data.session.access_token;
  const root = globalThis.ROLEFLOW_SUPABASE || {};
  const base = String(root.SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/setter-engine";
  const response = await fetch(base, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + (token || ""),
      apikey: root.SUPABASE_ANON_KEY || "",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action, business_id: ctx.state.businessId, ...(extra || {}) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
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
