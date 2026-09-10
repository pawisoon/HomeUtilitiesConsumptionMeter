/* Home Utilities Consumption Meter — dashboard.
   Plain browser JavaScript, no build step: the Worker serves this file as is. */

const DAY_LONG = new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long" });
const DAY_SHORT = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short" });
const WEEKDAY = new Intl.DateTimeFormat("pl-PL", { weekday: "short" });
const MONTH_LONG = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" });

/* ---------------- state ---------------- */

let config = { utilities: [], time_zone: "Europe/Warsaw" };
let utility = null;          // spec of the utility on screen
let chart = null;
let currentView = "day";
let currentDay = null;
let occupancyCache = [];

const num = (value, decimals = 0) =>
  new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);

/* ---------------- units ---------------- */

/** Base-unit value as a day-scale number, e.g. 0.223 m³ → 223. */
const fine = (base) => base * utility.finePerBase;

/** 1 litr, 2-4 litry, 5+ litrów, with the 12-14 exception. */
function polishLitre(n) {
  const abs = Math.abs(n);
  if (abs === 1) return "litr";
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return "litry";
  return "litrów";
}

/** The fine unit, declined when the utility says it declines. */
function fineUnitFor(amount) {
  if (utility.plural === "pl-litre") return polishLitre(Math.round(amount));
  return utility.fineUnit;
}

/** Day-scale figure with its unit, e.g. "223 litry" or "8,4 kWh". */
function fmtFine(base, { word = true } = {}) {
  const rounded = Number(fine(base).toFixed(utility.fineDecimals));
  const unit = word ? fineUnitFor(rounded) : utility.fineUnit;
  return `${num(rounded, utility.fineDecimals)} ${unit}`;
}

/** Long-period total in the base unit, e.g. "1,9 m³" or "312 kWh". */
function fmtBase(base) {
  // Cubic metres accumulate slowly enough that one decimal still says
  // something; a month of kWh does not need any.
  const decimals = utility.baseUnit === "m³" ? 1 : 0;
  return `${num(base, decimals)} ${utility.baseUnit}`;
}

function personWord(n) {
  if (n === 1) return "osoba";
  if (n >= 2 && n <= 4) return "osoby";
  return "osób";
}

/* ---------------- dates ---------------- */

const asDate = (iso) => new Date(`${iso}T12:00:00Z`);

function todayISO() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: config.time_zone }).format(new Date());
}

function addDays(iso, n) {
  return new Date(asDate(iso).getTime() + n * 86400000).toISOString().slice(0, 10);
}

function localDay(ts) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: config.time_zone }).format(new Date(ts));
}

function localTime(ts) {
  return new Intl.DateTimeFormat("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: config.time_zone,
  }).format(new Date(ts));
}

function relativeDayLabel(iso) {
  const diff = Math.round((asDate(todayISO()) - asDate(iso)) / 86400000);
  if (diff === 0) return "Dzisiaj";
  if (diff === 1) return "Wczoraj";
  if (diff === 2) return "Przedwczoraj";
  return DAY_LONG.format(asDate(iso)).replace(/^./, (c) => c.toUpperCase());
}

/* ---------------- api ---------------- */

