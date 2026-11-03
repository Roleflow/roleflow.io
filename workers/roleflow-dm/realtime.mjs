// Outbound Realtime socket to Supabase on port 443. Payloads are not logged.

import { loginChannel } from "../../acquire/dm-login.js";

export function realtimeSocketUrl(supabaseUrl, apiKey) {
  const host = new URL(String(supabaseUrl || "")).host;
  if (!host || !apiKey) return "";
  return "wss://" + host + "/realtime/v1/websocket?apikey=" + encodeURIComponent(apiKey) + "&vsn=1.0.0";
}

export function encodeRealtime(message) {
  return JSON.stringify([
    message.joinRef || null,
    message.ref || null,
    message.topic,
    message.event,
    message.payload || {}
  ]);
}

export function decodeRealtime(raw) {
  let data;
  try { data = JSON.parse(String(raw || "")); } catch (_error) { return null; }
  if (!Array.isArray(data) || data.length < 5) return null;
  return { joinRef: data[0], ref: data[1], topic: data[2], event: data[3], payload: data[4] };
}

export function joinMessage(topic, accessToken, ref) {
  return {
    joinRef: ref,
    ref,
    topic: "realtime:" + topic,
    event: "phx_join",
    payload: {
      config: {
        broadcast: { ack: false, self: false },
        presence: { key: "" },
        private: true
      },
      access_token: accessToken
    }
  };
}

export function broadcastMessage(topic, event, payload, ref, joinRef) {
  return {
    joinRef,
    ref,
    topic: "realtime:" + topic,
    event: "broadcast",
    payload: { type: "broadcast", event, payload }
  };
}

const RECONNECT_MS = [1000, 2000, 5000, 10000, 30000];
const PENDING_LIMIT = 50;

// One outbound socket that reconnects on its own and rejoins every open login channel.
// Frames are never queued while the socket is down; only joins, leaves and status are.
export function createRealtime(options) {
  const Socket = options.WebSocket || globalThis.WebSocket;
  const accessToken = options.key || "";
  const url = realtimeSocketUrl(options.url, accessToken);
  const channels = new Map();
  const pending = [];
  const schedule = options.setTimeout || setTimeout;
  const log = options.log || (() => {});
  let socket = null;
  let opened = false;
  let stopped = false;
  let attempts = 0;
  let ref = 0;
  const nextRef = () => String(++ref);

  function queue(encoded) {
    pending.push(encoded);
    if (pending.length > PENDING_LIMIT) pending.splice(0, pending.length - PENDING_LIMIT);
  }

  function transmit(message) {
    const encoded = encodeRealtime(message);
    if (!opened) queue(encoded);
    else socket.send(encoded);
  }

  function rejoin(full) {
    const channel = channels.get(full);
    if (!channel) return;
    channel.joinRef = nextRef();
    transmit(joinMessage(channel.topic, accessToken, channel.joinRef));
  }

  function connect() {
    if (stopped) return;
    let current;
    try { current = new Socket(url, options.protocols); } catch (_error) {
      retry();
      return;
    }
    socket = current;
    current.onopen = () => {
      if (socket !== current) return;
      opened = true;
      attempts = 0;
      const queued = pending.splice(0);
      const joins = new Set();
      for (const encoded of queued) {
        const message = decodeRealtime(encoded);
        if (message && message.event === "phx_join") joins.add(message.topic);
      }
      queued.forEach((encoded) => current.send(encoded));
      for (const full of channels.keys()) if (!joins.has(full)) rejoin(full);
      log("realtime");
    };
    current.onmessage = (event) => {
      const message = decodeRealtime(event && event.data);
      if (!message) return;
      const channel = channels.get(message.topic);
      if (!channel) return;
      if (message.event === "phx_error" || message.event === "phx_close") {
        if (message.joinRef && message.joinRef !== channel.joinRef) return;
        log("realtime_rejoin");
        schedule(() => rejoin(message.topic), 1000);
        return;
      }
      if (message.event === "phx_reply" && message.payload && message.payload.status === "error") {
        log("realtime_join_error");
        return;
      }
      if (message.event !== "broadcast") return;
      const body = message.payload && message.payload.payload;
      const name = message.payload && message.payload.event;
      if (name === "input") channel.onInput(body);
    };
    current.onerror = () => {};
    current.onclose = () => {
      if (socket !== current) return;
      opened = false;
      log("realtime_closed");
      retry();
    };
  }

  function retry() {
    if (stopped) return;
    const wait = RECONNECT_MS[Math.min(attempts, RECONNECT_MS.length - 1)];
    attempts += 1;
    const timer = schedule(connect, wait);
    if (timer && timer.unref) timer.unref();
  }

  connect();

  const beat = options.heartbeatMs === 0 ? null : setInterval(() => {
    if (opened) transmit({ topic: "phoenix", event: "heartbeat", payload: {}, ref: nextRef() });
  }, options.heartbeatMs || 20000);
  if (beat && beat.unref) beat.unref();

  return {
    isOpen() { return opened; },
    join(tokenHash, onInput) {
      const topic = loginChannel(tokenHash);
      const full = "realtime:" + topic;
      const channel = { topic, joinRef: nextRef(), onInput: onInput || (() => {}) };
      channels.set(full, channel);
      transmit(joinMessage(topic, accessToken, channel.joinRef));
      return {
        topic,
        send(event, payload) {
          const encoded = encodeRealtime(broadcastMessage(topic, event, payload, nextRef(), channel.joinRef));
          if (encoded.length > 200000) return false;
          if (!opened) {
            // A frame sent into a dead socket is lost; the relay resends the latest one.
            if (event !== "frame") queue(encoded);
            return false;
          }
          socket.send(encoded);
          return true;
        },
        close() {
          channels.delete(full);
          transmit({ joinRef: channel.joinRef, ref: nextRef(), topic: full, event: "phx_leave", payload: {} });
        }
      };
    },
    close() {
      stopped = true;
      if (beat) clearInterval(beat);
      if (socket) socket.close();
    }
  };
}
