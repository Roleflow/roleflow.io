import { toast } from "../auth/ui.js";

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  (children || []).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function scrub(message) {
  return String(message || "").replace(/tailortalk|zerochats/ig, "the setter service");
}

function storageKey(agentId) {
  return "roleflow.sim." + agentId;
}

async function invoke(supabase, body) {
  const { data, error } = await supabase.functions.invoke("prompt-simulator", { body });
  if (error) {
    let message = error.message || "The simulation failed.";
    const context = error.context;
    if (context && typeof context.json === "function") {
      try {
        const payload = await context.json();
        if (payload && payload.error) message = String(payload.error);
      } catch (_read) { /* keep the status text */ }
    }
    throw new Error(scrub(message));
  }
  if (data && data.error) throw new Error(scrub(data.error));
  return data || {};
}

export function mountSimulator(supabase, agent, host) {
  host.innerHTML = "";
  const panel = el("section", { class: "sim-panel", id: "simulator" });
  panel.append(el("h3", { text: "Simulation using the live prompt" }));
  panel.append(el("p", { class: "mute", text: "Practice chat only. Username checks and other tools are not run." }));
  const log = el("div", { class: "sim-log", id: "sim-log", role: "log", "aria-live": "polite" });
  const form = el("form", { class: "sim-form", id: "sim-form" });
  const input = el("textarea", { id: "sim-text", rows: "3", placeholder: "Message as a lead", "aria-label": "Message as a lead" });
  const send = el("button", { class: "btn sm", type: "submit" }, ["Send"]);
  const restart = el("button", { class: "btn ghost sm", type: "button", id: "sim-restart" }, ["Restart"]);
  const undo = el("button", { class: "btn ghost sm", type: "button", id: "sim-undo" }, ["Undo"]);
  const note = el("p", { class: "err", id: "sim-note", role: "status" });
  form.append(input, el("div", { class: "toolbar" }, [send, restart, undo]));
  panel.append(log, form, note);
  host.append(panel);

  let sessionId = sessionStorage.getItem(storageKey(agent.id)) || "";
  let messages = [];

  function paint() {
    log.innerHTML = "";
    if (!messages.length) {
      log.append(el("p", { class: "mute", text: "Send a message as a lead." }));
      return;
    }
    messages.forEach((message) => {
      const who = message.role === "assistant" ? "Setter" : "You";
      log.append(el("p", { class: "sim-bubble " + (message.role === "assistant" ? "assistant" : "user") }, [
        el("b", { text: who }),
        document.createTextNode(" " + message.content)
      ]));
    });
    log.scrollTop = log.scrollHeight;
  }

  async function run(action, text) {
    note.textContent = "";
    send.disabled = true;
    const result = await invoke(supabase, {
      action,
      agent_id: agent.id,
      session_id: sessionId,
      text
    });
    sessionId = result.session_id || sessionId;
    if (sessionId) sessionStorage.setItem(storageKey(agent.id), sessionId);
    messages = Array.isArray(result.messages) ? result.messages : [];
    paint();
    send.disabled = false;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    try {
      await run("send", text);
      input.value = "";
    } catch (error) {
      send.disabled = false;
      note.textContent = error.message;
      toast(error.message, "bad");
    }
  });
  restart.addEventListener("click", async () => {
    try {
      await run("restart", "");
    } catch (error) {
      note.textContent = error.message;
      toast(error.message, "bad");
    }
  });
  undo.addEventListener("click", async () => {
    try {
      await run("undo", "");
    } catch (error) {
      note.textContent = error.message;
      toast(error.message, "bad");
    }
  });
  paint();
}
