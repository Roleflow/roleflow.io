import { proposalOf } from "./studio-ops-model.js";

export function bindAssistant(getContext) {
  const openBtn = document.getElementById("assistant-open");
  const panel = document.getElementById("assistant-panel");
  const closeBtn = document.getElementById("assistant-close");
  const form = document.getElementById("assistant-form");
  const input = document.getElementById("assistant-input");
  const mode = document.getElementById("assistant-mode");
  const log = document.getElementById("assistant-log");
  if (!openBtn || !panel || !form || !log) return;

  window.addEventListener("roleflow-notice", (event) => {
    const text = event.detail && event.detail.text;
    if (!text) return;
    openBtn.classList.add("has-notice");
    push("ask", text);
  });

  function syncEmpty() {
    const empty = document.getElementById("assistant-empty");
    if (empty) empty.hidden = log.childElementCount > 0;
  }

  function setOpen(open) {
    const ctx = getContext() || {};
    openBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) openBtn.classList.remove("has-notice");
    if (open && ctx.onOpen) ctx.onOpen();
    else if (!open && ctx.onClose) ctx.onClose();
    else panel.hidden = !open;
    syncEmpty();
    if (open && input) input.focus();
  }

  openBtn.addEventListener("click", () => setOpen(panel.hidden));
  if (closeBtn) closeBtn.addEventListener("click", () => setOpen(false));
  const expand = document.getElementById("assistant-expand");
  if (expand) expand.addEventListener("click", () => {
    const ctx = getContext() || {};
    if (ctx.onExpand) ctx.onExpand();
  });
  const fresh = document.getElementById("assistant-new");
  if (fresh) fresh.addEventListener("click", () => { log.replaceChildren(); syncEmpty(); });
  const history = document.getElementById("assistant-history");
  if (history) history.addEventListener("click", () => { log.scrollTop = 0; });
  const download = document.getElementById("assistant-download");
  if (download) download.addEventListener("click", () => {
    const file = new Blob([log.innerText || ""], { type: "text/plain" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "roleflow-assistant.txt";
    link.click();
    URL.revokeObjectURL(url);
  });
  document.querySelectorAll("#assistant-chips button").forEach((button) => {
    button.addEventListener("click", () => {
      if (mode) mode.value = button.dataset.mode || "ask";
      document.querySelectorAll("#assistant-chips button").forEach((item) => item.setAttribute("aria-pressed", item === button ? "true" : "false"));
    });
  });
  document.querySelectorAll("#assistant-prompts button").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = button.dataset.fill || button.textContent.replace(/\s*→\s*$/, "");
      input.focus();
    });
  });
  const attach = document.getElementById("assistant-attach");
  const file = document.getElementById("assistant-file");
  if (attach && file) attach.addEventListener("click", () => file.click());
  if (file) file.addEventListener("change", () => { file.value = ""; });
  const mic = document.getElementById("assistant-mic");
  if (mic) mic.addEventListener("click", () => { mic.setAttribute("aria-pressed", "false"); });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    ask(input.value.trim(), mode ? mode.value : "ask");
  });
  window.addEventListener("roleflow-ask", (event) => {
    const detail = event.detail || {};
    setOpen(true);
    if (mode && detail.mode) mode.value = detail.mode;
    ask(detail.message || "", detail.mode || "ask");
  });

  async function ask(message, selected) {
    if (!message) return;
    const ctx = getContext();
    if (!ctx.supabase || !ctx.businessId) {
      push("ask", "Open a business first.");
      return;
    }
    input.value = "";
    push("me", message);
    const pending = push("ask", "Thinking…");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const { data, error } = await ctx.supabase.functions.invoke("roleflow-assistant", {
        body: { business_id: ctx.businessId, message, mode: selected || "ask" }
      });
      if (error) throw new Error(await readInvokeError(error));
      if (data && data.error) throw new Error(String(data.error));
      pending.textContent = "";
      pending.append(linkify(data && data.reply ? String(data.reply) : "No answer came back."));
      const proposal = proposalOf(data && data.proposal);
      if (proposal && (selected === "leads" || selected === "ai")) confirm(proposal, ctx);
    } catch (error) {
      pending.textContent = error.message || "The assistant could not answer.";
    } finally {
      button.disabled = false;
    }
  }

  function confirm(proposal, ctx) {
    const row = document.createElement("div");
    row.className = "ask";
    const text = document.createElement("p");
    text.textContent = proposal.type === "lead"
      ? "Confirm moving @" + proposal.handle + " to " + proposal.crm_state + "?"
      : "Confirm this settings change? Nothing is saved until you confirm.";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "btn sm";
    yes.textContent = "Confirm";
    const no = document.createElement("button");
    no.type = "button";
    no.className = "btn sm ghost";
    no.textContent = "Discard";
    yes.addEventListener("click", async () => {
      yes.disabled = true;
      if (ctx.applyProposal) await ctx.applyProposal(proposal);
      text.textContent = "Confirmed.";
    });
    no.addEventListener("click", () => { text.textContent = "Discarded. Nothing changed."; });
    row.append(text, yes, no);
    log.append(row);
  }

  function push(kind, text) {
    const node = document.createElement("p");
    node.className = kind === "me" ? "me" : "ask";
    node.textContent = text;
    log.append(node);
    log.scrollTop = log.scrollHeight;
    const empty = document.getElementById("assistant-empty");
    if (empty) empty.hidden = true;
    return node;
  }
}

function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /#([a-z]+)/g;
  let last = 0;
  let match;
  while ((match = re.exec(text))) {
    frag.append(document.createTextNode(text.slice(last, match.index)));
    const link = document.createElement("a");
    link.href = "#" + match[1];
    link.textContent = match[0];
    frag.append(link);
    last = match.index + match[0].length;
  }
  frag.append(document.createTextNode(text.slice(last)));
  return frag;
}

async function readInvokeError(error) {
  let message = error.message || "The assistant could not answer.";
  const context = error.context;
  if (context && typeof context.json === "function") {
    try {
      const payload = await context.json();
      if (payload && payload.error) message = String(payload.error);
    } catch (_read) { /* keep the status text */ }
  }
  return message;
}
