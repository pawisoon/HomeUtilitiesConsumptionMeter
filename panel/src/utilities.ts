/// What each utility is called and how its numbers should be shown.
///
/// Counters are stored in a base unit (m³ for water and gas, kWh for
/// electricity) and displayed in whichever unit reads better at household
/// scale: litres for water, kWh for electricity and gas.

export type UtilityId = "water" | "electricity" | "gas";

export interface UtilitySpec {
  id: UtilityId;
  /** Shown in the utility switcher and headings. */
  label: string;
  emoji: string;
  /** Unit the counter is stored in. */
  baseUnit: string;
  /** Unit used for day-scale numbers. */
  fineUnit: string;
  /** How many fine units make one base unit. */
  finePerBase: number;
  /** Decimals when showing a base-unit total. */
  baseDecimals: number;
  /** Decimals when showing a day-scale figure in fine units. */
  fineDecimals: number;
  /**
   * Declension rule the dashboard applies to the fine unit, or null when the
   * unit does not decline. A name rather than a function, because this spec
   * travels to the browser as JSON.
   */
  plural: "pl-litre" | null;
}

export const UTILITIES: Record<UtilityId, UtilitySpec> = {
  water: {
    id: "water",
    label: "Woda",
    emoji: "💧",
    baseUnit: "m³",
    fineUnit: "l",
    finePerBase: 1000,
    baseDecimals: 3,
    fineDecimals: 0,
    plural: "pl-litre",
  },
  electricity: {
    id: "electricity",
    label: "Prąd",
    emoji: "⚡",
    baseUnit: "kWh",
    fineUnit: "kWh",
    finePerBase: 1,
    baseDecimals: 2,
    fineDecimals: 1,
    plural: null,
  },
  gas: {
    id: "gas",
    label: "Gaz",
    emoji: "🔥",
    baseUnit: "m³",
    fineUnit: "m³",
    finePerBase: 1,
    baseDecimals: 2,
    fineDecimals: 2,
    plural: null,
  },
};

export function isUtilityId(value: string): value is UtilityId {
  return value === "water" || value === "electricity" || value === "gas";
}

/**
 * Utilities this deployment tracks, in display order, from the UTILITIES var.
 * Unknown names are ignored so a typo cannot take the panel down; water is the
 * fallback when nothing valid is configured.
 */
export function enabledUtilities(raw: string | undefined): UtilitySpec[] {
  const ids = (raw ?? "water")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(isUtilityId);
  const unique = [...new Set(ids)];
  return (unique.length > 0 ? unique : ["water" as const]).map((id) => UTILITIES[id]);
}