async function api(path, options) {
  const url = path.startsWith("/api/config")
    ? path
    : path + (path.includes("?") ? "&" : "?") + `u=${utility.id}`;
  const res = await fetch(url, options);
  if (res.status === 401) {
    location.reload();
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.status === 204 ? null : res.json();
}

/* ---------------- hero ---------------- */

function renderHero(s) {
  const day = s.latest_day;
  const value = document.getElementById("heroValue");
  const unit = document.getElementById("heroUnit");
  const pill = document.getElementById("heroPerPerson");

  if (!day) {
    value.textContent = "—";
    unit.textContent = "";
    pill.hidden = true;
    document.getElementById("heroDelta").textContent = "";
    document.getElementById("heroLabel").textContent = "Brak danych";
    document.getElementById("heroNote").textContent =
      "Pierwsze zużycie pojawi się, gdy licznik zostanie odczytany w dwóch kolejnych dniach.";
    renderToday(s);
    return;
  }

  document.getElementById("heroLabel").textContent = relativeDayLabel(day.date);

  const amount = Number(fine(day.usage).toFixed(utility.fineDecimals));
  countUp(value, amount);
  unit.textContent = fineUnitFor(amount);

  pill.hidden = false;
  pill.textContent =
    `${fmtFine(day.per_person, { word: false })} na osobę · ${day.persons} ${personWord(day.persons)}`;

  const delta = document.getElementById("heroDelta");
  if (s.previous_day && s.previous_day.usage > 0) {
    const change = Math.round(((day.usage - s.previous_day.usage) / s.previous_day.usage) * 100);
    if (Math.abs(change) < 1) {
      delta.textContent = "tyle samo co dzień wcześniej";
      delta.className = "delta";
    } else {
      delta.textContent = `${change > 0 ? "▲" : "▼"} o ${Math.abs(change)}% ${change > 0 ? "więcej" : "mniej"} niż dzień wcześniej`;
      delta.className = `delta ${change > 0 ? "up" : "down"}`;
    }
  } else {
    delta.textContent = "";
  }

  const notes = [];
  if (day.holiday_name) notes.push(day.holiday_name);
  else if (day.is_weekend) notes.push("weekend");
  if (day.estimated) notes.push("wartość szacowana — brakowało odczytu");
  document.getElementById("heroNote").textContent = notes.join(" · ");

  renderToday(s);
}

function renderToday(s) {
  const el = document.getElementById("heroToday");
  const t = s.today_so_far;
  if (!t || t.readings < 2) {
    el.hidden = true;
    return;
  }
  el.innerHTML = `Dzisiaj od ${localTime(t.since_ts)}: <strong>${fmtFine(t.usage)}</strong>`;
  el.hidden = false;
}

/** Writes the value at once, then animates towards it if the browser can. */
function countUp(el, target) {
  const decimals = utility.fineDecimals;
  el.textContent = num(target, decimals);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || Math.abs(target) > 100000) return;

  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 700);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = num(Number((target * eased).toFixed(decimals)), decimals);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------------- stat cards ---------------- */

function compare(now, before, phrase) {
  if (!before || before <= 0) return { text: "brak porównania", cls: "" };
  const change = Math.round(((now - before) / before) * 100);
  if (Math.abs(change) < 1) return { text: `tyle samo co ${phrase}`, cls: "" };
  return {
    text: `${change > 0 ? "▲" : "▼"} o ${Math.abs(change)}% ${change > 0 ? "więcej" : "mniej"} niż ${phrase}`,
    cls: change > 0 ? "up" : "down",
  };
}

function renderStats(s) {
  document.getElementById("weekNow").textContent = fmtFine(s.week.usage);
  const w = compare(s.week.usage, s.prev_week.usage, "w tym samym czasie tydzień temu");
  const weekCmp = document.getElementById("weekCmp");
  weekCmp.textContent = w.text;
  weekCmp.className = `cmp ${w.cls}`;

  document.getElementById("monthNow").textContent = fmtBase(s.month.usage);
  const m = compare(s.month.usage, s.prev_month.usage, "miesiąc temu o tej porze");
  const monthCmp = document.getElementById("monthCmp");
  monthCmp.textContent = m.text;
  monthCmp.className = `cmp ${m.cls}`;

  const perPerson = s.persons_today > 0 ? s.avg30 / s.persons_today : 0;
  document.getElementById("avgPerson").textContent = fmtFine(perPerson);
  document.getElementById("avgPersonSub").textContent = "dziennie na osobę · ostatnie 30 dni";

  const special = s.special.per_person;
  const ordinary = s.ordinary.per_person;
  document.getElementById("specialNum").textContent = fmtFine(special);
  const specialCmp = document.getElementById("specialCmp");
  if (ordinary > 0 && s.special.days > 0) {
    const diff = Math.round(((special - ordinary) / ordinary) * 100);
    specialCmp.textContent =
      Math.abs(diff) < 1
        ? "na osobę — tyle samo co w dni robocze"
        : `na osobę — ${Math.abs(diff)}% ${diff > 0 ? "więcej" : "mniej"} niż w dni robocze`;
    specialCmp.className = `cmp ${diff > 0 ? "up" : "down"}`;
  } else {
    specialCmp.textContent = "na osobę";
    specialCmp.className = "cmp";
  }

  const r = s.last_reading;
  document.getElementById("lastReading").textContent = r.ts
    ? `odczyt: ${relativeDayLabel(localDay(r.ts)).toLowerCase()}, ${localTime(r.ts)}`
    : "brak odczytu";

  const meta = [];
  if (r.total != null) meta.push(`Licznik: ${num(r.total, utility.baseDecimals)} ${utility.baseUnit}`);
  if (r.battery_y != null) meta.push(`bateria ~${num(r.battery_y, 1)} lat`);
  meta.push(`${s.total_days} dni historii`);
  document.getElementById("meta").textContent = meta.join(" · ");
}

