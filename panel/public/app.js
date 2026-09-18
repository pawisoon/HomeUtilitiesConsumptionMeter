/* Home Utilities Consumption Meter — dashboard.
   Plain browser JavaScript, no build step: the Worker serves this file as is. */

/* ---------------- language ---------------- */

let lang = "pl";
let S = window.I18N.strings.pl;
let plural = window.I18N.plurals.pl;
let DAY_LONG, DAY_SHORT, WEEKDAY, MONTH_LONG;

/** A string from the dictionary with {placeholders} filled in. */
function t(key, vars) {
  let text = S[key] ?? key;
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(value);
  return text;
}

function setLanguage(code) {
  lang = window.I18N.languages.includes(code) ? code : "pl";
  S = window.I18N.strings[lang];
  plural = window.I18N.plurals[lang];
  const l = S.locale;
  DAY_LONG = new Intl.DateTimeFormat(l, { weekday: "long", day: "numeric", month: "long" });
  DAY_SHORT = new Intl.DateTimeFormat(l, { day: "numeric", month: "short" });
  WEEKDAY = new Intl.DateTimeFormat(l, { weekday: "short" });
  MONTH_LONG = new Intl.DateTimeFormat(l, { month: "long", year: "numeric" });
  document.documentElement.lang = lang;
  try {
    localStorage.setItem("lang", lang);
  } catch {
    // Storage refused; the choice lasts for this visit only.
  }
}

/** Fills every element carrying data-i18n, and its aria-label twin. */
function translatePage() {
  document.title = S.docTitle;
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-aria]")) {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  }
}

/* ---------------- state ---------------- */

let config = { utilities: [], time_zone: "Europe/Warsaw", language: "pl" };
let utility = null;          // spec of the utility on screen
let chart = null;
let currentView = "day";
let currentDay = null;
let occupancyCache = [];

const num = (value, decimals = 0) =>
  new Intl.NumberFormat(S.locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);

/* ---------------- units ---------------- */

/** Base-unit value as a day-scale number, e.g. 0.223 m³ → 223. */
const fine = (base) => base * utility.finePerBase;

/** The fine unit, declined in languages that decline it. */
function fineUnitFor(amount) {
  if (utility.plural === "pl-litre") return plural.litre(Math.round(amount));
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

const personWord = (n) => plural.person(n);

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
  return new Intl.DateTimeFormat(S.locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: config.time_zone,
  }).format(new Date(ts));
}

function relativeDayLabel(iso) {
  const diff = Math.round((asDate(todayISO()) - asDate(iso)) / 86400000);
  if (diff === 0) return S.today;
  if (diff === 1) return S.yesterday;
  if (diff === 2) return S.dayBefore;
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
    document.getElementById("heroLabel").textContent = S.noData;
    document.getElementById("heroNote").textContent = S.firstReading;
    renderToday(s);
    return;
  }

  document.getElementById("heroLabel").textContent = relativeDayLabel(day.date);

  const amount = Number(fine(day.usage).toFixed(utility.fineDecimals));
  countUp(value, amount);
  unit.textContent = fineUnitFor(amount);

  pill.hidden = false;
  pill.textContent = t("heroPill", {
    amount: fmtFine(day.per_person, { word: false }),
    n: day.persons,
    people: personWord(day.persons),
  });

  const delta = document.getElementById("heroDelta");
  if (s.previous_day && s.previous_day.usage > 0) {
    const change = Math.round(((day.usage - s.previous_day.usage) / s.previous_day.usage) * 100);
    if (Math.abs(change) < 1) {
      delta.textContent = t("cmpSame", { phrase: S.phraseYesterday });
      delta.className = "delta";
    } else {
      delta.textContent = t("cmpPattern", {
        arrow: change > 0 ? "▲" : "▼",
        pct: Math.abs(change),
        dir: change > 0 ? S.more : S.less,
        phrase: S.phraseYesterday,
      });
      delta.className = `delta ${change > 0 ? "up" : "down"}`;
    }
  } else {
    delta.textContent = "";
  }

  const notes = [];
  if (day.holiday_name) notes.push(day.holiday_name);
  else if (day.is_weekend) notes.push(S.weekend);
  if (day.estimated) notes.push(S.estimatedDay);
  document.getElementById("heroNote").textContent = notes.join(" · ");

  renderToday(s);
}

