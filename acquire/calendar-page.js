import { showUpRate } from "./model.js";
import { sectionAlert, sectionEmpty, sectionText } from "./section-copy.js";
import {
  addMonths,
  blockGeometry,
  buildEvents,
  eventsOnDay,
  formatClock,
  formatHourLabel,
  formatRange,
  monthChips,
  monthMatrix,
  placeEvents,
  sameDay,
  scheduleDays,
  shiftCursor,
  viewLabel,
  visibleDays,
  weekdayLabels
} from "./calendar-view.js";

const VIEWS = [
  ["day", "calDay"],
  ["week", "calWeek"],
  ["month", "calMonth"],
  ["schedule", "calSchedule"]
];

function langOf(ui) {
  return ui.language && ui.language() === "es" ? "es" : "en";
}

function t(lang, key) {
  return sectionText(lang, key);
}

function narrowScreen() {
  return typeof window !== "undefined" && window.innerWidth < 768;
}

function ensureCalendar(ui) {
  const narrow = narrowScreen();
  if (!ui.state.calendar) {
    ui.state.calendar = {
      cursor: Date.now(),
      view: narrow ? "day" : "week",
      viewChosen: false,
      layers: { calls: true, followups: true },
      openId: ""
    };
  }
  const cal = ui.state.calendar;
  if (!cal.layers) cal.layers = { calls: true, followups: true };
  if (cal.layers.calls == null) cal.layers.calls = true;
  if (cal.layers.followups == null) cal.layers.followups = true;
  if (!cal.view) cal.view = narrow ? "day" : "week";
  if (!cal.viewChosen && narrow && cal.view !== "day" && cal.view !== "schedule") cal.view = "day";
  if (!Number.isFinite(Number(cal.cursor))) cal.cursor = Date.now();
  return cal;
}

function statusLabel(lang, status) {
  if (status === "showed") return t(lang, "showed");
  if (status === "no_show") return t(lang, "noShow");
  if (status === "cancelled") return t(lang, "cancelled");
  if (status === "followup") return t(lang, "followStatus");
  return t(lang, "booked");
}

function toneOf(event) {
  if (event.layer === "followups") return "followups";
  if (event.status === "showed") return "showed";
  if (event.status === "no_show") return "no_show";
  if (event.status === "cancelled") return "cancelled";
  return "calls";
}

function eventLabel(lang, event) {
  const when = event.untimed || !event.start ? t(lang, "timeNotSet") : formatRange(event, lang);
  return event.title + ", " + when + ", " + statusLabel(lang, event.status);
}

function setCursor(ui, date) {
  ui.state.calendar.cursor = date.getTime();
  ui.paint();
}

function chooseView(ui, view) {
  ui.state.calendar.view = view;
  ui.state.calendar.viewChosen = true;
  ui.state.calendar.openId = "";
  ui.paint();
}

function leadFor(ui, event) {
  if (!ui.collectLeads) return null;
  const leads = ui.collectLeads(ui.state.contacts || [], ui.state.targets || []);
  return leads.find((row) => event.leadKind && row.kind === event.leadKind && row.id === event.leadId)
    || leads.find((row) => event.handle && row.handle === event.handle)
    || null;
}

function openChat(ui, event) {
  const lead = leadFor(ui, event);
  if (!lead || !ui.go) return;
  if (!ui.state.flow) ui.state.flow = {};
  ui.state.flow.chat = lead.kind + ":" + lead.id;
  ui.go("chats");
  if (ui.openChat) ui.openChat(lead);
}

function openOpportunity(ui, event) {
  const lead = leadFor(ui, event);
  if (!lead || !ui.go) return;
  if (!ui.state.studio) {
    ui.state.studio = { view: "list", page: 1, query: {}, open: "", schedule: "calendly", sim: { as: "lead", state: "open", version: "", lines: [] }, proposal: null, edit: "" };
  }
  ui.state.studio.open = lead.kind + ":" + lead.id;
  ui.go("opportunities");
}

function sourceFor(ui) {
  return {
    bookings: ui.state.bookings || [],
    reminders: ui.state.reminders || [],
    targets: ui.state.targets || [],
    contacts: ui.state.contacts || []
  };
}

