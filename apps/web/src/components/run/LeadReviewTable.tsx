"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";

interface ParsedCsvRows {
  headers: string[];
  rows: Record<string, string>[];
}

const PAGE_SIZE = 25;

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "READY") return "success";
  if (status === "READY_FALLBACK") return "warning";
  if (status === "BLOCKED") return "danger";
  return "neutral";
}

/**
 * Tabs for the fallback resolver's two lead-review artifacts. The blocked
 * tab is read-only by construction — there is no row-selection or export
 * affordance here, so blocked rows can never enter an upload/export action
 * from this screen. Every cell is rendered through JSX text interpolation
 * (never dangerouslySetInnerHTML), so lead content is always escaped.
 */
export function LeadReviewTable({ ready, blocked }: { ready: ParsedCsvRows; blocked: ParsedCsvRows }) {
  const [tab, setTab] = useState<"ready" | "blocked">(blocked.rows.length > 0 ? "blocked" : "ready");
  const [search, setSearch] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const active = tab === "ready" ? ready : blocked;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    let rows = active.rows;
    if (query) {
      rows = rows.filter((row) => Object.values(row).some((value) => value.toLowerCase().includes(query)));
    }
    if (sortColumn) {
      rows = [...rows].sort((a, b) => {
        const cmp = (a[sortColumn] ?? "").localeCompare(b[sortColumn] ?? "", undefined, { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [active.rows, search, sortColumn, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function switchTab(next: "ready" | "blocked") {
    setTab(next);
    setSearch("");
    setSortColumn(null);
    setPage(0);
  }

  function toggleSort(column: string) {
    if (sortColumn === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDir("asc");
    }
    setPage(0);
  }

  const visibleColumns = active.headers.filter(
    (h) => !["fallback_applied", "fallback_fields", "validation_errors", "automation_status"].includes(h),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2" role="tablist" aria-label="Lead review">
        <Button
          size="sm"
          variant={tab === "ready" ? "secondary" : "ghost"}
          role="tab"
          aria-selected={tab === "ready"}
          onClick={() => switchTab("ready")}
          data-testid="lead-review-tab-ready"
        >
          Ready to push ({ready.rows.length})
        </Button>
        <Button
          size="sm"
          variant={tab === "blocked" ? "secondary" : "ghost"}
          role="tab"
          aria-selected={tab === "blocked"}
          onClick={() => switchTab("blocked")}
          data-testid="lead-review-tab-blocked"
        >
          Blocked for review ({blocked.rows.length})
        </Button>
      </div>

      <Input
        placeholder="Search…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
        aria-label={`Search ${tab} leads`}
        data-testid="lead-review-search"
        className="max-w-sm"
      />

      {active.rows.length === 0 ? (
        <EmptyState title={`No ${tab === "ready" ? "ready" : "blocked"} leads`} />
      ) : (
        <div className="max-h-[32rem] overflow-auto rounded border border-sage-light">
          <Table>
            <THead>
              <TR>
                {visibleColumns.map((header) => (
                  <TH key={header}>
                    <button
                      type="button"
                      className="flex items-center gap-1 whitespace-nowrap font-medium hover:underline"
                      onClick={() => toggleSort(header)}
                      aria-label={`Sort by ${header}`}
                    >
                      {header}
                      {sortColumn === header ? (sortDir === "asc" ? "▲" : "▼") : ""}
                    </button>
                  </TH>
                ))}
                {tab === "ready" && active.headers.includes("automation_status") ? <TH>Status</TH> : null}
                {tab === "blocked" && active.headers.includes("validation_errors") ? (
                  <TH>Validation errors</TH>
                ) : null}
                {tab === "blocked" && active.headers.includes("fallback_fields") ? (
                  <TH>Fallback fields</TH>
                ) : null}
              </TR>
            </THead>
            <TBody>
              {pageRows.map((row, index) => (
                <TR key={index}>
                  {visibleColumns.map((header) => (
                    <TD key={header} className="max-w-52 truncate whitespace-nowrap text-xs">
                      {row[header]}
                    </TD>
                  ))}
                  {tab === "ready" && active.headers.includes("automation_status") ? (
                    <TD>
                      <Badge tone={statusTone(row.automation_status ?? "")}>{row.automation_status}</Badge>
                    </TD>
                  ) : null}
                  {tab === "blocked" && active.headers.includes("validation_errors") ? (
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {(row.validation_errors ?? "")
                          .split(";")
                          .filter(Boolean)
                          .map((code) => (
                            <Badge key={code} tone="danger" className="font-mono text-[10px]">
                              {code}
                            </Badge>
                          ))}
                      </div>
                    </TD>
                  ) : null}
                  {tab === "blocked" && active.headers.includes("fallback_fields") ? (
                    <TD className="text-xs">{row.fallback_fields}</TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      {filtered.length > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-xs text-charcoal/60">
          <span>
            Page {page + 1} of {pageCount} ({filtered.length} row(s))
          </span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
