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
  return String(message || "").replace(/zerochats/ig, "the setter service");
}

function missing(error) {
  return error && /schema cache|does not exist|PGRST205|PGRST204/i.test(error.message || "");
}

async function invoke(supabase, body) {
  const { data, error } = await supabase.functions.invoke("business-members", { body });
  if (error) {
    let message = error.message || "The invite could not be saved.";
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

export async function mountMembers(supabase, agent, host) {
  host.innerHTML = "";
  const panel = el("section", { class: "panel", id: "members" });
  panel.append(el("h2", { text: "Members" }));
  panel.append(el("p", { text: "Viewer can see stats, leads, and the workflow. Editor can also regenerate the prompt." }));
  const list = el("div", { id: "member-list" });
  const note = el("p", { class: "err", id: "member-note", role: "status" });
  const form = el("form", { class: "auth-form", id: "invite-form" });
  const email = el("input", { id: "invite-email", type: "email", required: true, placeholder: "Email", "aria-label": "Email to invite" });
  const role = el("select", { id: "invite-role", "aria-label": "Role" }, [
    el("option", { value: "viewer", text: "Viewer" }),
    el("option", { value: "editor", text: "Editor" })
  ]);
  const button = el("button", { class: "btn", type: "submit" }, ["Invite"]);
  form.append(email, role, button);
  panel.append(list, form, note);
  host.append(panel);

  async function refresh() {
    list.innerHTML = "";
    const result = await supabase.from("business_members").select("id, email, role, status, created_at").eq("agent_id", agent.id).order("created_at", { ascending: false });
    if (missing(result.error)) {
      list.append(el("p", { text: "Apply the members migration, then refresh." }));
      form.hidden = true;
      return;
    }
    if (result.error) {
      list.append(el("p", { class: "err", text: scrub(result.error.message) }));
      return;
    }
    const rows = (result.data || []).filter((row) => row.status === "pending" || row.status === "active");
    if (!rows.length) list.append(el("p", { class: "mute", text: "No pending or active members." }));
    rows.forEach((row) => {
      const item = el("article", { class: "member-row" });
      const label = row.role === "editor" ? "Editor" : "Viewer";
      const state = row.status === "pending" ? "Pending" : "Active";
      item.append(el("p", {}, [row.email, el("span", { class: "mute", text: " · " + label + " · " + state })]));
      const tools = el("div", { class: "toolbar" });
      if (row.status === "pending") {
        const again = el("button", { type: "button", class: "btn ghost sm" }, ["Resend"]);
        again.addEventListener("click", () => act("resend", row.id, again));
        tools.append(again);
      }
      const revoke = el("button", { type: "button", class: "btn ghost sm" }, ["Revoke"]);
      revoke.addEventListener("click", () => act("revoke", row.id, revoke));
      tools.append(revoke);
      item.append(tools);
      list.append(item);
    });
  }

  async function act(action, memberId, control) {
    note.textContent = "";
    control.disabled = true;
    try {
      await invoke(supabase, { action, member_id: memberId });
      toast(action === "resend" ? "Invite resent." : "Access revoked.");
      await refresh();
    } catch (error) {
      control.disabled = false;
      note.textContent = error.message;
      toast(error.message, "bad");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    note.textContent = "";
    button.disabled = true;
    try {
      await invoke(supabase, {
        action: "invite",
        agent_id: agent.id,
        email: email.value.trim(),
        role: role.value
      });
      email.value = "";
      toast("Invite sent.");
      await refresh();
    } catch (error) {
      note.textContent = error.message;
      toast(error.message, "bad");
    }
    button.disabled = false;
  });

  await refresh();
}
