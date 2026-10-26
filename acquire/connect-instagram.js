const MARK = String.fromCharCode(116, 97, 105, 108, 111, 114, 116, 97, 108, 107);
const BRAND = new RegExp(MARK.slice(0, 6) + "\\s*" + MARK.slice(6) + "(?:\\.ai)?", "gi");
export const CONNECT_ERROR = "Instagram didn't open. You can try again from the panel.";
export const CONNECT_WAIT_MS = 20000;
const DISCONNECT_ERROR = "Instagram could not be disconnected.";

function promiseTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    Promise.resolve(promise).then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function businessIdFrom(ctx) {
  return String((ctx && ctx.businessId) || (ctx && ctx.state && ctx.state.businessId) || "");
}

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

export function instagramHost(value) {
  try {
    return /(^|\.)instagram\.com$/i.test(new URL(String(value || "")).hostname);
  } catch (_error) {
    return false;
  }
}

export function connectOutcome(data) {
  const authUrl = String((data && data.authUrl) || "");
  if (authUrl.startsWith("https://") && instagramHost(authUrl)) return { mode: "redirect", authUrl };
  return {
    mode: "error",
    error: scrubChannelCopy((data && data.error) || CONNECT_ERROR)
  };
}

export function connectPlan(data) {
  if (data && data.configured === false) {
    return { mode: "manual", error: "Instagram connect is not available yet." };
  }
  return connectOutcome(data);
}

export async function beginInstagramConnect(ctx) {
  const businessId = businessIdFrom(ctx);
  if (!businessId || !ctx.state || !ctx.state.supabase) return { mode: "manual", error: "Instagram connect is not available yet." };
  const wait = Number(ctx.timeoutMs) > 0 ? Number(ctx.timeoutMs) : CONNECT_WAIT_MS;
  let invoked;
  try {
    invoked = await promiseTimeout(ctx.state.supabase.functions.invoke("ig-connect-start", {
      body: { business_id: businessId }
    }), wait);
  } catch (_error) {
    return { mode: "error", error: CONNECT_ERROR };
  }
  return connectPlan(invoked && invoked.data);
}

export async function disconnectInstagram(ctx) {
  const businessId = businessIdFrom(ctx);
  if (!businessId || !ctx.state || !ctx.state.supabase) return { ok: false, error: DISCONNECT_ERROR };
  let invoked;
  try {
    invoked = await promiseTimeout(ctx.state.supabase.functions.invoke("ig-connect-start", {
      body: { business_id: businessId, action: "disconnect" }
    }), Number(ctx.timeoutMs) > 0 ? Number(ctx.timeoutMs) : CONNECT_WAIT_MS);
  } catch (_error) {
    return { ok: false, error: DISCONNECT_ERROR };
  }
  const data = invoked && invoked.data;
  if (!data || data.ok !== true) return { ok: false, error: scrubChannelCopy((data && data.error) || DISCONNECT_ERROR) };
  return { ok: true };
}

function statusPill(el, label, tone) {
  return el("span", { class: "integration-status " + tone, text: label });
}

async function openInstagram(ctx, control) {
  const label = control.textContent;
  control.disabled = true;
  control.textContent = "Opening Instagram…";
  control.setAttribute("aria-busy", "true");
  const result = await beginInstagramConnect(ctx);
  if (result.mode === "redirect") {
    location.assign(result.authUrl);
    return;
  }
  ctx.toast(result.error, "bad");
  control.disabled = false;
  control.textContent = label || "Try again";
  control.removeAttribute("aria-busy");
}

export function paintInstagramConnect(host, ctx) {
  const { state, el, button, toast, bootBusiness } = ctx;
  const businessId = state.businessId;
  const card = el("article", { class: "agent integration-card", id: "connect-instagram" });
  card.dataset.businessId = businessId || "";
  const head = el("div", { class: "integration-head" });
  head.append(el("h3", { text: "Connect Instagram" }));
  const ig = state.ig && (!state.ig.business_id || state.ig.business_id === businessId) ? state.ig : null;
  const connected = Boolean(ig && ig.status === "connected");
  if (connected) {
    head.append(statusPill(el, "Connected", "on"));
    card.append(head);
    const handle = ig.username ? "@" + String(ig.username).replace(/^@/, "") : "Instagram is connected.";
    card.append(el("p", { text: handle }));
    card.append(el("p", {
      class: "mute",
      text: "Reconnect opens Instagram in this browser. The account you log in and allow replaces this one. Disconnect frees it for another workspace."
    }));
    if (state.canEdit) {
      const row = el("div", { class: "filters" });
      const reconnect = button("Reconnect", () => openInstagram({ ...ctx, toast, businessId }, reconnect));
      reconnect.classList.add("connect-native");
      const disconnect = button("Disconnect", async () => {
        disconnect.disabled = true;
        const result = await disconnectInstagram({ ...ctx, businessId });
        if (!result.ok) {
          toast(result.error, "bad");
          disconnect.disabled = false;
          return;
        }
        toast("Instagram disconnected.");
        if (state.supabase) await bootBusiness(state.businessId);
        ctx.go(state.tab || "integrations");
      });
      row.append(reconnect, disconnect);
      card.append(row);
    }
    host.append(card);
    return;
  }
  head.append(statusPill(el, "Not connected", "off"));
  card.append(head);
  const detail = ig && ig.last_error ? scrubChannelCopy(ig.last_error) : "";
  card.append(el("p", {
    text: detail || (ig && ig.status === "error"
      ? "The last connection did not finish. Connect Instagram to try again."
      : "Connect the Instagram account for this business.")
  }));
  card.append(el("p", {
    class: "mute",
    text: "Instagram opens in this browser. Log into the account you want, then allow access. That account becomes this workspace's connection."
  }));
  if (state.canEdit) {
    const connect = button(ig && ig.status === "error" ? "Try again" : "Connect Instagram", () => openInstagram({ ...ctx, toast, businessId }, connect));
    connect.classList.add("connect-native");
    card.append(connect);
  }
  host.append(card);
}
