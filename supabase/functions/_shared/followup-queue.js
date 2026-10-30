// Queues 24-hour ladder steps and welcome steps. Used by the follow-up tick
// and by the conversation engine tick. The DM gate is read first: while
// sending is off, a due step is recorded as held and nothing is queued.

import { agentEnabled, followupLead } from "./agent-control.js";
import { readDmGate } from "./dm-gate.js";
import { followupCycle, followupKey, ladderDecision, welcomeDecision } from "./followup-ladder.js";

async function rows(promise) {
  try {
    const res = await promise;
    return res && !res.error ? res.data || [] : [];
  } catch (_error) {
    return [];
  }
}

async function record(db, row) {
  await db.from("acq_followup_sends").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "thread_id,step_id,cycle" });
}

async function leadFacts(db, businessId, thread) {
  const last = await rows(db.from("ig_messages").select("direction, created_at").eq("thread_id", thread.id).eq("business_id", businessId).order("created_at", { ascending: false }).limit(1));
  const lastOut = await rows(db.from("ig_messages").select("created_at").eq("thread_id", thread.id).eq("business_id", businessId).eq("direction", "out").order("created_at", { ascending: false }).limit(1));
  const firstOut = await rows(db.from("ig_messages").select("created_at").eq("thread_id", thread.id).eq("business_id", businessId).eq("direction", "out").order("created_at", { ascending: true }).limit(1));
  const handle = String(thread.username || "").replace(/^@/, "");
  const externalId = String(thread.igsid || "").trim();
  let contact = externalId
    ? (await rows(db.from("acq_contacts").select("id, we_follow, automated, crm_state").eq("business_id", businessId).eq("external_id", externalId).limit(1)))[0] || null
    : null;
  if (!contact && handle) {
    contact = (await rows(db.from("acq_contacts").select("id, we_follow, automated, crm_state").eq("business_id", businessId).ilike("ig_handle", handle).limit(1)))[0] || null;
  }
  const resume = thread.target_id
    ? await rows(db.from("acq_reminders").select("id").eq("business_id", businessId).eq("target_id", thread.target_id).eq("kind", "resume").eq("status", "open").limit(1))
    : contact
      ? await rows(db.from("acq_reminders").select("id").eq("business_id", businessId).eq("contact_id", contact.id).eq("kind", "resume").eq("status", "open").limit(1))
      : [];
  const firstAt = firstOut[0] ? firstOut[0].created_at : "";
  const repliedAfter = firstAt && thread.last_user_message_at ? Date.parse(thread.last_user_message_at) > Date.parse(firstAt) : false;
  return {
    contact,
    lastFromLead: last[0] ? last[0].direction === "in" : false,
    lastBusinessMessageAt: lastOut[0] ? lastOut[0].created_at : "",
    firstBusinessMessageAt: firstAt,
    leadRepliedAfterFirst: repliedAfter,
    resumeReminderOpen: resume.length > 0
  };
}

export async function queueFollowups(db, settings, now) {
  const businessId = settings.agent_id;
  if (!await agentEnabled(db, businessId, "followup")) return { queued: 0, held: 0 };
  const gate = await readDmGate(db, businessId);
  const steps = await rows(db.from("acq_followup_steps").select("id, hours, mode, body, crm_state, asset_id, voice_note_id, state_prompts, enabled").eq("business_id", businessId).eq("enabled", true));
  const welcome = await rows(db.from("acq_welcome_steps").select("id, position, delay_hours, mode, body").eq("business_id", businessId));
  if (!steps.length && !welcome.length) return { queued: 0, held: 0 };
  const threads = await rows(db.from("ig_threads").select("*").eq("business_id", businessId).eq("human_locked", false).limit(100));
  let queued = 0;
  let held = 0;
  for (const thread of threads) {
    const facts = await leadFacts(db, businessId, thread);
    const base = followupLead(thread);
    const state = facts.contact && facts.contact.crm_state ? String(facts.contact.crm_state) : base.stage;
    const lead = {
      state,
      automated: facts.contact ? facts.contact.automated !== false : true,
      weFollow: facts.contact ? facts.contact.we_follow === true : false,
      humanLocked: base.humanLocked,
      humanWrote: thread.state === "human",
      lastUserMessageAt: thread.last_user_message_at,
      ...facts
    };
    const cycle = followupCycle(settings.followup_restart_on_reply === true, thread.last_user_message_at);
    const sends = await rows(db.from("acq_followup_sends").select("step_id, status, track, cycle").eq("thread_id", thread.id).in("cycle", [cycle, "welcome"]));
    const doneAuto = sends.filter((row) => row.track === "auto" && row.cycle === cycle && row.status !== "held").map((row) => row.step_id);
    const doneWelcome = sends.filter((row) => row.track === "welcome" && row.status !== "held").map((row) => row.step_id);
    const plans = [];
    if (steps.length) {
      const decision = ladderDecision({
        steps,
        doneStepIds: doneAuto,
        lead,
        now,
        skipFollowed: settings.skip_followed === true,
        beforeClose: settings.followup_before_close === true,
        office: { mode: settings.office_mode, start: settings.office_start, end: settings.office_end, timeZone: settings.timezone }
      });
      plans.push({ track: "auto", cycle, decision });
    }
    if (welcome.length) plans.push({ track: "welcome", cycle: "welcome", decision: welcomeDecision({ steps: welcome, doneStepIds: doneWelcome, lead, now }) });
    for (const plan of plans) {
      const { decision } = plan;
      if (!decision.step || decision.action === "wait") continue;
      const base = {
        business_id: businessId,
        track: plan.track,
        step_id: decision.step.id,
        thread_id: thread.id,
        target_id: thread.target_id || null,
        contact_id: facts.contact ? facts.contact.id : null,
        cycle: plan.cycle
      };
      if (decision.action === "skip") {
        await record(db, { ...base, status: "skipped", reason: decision.reason });
        continue;
      }
      if (!gate.open) {
        await record(db, { ...base, status: "held", reason: gate.reason });
        held += 1;
        continue;
      }
      const inserted = await db.from("ig_outbox").insert({
        business_id: businessId,
        thread_id: thread.id,
        kind: "recovery",
        payload: { text: "", event_kind: "message", track: plan.track, step_id: decision.step.id, cycle: plan.cycle },
        run_at: new Date(now).toISOString(),
        idempotency_key: followupKey(thread.id, decision.step.id, plan.cycle)
      });
      if (inserted.error) continue;
      await record(db, { ...base, status: "queued", reason: decision.reason });
      queued += 1;
      await db.from("ig_threads").update({
        followup_count: (Number(thread.followup_count) || 0) + 1,
        state: thread.state === "comment_to_dm" ? "qualification" : "recovery"
      }).eq("id", thread.id).eq("business_id", businessId);
      break;
    }
  }
  return { queued, held };
}
