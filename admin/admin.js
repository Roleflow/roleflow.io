import { getSupabase, isConfigured, logout } from "../auth/supabase.js";
import { renderCrm } from "./crm.js";

const hello = document.getElementById("admin-hello");
const app = document.getElementById("admin-app");
const logoutBtn = document.getElementById("nav-logout");
logoutBtn.addEventListener("click", logout);

const STATUS_LABELS = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  integrated: "Integrated",
  live: "Live"
};

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

function submissionOf(profile) {
  const raw = profile.onboarding_submissions;
  if (Array.isArray(raw)) return raw[0] || null;
  return raw || null;
}

function answersOf(submission) {
  const answers = submission && submission.answers;
  return answers && typeof answers === "object" ? answers : {};
}

function stepTotal() {
  const config = globalThis.ROLEFLOW_ONBOARDING_CONFIG;
  return (config && config.QUESTIONS ? config.QUESTIONS.length : 11) + 1;
}

function statusText(submission) {
  const status = submission?.status || "not_started";
  if (status === "in_progress") {
    const n = Math.min(stepTotal(), (Number(submission.step_index) || 0) + 1);
    return "In progress · step " + n + " of " + stepTotal();
  }
  return STATUS_LABELS[status] || status;
}

function when(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function businessName(profile) {
  return answersOf(submissionOf(profile)).businessName || "—";
}

function displayName(profile) {
  return profile.full_name || answersOf(submissionOf(profile)).clientName || "Unnamed client";
}

function showMessage(text) {
  app.innerHTML = "";
  app.append(el("div", { class: "panel" }, [el("p", {}, [text])]));
}

if (!isConfigured()) {
  hello.textContent = "Add the Supabase keys in supabase/config.js.";
  showMessage("Paste SUPABASE_URL and SUPABASE_ANON_KEY into supabase/config.js, then refresh.");
} else {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.replace("/login/?next=/admin/");
  } else {
    logoutBtn.hidden = false;
    const user = data.session.user;
    const adminRes = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (adminRes.error && /schema cache|does not exist|PGRST205/i.test(adminRes.error.message || "")) {
      hello.textContent = "Signed in.";
      showMessage("The database migration has not been applied yet. Run supabase/migrations/20261010120000_roleflow_accounts.sql in the Supabase SQL editor.");
    } else if (!adminRes.data) {
      hello.textContent = "Signed in as " + (user.email || "a client") + ".";
      showMessage("This tracking page is only for Roleflow admins. Your account page is still available.");
      app.append(el("p", { class: "links" }, [el("a", { href: "/account/" }, ["Go to your account"])]));
    } else {
      hello.textContent = "Signed in as " + (user.email || "admin") + ".";
      const tabs = document.getElementById("admin-tabs");
      const tabClients = document.getElementById("tab-clients");
      const tabCrm = document.getElementById("tab-crm");
      tabs.hidden = false;
      async function showSection(name) {
        const crm = name === "crm";
        tabClients.setAttribute("aria-selected", crm ? "false" : "true");
        tabCrm.setAttribute("aria-selected", crm ? "true" : "false");
        const nextHash = crm ? "#crm" : "#clients";
        if (location.hash !== nextHash) history.replaceState(null, "", nextHash);
        if (crm) await renderCrm(supabase, user, { app, hello });
        else {
          hello.textContent = "Signed in as " + (user.email || "admin") + ".";
          await renderDashboard(supabase, user);
        }
      }
      tabClients.addEventListener("click", () => { showSection("clients"); });
      tabCrm.addEventListener("click", () => { showSection("crm"); });
      window.addEventListener("hashchange", () => {
        showSection(location.hash === "#crm" ? "crm" : "clients");
      });
      await showSection(location.hash === "#crm" ? "crm" : "clients");
    }
  }
}