export function renderRoleflowCalendar(ui, options) {
  const lang = langOf(ui);
  const cal = ensureCalendar(ui);
  const cursor = new Date(Number(cal.cursor));
  const now = new Date();
  const all = buildEvents({ ...sourceFor(ui), layers: { calls: true, followups: true } });
  const events = buildEvents({ ...sourceFor(ui), layers: cal.layers });
  const open = events.find((event) => event.id === cal.openId) || all.find((event) => event.id === cal.openId) || null;
  if (cal.openId && !open) cal.openId = "";

  const wrap = ui.el("div", { class: "gcal", "data-view": cal.view });
  const alert = sectionAlert(ui, "calendar");
  if (alert) wrap.append(alert);
  wrap.append(renderToolbar(ui, lang, cal, cursor, now));
  const body = ui.el("div", { class: "gcal-body" });
  body.append(renderRail(ui, lang, cal, cursor, now, options || {}));
  body.append(renderMain(ui, lang, cal, cursor, now, events, all, alert));
  wrap.append(body);
  if (open) {
    wrap.append(ui.el("button", { type: "button", class: "gcal-backdrop", "aria-label": t(lang, "closeCard") }));
    wrap.append(renderPopover(ui, lang, open));
    const backdrop = wrap.querySelector(".gcal-backdrop");
    backdrop.addEventListener("click", () => {
      cal.openId = "";
      ui.paint();
    });
  }
  if (!cal.escBound && typeof document !== "undefined") {
    cal.escBound = true;
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !ui.state.calendar || !ui.state.calendar.openId) return;
      ui.state.calendar.openId = "";
      ui.paint();
    });
  }
  queueMicrotask(() => {
    const scroller = wrap.querySelector(".gcal-time");
    if (scroller) scroller.scrollTop = 8 * 48;
    if (wrap.querySelector(".gcal-pop")) placePopover(wrap);
  });
  return wrap;
}

function renderToolbar(ui, lang, cal, cursor, now) {
  const bar = ui.el("div", { class: "gcal-toolbar" });
  const today = ui.el("button", { type: "button", class: "gcal-today" }, [t(lang, "calToday")]);
  today.addEventListener("click", () => setCursor(ui, now));
  const prev = ui.el("button", { type: "button", class: "gcal-nav", "aria-label": t(lang, "calPrev") }, ["‹"]);
  const next = ui.el("button", { type: "button", class: "gcal-nav", "aria-label": t(lang, "calNext") }, ["›"]);
  prev.addEventListener("click", () => setCursor(ui, shiftCursor(cursor, cal.view, -1)));
  next.addEventListener("click", () => setCursor(ui, shiftCursor(cursor, cal.view, 1)));
  const label = ui.el("h2", { class: "gcal-label", text: viewLabel(cursor, cal.view, lang) });
  const show = showUpRate(ui.state.bookings || []);
  const rate = show.rate == null ? "—" : Math.round(show.rate * 100) + "%";
  const chip = ui.el("span", { class: "gcal-showup", text: t(lang, "showUp") + " " + rate });
  const views = ui.el("div", { class: "gcal-views", role: "group", "aria-label": t(lang, "calendarTitle") });
  VIEWS.forEach(([id, key]) => {
    const button = ui.el("button", { type: "button", "aria-pressed": cal.view === id ? "true" : "false" }, [t(lang, key)]);
    button.addEventListener("click", () => chooseView(ui, id));
    views.append(button);
  });
  bar.append(today, prev, next, label, chip, views);
  return bar;
}

function renderRail(ui, lang, cal, cursor, now, options) {
  const rail = ui.el("details", { class: "gcal-rail" });
  if (!narrowScreen()) rail.open = true;
  rail.append(ui.el("summary", { text: t(lang, "calendars") }));
  rail.append(renderMini(ui, lang, cursor, now));
  const layers = ui.el("div", { class: "gcal-layers" });
  [
    ["calls", "bookedCalls"],
    ["followups", "followLayer"]
  ].forEach(([id, key]) => {
    const label = ui.el("label", { class: "gcal-layer " + id });
    const input = ui.el("input", { type: "checkbox" });
    if (cal.layers[id] !== false) input.checked = true;
    input.addEventListener("change", () => {
      cal.layers[id] = input.checked;
      cal.openId = "";
      ui.paint();
    });
    label.append(input, ui.el("span", { text: t(lang, key) }));
    layers.append(label);
  });
  rail.append(layers);
  rail.append(renderBookingDetails(ui, lang, options));
  return rail;
}