function renderToday(s) {
  const el = document.getElementById("heroToday");
  const today = s.today_so_far;
  if (!today || today.readings < 2) {
    el.hidden = true;
    return;
  }
  el.innerHTML = t("todaySince", {
    time: localTime(today.since_ts),
    amount: `<strong>${fmtFine(today.usage)}</strong>`,
  });
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
  if (!before || before <= 0) return { text: S.noComparison, cls: "" };
  const change = Math.round(((now - before) / before) * 100);
  if (Math.abs(change) < 1) return { text: t("cmpSame", { phrase }), cls: "" };
  return {
    text: t("cmpPattern", {
      arrow: change > 0 ? "▲" : "▼",
      pct: Math.abs(change),
      dir: change > 0 ? S.more : S.less,
      phrase,
    }),
    cls: change > 0 ? "up" : "down",
  };
}

function renderStats(s) {
  document.getElementById("weekNow").textContent = fmtFine(s.week.usage);
  const w = compare(s.week.usage, s.prev_week.usage, S.phraseWeek);
  const weekCmp = document.getElementById("weekCmp");
  weekCmp.textContent = w.text;
  weekCmp.className = `cmp ${w.cls}`;

  document.getElementById("monthNow").textContent = fmtBase(s.month.usage);
  const m = compare(s.month.usage, s.prev_month.usage, S.phraseMonth);
  const monthCmp = document.getElementById("monthCmp");
  monthCmp.textContent = m.text;
  monthCmp.className = `cmp ${m.cls}`;

  const perPerson = s.persons_today > 0 ? s.avg30 / s.persons_today : 0;
  document.getElementById("avgPerson").textContent = fmtFine(perPerson);
  document.getElementById("avgPersonSub").textContent = S.dailyPerPerson;

  const special = s.special.per_person;
  const ordinary = s.ordinary.per_person;
  document.getElementById("specialNum").textContent = fmtFine(special);
  const specialCmp = document.getElementById("specialCmp");
  if (ordinary > 0 && s.special.days > 0) {
    const diff = Math.round(((special - ordinary) / ordinary) * 100);
    specialCmp.textContent =
      Math.abs(diff) < 1
        ? S.sameAsWorkdays
        : t("vsWorkdays", { pct: Math.abs(diff), dir: diff > 0 ? S.more : S.less });
    specialCmp.className = `cmp ${diff > 0 ? "up" : "down"}`;
  } else {
    specialCmp.textContent = S.perPersonOnly;
    specialCmp.className = "cmp";
  }

  const r = s.last_reading;
  document.getElementById("lastReading").textContent = r.ts
    ? t("lastReading", {
        day: S.lowercaseRelative
          ? relativeDayLabel(localDay(r.ts)).toLowerCase()
          : relativeDayLabel(localDay(r.ts)),
        time: localTime(r.ts),
      })
    : S.noReading;

  const meta = [];
  if (r.total != null) {
    meta.push(t("meterTotal", { total: `${num(r.total, utility.baseDecimals)} ${utility.baseUnit}` }));
  }
  if (r.battery_y != null) meta.push(t("battery", { years: num(r.battery_y, 1) }));
  meta.push(t("historyDays", { n: s.total_days }));
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
    select.setAttribute("aria-label", t("peopleOn", { date }));
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
          t("perPersonCount", { amount: fmtFine(d.per_person, { word: false }), n: d.persons }),
          d.estimated ? S.estimated : null,
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
        view === "week" ? t("weekFrom", { date: DAY_SHORT.format(asDate(p.from_date)) }) : p.label,
        t("perPersonDaily", { amount: fmtFine(p.per_person, { word: false }) }),
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
    el.innerHTML = t("noHours", { day: `<strong>${title}</strong>` });
    return;
  }

  const parts = [
    `<strong>${title}</strong>`,
    t("measuredLine", { amount: `<strong>${fmtFine(sum)}</strong>`, n: measured }),
  ];
  if (day && !day.estimated) {
    parts.push(t("wholeDayLine", {
      total: fmtFine(day.usage),
      perPerson: fmtFine(day.per_person, { word: false }),
      n: day.persons,
    }));
  }
  if (day && day.holiday_name) parts.push(`🎉 ${day.holiday_name}`);
  if (measured < 24) parts.push(t("missingHours", { n: 24 - measured }));
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
    wrap.innerHTML = `<p class="empty">${S.noHolidays}</p>`;
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
  nav.setAttribute("aria-label", S.utilityPicker);
  nav.innerHTML = "";
  for (const u of config.utilities) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `util${u.id === utility.id ? " is-on" : ""}`;
    b.innerHTML = `<span aria-hidden="true">${u.emoji}</span> ${S[u.id] ?? u.label}`;
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
  const label = S[spec.id] ?? spec.label;
  document.getElementById("brandEmoji").textContent = spec.emoji;
  document.getElementById("brandLabel").textContent = label;
  document.title = t("pageTitle", { utility: label });
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
  e.target.textContent = opening ? S.hideEarlier : S.fixEarlier;
});

