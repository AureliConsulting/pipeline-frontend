"use client";
import { useMemo, useState } from "react";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";

interface ParsedCsvRows {
  headers: string[];
  rows: Record<string, string>[];
}

const PAGE_SIZE = 50;

const COLUMNS = [
  "row_number",
  "email",
  "internal_field",
  "output_field",
  "old_value",
  "new_value",
  "rule_type",
  "rule_index",
  "campaign_config_hash",
] as const;

/** Renders fallback_audit.csv 1:1 with filters by email, field, and rule type. */
export function AuditTable({ audit }: { audit: ParsedCsvRows }) {
  const [email, setEmail] = useState("");
  const [field, setField] = useState("");
  const [ruleType, setRuleType] = useState("");
  const [page, setPage] = useState(0);

  const columns = COLUMNS.filter((c) => audit.headers.includes(c) || c === "internal_field" || c === "output_field");

  const filtered = useMemo(() => {
    const emailQuery = email.trim().toLowerCase();
    const fieldQuery = field.trim().toLowerCase();
    const ruleQuery = ruleType.trim().toLowerCase();
    return audit.rows.filter((row) => {
      if (emailQuery && !(row.email ?? "").toLowerCase().includes(emailQuery)) return false;
      if (fieldQuery) {
        const fieldValue = (row.internal_field ?? row.field ?? "").toLowerCase();
        const outputValue = (row.output_field ?? "").toLowerCase();
        if (!fieldValue.includes(fieldQuery) && !outputValue.includes(fieldQuery)) return false;
      }
      if (ruleQuery && !(row.rule_type ?? "").toLowerCase().includes(ruleQuery)) return false;
      return true;
    });
  }, [audit.rows, email, field, ruleType]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="audit-email">Email</Label>
          <Input
            id="audit-email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setPage(0);
            }}
            data-testid="audit-filter-email"
          />
        </div>
        <div>
          <Label htmlFor="audit-field">Field</Label>
          <Input
            id="audit-field"
            value={field}
            onChange={(e) => {
              setField(e.target.value);
              setPage(0);
            }}
            data-testid="audit-filter-field"
          />
        </div>
        <div>
          <Label htmlFor="audit-rule-type">Rule type</Label>
          <Input
            id="audit-rule-type"
            value={ruleType}
            onChange={(e) => {
              setRuleType(e.target.value);
              setPage(0);
            }}
            data-testid="audit-filter-rule-type"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No matching audit entries" />
      ) : (
        <div className="max-h-[32rem] overflow-auto rounded border border-sage-light">
          <Table>
            <THead>
              <TR>
                {columns.map((column) => (
                  <TH key={column} className="whitespace-nowrap">
                    {column}
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {pageRows.map((row, index) => (
                <TR key={index}>
                  {columns.map((column) => {
                    const value =
                      column === "internal_field"
                        ? (row.internal_field ?? row.field ?? "")
                        : (row[column] ?? "");
                    return (
                      <TD key={column} className="max-w-52 truncate whitespace-nowrap text-xs">
                        {value}
                      </TD>
                    );
                  })}
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
