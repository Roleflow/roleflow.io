import { toast } from "../auth/ui.js";
import {
  APPLICATION_SELECT,
  CHANNELS,
  COLUMNS,
  STAGES,
  applicationsToCsv,
  blankApplication,
  csvToApplications,
  filterApplications,
  instagramUrl,
  isOverdue,
  normalizeHandle,
  safeHttpUrl,
  sortApplications,
  todayISO
} from "./applications-model.js";

const TABLE = "setter_applications";
const DATE_KEYS = new Set(["date_sent", "follow_up_date"]);

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

function missingTable(error) {
  return /schema cache|does not exist|PGRST205|PGRST204|setter_applications/i.test(error?.message || "");
}

function fromDb(row) {
  const next = { ...blankApplication(), ...row };
  next.date_sent = row.date_sent ? String(row.date_sent).slice(0, 10) : "";
  next.follow_up_date = row.follow_up_date ? String(row.follow_up_date).slice(0, 10) : "";
  next.sort_order = Number(row.sort_order) || 0;
  return next;
}

function payloadFrom(row, keys) {
  const payload = {};
  keys.forEach((key) => {
    if (DATE_KEYS.has(key)) payload[key] = row[key] || null;
    else payload[key] = row[key] ?? "";
  });
  return payload;
}

