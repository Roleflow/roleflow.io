import { getSupabase, isConfigured, logout } from "../auth/supabase.js";

const SUBMISSION_COLUMNS = "status, step_index, answers, prompt_text, prompt_sections, submitted_at, last_activity_at, updated_at, generation_status, generation_error, email_status, email_error, prompt_generated_at";
const SUBMISSION_COLUMNS_TRACKED = "status, step_index, answers, prompt_text, submitted_at, last_activity_at, updated_at, generation_status, generation_error, email_status, email_error, prompt_generated_at";
const SUBMISSION_COLUMNS_BASE = "status, step_index, answers, prompt_text, submitted_at, last_activity_at, updated_at";

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

function sectionMap(submission) {
  const raw = submission?.prompt_sections;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_error) {
    return false;
  }
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
  const answers = answersOf(submissionOf(profile));
  if (answers.businessName) return answers.businessName;
  const story = String(answers.brandStory || "").split(/[.\n]/)[0].trim();
  return story || "—";
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
      await renderDashboard(supabase, user);
    }
  }
}

async function loadClients(supabase) {
  const columns = [SUBMISSION_COLUMNS, SUBMISSION_COLUMNS_TRACKED, SUBMISSION_COLUMNS_BASE];
  let last = null;
  for (const columnList of columns) {
    last = await supabase.from("profiles").select(`
      id, full_name, email, instagram, created_at,
      onboarding_submissions ( ${columnList} )
    `).order("created_at", { ascending: false });
    if (!last.error) return last;
    if (!/schema cache|PGRST204|prompt_sections|generation_status|email_status|column/i.test(last.error.message || "")) return last;
  }
  return last;
}

async function renderDashboard(supabase, user) {
  const { data, error } = await loadClients(supabase);
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
    const generationLabel = submission?.generation_status ? "Generation: " + submission.generation_status : "Generation: not tracked yet";
    const emailLabel = submission?.email_status ? "Email to Diego: " + submission.email_status : "Email to Diego: not tracked yet";
    panel.append(el("p", { class: "step-desc" }, [generationLabel + " · " + emailLabel]));
    if (submission?.generation_error) panel.append(el("p", { class: "err" }, [submission.generation_error]));
    if (submission?.email_error) panel.append(el("p", { class: "err" }, [submission.email_error]));
    const regenMsg = el("p", { class: "err", role: "status" });
    const regenerate = el("button", { type: "button", class: "btn" }, ["Regenerate"]);
    regenerate.addEventListener("click", async () => {
      regenMsg.textContent = "";
      regenerate.disabled = true;
      regenerate.textContent = "Regenerating…";
      const invoked = await supabase.functions.invoke("generate-setter-prompt", { body: { user_id: profile.id } });
      regenerate.disabled = false;
      regenerate.textContent = "Regenerate";
      if (invoked.error) {
        let message = invoked.error.message || "Regenerate failed.";
        const context = invoked.error.context;
        if (context && typeof context.json === "function") {
          try {
            const body = await context.json();
            if (body && body.error) message = body.error;
          } catch (_readError) { /* keep the status text */ }
        }
        regenMsg.textContent = message;
        return;
      }
      const payload = invoked.data || {};
      if (submission) {
        submission.prompt_text = payload.prompt_text || submission.prompt_text;
        submission.prompt_sections = payload.prompt_sections || submission.prompt_sections;
        submission.generation_status = payload.generation_status || "ready";
        submission.generation_error = payload.generation_error || "";
        submission.email_status = payload.email_status || "";
        submission.email_error = payload.email_error || "";
        if (!submission.status || submission.status === "not_started" || submission.status === "in_progress") {
          submission.status = "submitted";
        }
      }
      live.textContent = "Prompt regenerated for " + displayName(profile) + ".";
      paintDetail();
    });
    panel.append(el("div", { class: "toolbar" }, [regenerate]));
    panel.append(regenMsg);
    const sections = sectionMap(submission);
    const sectionList = globalThis.ROLEFLOW_ONBOARDING_CONFIG?.TAILORTALK_SECTIONS || [];
    if (sectionList.length && Object.keys(sections).length) {
      panel.append(el("p", { class: "step-desc" }, ["Copy one section at a time into Tailortalk."]));
      sectionList.forEach((section) => {
        const text = String(sections[section.id] || "").trim();
        const block = el("section", { class: "section-block" });
        block.append(el("h3", {}, [section.title]));
        const note = el("p", { class: "copy-note", role: "status" });
        const copy = el("button", { type: "button", class: "btn" }, ["Copy section"]);
        copy.addEventListener("click", async () => {
          const ok = await copyText(text);
          note.textContent = ok ? "Copied. Paste this section into Tailortalk." : "Couldn't copy automatically.";
          note.className = ok ? "copy-note ok" : "copy-note bad";
        });
        block.append(el("div", { class: "toolbar" }, [copy]));
        block.append(note);
        block.append(el("pre", { class: "prompt", tabindex: "0" }, [text || "This section was not stored."]));
        panel.append(block);
      });
    }
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
