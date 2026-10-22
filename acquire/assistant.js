export function bindAssistant(getContext) {
  const openBtn = document.getElementById("assistant-open");
  const panel = document.getElementById("assistant-panel");
  const closeBtn = document.getElementById("assistant-close");
  const form = document.getElementById("assistant-form");
  const input = document.getElementById("assistant-input");
  const log = document.getElementById("assistant-log");
  if (!openBtn || !panel || !form || !log) return;

  function setOpen(open) {
    panel.hidden = !open;
    openBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && !log.childElementCount) {
      push("ask", "Ask how a page works, what a number means, or where to change a setting. Answers use this business only.");
    }
    if (open) input.focus();
  }

  openBtn.addEventListener("click", () => setOpen(panel.hidden));
  closeBtn.addEventListener("click", () => setOpen(false));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    const ctx = getContext();
    if (!ctx.supabase || !ctx.businessId) {
      push("ask", "Open a business first.");
      return;
    }
    input.value = "";
    push("me", message);
    const pending = push("ask", "Thinking…");
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const { data, error } = await ctx.supabase.functions.invoke("roleflow-assistant", {
        body: { business_id: ctx.businessId, message }
      });
      if (error) throw new Error(await readInvokeError(error));
      if (data && data.error) throw new Error(String(data.error));
      pending.textContent = "";
      pending.append(linkify(data && data.reply ? String(data.reply) : "No answer came back."));
    } catch (error) {
      pending.textContent = error.message || "The assistant could not answer.";
    } finally {
      button.disabled = false;
    }
  });

  function push(kind, text) {
    const node = document.createElement("p");
    node.className = kind === "me" ? "me" : "ask";
    node.textContent = text;
    log.append(node);
    log.scrollTop = log.scrollHeight;
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
