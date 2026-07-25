import { PROTOCOL } from "./protocol";

/**
 * Canonical version-one upload schema. Source of truth: the attached
 * enriched lead export ("AI Heads - 51 to 200 HC - US - Enriched.csv"),
 * which is a Vayne "simple" export enriched with Icypeas email discovery
 * (Email/Status/MX columns) and MillionVerifier results (quality/result/
 * free/role). Matching is case- and punctuation-insensitive, mirroring
 * gtm_research/pipeline/input.py `_normalise_header`.
 */
export const CANONICAL_HEADERS = [
  "recent duplicate", "matching filters", "mismatched filters", "member linkedin id",
  "member linkedin sales nav id", "first name", "last name", "email", "quality", "result",
  "free", "role", "phone", "profile picture", "summary", "job title", "job description",
  "job started on", "linkedin url", "location", "company linkedin id", "company",
  "corporate linkedin url", "corporate website", "linkedin description",
  "linkedin specialities", "linkedin employees", "linkedin industry", "linkedin founded year",
  "linkedin company location", "linkedin company picture", "job ended on",
  "linkedin company employee count", "linkedin company revenue range", "headline",
  "open profile", "premium member", "skills", "languages", "number of connections",
  "certifications", "Email", "Status", "MX provider", "MX records", "company_casual",
  "niche", "icebreaker", "subject_line",
] as const;

/**
 * Columns the pipelines actually require to run. The GTM pipeline's own
 * loader (input.py COLUMN_ALIASES) accepts aliases; these names are the
 * canonical spelling and each entry lists accepted aliases.
 */
export const REQUIRED_COLUMNS: ReadonlyArray<{ name: string; aliases: readonly string[] }> = [
  { name: "first name", aliases: ["first name", "first_name", "firstname", "given name"] },
  { name: "last name", aliases: ["last name", "last_name", "lastname", "family name", "surname"] },
  { name: "company", aliases: ["company", "company name", "account name", "account", "organization", "organisation"] },
  { name: "corporate website", aliases: ["corporate website", "website", "company website", "domain", "company domain"] },
  { name: "Email", aliases: ["email", "work email", "business email", "contact email"] },
  { name: "Status", aliases: ["status", "email status", "email verification status", "verification status", "mv_result", "mv_quality", "icypeas_status", "result", "quality"] },
];

export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Dependency-free RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string, maxRows?: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip UTF-8 BOM
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Skip fully-empty trailing lines
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
      if (maxRows !== undefined && rows.length > maxRows) return rows;
    } else if (ch === "\r") {
      // handled by the following \n; lone \r also terminates a row
      if (src[i + 1] !== "\n") {
        pushRow();
        if (maxRows !== undefined && rows.length > maxRows) return rows;
      }
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

export interface CsvValidationResult {
  ok: boolean;
  totalRows: number;
  headers: string[];
  missingRequired: string[];
  unexpectedColumns: string[];
  duplicateRowCount: number;
  errors: string[];
  warnings: string[];
  preview: { headers: string[]; rows: string[][] };
}

/**
 * Validate an uploaded CSV against the canonical schema.
 * - Missing required columns block the run (no automatic column-mapping guesses).
 * - Unexpected columns are surfaced but never deleted.
 * - Duplicates counted by lowercased email (falling back to whole-row identity).
 */
export function validateLeadCsv(
  text: string,
  options: { maxRows?: number; previewRows?: number } = {},
): CsvValidationResult {
  const maxRows = options.maxRows ?? PROTOCOL.limits.max_leads_per_run;
  const previewRows = options.previewRows ?? 50;
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = parseCsv(text);
  if (parsed.length === 0) {
    return {
      ok: false, totalRows: 0, headers: [], missingRequired: [], unexpectedColumns: [],
      duplicateRowCount: 0, errors: ["File is empty or has no header row."], warnings: [],
      preview: { headers: [], rows: [] },
    };
  }
  const headers = parsed[0] ?? [];
  const dataRows = parsed.slice(1);
  const normalized = headers.map(normalizeHeader);
  const normalizedSet = new Set(normalized);

  const missingRequired = REQUIRED_COLUMNS.filter(
    (req) => !req.aliases.some((alias) => normalizedSet.has(normalizeHeader(alias))),
  ).map((req) => req.name);

  const canonicalNormalized = new Set(CANONICAL_HEADERS.map(normalizeHeader));
  const unexpectedColumns = headers.filter((h) => !canonicalNormalized.has(normalizeHeader(h)));

  if (missingRequired.length > 0) {
    errors.push(
      `Missing required columns: ${missingRequired.join(", ")}. Fix the file — columns are never guessed or auto-mapped.`,
    );
  }
  if (dataRows.length === 0) errors.push("File contains a header but no data rows.");
  if (dataRows.length > maxRows) {
    errors.push(`File has ${dataRows.length} rows; the maximum per run is ${maxRows}.`);
  }
  if (unexpectedColumns.length > 0) {
    warnings.push(
      `${unexpectedColumns.length} column(s) outside the canonical schema are present and will be kept as-is: ${unexpectedColumns.slice(0, 8).join(", ")}${unexpectedColumns.length > 8 ? ", …" : ""}`,
    );
  }

  // Duplicate detection: prefer the Icypeas "Email" column, then vayne "email".
  const emailIdx = findColumn(headers, ["Email"]) ?? findColumn(headers, ["email"]);
  const seen = new Set<string>();
  let duplicateRowCount = 0;
  for (const row of dataRows) {
    const key =
      emailIdx !== null && (row[emailIdx] ?? "").trim() !== ""
        ? `e:${(row[emailIdx] ?? "").trim().toLowerCase()}`
        : `r:${row.join("\u001f")}`;
    if (seen.has(key)) duplicateRowCount++;
    else seen.add(key);
  }
  if (duplicateRowCount > 0) {
    warnings.push(`${duplicateRowCount} duplicate row(s) detected (matching email or identical row).`);
  }

  return {
    ok: errors.length === 0,
    totalRows: dataRows.length,
    headers,
    missingRequired,
    unexpectedColumns,
    duplicateRowCount,
    errors,
    warnings,
    preview: { headers, rows: dataRows.slice(0, previewRows) },
  };
}

/** Exact-header-first, then normalized lookup. Returns column index or null. */
export function findColumn(headers: string[], candidates: string[]): number | null {
  for (const candidate of candidates) {
    const exact = headers.indexOf(candidate);
    if (exact >= 0) return exact;
  }
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => normalizeHeader(h) === normalizeHeader(candidate));
    if (idx >= 0) return idx;
  }
  return null;
}

/** Windows/posix-safe artifact file name: strips path separators and control chars. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001f]/g, "").replace(/\.\.+/g, ".").trim();
  return cleaned.length > 0 && cleaned !== "." ? cleaned.slice(0, 180) : "file.csv";
}

/** Sales Navigator search URL validation (search or saved-list URLs). */
export function isSalesNavigatorSearchUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host !== "www.linkedin.com" && host !== "linkedin.com") return false;
  return /^\/sales\/(search\/(people|company)|lists\/)/.test(url.pathname);
}
