import { createDb } from "./db.mjs";
import { routeActions, routeDue, routeResult, routeRuns, routeTick } from "./handlers.mjs";

export function deps(req, res) {
  const env = process.env;
  const complete = env.XAI_API_KEY ? (messages) => grok(env, messages) : null;
  return { db: createDb(env), complete, res };
}

export function due(req, res) {
  return routeDue(req, res, deps(req, res));
}

export function runs(req, res) {
  return routeRuns(req, res, deps(req, res));
}

export function actions(req, res) {
  return routeActions(req, res, deps(req, res));
}

export function result(req, res) {
  const query = Object.assign({}, req.query || {});
  return routeResult(Object.assign({}, req, { query }), res, deps(req, res));
}

export function tick(req, res) {
  return routeTick(req, res, deps(req, res));
}

async function grok(env, messages) {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.XAI_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.XAI_MODEL || "grok-4.3",
      temperature: 0.2,
      messages
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("The model did not answer.");
  const text = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content
    : "";
  return String(text || "");
}
