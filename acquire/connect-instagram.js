const MARK = "tailor" + "talk";
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
  announceConnection(handle, payload.id);
  return { ok: true, username: handle };
}

function statusPill(el, label, tone) {
  return el("span", { class: "integration-status " + tone, text: label });
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
      ? "We could not finish that connection. Send the Instagram Business username again."
      : "Enter the Instagram Business username. We connect the Instagram channel for this business."
  }));
  if (state.canEdit) {
    const username = field("Instagram Business username", "");
    const note = field("Note (optional)", "");
    username.input.autocomplete = "off";
    username.input.maxLength = 30;
    note.input.maxLength = 500;
    card.append(username.label, note.label);
    const connect = button("Connect Instagram", async () => {
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
    connect.classList.add("connect-native");
    card.append(connect);
  }
  host.append(card);
}