/* ---------------- occupancy ---------------- */

async function renderOccupancy(summary) {
  const day = todayISO();
  document.getElementById("occToday").textContent =
    DAY_LONG.format(asDate(day)).replace(/^./, (c) => c.toUpperCase());

  const data = await api(`/api/occupancy?from=${addDays(day, -13)}&to=${day}`);
  occupancyCache = data.occupancy;
  const current = personsOn(day, summary.persons_today);

  const wrap = document.getElementById("personsToday");
  wrap.innerHTML = "";
  for (let n = 1; n <= 8; n++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `person-btn${n === current ? " is-on" : ""}`;
    b.textContent = n;
    b.setAttribute("aria-pressed", String(n === current));
    b.addEventListener("click", () => setPersons(day, n));
    wrap.appendChild(b);
  }
  renderHistory();
}

function personsOn(date, fallback) {
  let persons = fallback;
  for (const row of [...occupancyCache].sort((a, b) => a.date.localeCompare(b.date))) {
    if (row.date <= date) persons = row.persons;
  }
  return persons;
}

function renderHistory() {
  const wrap = document.getElementById("history");
  const day = todayISO();
  wrap.innerHTML = "";

  for (let i = 1; i <= 13; i++) {
    const date = addDays(day, -i);
    const row = document.createElement("div");
    row.className = "hrow";

    const label = document.createElement("div");
    label.className = "day";
    label.innerHTML = `${DAY_SHORT.format(asDate(date))}<small>${WEEKDAY.format(asDate(date))}</small>`;

    const select = document.createElement("select");
    select.setAttribute("aria-label", `Liczba osób ${date}`);
    const known = occupancyCache.find((r) => r.date === date);
    const shown = known ? known.persons : personsOn(date, 2);
    for (let n = 1; n <= 8; n++) {
      const opt = document.createElement("option");
      opt.value = String(n);
      opt.textContent = `${n} ${personWord(n)}`;
      if (n === shown) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => setPersons(date, Number(select.value)));

    row.append(label, select);
    wrap.appendChild(row);
  }
}

async function setPersons(date, persons) {
  await api("/api/occupancy", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date, persons }),
  });
  await load();
}

/* ---------------- charts ---------------- */

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function barColour(point) {
  if (point.is_holiday || point.has_holiday) return css("--sand") || "#c9975c";
  if (point.estimated) return css("--estimate") || "#b9cfd3";
  if (point.is_weekend) return "#7fb3ba";
  return css("--water") || "#0e7c86";
}

