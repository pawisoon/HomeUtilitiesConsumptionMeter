/// Polish public holidays, computed rather than fetched, so the panel keeps
/// working offline and for whatever years the meter history covers.
///
/// To support another country, add a table beside this one and pick it in
/// holidayFor(). The rest of the code only asks "is this date special, and what
/// is it called".

/** Easter Sunday (Gregorian), Meeus/Jones/Butcher algorithm. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

const cache = new Map<number, Map<string, string>>();

function holidaysOfYear(year: number): Map<string, string> {
  const cached = cache.get(year);
  if (cached) return cached;

  const map = new Map<string, string>();
  const fixed: Array<[string, string]> = [
    ["01-01", "Nowy Rok"],
    ["01-06", "Trzech Króli"],
    ["05-01", "Święto Pracy"],
    ["05-03", "Święto Konstytucji 3 Maja"],
    ["08-15", "Wniebowzięcie NMP"],
    ["11-01", "Wszystkich Świętych"],
    ["11-11", "Święto Niepodległości"],
    ["12-24", "Wigilia"],
    ["12-25", "Boże Narodzenie"],
    ["12-26", "Drugi dzień świąt"],
    ["12-31", "Sylwester"],
  ];
  for (const [md, name] of fixed) map.set(`${year}-${md}`, name);

  const easter = easterSunday(year);
  map.set(iso(shift(easter, -1)), "Wielka Sobota");
  map.set(iso(easter), "Wielkanoc");
  map.set(iso(shift(easter, 1)), "Poniedziałek Wielkanocny");
  map.set(iso(shift(easter, 49)), "Zielone Świątki");
  map.set(iso(shift(easter, 60)), "Boże Ciało");

  cache.set(year, map);
  return map;
}

/** Holiday name for a date, or null on an ordinary day. */
export function holidayFor(isoDate: string): string | null {
  const year = Number(isoDate.slice(0, 4));
  if (!Number.isInteger(year)) return null;
  return holidaysOfYear(year).get(isoDate) ?? null;
}
