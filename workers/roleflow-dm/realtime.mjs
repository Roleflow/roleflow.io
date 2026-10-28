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

export function createRealtime(options) {
  const Socket = options.WebSocket || globalThis.WebSocket;
  const accessToken = options.key || "";
  const url = realtimeSocketUrl(options.url, accessToken);
  const socket = new Socket(url, options.protocols);
  const channels = new Map();
  const pending = [];
  let opened = false;
  let ref = 0;
  const nextRef = () => String(++ref);
  const log = options.log || (() => {});

  function transmit(message) {
    const encoded = encodeRealtime(message);
    if (!opened) pending.push(encoded);
    else socket.send(encoded);
  }

  socket.onopen = () => {
    opened = true;
    pending.splice(0).forEach((encoded) => socket.send(encoded));
    log("realtime");
  };
  socket.onmessage = (event) => {
    const message = decodeRealtime(event && event.data);
    if (!message || message.event !== "broadcast") return;
    const channel = channels.get(message.topic);
    const body = message.payload && message.payload.payload;
    const name = message.payload && message.payload.event;
    if (channel && name === "input") channel.onInput(body);
  };
  socket.onerror = () => log("realtime_closed");
  socket.onclose = () => {
    opened = false;
    log("realtime_closed");
  };

  const beat = options.heartbeatMs === 0 ? null : setInterval(() => {
    transmit({ topic: "phoenix", event: "heartbeat", payload: {}, ref: nextRef() });
  }, options.heartbeatMs || 20000);
  if (beat && beat.unref) beat.unref();

  return {
    join(tokenHash, onInput) {
      const topic = loginChannel(tokenHash);
      const joinRef = nextRef();
      const full = "realtime:" + topic;
      channels.set(full, { onInput: onInput || (() => {}) });
      transmit(joinMessage(topic, accessToken, joinRef));
      return {
        topic,
        send(event, payload) {
          const encoded = encodeRealtime(broadcastMessage(topic, event, payload, nextRef(), joinRef));
          if (encoded.length > 200000) return false;
          if (!opened) pending.push(encoded);
          else socket.send(encoded);
          return true;
        },
        close() {
          channels.delete(full);
          transmit({ joinRef, ref: nextRef(), topic: full, event: "phx_leave", payload: {} });
        }
      };
    },
    close() {
      if (beat) clearInterval(beat);
      socket.close();
    }
  };
}