async function renderChart(view) {
  currentView = view;
  const labels = [];
  const values = [];
  const colours = [];
  const tooltips = [];
  let unit = utility.fineUnit;
  let decimals = utility.fineDecimals;

  if (view === "day") {
    const [hourly, daily] = await Promise.all([
      api(`/api/hours?from=${currentDay}&to=${currentDay}`),
      api(`/api/days?from=${currentDay}&to=${currentDay}`),
    ]);
    const byHour = new Map(hourly.hours.map((h) => [h.hour, h]));

    let measured = 0;
    let sum = 0;
    for (let hour = 0; hour < 24; hour++) {
      const h = byHour.get(hour);
      const real = h && !h.estimated;
      labels.push(String(hour).padStart(2, "0"));
      // Hourly views show measured hours only; a missing reading leaves a gap
      // rather than a number nobody measured.
      values.push(real ? Number(fine(h.usage).toFixed(decimals)) : null);
      colours.push(css("--water") || "#0e7c86");
      tooltips.push([`${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00`]);
      if (real) {
        measured++;
        sum += h.usage;
      }
    }
    renderDaySummary(daily.days[0] ?? null, measured, sum);
  } else if (view === "30" || view === "90") {
    const days = Number(view);
    const to = todayISO();
    const data = await api(`/api/days?from=${addDays(to, -(days - 1))}&to=${to}`);
    for (const d of data.days) {
      labels.push(DAY_SHORT.format(asDate(d.date)));
      values.push(Number(fine(d.usage).toFixed(decimals)));
      colours.push(barColour(d));
      tooltips.push(
        [
          DAY_LONG.format(asDate(d.date)),
          d.holiday_name ? `🎉 ${d.holiday_name}` : null,
          `${fmtFine(d.per_person, { word: false })} na osobę (${d.persons})`,
          d.estimated ? "wartość szacowana" : null,
        ].filter(Boolean),
      );
    }
  } else {
    const data = await api(`/api/series?g=${view}`);
    // Weeks still read well in day-scale units; months and years do not.
    const asBase = view !== "week" && utility.finePerBase !== 1;
    unit = asBase ? utility.baseUnit : utility.fineUnit;
    decimals = asBase ? 1 : utility.fineDecimals;

    for (const p of data.points) {
      labels.push(
        view === "week"
          ? DAY_SHORT.format(asDate(p.from_date))
          : view === "month"
            ? MONTH_LONG.format(asDate(p.from_date)).replace(/ \d{4}$/, "")
            : p.label,
      );
      values.push(Number((asBase ? p.usage : fine(p.usage)).toFixed(decimals)));
      colours.push(barColour(p));
      tooltips.push([
        view === "week" ? `Tydzień od ${DAY_SHORT.format(asDate(p.from_date))}` : p.label,
        `${fmtFine(p.per_person, { word: false })} dziennie na osobę`,
      ]);
    }
  }

  const ink = css("--ink") || "#12303a";
  const paper = css("--paper") || "#f4f0e8";
  const muted = css("--muted") || "#5d7178";
  const line = css("--line") || "#ded7c8";

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById("chart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { data: values, backgroundColor: colours, borderRadius: 6, borderSkipped: false, maxBarThickness: 46 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: {
          // Ink box on paper text, so it stays legible in both themes.
          backgroundColor: ink,
          titleColor: paper,
          bodyColor: paper,
          titleFont: { family: "Manrope", size: 17, weight: "700" },
          bodyFont: { family: "Manrope", size: 16, weight: "600" },
          padding: 14,
          cornerRadius: 10,
          displayColors: false,
          callbacks: {
            title: (items) => tooltips[items[0].dataIndex][0],
            label: (item) => [
              `${num(item.parsed.y, decimals)} ${unit}`,
              ...tooltips[item.dataIndex].slice(1),
            ],
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: line },
          ticks: {
            color: muted,
            font: { family: "Manrope", size: 13, weight: "600" },
            maxRotation: 0,
            autoSkipPadding: 16,
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: line, drawTicks: false },
          border: { display: false },
          ticks: {
            color: muted,
            font: { family: "Manrope", size: 13, weight: "600" },
            padding: 8,
            callback: (v) => `${num(v, 0)} ${unit}`,
          },
        },
      },
    },
  });
}

function renderDaySummary(day, measured, sum) {
  const el = document.getElementById("daySum");
  const title = DAY_LONG.format(asDate(currentDay)).replace(/^./, (c) => c.toUpperCase());

  if (measured === 0) {
    el.innerHTML = `<strong>${title}</strong> — brak odczytów godzinowych z tego dnia.`;
    return;
  }

  const parts = [`<strong>${title}</strong>`, `zmierzone: <strong>${fmtFine(sum)}</strong> w ${measured} godz.`];
  if (day && !day.estimated) {
    parts.push(`cały dzień: ${fmtFine(day.usage)} · ${fmtFine(day.per_person, { word: false })} na osobę (${day.persons})`);
  }
  if (day && day.holiday_name) parts.push(`🎉 ${day.holiday_name}`);
  if (measured < 24) parts.push(`bez odczytu: ${24 - measured} godz.`);
  el.innerHTML = parts.join(" · ");
}