function renderMini(ui, lang, cursor, now) {
  const mini = ui.el("div", { class: "gcal-mini" });
  const head = ui.el("div", { class: "gcal-mini-head" });
  const prev = ui.el("button", { type: "button", class: "gcal-nav", "aria-label": t(lang, "calPrev") }, ["‹"]);
  const next = ui.el("button", { type: "button", class: "gcal-nav", "aria-label": t(lang, "calNext") }, ["›"]);
  prev.addEventListener("click", () => setCursor(ui, addMonths(cursor, -1)));
  next.addEventListener("click", () => setCursor(ui, addMonths(cursor, 1)));
  head.append(prev, ui.el("strong", { text: viewLabel(cursor, "month", lang) }), next);
  const grid = ui.el("div", { class: "gcal-mini-grid" });
  weekdayLabels(lang, "narrow").forEach((label) => grid.append(ui.el("span", { class: "gcal-dow", text: label })));
  monthMatrix(cursor).flat().forEach((day) => {
    const button = ui.el("button", {
      type: "button",
      class: "gcal-mini-day" + (sameDay(day, now) ? " is-today" : "") + (sameDay(day, cursor) ? " is-selected" : "") + (day.getMonth() === cursor.getMonth() ? "" : " is-out"),
      "aria-label": viewLabel(day, "day", lang),
      text: String(day.getDate())
    });
    if (sameDay(day, cursor)) button.setAttribute("aria-current", "date");
    button.addEventListener("click", () => setCursor(ui, day));
    grid.append(button);
  });
  mini.append(head, grid);
  return mini;
}

function renderBookingDetails(ui, lang, options) {
  const box = ui.el("details", { class: "gcal-book" });
  box.append(ui.el("summary", { text: t(lang, "bookingDetails") }));
  const linkLabel = lang === "es" ? "Enlace de reserva" : "Booking link";
  const input = ui.el("input", {
    id: "calendar-booking-link",
    type: "text",
    value: (ui.state.settings && ui.state.settings.booking_fallback_url) || ui.state.bookingLink || "",
    placeholder: linkLabel,
    "aria-label": linkLabel
  });
  box.append(input);
  if (ui.saveBookingLink && ui.state.canEdit) box.append(ui.button(lang === "es" ? "Guardar enlace" : "Save link", () => ui.saveBookingLink(input.value)));
  if (options.recordForm) box.append(options.recordForm);
  return box;
}

function renderMain(ui, lang, cal, cursor, now, events, all, alert) {
  const main = ui.el("div", { class: "gcal-main" });
  if (!alert && !all.length) main.append(sectionEmpty(ui, "calendarEmpty"));
  else if (!events.length) main.append(ui.el("p", { class: "section-empty", role: "status", text: t(lang, "calendarNone") }));
  if (cal.view === "month") main.append(renderMonth(ui, lang, cursor, now, events));
  else if (cal.view === "schedule") main.append(renderSchedule(ui, lang, cursor, events));
  else main.append(renderTimeGrid(ui, lang, visibleDays(cursor, cal.view), now, events));
  return main;
}

function renderTimeGrid(ui, lang, days, now, events) {
  const untimed = events.filter((event) => event.untimed);
  const time = ui.el("div", { class: "gcal-time" });
  const inner = ui.el("div", { class: "gcal-time-inner" });
  inner.style.setProperty("--days", String(days.length));
  const head = ui.el("div", { class: "gcal-head" });
  head.append(ui.el("div", { class: "gcal-gutter" }));
  days.forEach((day) => {
    const cell = ui.el("div", { class: "gcal-dayhead" + (sameDay(day, now) ? " is-today" : "") });
    cell.append(ui.el("span", { text: new Intl.DateTimeFormat(lang === "es" ? "es" : "en", { weekday: "short" }).format(day) }));
    const num = ui.el("span", { class: "gcal-num", text: String(day.getDate()) });
    cell.append(num);
    head.append(cell);
  });
  inner.append(head);
  if (untimed.length) {
    const row = ui.el("div", { class: "gcal-allday" });
    row.append(ui.el("div", { class: "gcal-gutter" }));
    const list = ui.el("div", { class: "gcal-allday-list" });
    list.append(ui.el("span", { class: "gcal-allday-label", text: t(lang, "timeNotSet") }));
    untimed.forEach((event) => list.append(eventButton(ui, lang, event, "gcal-chip " + toneOf(event))));
    row.append(list);
    inner.append(row);
  }
  const grid = ui.el("div", { class: "gcal-hours-grid" });
  const hours = ui.el("div", { class: "gcal-hours" });
  for (let hour = 0; hour < 24; hour += 1) {
    hours.append(ui.el("div", { class: "gcal-hour" }, [ui.el("span", { text: formatHourLabel(hour, lang) })]));
  }
  grid.append(hours);
  days.forEach((day) => {
    const col = ui.el("div", { class: "gcal-col" + (sameDay(day, now) ? " is-today" : "") });
    for (let hour = 0; hour < 24; hour += 1) col.append(ui.el("div", { class: "gcal-hourline" }));
    placeEvents(eventsOnDay(events, day)).forEach((event) => {
      const button = eventButton(ui, lang, event, "gcal-event " + toneOf(event));
      const box = blockGeometry(event, day);
      button.style.top = box.top + "%";
      button.style.height = box.height + "%";
      button.style.left = "calc(" + (event.col / event.cols) * 100 + "% + 2px)";
      button.style.width = "calc(" + (100 / event.cols) + "% - 4px)";
      button.append(ui.el("small", { text: formatClock(event.start, lang) }));
      col.append(button);
    });
    if (sameDay(day, now)) {
      const line = ui.el("div", { class: "gcal-now", "aria-hidden": "true" });
      const minutes = now.getHours() * 60 + now.getMinutes();
      line.style.top = (minutes / 1440) * 100 + "%";
      col.append(line);
    }
    grid.append(col);
  });
  inner.append(grid);
  time.append(inner);
  return time;
}

