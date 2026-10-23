// Runner HTTP handlers. The bearer is the workforce secret or CRON_SECRET.
// Reasoning actions can be completed here. Browser actions stay approved.

import {
  ACTION_TYPES,
  AGENT_ROLES,
  BROWSER_TYPES,
  REASONING_TYPES,
  actionStatus,
  bearerMatches,
  crmWrite,
  dueContext,
  executorFor,
  isDue,
  parseModelActions,
  runnerMessages,
  validCron,
  validZone
} from "../../acquire/workforce-model.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function routeDue(req, res, deps) {
  if (req.method !== "GET") return send(res, 405, { error: "Use GET." });
  const gate = await open(req, res, deps);
  if (gate) return gate;
  const now = deps.now ? new Date(deps.now) : new Date();
  const library = await deps.db.library();
  const routines = (library.routines || []).filter((row) => isDue(row, now)).slice(0, 50).map((row) => dueContext(row, library));
  return send(res, 200, { ok: true, now: now.toISOString(), routines });
}

export async function routeRuns(req, res, deps) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const gate = await open(req, res, deps);
  if (gate) return gate;
  const body = await readBody(req);
  const businessId = String(body.business_id || "");
  const role = String(body.agent_role || "");
  if (!UUID.test(businessId) || !AGENT_ROLES.includes(role)) return send(res, 400, { error: "business_id and agent_role are required." });
  const routineId = body.routine_id ? String(body.routine_id) : null;
  if (routineId && !UUID.test(routineId)) return send(res, 400, { error: "routine_id must be a UUID." });
  const parsed = parseModelActions(JSON.stringify({ summary: body.summary || "", actions: body.actions || [] }));
  const auto = await deps.db.autoApprove(businessId, role);
  const status = body.error ? "error" : parsed.actions.some((row) => actionStatus(row.type, auto) === "proposed") ? "waiting" : "ok";
  const run = await deps.db.insertRun({
    business_id: businessId,
    agent_role: role,
    routine_id: routineId,
    started_at: body.started_at || new Date().toISOString(),
    ended_at: body.ended_at || new Date().toISOString(),
    status,
    summary: parsed.summary,
    error: String(body.error || "").slice(0, 500)
  });
  const actions = [];
  for (const row of parsed.actions) {
    const saved = await deps.db.insertAction({
      business_id: businessId,
      agent_role: role,
      run_id: run.id,
      type: row.type,
      target: row.target,
      payload: row.payload,
      status: actionStatus(row.type, auto)
    });
    actions.push({ id: saved.id, type: row.type, status: saved.status, executor: executorFor(row.type) });
  }
  if (routineId) await deps.db.touchRoutine(routineId, new Date().toISOString());
  return send(res, 200, { ok: true, run_id: run.id, actions, skipped: parsed.skipped });
}

export async function routeActions(req, res, deps) {
  if (req.method !== "GET") return send(res, 405, { error: "Use GET." });
  const gate = await open(req, res, deps);
  if (gate) return gate;
  const status = String((req.query && req.query.status) || "");
  if (!["proposed", "approved", "done", "failed", "rejected"].includes(status)) return send(res, 400, { error: "status is required." });
  const executor = String((req.query && req.query.executor) || (status === "approved" ? "browser" : ""));
  const rows = await deps.db.listActions(status);
  const actions = rows.filter((row) => !executor || executorFor(row.type) === executor).map(publicAction);
  return send(res, 200, { ok: true, actions });
}

export async function routeResult(req, res, deps) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const gate = await open(req, res, deps);
  if (gate) return gate;
  const id = String((req.query && req.query.id) || "");
  if (!UUID.test(id)) return send(res, 400, { error: "Action id must be a UUID." });
  const body = await readBody(req);
  const status = String(body.status || "");
  if (status !== "done" && status !== "failed") return send(res, 400, { error: "status must be done or failed." });
  const current = await deps.db.getAction(id);
  if (!current) return send(res, 404, { error: "Action not found." });
  if (current.status !== "approved") return send(res, 409, { error: "Only an approved action can be finished." });
  if (wantsMessage(body)) return send(res, 400, { error: "This action would message a lead." });
  const saved = await deps.db.finishAction(id, {
    status,
    result: body.result && typeof body.result === "object" ? body.result : {},
    error: String(body.error || body.summary || "").slice(0, 500)
  });
  return send(res, 200, { ok: true, action: publicAction(saved) });
}

