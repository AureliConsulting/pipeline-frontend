"use client";
import { useRef, useState } from "react";
import { PROTOCOL } from "@aureli/shared";
import { fetchJson } from "@/lib/fetchJson";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Spinner } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export interface UploadResult {
  run_id: string;
  artifact_id: string;
  validation: {
    ok: boolean;
    totalRows: number;
    missingRequired: string[];
    unexpectedColumns: string[];
    duplicateRowCount: number;
    errors: string[];
    warnings: string[];
    preview?: { headers: string[]; rows: string[][] };
  };
}

export function CsvUploadStep({
  campaignId,
  maxLeads,
  onUploaded,
  initial,
}: {
  campaignId: string;
  maxLeads: number;
  onUploaded: (result: UploadResult) => void;
  initial: UploadResult | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(initial);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!/\.csv$/i.test(file.name)) {
      setError("Only .csv files are accepted.");
      return;
    }
    if (file.size > PROTOCOL.limits.max_csv_upload_bytes) {
      setError(`File is too large (max ${Math.round(PROTOCOL.limits.max_csv_upload_bytes / 1024 / 1024)} MB).`);
      return;
    }
    try {
      setBusy("Preparing upload…");
      const prep = await fetchJson<{
        run_id: string;
        storage_path: string;
        token: string;
      }>(`/api/campaigns/${campaignId}/upload`, {
        method: "POST",
        json: { file_name: file.name, size_bytes: file.size },
      });

      setBusy("Uploading to private storage…");
      const supabase = getSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from("artifacts")
        .uploadToSignedUrl(prep.storage_path, prep.token, file, { contentType: "text/csv" });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      setBusy("Validating against the canonical schema…");
      const completed = await fetchJson<UploadResult>(`/api/campaigns/${campaignId}/upload`, {
        method: "PUT",
        json: { storage_path: prep.storage_path },
      });
      setResult(completed);
      onUploaded(completed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  const v = result?.validation;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload CSV</CardTitle>
        <span className="text-xs text-charcoal/50">Canonical schema · max {maxLeads} rows</span>
      </CardHeader>
      <CardBody className="space-y-4">
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload CSV file"
          data-testid="csv-dropzone"
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInput.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) void handleFile(file);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-8 text-center transition-colors ${
            dragOver ? "border-evergreen bg-sage-light/40" : "border-sage bg-warm/60"
          }`}
        >
          {busy ? (
            <div className="flex items-center gap-2 text-sm text-charcoal/70">
              <Spinner /> {busy}
            </div>
          ) : (
            <>
              <p className="text-sm font-medium text-charcoal/80">
                Drag & drop a CSV here, or click to choose a file
              </p>
              <p className="mt-1 text-xs text-charcoal/50">
                CSV only. The attached enriched lead export format is the canonical v1 schema.
              </p>
            </>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            data-testid="csv-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {error ? <Alert tone="danger">{error}</Alert> : null}

        {v ? (
          <div className="space-y-3" data-testid="csv-validation">
            <div className="flex flex-wrap items-center gap-2">
              {v.ok ? (
                <Badge tone="success">Validation passed</Badge>
              ) : (
                <Badge tone="danger">Validation failed — fix the file to continue</Badge>
              )}
              <Badge tone="neutral">Total rows: {v.totalRows}</Badge>
              <Badge tone={v.duplicateRowCount > 0 ? "warning" : "neutral"}>
                Duplicates: {v.duplicateRowCount}
              </Badge>
              {v.unexpectedColumns.length > 0 ? (
                <Badge tone="warning">Unexpected columns: {v.unexpectedColumns.length} (kept)</Badge>
              ) : null}
            </div>
            {v.errors.map((message) => (
              <Alert key={message} tone="danger">{message}</Alert>
            ))}
            {v.missingRequired.length > 0 ? (
              <Alert tone="danger">
                Missing required columns: {v.missingRequired.join(", ")}. Columns are never guessed
                or auto-mapped — update the file so it matches the canonical schema.
              </Alert>
            ) : null}
            {v.warnings.map((message) => (
              <Alert key={message} tone="warning">{message}</Alert>
            ))}
            {v.preview && v.preview.rows.length > 0 ? (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal/70">
                  Read-only preview (first {v.preview.rows.length} rows)
                </div>
                <div className="max-h-80 overflow-auto rounded border border-sage-light">
                  <Table>
                    <THead>
                      <TR>
                        {v.preview.headers.slice(0, 12).map((h, i) => (
                          <TH key={`${h}-${i}`} className="whitespace-nowrap">{h || "—"}</TH>
                        ))}
                        {v.preview.headers.length > 12 ? (
                          <TH>… +{v.preview.headers.length - 12} more</TH>
                        ) : null}
                      </TR>
                    </THead>
                    <TBody>
                      {v.preview.rows.map((row, rowIndex) => (
                        <TR key={rowIndex}>
                          {row.slice(0, 12).map((cell, cellIndex) => (
                            <TD key={cellIndex} className="max-w-56 truncate whitespace-nowrap text-xs">
                              {cell}
                            </TD>
                          ))}
                          {v.preview!.headers.length > 12 ? <TD className="text-xs">…</TD> : null}
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
                <p className="mt-1 text-[11px] text-charcoal/45">
                  Row editing and deletion are not part of version one; fix issues in the source
                  file and re-upload.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