/* ---------------- theme ---------------- */

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "dark") root.dataset.theme = "dark";
  else delete root.dataset.theme;

  const button = document.getElementById("theme");
  button.textContent = theme === "dark" ? "☀️" : "🌙";
  button.setAttribute("aria-label", theme === "dark" ? S.toLight : S.toDark);
  document.querySelector('meta[name="theme-color"]').content =
    theme === "dark" ? "#0c1a20" : "#0e5a66";

  try {
    localStorage.setItem("theme", theme);
  } catch {
    // Private windows refuse storage; the choice simply lasts one visit.
  }
}

document.getElementById("language").addEventListener("click", async () => {
  const next = window.I18N.languages[(window.I18N.languages.indexOf(lang) + 1) % window.I18N.languages.length];
  setLanguage(next);
  translatePage();
  applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  document.getElementById("language").textContent = next.toUpperCase();
  renderUtilitySwitcher();
  await load();
});

document.getElementById("theme").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  // Chart.js copies the palette when it builds, so it needs drawing again.
  if (chart) renderChart(currentView);
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

    // Order of preference: what this visitor chose, then what the panel is
    // configured for, then Polish.
    let storedLang = null;
    try {
      storedLang = localStorage.getItem("lang");
    } catch {
      // Storage refused; fall back to the configured language.
    }
    setLanguage(storedLang ?? config.language ?? "pl");
    translatePage();
    document.getElementById("language").textContent = lang.toUpperCase();

    if (!config.utilities || config.utilities.length === 0) throw new Error("no utilities configured");

    let remembered = null;
    try {
      remembered = localStorage.getItem("utility");
    } catch {
      // Storage is a convenience here, never a requirement.
    }
    const chosen = config.utilities.find((u) => u.id === remembered) ?? config.utilities[0];

    // The stored choice is the source of truth, so the theme survives even if
    // the pre-paint script in the page never ran.
    let storedTheme = null;
    try {
      storedTheme = localStorage.getItem("theme");
    } catch {
      // Storage refused; the page simply opens light.
    }
    applyTheme(storedTheme === "dark" ? "dark" : "light");
    currentDay = todayISO();
    const input = document.getElementById("dayInput");
    input.max = currentDay;
    input.value = currentDay;

    await switchUtility(chosen);
  } catch (err) {
    console.error(err);
    document.getElementById("heroNote").textContent = S.loadFailed;
  }
})();