export async function routeTick(req, res, deps) {
  if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { error: "Use GET." });
  const gate = await open(req, res, deps);
  if (gate) return gate;
  const now = deps.now ? new Date(deps.now) : new Date();
  const library = await deps.db.library();
  const due = deps.complete ? (library.routines || []).filter((row) => isDue(row, now)).slice(0, 3) : [];
  let ran = 0;
  for (const routine of due) {
    const claimed = await deps.db.claimRoutine(routine.id, routine.last_run_at || null, now.toISOString());
    if (!claimed) continue;
    const context = dueContext(routine, library);
    const auto = await deps.db.autoApprove(routine.business_id, routine.agent_role);
    let produced = { summary: "", actions: [], skipped: [] };
    let runError = "";
    try {
      const text = await deps.complete(runnerMessages(context));
      produced = parseModelActions(text);
    } catch (error) {
      runError = String(error && error.message || "The model did not answer.").slice(0, 300);
    }
    const waiting = !runError && produced.actions.some((row) => actionStatus(row.type, auto) === "proposed");
    const run = await deps.db.insertRun({
      business_id: routine.business_id,
      agent_role: routine.agent_role,
      routine_id: routine.id,
      started_at: now.toISOString(),
      ended_at: new Date().toISOString(),
      status: runError ? "error" : waiting ? "waiting" : "ok",
      summary: produced.summary,
      error: runError
    });
    for (const row of produced.actions) {
      await deps.db.insertAction({
        business_id: routine.business_id,
        agent_role: routine.agent_role,
        run_id: run.id,
        type: row.type,
        target: row.target,
        payload: row.payload,
        status: actionStatus(row.type, auto)
      });
    }
    ran += 1;
  }
  const approved = (await deps.db.listActions("approved")).filter((row) => REASONING_TYPES.includes(row.type) && !row.claimed_at).slice(0, 5);
  let executed = 0;
  for (const action of approved) {
    if (!deps.complete && crmWrite(action).error) continue;
    const claim = await deps.db.claimAction(action.id);
    if (!claim) continue;
    const outcome = await finishReasoning(action, deps.complete);
    if (!outcome.error && (outcome.table || outcome.note)) await deps.db.applyCrm(action.business_id, outcome);
    await deps.db.finishAction(action.id, {
      status: outcome.error ? "failed" : "done",
      result: outcome.result || outcome.patch || {},
      error: outcome.error || ""
    });
    executed += 1;
  }
  const body = { ok: true, ran, executed };
  if (!deps.complete) body.skipped = "XAI_API_KEY is not set.";
  return send(res, 200, body);
}

async function finishReasoning(action, complete) {
  const ready = crmWrite(action);
  if (ready.error && action.type !== "research" && action.type !== "draft") return { error: ready.error, result: {} };
  if (!ready.error && (ready.result || ready.table || ready.note)) return { ...ready, error: ready.error || "" };
  try {
    const text = await complete([
      { role: "system", content: "Return JSON only: {\"draft\": string, \"note\": string, \"score\": number}. Do not send a message." },
      { role: "user", content: JSON.stringify({ type: action.type, target: action.target, payload: action.payload }) }
    ]);
    const parsed = parseModelActions(JSON.stringify({ summary: "", actions: [{ type: action.type, target: action.target, payload: { ...action.payload, ...readLoose(text) } }] }));
    const next = parsed.actions[0] || action;
    const filled = crmWrite(next);
    return filled.error ? { error: filled.error, result: {} } : filled;
  } catch (error) {
    return { error: String(error && error.message || "The model did not answer.").slice(0, 300), result: {} };
  }
}

function readLoose(text) {
  const start = String(text || "").indexOf("{");
  const end = String(text || "").lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    const parsed = JSON.parse(String(text).slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function publicAction(row) {
  return {
    id: row.id,
    business_id: row.business_id,
    agent_role: row.agent_role,
    run_id: row.run_id || null,
    type: row.type,
    target: row.target || "",
    payload: row.payload || {},
    status: row.status,
    executor: executorFor(row.type),
    approved_by: row.approved_by || null,
    error: row.error || ""
  };
}

function wantsMessage(body) {
  const result = body && body.result;
  if (!result || typeof result !== "object") return false;
  return Boolean(result.send || result.message || result.dm);
}

async function open(req, res, deps) {
  const secrets = await deps.db.secrets();
  const header = req.headers && (req.headers.authorization || req.headers.Authorization) || "";
  if (!bearerMatches(header, secrets)) return send(res, 401, { error: "Unauthorized." });
  return null;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) return JSON.parse(req.body);
  if (typeof req[Symbol.asyncIterator] !== "function" || req.body === "") return {};
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))).toString("utf8") || "{}");
}

function send(res, status, body) {
  res.statusCode = status;
  if (typeof res.status === "function") res.status(status);
  if (typeof res.json === "function") res.json(body);
  else res.body = body;
  return body;
}

export function validateRoutine(input) {
  const name = String(input.name || "").trim();
  const cron = String(input.cron || "").trim();
  const timezone = String(input.timezone || "").trim();
  if (!name || name.length > 120) return "Name the routine.";
  if (!validCron(cron)) return "Use a five-field schedule.";
  if (!validZone(timezone)) return "Use a timezone such as Europe/Madrid.";
  if (String(input.instructions || "").length > 4000) return "Shorten the instructions.";
  if (!AGENT_ROLES.includes(input.agent_role)) return "Choose an agent.";
  return "";
}

export { ACTION_TYPES, BROWSER_TYPES };
