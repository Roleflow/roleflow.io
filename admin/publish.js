import { toast } from "../auth/ui.js";

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  (children || []).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function quiet(message) {
  return String(message || "").replace(/zerochats/ig, "the setter service");
}

function when(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function missingColumn(error) {
  return error && /schema cache|PGRST204|column|does not exist|PGRST205/i.test(error.message || "");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_error) {
    return false;
  }
}

const COLUMNS = "user_id, publish_status, publish_error, publish_agent_id, publish_requested_at, prompt_sections, generation_status, generation_error";

async function rowsFor(supabase, agent) {
  const byAgent = await supabase.from("onboarding_submissions").select(COLUMNS).eq("publish_agent_id", agent.id);
  if (missingColumn(byAgent.error)) return { missing: true, rows: [] };
  if (byAgent.error) return { error: byAgent.error.message, rows: [] };
  const rows = byAgent.data || [];
  if (agent.client_id && !rows.some((row) => row.user_id === agent.client_id)) {
    const byClient = await supabase.from("onboarding_submissions").select(COLUMNS).eq("user_id", agent.client_id);
    if (missingColumn(byClient.error)) return { missing: true, rows: [] };
    if (!byClient.error) rows.push(...(byClient.data || []));
  }
  return { rows };
}

function sectionMap(row) {
  const raw = row && row.prompt_sections;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw;
}

export async function mountPublish(supabase, agent, host) {
  host.innerHTML = "";
  const panel = el("section", { class: "panel", id: "publish-status" });
  panel.append(el("h3", {}, ["Publish"]));
  const loaded = await rowsFor(supabase, agent);
  if (loaded.missing) {
    panel.append(el("p", {}, ["Apply the businesses migration, then refresh."]));
    host.append(panel);
    return;
  }
  if (loaded.error) {
    panel.append(el("p", { class: "err" }, [quiet(loaded.error)]));
    host.append(panel);
    return;
  }
  const row = (loaded.rows || []).find((item) => item.publish_status === "pending") || (loaded.rows || [])[0] || null;
  if (!row) {
    panel.append(el("p", { class: "mute" }, ["Nothing is waiting to publish for this business. Link a client in Setup if the prompt belongs to an account."]));
    host.append(panel);
    return;
  }

  const labels = {
    idle: "Not requested",
    pending: "Pending publish",
    published: "Published",
    failed: "Publish failed"
  };
  panel.append(el("p", {}, [labels[row.publish_status] || row.publish_status || "Not requested"]));
  if (row.publish_requested_at) panel.append(el("p", { class: "mute" }, ["Requested " + when(row.publish_requested_at) + "."]));
  if (row.publish_error) panel.append(el("p", { class: "err" }, [quiet(row.publish_error)]));
  if (row.generation_error) panel.append(el("p", { class: "err" }, [quiet(row.generation_error)]));

  if (row.publish_status === "pending") {
    const mark = el("button", { type: "button", class: "btn", id: "mark-published-" + row.user_id }, ["Mark published"]);
    mark.addEventListener("click", async () => {
      mark.disabled = true;
      const updated = await supabase.from("onboarding_submissions").update({
        publish_status: "published",
        publish_error: null
      }).eq("user_id", row.user_id);
      mark.disabled = false;
      if (updated.error) {
        toast(quiet(updated.error.message), "bad");
        return;
      }
      toast("Marked published.");
      mountPublish(supabase, agent, host);
    });
    panel.append(mark);
  }

  const profile = { id: row.user_id };
  const regenMsg = el("p", { class: "err", role: "status" });
  const regenerate = el("button", { type: "button", class: "btn ghost" }, ["Regenerate"]);
  regenerate.addEventListener("click", async () => {
    regenMsg.textContent = "";
    regenerate.disabled = true;
    const invoked = await supabase.functions.invoke("generate-setter-prompt", { body: { user_id: profile.id } });
    regenerate.disabled = false;
    if (invoked.error) {
      let message = invoked.error.message || "Regenerate failed.";
      const context = invoked.error.context;
      if (context && typeof context.json === "function") {
        try {
          const body = await context.json();
          if (body && body.error) message = body.error;
        } catch (_readError) { /* keep the status text */ }
      }
      regenMsg.textContent = quiet(message);
      return;
    }
    toast("Prompt regenerated.");
    mountPublish(supabase, agent, host);
  });
  panel.append(el("div", { class: "toolbar" }, [regenerate]));
  panel.append(regenMsg);

  const sections = sectionMap(row);
  const sectionList = globalThis.ROLEFLOW_ONBOARDING_CONFIG?.SETTER_SECTIONS || [];
  if (sectionList.length && Object.keys(sections).length) {
    panel.append(el("p", { class: "step-desc" }, ["Copy one section at a time, then publish it from the connector."]));
    sectionList.forEach((section) => {
      const text = String(sections[section.id] || "").trim();
      const block = el("section", { class: "section-block" });
      block.append(el("h3", {}, [section.title]));
      const note = el("p", { class: "copy-note", role: "status" });
      const copy = el("button", { type: "button", class: "btn ghost sm" }, ["Copy section"]);
      copy.addEventListener("click", async () => {
        const ok = await copyText(text);
        note.textContent = ok ? "Copied." : "Couldn't copy automatically.";
        if (ok) toast("Section copied.");
      });
      block.append(el("div", { class: "toolbar" }, [copy]));
      block.append(note);
      block.append(el("pre", { class: "prompt" }, [text || "Not stored."]));
      panel.append(block);
    });
  }

  host.append(panel);
}
