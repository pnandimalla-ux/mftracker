export type Confidence = "high" | "medium" | "low";

export interface ParsedHolding {
  scheme_name: string;
  scheme_code: string | null;
  category: string;
  units: number;
  avg_nav: number;
  invested_amount: number;
  confidence: Confidence;
}

export interface ParseRowError {
  row: number;
  raw: string;
  reason: string;
}

export interface CasParseResult {
  holdings: ParsedHolding[];
  errors: ParseRowError[];
}

interface MfapiSearchResult {
  schemeCode: number;
  schemeName: string;
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/large\s*cap|bluechip|top\s*100|top\s*50/i, "Large Cap"],
  [/mid\s*cap|midcap/i, "Mid Cap"],
  [/small\s*cap|smallcap/i, "Small Cap"],
  [/flexi|multi\s*cap|multicap/i, "Flexi Cap"],
  [/elss|tax\s*saver|tax\s*saving|long\s*term\s*equity/i, "ELSS"],
  [/liquid|overnight|debt|bond|gilt|credit/i, "Debt"],
  [/balanced|hybrid|equity\s*savings|arbitrage/i, "Hybrid"],
  [/index|nifty|sensex|bse|etf/i, "Index"],
  [/international|global|overseas|nasdaq|s&p/i, "International"],
];

function detectCategory(schemeName: string): string {
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(schemeName)) return category;
  }
  return "Flexi Cap";
}

// Minimal RFC4180-ish CSV line splitter: handles quoted fields, embedded
// commas, and "" escaped quotes.
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseNumeric(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/[₹,\s]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const HEADER_FIELD_PATTERNS: Record<string, RegExp[]> = {
  folio: [/folio/i],
  scheme: [/scheme\s*name/i, /fund\s*name/i, /scheme/i],
  units: [/^units?$/i, /units?\s*balance/i, /closing\s*units/i, /^units?\b/i],
  cost: [
    /cost\s*value/i,
    /amount\s*invested/i,
    /purchase\s*(cost|value)/i,
    /total\s*cost/i,
    /^cost$/i,
    /invested/i,
  ],
};

interface HeaderMatch {
  index: number;
  columns: Partial<Record<string, number>>;
}

function detectHeader(lines: string[]): HeaderMatch | null {
  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const columns: Partial<Record<string, number>> = {};

    for (const [field, patterns] of Object.entries(HEADER_FIELD_PATTERNS)) {
      for (let c = 0; c < cells.length; c++) {
        if (columns[field] !== undefined) break;
        if (patterns.some((p) => p.test(cells[c]))) {
          columns[field] = c;
        }
      }
    }

    if (
      columns.scheme !== undefined &&
      columns.units !== undefined &&
      columns.cost !== undefined
    ) {
      return { index: i, columns };
    }
  }
  return null;
}

const NON_DATA_ROW = /total|grand total|folio\s*no\s*:|opening balance|closing balance/i;

function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(fund|scheme|plan|direct|regular|growth|dividend|payout|reinvestment|option)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  const wa = new Set(normalizeForMatch(a).split(" ").filter(Boolean));
  const wb = new Set(normalizeForMatch(b).split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;

  let intersection = 0;
  wa.forEach((w) => {
    if (wb.has(w)) intersection++;
  });
  const unionSet = new Set(wa);
  wb.forEach((w) => unionSet.add(w));
  const union = unionSet.size;
  return union === 0 ? 0 : intersection / union;
}

async function matchScheme(
  schemeName: string
): Promise<{ scheme_code: string | null; confidence: Confidence }> {
  try {
    const res = await fetch(
      `https://api.mfapi.in/mf/search?q=${encodeURIComponent(schemeName)}`
    );
    if (!res.ok) return { scheme_code: null, confidence: "low" };

    const results = (await res.json()) as MfapiSearchResult[];
    if (!Array.isArray(results) || results.length === 0) {
      return { scheme_code: null, confidence: "low" };
    }

    let best = results[0];
    let bestScore = similarity(schemeName, best.schemeName);

    for (const r of results.slice(1)) {
      const score = similarity(schemeName, r.schemeName);
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }

    if (bestScore >= 0.6) {
      return { scheme_code: String(best.schemeCode), confidence: "high" };
    }
    if (bestScore >= 0.3) {
      return { scheme_code: String(best.schemeCode), confidence: "medium" };
    }
    return { scheme_code: null, confidence: "low" };
  } catch (err) {
    console.error(`matchScheme("${schemeName}") failed:`, err);
    return { scheme_code: null, confidence: "low" };
  }
}

export async function parseCasCsv(rawCsv: string): Promise<CasParseResult> {
  const lines = rawCsv.split(/\r?\n/);
  const errors: ParseRowError[] = [];

  const header = detectHeader(lines);
  if (!header) {
    return {
      holdings: [],
      errors: [
        {
          row: 0,
          raw: "",
          reason:
            "Could not find a header row with Scheme, Units, and Cost columns.",
        },
      ],
    };
  }

  const schemeCol = header.columns.scheme as number;
  const unitsCol = header.columns.units as number;
  const costCol = header.columns.cost as number;

  const draft: { scheme_name: string; units: number; invested_amount: number }[] = [];

  for (let i = header.index + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;

    const cells = splitCsvLine(raw);
    const schemeName = cells[schemeCol]?.trim();

    if (!schemeName || NON_DATA_ROW.test(schemeName)) {
      continue;
    }

    const units = parseNumeric(cells[unitsCol]);
    const cost = parseNumeric(cells[costCol]);

    if (units === null || cost === null || units <= 0) {
      errors.push({
        row: i + 1,
        raw,
        reason:
          units === null
            ? "Could not parse units"
            : cost === null
              ? "Could not parse cost/invested amount"
              : "Units must be greater than zero",
      });
      continue;
    }

    draft.push({ scheme_name: schemeName, units, invested_amount: cost });
  }

  const holdings: ParsedHolding[] = await Promise.all(
    draft.map(async (row) => {
      const { scheme_code, confidence } = await matchScheme(row.scheme_name);
      return {
        scheme_name: row.scheme_name,
        scheme_code,
        category: detectCategory(row.scheme_name),
        units: row.units,
        avg_nav: row.invested_amount / row.units,
        invested_amount: row.invested_amount,
        confidence,
      };
    })
  );

  return { holdings, errors };
}