function renderMonth(ui, lang, cursor, now, events) {
  const month = ui.el("div", { class: "gcal-month" });
  const untimed = events.filter((event) => event.untimed);
  if (untimed.length) {
    const note = ui.el("div", { class: "gcal-untimed" });
    note.append(ui.el("span", { text: t(lang, "timeNotSet") }));
    untimed.forEach((event) => note.append(eventButton(ui, lang, event, "gcal-chip " + toneOf(event))));
    month.append(note);
  }
  const dow = ui.el("div", { class: "gcal-month-dow" });
  weekdayLabels(lang, "short").forEach((label) => dow.append(ui.el("span", { text: label })));
  const grid = ui.el("div", { class: "gcal-month-grid" });
  monthMatrix(cursor).flat().forEach((day) => {
    const cell = ui.el("div", { class: "gcal-cell" + (day.getMonth() === cursor.getMonth() ? "" : " is-out") + (sameDay(day, now) ? " is-today" : "") });
    const num = ui.el("button", { type: "button", class: "gcal-num", text: String(day.getDate()), "aria-label": viewLabel(day, "day", lang) });
    num.addEventListener("click", () => {
      ui.state.calendar.cursor = day.getTime();
      chooseView(ui, "day");
    });
    cell.append(num);
    const chips = monthChips(events, day);
    chips.visible.forEach((event) => {
      const button = eventButton(ui, lang, event, "gcal-chip " + toneOf(event));
      button.textContent = "";
      button.append(formatClock(event.start, lang) + " " + event.title);
      cell.append(button);
    });
    if (chips.more) {
      const more = ui.el("button", { type: "button", class: "gcal-more" }, [t(lang, "calMore").replace("{n}", String(chips.more))]);
      more.addEventListener("click", () => {
        ui.state.calendar.cursor = day.getTime();
        chooseView(ui, "day");
      });
      cell.append(more);
    }
    grid.append(cell);
  });
  month.append(dow, grid);
  return month;
}

function renderSchedule(ui, lang, cursor, events) {
  const list = ui.el("div", { class: "gcal-schedule" });
  const untimed = events.filter((event) => event.untimed);
  if (untimed.length) {
    const group = ui.el("section", { class: "gcal-daygroup" });
    group.append(ui.el("h3", { text: t(lang, "timeNotSet") }));
    untimed.forEach((event) => group.append(scheduleRow(ui, lang, event)));
    list.append(group);
  }
  const days = scheduleDays(cursor).filter((day) => eventsOnDay(events, day).length);
  if (!days.length && !untimed.length) return list;
  days.forEach((day) => {
    const group = ui.el("section", { class: "gcal-daygroup" + (sameDay(day, new Date()) ? " is-today" : "") });
    group.append(ui.el("h3", { text: viewLabel(day, "day", lang) }));
    eventsOnDay(events, day).slice().sort((a, b) => a.start - b.start).forEach((event) => group.append(scheduleRow(ui, lang, event)));
    list.append(group);
  });
  return list;
}

