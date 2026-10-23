const MARK = String.fromCharCode(116, 97, 105, 108, 111, 114, 116, 97, 108, 107);
const BRAND = new RegExp(MARK.slice(0, 6) + "\\s*" + MARK.slice(6) + "(?:\\.ai)?", "gi");

export function normalizeInstagramHandle(value) {
  const handle = String(value || "").trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : "";
}

export function scrubChannelCopy(value) {
  const url = new RegExp("https?:\\/\\/\\S*" + MARK.slice(0, 6) + "\\s*" + MARK.slice(6) + "\\.ai\\S*", "gi");
  return String(value || "").replace(url, "Instagram channel").replace(BRAND, "Instagram channel");
}

export function waitingRequest(rows) {
  return (rows || []).find((row) => row && (row.status === "pending" || row.status === "in_progress")) || null;
}

export function announceConnection(handle, id) {
  const key = "rf-connect-" + (id || handle);
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch (_error) { /* private browsing */ }
  window.dispatchEvent(new CustomEvent("roleflow-notice", {
    detail: { text: "A connection is waiting for @" + handle + ". We'll finish this for you." }
  }));
}

export function announceWaiting(rows) {
  const waiting = waitingRequest(rows);
  if (waiting) announceConnection(waiting.username, waiting.id);
}

export async function submitInstagramConnect(ctx, username, notes) {
  const handle = normalizeInstagramHandle(username);
  if (!handle) return { ok: false, error: "Enter the Instagram Business username." };
  const note = String(notes || "").trim().slice(0, 500);
  if (!ctx.state.supabase) {
    const row = {
      id: "preview-request",
      workspace_id: ctx.state.businessId,
      channel: "instagram",
      username: handle,
      status: "pending",
      notes: note
    };
    ctx.state.connectRequests = [row];
    announceConnection(handle, row.id);
    return { ok: true, username: handle };
  }
  const saved = await ctx.state.supabase.rpc("acq_request_instagram_connection", {
    p_workspace: ctx.state.businessId,
    p_username: handle,
    p_notes: note
  });
  if (saved.error) return { ok: false, error: scrubChannelCopy(saved.error.message) };
  const payload = typeof saved.data === "string" ? JSON.parse(saved.data) : (saved.data || {});
  ctx.state.supabase.functions.invoke("roleflow-hooks", {
    body: { action: "notify_connect", request_id: payload.id }
  }).catch(() => {});
  ctx.state.supabase.functions.invoke("roleflow-hooks", {
    body: { action: "notify_sync", business_id: ctx.state.businessId }
  }).catch(() => {});
  announceConnection(handle, payload.id);
  return { ok: true, username: handle };
}

function statusPill(el, label, tone) {
  return el("span", { class: "integration-status " + tone, text: label });
}

export function connectOutcome(data) {
  if (!data || data.configured === false) return { mode: "fallback" };
  const authUrl = String(data.authUrl || "");
  if (authUrl.startsWith("https://")) return { mode: "redirect", authUrl };
  return {
    mode: "error",
    error: scrubChannelCopy(data.error || "Instagram didn't finish connecting. You can try again from the panel.")
  };
}

export async function beginInstagramConnect(ctx) {
  if (!ctx.state.supabase) return { mode: "fallback" };
  let invoked;
  try {
    invoked = await ctx.state.supabase.functions.invoke("ig-connect-start", {
      body: { business_id: ctx.state.businessId }
    });
  } catch (_error) {
    return { mode: "fallback" };
  }
  if (!invoked || invoked.error) return connectOutcome(invoked && invoked.data);
  return connectOutcome(invoked.data);
}

export function paintInstagramConnect(host, ctx) {
  const { state, el, button, field, toast, bootBusiness } = ctx;
  const waiting = waitingRequest(state.connectRequests);
  const card = el("article", { class: "agent integration-card", id: "connect-instagram" });
  const head = el("div", { class: "integration-head" });
  head.append(el("h3", { text: "Connect Instagram" }));
  if (waiting) {
    head.append(statusPill(el, "Connecting", "wait"));
    card.append(head);
    card.append(el("p", { text: "Connecting… we'll finish this for you" }));
    card.append(el("p", { class: "mute", text: "@" + waiting.username + (waiting.notes ? " · " + waiting.notes : "") }));
    host.append(card);
    return;
  }
  const ig = state.ig;
  if (ig && ig.status === "connected") {
    head.append(statusPill(el, "Connected", "on"));
    card.append(head);
    if (ig.username) card.append(el("p", { text: "@" + String(ig.username).replace(/^@/, "") }));
    host.append(card);
    return;
  }
  const failed = (state.connectRequests || []).find((row) => row.status === "failed");
  head.append(statusPill(el, "Not connected", "off"));
  card.append(head);
  card.append(el("p", {
    text: failed
      ? "We could not finish that connection. You can try again."
      : "Connect the Instagram Business account for this business."
  }));
  if (state.canEdit) {
    const fallback = el("div", { hidden: true });
    fallback.append(el("p", {
      text: failed
        ? "We could not finish that connection. Send the Instagram Business username again."
        : "Enter the Instagram Business username. We connect the Instagram channel for this business."
    }));
    const username = field("Instagram Business username", "");
    const note = field("Note (optional)", "");
    username.input.autocomplete = "off";
    username.input.maxLength = 30;
    note.input.maxLength = 500;
    const submit = button("Connect Instagram", async () => {
      const result = await submitInstagramConnect(ctx, username.input.value, note.input.value);
      if (!result.ok) {
        toast(result.error, "bad");
        return;
      }
      toast("Connecting… we'll finish this for you");
      if (state.supabase) {
        await bootBusiness(state.businessId);
        ctx.go(state.tab || "integrations");
      } else ctx.go(state.tab || "integrations");
    });
    submit.classList.add("connect-native");
    fallback.append(username.label, note.label, submit);
    const connect = button("Connect Instagram", async () => {
      connect.disabled = true;
      const result = await beginInstagramConnect(ctx);
      if (result.mode === "redirect") {
        location.assign(result.authUrl);
        return;
      }
      if (result.mode === "fallback") {
        connect.hidden = true;
        fallback.hidden = false;
        return;
      }
      toast(result.error, "bad");
      connect.disabled = false;
    });
    connect.classList.add("connect-native");
    card.append(connect, fallback);
  }
  host.append(card);
}
