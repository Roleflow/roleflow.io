import { createDb } from "./db.mjs";
import { routeCallback, routeDeletion, routeDisconnect, routeOutbox, routeRefresh, routeStart, routeWebhook } from "./handlers.mjs";

export function deps(env = process.env) {
  return { env, db: createDb(env), fetch };
}

export function start(req, res) {
  return routeStart(req, res, deps());
}

export function callback(req, res) {
  return routeCallback(req, res, deps());
}

export function disconnect(req, res) {
  return routeDisconnect(req, res, deps());
}

export function webhook(req, res) {
  return routeWebhook(req, res, deps());
}

export function refresh(req, res) {
  return routeRefresh(req, res, deps());
}

export function outbox(req, res) {
  return routeOutbox(req, res, deps());
}

export function deletion(req, res) {
  return routeDeletion(req, res, deps());
}