export async function renderApplications(supabase, _user, { app, hello, isCurrent = () => true }) {
  hello.textContent = "Applications tracker";
  app.innerHTML = "";
  const root = el("div", { class: "tracker" });
  app.append(root);

  let rows = [];
  let query = "";
  let stage = "";
  let channel = "";
  let overdueOnly = false;
  let sortKey = "sort_order";
  let sortDir = "asc";
  let confirmId = "";
  let pendingPaint = false;
  let disposed = false;
  let missedRemote = false;
  let realtime = null;
  const dirty = new Set();
  const pending = new Map();
  const today = todayISO();

  const status = el("p", { id: "applications-status", class: "tracker-status", role: "status" });
  const scroll = el("div", { class: "crm-scroll sheet-scroll" });
  const table = el("table", { class: "crm-table sheet-table" });
  const thead = el("thead");
  const tbody = el("tbody");
  table.append(thead, tbody);
  table.setAttribute("aria-label", "DM setter applications");
  scroll.append(table);

  function visibleRows() {
    return sortApplications(filterApplications(rows, { query, stage, channel, overdueOnly, today }), sortKey, sortDir);
  }

  function editing() {
    const active = document.activeElement;
    return Boolean(active && tbody.contains(active));
  }

  function setStatus(extra) {
    const shown = visibleRows().length;
    const overdue = rows.filter((row) => isOverdue(row, today)).length;
    const bits = [shown + (shown === rows.length ? "" : " of " + rows.length) + (rows.length === 1 ? " application" : " applications")];
    if (overdue) bits.push(overdue + " overdue");
    if (extra) bits.push(extra);
    status.textContent = bits.join(" · ");
  }

  function queueSave(id, key, value) {
    const slot = pending.get(id) || { fields: {} };
    clearTimeout(slot.timer);
    slot.fields[key] = value;
    slot.timer = window.setTimeout(() => { flush(id); }, 350);
    pending.set(id, slot);
    setStatus("Saving…");
  }

  async function flush(id) {
    const slot = pending.get(id);
    if (!slot) return;
    clearTimeout(slot.timer);
    pending.delete(id);
    const keys = Object.keys(slot.fields);
    const row = rows.find((item) => item.id === id);
    if (!row || !keys.length) return;
    dirty.add(id);
    const { data, error } = await supabase.from(TABLE).update(payloadFrom(row, keys)).eq("id", id).select(APPLICATION_SELECT).single();
    dirty.delete(id);
    if (disposed) return;
    if (error) {
      toast(error.message, "bad");
      setStatus("Save failed");
      return;
    }
    const fresh = fromDb(data);
    const index = rows.findIndex((item) => item.id === id);
    if (index >= 0) {
      const newer = pending.get(id)?.fields;
      Object.assign(rows[index], newer ? { ...fresh, ...newer } : fresh);
    }
    if (missedRemote && !pending.size && !editing()) {
      missedRemote = false;
      reload();
      return;
    }
    setStatus("Saved");
  }

  function applyRemote(payload) {
    const id = payload.eventType === "DELETE" ? payload.old?.id : payload.new?.id;
    if (!id || dirty.has(id) || pending.has(id)) {
      missedRemote = true;
      return;
    }
    if (payload.eventType === "DELETE") rows = rows.filter((row) => row.id !== id);
    else {
      const next = fromDb(payload.new);
      const index = rows.findIndex((row) => row.id === next.id);
      if (index >= 0) rows[index] = next;
      else rows.push(next);
    }
    if (editing()) pendingPaint = true;
    else paintRows();
  }

  function headerCell(column) {
    const button = el("button", { type: "button", id: "sort-" + column.key, text: column.label });
    button.addEventListener("click", () => {
      if (sortKey === column.key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else {
        sortKey = column.key;
        sortDir = "asc";
      }
      paintRows();
    });
    return el("th", { scope: "col" }, [button]);
  }

  thead.append(el("tr", {}, [...COLUMNS.map(headerCell), el("th", { scope: "col", class: "sheet-actions", text: "" })]));

  function syncOverdue(tr, row) {
    const cell = tr.querySelector('[data-col="follow_up_date"]');
    const wrap = cell?.querySelector(".sheet-cell");
    if (!cell || !wrap) return;
    const overdue = isOverdue(row, today);
    cell.classList.toggle("overdue", overdue);
    let tag = wrap.querySelector(".overdue-tag");
    if (overdue && !tag) wrap.append(el("span", { class: "overdue-tag", text: "Overdue" }));
    if (!overdue && tag) tag.remove();
  }

  function linkFor(row, column) {
    const anchor = el("a", { class: "cell-link", target: "_blank", rel: "noopener noreferrer", text: "Open" });
    const sync = () => {
      const href = column.key === "instagram" ? instagramUrl(row.instagram) : safeHttpUrl(row[column.key]);
      if (!href) {
        anchor.hidden = true;
        return;
      }
      anchor.href = href;
      anchor.hidden = false;
    };
    sync();
    return { anchor, sync };
  }

  function fieldFor(row, column, tr) {
    const label = column.label + (row.owner ? " for " + row.owner : "");
    if (column.type === "select") {
      const options = column.options.slice();
      if (row[column.key] && !options.includes(row[column.key])) options.unshift(row[column.key]);
      const select = el("select", { "aria-label": label });
      if (column.key === "stage") select.setAttribute("data-stage", row.stage || "");
      options.forEach((option) => select.append(el("option", { value: option, text: option })));
      select.value = row[column.key] || options[0];
      select.addEventListener("change", () => {
        row[column.key] = select.value;
        if (column.key === "stage") select.setAttribute("data-stage", select.value);
        syncOverdue(tr, row);
        queueSave(row.id, column.key, select.value);
        if (query || stage || channel || overdueOnly) paintRows();
        else setStatus();
      });
      return select;
    }
    if (column.type === "notes") {
      const area = el("textarea", { "aria-label": label, rows: "2" });
      area.value = row.notes || "";
      area.addEventListener("input", () => {
        row.notes = area.value;
        queueSave(row.id, "notes", area.value);
      });
      area.addEventListener("blur", () => { flush(row.id); });
      return area;
    }
    const input = el("input", {
      type: column.type === "date" ? "date" : "text",
      "aria-label": label,
      value: row[column.key] || "",
      spellcheck: column.type === "text" ? "true" : "false"
    });
    if (column.key === "email") input.setAttribute("inputmode", "email");
    const onValue = () => {
      let value = input.value;
      if (column.key === "instagram") value = normalizeHandle(value);
      row[column.key] = value;
      if (column.key === "follow_up_date") syncOverdue(tr, row);
      queueSave(row.id, column.key, value);
    };
    input.addEventListener("input", onValue);
    input.addEventListener("change", onValue);
    input.addEventListener("blur", () => {
      if (column.key === "instagram") input.value = row.instagram || "";
      flush(row.id);
    });
    return input;
  }

  function actionCell(row) {
    const cell = el("td", { class: "sheet-actions" });
    const draw = () => {
      cell.innerHTML = "";
      if (confirmId === row.id) {
        const confirm = el("button", { type: "button", class: "row-delete confirm", text: "Delete row" });
        const cancel = el("button", { type: "button", class: "row-delete", text: "Cancel" });
        confirm.addEventListener("click", () => removeRow(row.id));
        cancel.addEventListener("click", () => {
          confirmId = "";
          draw();
        });
        cell.append(confirm, cancel);
        return;
      }
      const button = el("button", { type: "button", class: "row-delete", text: "Delete" });
      button.addEventListener("click", () => {
        confirmId = row.id;
        draw();
      });
      cell.append(button);
    };
    draw();
    return cell;
  }

  function paintRows() {
    const activeId = document.activeElement?.closest?.("tr")?.dataset?.id || "";
    const columnKey = document.activeElement?.closest?.("td")?.dataset?.col || "";
    tbody.innerHTML = "";
    const shown = visibleRows();
    COLUMNS.forEach((column) => {
      const header = document.getElementById("sort-" + column.key)?.parentElement;
      if (!header) return;
      const button = document.getElementById("sort-" + column.key);
      if (button) button.textContent = column.label + (sortKey === column.key ? (sortDir === "desc" ? " ↓" : " ↑") : "");
      if (sortKey === column.key) header.setAttribute("aria-sort", sortDir === "desc" ? "descending" : "ascending");
      else header.removeAttribute("aria-sort");
    });
    if (!shown.length) {
      const empty = rows.length ? "No applications match that search." : "No applications yet. Add a row to start the list.";
      tbody.append(el("tr", {}, [el("td", { colspan: String(COLUMNS.length + 1), class: "sheet-empty", text: empty })]));
      setStatus();
      return;
    }
    shown.forEach((row) => {
      const tr = el("tr", { "data-id": row.id });
      COLUMNS.forEach((column) => {
        const td = el("td", { "data-col": column.key, class: column.type === "notes" ? "notes" : "" });
        const wrap = el("div", { class: "sheet-cell" });
        wrap.append(fieldFor(row, column, tr));
        if (column.key === "instagram" || column.type === "url") {
          const { anchor, sync } = linkFor(row, column);
          wrap.append(anchor);
          const control = wrap.querySelector("input");
          control?.addEventListener("input", sync);
        }
        td.append(wrap);
        tr.append(td);
      });
      tr.append(actionCell(row));
      syncOverdue(tr, row);
      tbody.append(tr);
    });
    if (activeId && columnKey) {
      tbody.querySelector('tr[data-id="' + CSS.escape(activeId) + '"] [data-col="' + CSS.escape(columnKey) + '"] input, tr[data-id="' + CSS.escape(activeId) + '"] [data-col="' + CSS.escape(columnKey) + '"] textarea, tr[data-id="' + CSS.escape(activeId) + '"] [data-col="' + CSS.escape(columnKey) + '"] select')?.focus();
    }
    setStatus();
  }

  async function removeRow(id) {
    await flush(id);
    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (error) {
      toast(error.message, "bad");
      return;
    }
    rows = rows.filter((row) => row.id !== id);
    confirmId = "";
    paintRows();
    toast("Row deleted.");
  }

  async function addRow() {
    const sortOrder = rows.reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), 0) + 1;
    const draft = blankApplication();
    const { data, error } = await supabase.from(TABLE).insert({
      ...payloadFrom(draft, COLUMNS.map((column) => column.key)),
      sort_order: sortOrder
    }).select(APPLICATION_SELECT).single();
    if (error) {
      toast(error.message, "bad");
      return;
    }
    const created = fromDb(data);
    rows.push(created);
    sortKey = "sort_order";
    sortDir = "desc";
    query = "";
    stage = "";
    channel = "";
    overdueOnly = false;
    const search = document.getElementById("applications-search");
    const stageSelect = document.getElementById("applications-stage");
    const channelSelect = document.getElementById("applications-channel");
    const overdue = document.getElementById("applications-overdue");
    if (search) search.value = "";
    if (stageSelect) stageSelect.value = "";
    if (channelSelect) channelSelect.value = "";
    if (overdue) overdue.checked = false;
    paintRows();
    tbody.querySelector('tr[data-id="' + CSS.escape(created.id) + '"] input')?.focus();
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function importFile(file) {
    const text = await file.text();
    const parsed = csvToApplications(text);
    if (!parsed.rows.length) {
      toast(parsed.errors[0] || "That CSV has no application rows.", "bad");
      return;
    }
    let added = 0;
    let updated = 0;
    for (const item of parsed.rows) {
      const match = item.row.id && rows.some((row) => row.id === item.row.id);
      if (match) {
        const keys = [...item.present];
        const { data, error } = await supabase.from(TABLE).update(payloadFrom(item.row, keys)).eq("id", item.row.id).select(APPLICATION_SELECT).single();
        if (error) {
          parsed.errors.push(error.message);
          continue;
        }
        const index = rows.findIndex((row) => row.id === item.row.id);
        if (index >= 0) rows[index] = fromDb(data);
        updated += 1;
      } else {
        const sortOrder = rows.reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), 0) + 1;
        const { data, error } = await supabase.from(TABLE).insert({
          ...payloadFrom(item.row, COLUMNS.map((column) => column.key)),
          sort_order: sortOrder
        }).select(APPLICATION_SELECT).single();
        if (error) {
          parsed.errors.push(error.message);
          continue;
        }
        rows.push(fromDb(data));
        added += 1;
      }
    }
    paintRows();
    const summary = "Imported " + added + " new and updated " + updated + ".";
    toast(parsed.errors.length ? summary + " " + parsed.errors[0] : summary, parsed.errors.length ? "bad" : undefined);
  }

  const search = el("input", { id: "applications-search", type: "search", placeholder: "Search offer, owner, handle, email, notes", "aria-label": "Search applications" });
  const stageSelect = el("select", { id: "applications-stage", "aria-label": "Filter by stage" }, [el("option", { value: "", text: "All stages" })]);
  STAGES.forEach((option) => stageSelect.append(el("option", { value: option, text: option })));
  const channelSelect = el("select", { id: "applications-channel", "aria-label": "Filter by channel" }, [el("option", { value: "", text: "All channels" })]);
  CHANNELS.forEach((option) => channelSelect.append(el("option", { value: option, text: option })));
  const overdueInput = el("input", { id: "applications-overdue", type: "checkbox" });
  const overdueLabel = el("label", { class: "overdue-filter", for: "applications-overdue" }, [overdueInput, " Overdue only"]);
  const add = el("button", { type: "button", class: "btn sm", id: "applications-add", text: "Add row" });
  const exportButton = el("button", { type: "button", class: "btn ghost sm", id: "applications-export", text: "Export CSV" });
  const file = el("input", { id: "applications-file", class: "sr", type: "file", accept: ".csv,text/csv" });
  const importButton = el("button", { type: "button", class: "btn ghost sm", id: "applications-import", text: "Import CSV" });
  search.addEventListener("input", () => {
    query = search.value;
    paintRows();
  });
  stageSelect.addEventListener("change", () => {
    stage = stageSelect.value;
    paintRows();
  });
  channelSelect.addEventListener("change", () => {
    channel = channelSelect.value;
    paintRows();
  });
  overdueInput.addEventListener("change", () => {
    overdueOnly = overdueInput.checked;
    paintRows();
  });
  add.addEventListener("click", () => { addRow(); });
  exportButton.addEventListener("click", () => {
    const shown = visibleRows();
    download("applications-tracker.csv", applicationsToCsv(shown));
    toast("Exported " + shown.length + (shown.length === 1 ? " application." : " applications."));
  });
  importButton.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const chosen = file.files && file.files[0];
    file.value = "";
    if (chosen) importFile(chosen);
  });

  root.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!editing() && pendingPaint && !disposed) {
        pendingPaint = false;
        paintRows();
      }
    }, 0);
  });

  function onFocus() {
    if (!editing()) reload();
  }

  async function reload() {
    const { data, error } = await supabase.from(TABLE).select(APPLICATION_SELECT).order("sort_order", { ascending: true });
    if (error || disposed || editing()) return;
    rows = (data || []).map(fromDb);
    paintRows();
  }

  function cleanup() {
    disposed = true;
    pending.forEach((slot) => clearTimeout(slot.timer));
    window.removeEventListener("focus", onFocus);
    if (realtime) supabase.removeChannel(realtime);
  }

  const { data, error } = await supabase.from(TABLE).select(APPLICATION_SELECT).order("sort_order", { ascending: true });
  if (disposed || !isCurrent()) return cleanup;
  if (error) {
    const message = missingTable(error)
      ? "Apply supabase/migrations/20261015120000_setter_applications.sql in the Supabase SQL editor, then refresh."
      : error.message;
    root.append(el("div", { class: "panel" }, [el("p", { text: message })]));
    return cleanup;
  }
  rows = (data || []).map(fromDb);
  root.append(
    el("h2", {}, ["Applications ", el("span", { class: "g", text: "tracker" })]),
    el("p", { class: "crm-note mute", text: "DM setter offers sent with a video. Edits save to the admin account and show on every signed-in device. Import updates rows with a matching Id and does not delete anything." }),
    el("div", { class: "crm-tools" }, [search, stageSelect, channelSelect, overdueLabel, add, exportButton, importButton, file]),
    status,
    scroll
  );
  paintRows();
  window.addEventListener("focus", onFocus);
  realtime = supabase.channel("setter-applications")
    .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, applyRemote)
    .subscribe();
  return cleanup;
}