function scheduleRow(ui, lang, event) {
  const row = eventButton(ui, lang, event, "gcal-sched " + toneOf(event));
  const when = event.untimed || !event.start ? t(lang, "timeNotSet") : formatRange(event, lang);
  row.append(ui.el("span", { class: "gcal-sched-time", text: when }));
  row.append(ui.el("span", { text: statusLabel(lang, event.status) }));
  return row;
}

function eventButton(ui, lang, event, className) {
  const button = ui.el("button", {
    type: "button",
    class: className,
    "data-event-id": event.id,
    "aria-label": eventLabel(lang, event)
  }, [ui.el("strong", { text: event.title })]);
  if (ui.state.calendar && ui.state.calendar.openId === event.id) button.setAttribute("data-open-event", "true");
  button.addEventListener("click", () => {
    ui.state.calendar.openId = event.id;
    ui.paint();
  });
  return button;
}

function renderPopover(ui, lang, event) {
  const card = ui.el("div", { class: "gcal-pop " + toneOf(event), role: "dialog", "aria-label": event.title });
  const close = ui.el("button", { type: "button", class: "gcal-pop-close", "aria-label": t(lang, "closeCard") }, ["×"]);
  close.addEventListener("click", () => {
    ui.state.calendar.openId = "";
    ui.paint();
  });
  const name = event.name || event.handle || event.title;
  card.append(close, ui.el("strong", { text: name }));
  if (event.handle) card.append(ui.el("span", { class: "gcal-handle", text: "@" + event.handle }));
  const when = event.untimed || !event.start ? t(lang, "timeNotSet") : formatRange(event, lang);
  card.append(ui.el("span", { text: when }));
  card.append(ui.el("span", { class: "status-pill " + pillTone(event), text: statusLabel(lang, event.status) }));
  const lead = leadFor(ui, event);
  const actions = ui.el("div", { class: "gcal-pop-actions" });
  const chat = ui.el("button", { type: "button", class: "btn ghost sm" }, [t(lang, "openChat")]);
  const opportunity = ui.el("button", { type: "button", class: "btn ghost sm" }, [t(lang, "openOpportunity")]);
  if (!lead) {
    chat.disabled = true;
    opportunity.disabled = true;
  }
  chat.addEventListener("click", () => openChat(ui, event));
  opportunity.addEventListener("click", () => openOpportunity(ui, event));
  actions.append(chat, opportunity);
  card.append(actions);
  if (event.layer === "calls" && ui.saveShowStatus && ui.state.canEdit && ui.state.supabase) {
    const booking = (ui.state.bookings || []).find((row) => row.id === event.sourceId);
    const target = (ui.state.targets || []).find((row) => row.id === event.leadId) || { id: event.leadId };
    const select = ui.el("select", { "aria-label": t(lang, "showUp") });
    [["scheduled", t(lang, "booked")], ["showed", t(lang, "showed")], ["no_show", t(lang, "noShow")], ["cancelled", t(lang, "cancelled")]].forEach(([value, label]) => {
      select.append(ui.el("option", { value, text: label }));
    });
    select.value = event.status === "followup" ? "scheduled" : (event.status || "scheduled");
    card.append(select, ui.button(lang === "es" ? "Guardar asistencia" : "Save show-up", () => ui.saveShowStatus(target, booking, select.value)));
  }
  return card;
}

function pillTone(event) {
  if (event.status === "showed") return "booked";
  if (event.status === "no_show") return "lost";
  if (event.status === "cancelled") return "open";
  if (event.layer === "followups") return "discovering";
  return "booked";
}

function placePopover(wrap) {
  const anchor = wrap.querySelector("[data-open-event]");
  const pop = wrap.querySelector(".gcal-pop");
  if (!pop) return;
  const host = wrap.getBoundingClientRect();
  const box = anchor ? anchor.getBoundingClientRect() : host;
  let left = (anchor ? box.left : host.left + 16) - host.left;
  let top = (anchor ? box.bottom : host.top + 48) - host.top + 8;
  const width = pop.offsetWidth || 280;
  const height = pop.offsetHeight || 180;
  if (left + width > host.width - 8) left = Math.max(8, host.width - width - 8);
  if (top + height > host.height - 8) top = Math.max(8, (anchor ? box.top - host.top : 8) - height - 8);
  pop.style.left = Math.max(8, left) + "px";
  pop.style.top = Math.max(8, top) + "px";
}