async function renderDashboard(supabase, user) {
  const { data, error } = await supabase.from("profiles").select(`
    id, full_name, email, instagram, created_at,
    onboarding_submissions (
      status, step_index, answers, prompt_text, submitted_at, last_activity_at, updated_at
    )
  `).order("created_at", { ascending: false });
  if (error) {
    showMessage(error.message);
    return;
  }
  const clients = data || [];
  let filter = "";
  let query = "";
  let selected = clients[0]?.id || "";

  const counts = el("div", { class: "counts", role: "group", "aria-label": "Filter by status" });
  const search = el("input", { id: "client-search", type: "search", placeholder: "Name, business, Instagram, or email", "aria-label": "Search clients" });
  const statusSelect = el("select", { id: "status-filter", "aria-label": "Filter by status" }, [
    el("option", { value: "" }, ["All statuses"])
  ]);
  Object.entries(STATUS_LABELS).forEach(([value, label]) => {
    statusSelect.append(el("option", { value }, [label]));
  });
  const list = el("div", { class: "client-list" });
  const detail = el("div", { class: "detail", id: "client-detail" });
  const live = el("div", { class: "sr", role: "status", "aria-live": "polite" });

  function matches(profile) {
    const submission = submissionOf(profile);
    const status = submission?.status || "not_started";
    if (filter && status !== filter) return false;
    if (!query) return true;
    const hay = [displayName(profile), businessName(profile), profile.email, profile.instagram].join(" ").toLowerCase();
    return hay.includes(query);
  }

  function paintCounts() {
    counts.innerHTML = "";
    const buckets = { "": clients.length };
    Object.keys(STATUS_LABELS).forEach((key) => { buckets[key] = 0; });
    clients.forEach((profile) => {
      const status = submissionOf(profile)?.status || "not_started";
      buckets[status] = (buckets[status] || 0) + 1;
    });
    const buttons = [["", "All"], ...Object.entries(STATUS_LABELS)];
    buttons.forEach(([value, label]) => {
      const button = el("button", { type: "button", "aria-pressed": filter === value ? "true" : "false" }, [
        label + " ",
        el("b", {}, [String(buckets[value] || 0)])
      ]);
      button.addEventListener("click", () => {
        filter = value;
        statusSelect.value = value;
        paint();
      });
      counts.append(button);
    });
  }

  function paintList() {
    list.innerHTML = "";
    const rows = clients.filter(matches);
    if (!rows.length) {
      list.append(el("p", { class: "mute" }, ["No clients match this filter."]));
      return;
    }
    rows.forEach((profile) => {
      const submission = submissionOf(profile);
      const card = el("article", { class: "client" }, [
        el("header", {}, [
          el("h3", {}, [displayName(profile)]),
          el("span", { class: "badge" }, [statusText(submission)])
        ]),
        el("p", {}, [businessName(profile) + " · " + (profile.instagram || "No Instagram")]),
        el("p", {}, [profile.email || "No email"]),
        el("p", {}, ["Signed up " + when(profile.created_at) + " · Last activity " + when(submission?.last_activity_at)])
      ]);
      const button = el("button", { type: "button", class: "btn ghost sm" }, [selected === profile.id ? "Viewing" : "View"]);
      button.addEventListener("click", () => {
        selected = profile.id;
        paint();
        document.getElementById("client-detail")?.scrollIntoView({ block: "start" });
      });
      card.append(button);
      list.append(card);
    });
  }

  async function paintDetail() {
    detail.innerHTML = "";
    const profile = clients.find((item) => item.id === selected);
    if (!profile) return;
    const submission = submissionOf(profile);
    const answers = answersOf(submission);
    const panel = el("div", { class: "panel" });
    panel.append(el("h2", { id: "detail-title", tabindex: "-1" }, [displayName(profile)]));
    panel.append(el("p", { class: "step-desc" }, [statusText(submission)]));

    const statusForm = el("form", { class: "auth-form" });
    const select = el("select", { id: "detail-status", "aria-label": "Onboarding status" });
    Object.entries(STATUS_LABELS).forEach(([value, label]) => {
      const option = el("option", { value }, [label]);
      if ((submission?.status || "not_started") === value) option.selected = true;
      select.append(option);
    });
    const statusMsg = el("p", { class: "err", role: "status" });
    const saveStatus = el("button", { type: "submit", class: "btn" }, ["Save status"]);
    statusForm.append(el("label", {}, ["Status", select]));
    statusForm.append(saveStatus);
    statusForm.append(statusMsg);
    statusForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      statusMsg.textContent = "";
      saveStatus.disabled = true;
      const { error: updateError } = await supabase.from("onboarding_submissions").update({ status: select.value }).eq("user_id", profile.id);
      saveStatus.disabled = false;
      if (updateError) {
        statusMsg.textContent = updateError.message;
        return;
      }
      if (submission) submission.status = select.value;
      statusMsg.textContent = "Status saved.";
      live.textContent = "Status saved for " + displayName(profile) + ".";
      paintCounts();
      paintList();
    });
    panel.append(statusForm);

    const noteForm = el("form", { class: "auth-form" });
    const noteInput = el("textarea", { id: "note-body", rows: "3" });
    const noteMsg = el("p", { class: "err", role: "status" });
    const noteList = el("div", { class: "note-list" });
    noteForm.append(el("label", {}, ["Internal note", noteInput]));
    noteForm.append(el("button", { type: "submit", class: "btn ghost" }, ["Add note"]));
    noteForm.append(noteMsg);
    panel.append(el("h3", {}, ["Notes"]));
    panel.append(noteList);
    panel.append(noteForm);

    const notesRes = await supabase.from("admin_notes").select("id, body, created_at, author:author_id(full_name, email)").eq("client_id", profile.id).order("created_at", { ascending: true });
    noteList.innerHTML = "";
    if (notesRes.error) noteMsg.textContent = notesRes.error.message;
    else if (!notesRes.data.length) noteList.append(el("p", { class: "mute" }, ["No notes yet."]));
    else notesRes.data.forEach((note) => {
      const author = note.author?.full_name || note.author?.email || "Admin";
      noteList.append(el("article", {}, [
        el("p", {}, [note.body]),
        el("p", { class: "mute" }, [author + " · " + when(note.created_at)])
      ]));
    });

    noteForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = noteInput.value.trim();
      noteMsg.textContent = "";
      if (!body) {
        noteMsg.textContent = "Write a note before saving it.";
        return;
      }
      const { error: noteError } = await supabase.from("admin_notes").insert({
        client_id: profile.id,
        author_id: user.id,
        body
      });
      if (noteError) {
        noteMsg.textContent = noteError.message;
        return;
      }
      noteInput.value = "";
      live.textContent = "Note added.";
      paintDetail();
    });

    panel.append(el("h3", {}, ["Answers"]));
    const config = globalThis.ROLEFLOW_ONBOARDING_CONFIG;
    const Prompt = globalThis.RoleflowPrompt;
    const listEl = el("dl");
    (config?.QUESTIONS || []).forEach((step) => {
      step.fields.forEach((field) => {
        const formatted = Prompt ? Prompt.formatAnswer(field, answers[field.id]) : "";
        listEl.append(el("dt", {}, [field.label]));
        listEl.append(el("dd", { class: formatted ? "filled" : "" }, [formatted || "Blank"]));
      });
    });
    panel.append(listEl);

    panel.append(el("h3", {}, ["Generated prompt"]));
    if (submission?.prompt_text) {
      const pre = el("pre", { class: "prompt", id: "admin-prompt", tabindex: "0" }, [submission.prompt_text]);
      const copy = el("button", { type: "button", class: "btn" }, ["Copy prompt"]);
      const download = el("button", { type: "button", class: "btn ghost" }, ["Download .md"]);
      const note = el("p", { class: "copy-note", role: "status" });
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(submission.prompt_text);
          note.textContent = "Copied to your clipboard.";
          note.className = "copy-note ok";
        } catch (error) {
          note.textContent = "Couldn't copy automatically.";
          note.className = "copy-note bad";
        }
      });
      download.addEventListener("click", () => {
        const blob = new Blob([submission.prompt_text], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = el("a", { href: url, download: "dm-setter-prompt.md" });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      });
      panel.append(el("div", { class: "toolbar" }, [copy, download]));
      panel.append(note);
      panel.append(pre);
    } else {
      panel.append(el("p", { class: "mute" }, ["No prompt stored yet."]));
    }

    detail.append(panel);
    document.getElementById("detail-title")?.focus({ preventScroll: true });
  }

  function paint() {
    paintCounts();
    paintList();
    paintDetail();
  }

  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    paintList();
  });
  statusSelect.addEventListener("change", () => {
    filter = statusSelect.value;
    paint();
  });

  app.innerHTML = "";
  app.append(counts);
  app.append(el("div", { class: "filters" }, [search, statusSelect]));
  app.append(list);
  app.append(detail);
  app.append(live);
  paint();
}