function setDay(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso > todayISO()) return;
  currentDay = iso;
  document.getElementById("dayInput").value = iso;
  renderChart("day");
}

/* ---------------- holidays ---------------- */

async function renderHolidays() {
  const data = await api(`/api/days?from=2000-01-01&to=${todayISO()}`);
  const holidays = data.days.filter((d) => d.is_holiday);
  const wrap = document.getElementById("holidayList");
  wrap.innerHTML = "";

  if (holidays.length === 0) {
    wrap.innerHTML =
      '<p class="empty">Jeszcze żadne święto nie trafiło w okres pomiarów. Pojawią się tutaj automatycznie.</p>';
    return;
  }

  for (const d of holidays.slice(-12).reverse()) {
    const row = document.createElement("div");
    row.className = "hol";
    row.innerHTML =
      `<div class="name">${d.holiday_name}<small>${DAY_SHORT.format(asDate(d.date))} · ${d.persons} ${personWord(d.persons)}</small></div>` +
      `<div class="val">${fmtFine(d.usage, { word: false })}</div>`;
    wrap.appendChild(row);
  }
}

/* ---------------- utility switcher ---------------- */

function renderUtilitySwitcher() {
  const nav = document.getElementById("utils");
  if (config.utilities.length < 2) {
    nav.hidden = true;
    return;
  }
  nav.hidden = false;
  nav.innerHTML = "";
  for (const u of config.utilities) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `util${u.id === utility.id ? " is-on" : ""}`;
    b.innerHTML = `<span aria-hidden="true">${u.emoji}</span> ${u.label}`;
    b.setAttribute("aria-pressed", String(u.id === utility.id));
    b.addEventListener("click", () => switchUtility(u));
    nav.appendChild(b);
  }
}

async function switchUtility(spec) {
  utility = spec;
  try {
    localStorage.setItem("utility", spec.id);
  } catch {
    // Private windows refuse storage; remembering the choice is optional.
  }
  document.getElementById("brandEmoji").textContent = spec.emoji;
  document.getElementById("brandLabel").textContent = spec.label;
  document.title = `${spec.label} — zużycie w domu`;
  renderUtilitySwitcher();
  await load();
}

/* ---------------- boot ---------------- */

async function load() {
  const summary = await api("/api/summary");
  renderHero(summary);
  renderStats(summary);
  await renderOccupancy(summary);
  await renderChart(currentView);
  await renderHolidays();
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-on", t === tab));
  document.getElementById("dayPick").hidden = tab.dataset.view !== "day";
  renderChart(tab.dataset.view);
});

document.getElementById("toggleHistory").addEventListener("click", (e) => {
  const box = document.getElementById("history");
  const opening = box.hidden;
  box.hidden = !opening;
  e.target.setAttribute("aria-expanded", String(opening));
  e.target.textContent = opening ? "Ukryj wcześniejsze dni" : "Popraw wcześniejsze dni";
});

document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.reload();
});

document.getElementById("dayPrev").addEventListener("click", () => setDay(addDays(currentDay, -1)));
document.getElementById("dayNext").addEventListener("click", () => setDay(addDays(currentDay, 1)));
document.getElementById("dayInput").addEventListener("change", (e) => setDay(e.target.value));

(async function start() {
  try {
    config = await (await fetch("/api/config")).json();
    if (!config.utilities || config.utilities.length === 0) throw new Error("no utilities configured");

    let remembered = null;
    try {
      remembered = localStorage.getItem("utility");
    } catch {
      // Storage is a convenience here, never a requirement.
    }
    const chosen = config.utilities.find((u) => u.id === remembered) ?? config.utilities[0];

    currentDay = todayISO();
    const input = document.getElementById("dayInput");
    input.max = currentDay;
    input.value = currentDay;

    await switchUtility(chosen);
  } catch (err) {
    console.error(err);
    document.getElementById("heroNote").textContent =
      "Nie udało się wczytać danych. Odśwież stronę.";
  }
})();
