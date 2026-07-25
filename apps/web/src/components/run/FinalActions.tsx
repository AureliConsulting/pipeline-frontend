"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/fetchJson";
import { canConfirmInstantlyUpload } from "@/lib/exportGate";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";

/**
 * Final checkpoint actions. The Instantly upload requires the user to re-type
 * the campaign title and the exact lead count; a client-generated idempotency
 * key plus a UNIQUE(run_id) constraint server-side make repeated clicks or
 * network retries incapable of double-uploading.
 */
export function FinalActions({
  runId,
  campaignTitle,
  instantlyReadyCount,
  blockedRowsCount = 0,
  uploadStatus,
}: {
  runId: string;
  campaignTitle: string;
  instantlyReadyCount: number | null;
  /** Rows the fallback resolver quarantined — always excluded from this
   * upload. When > 0, the dialog requires an explicit acknowledgement
   * checkbox before the confirm button enables, regardless of whatever
   * allow_partial was set to at run creation time. */
  blockedRowsCount?: number;
  uploadStatus: string | null;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmCount, setConfirmCount] = useState("");
  const [listId, setListId] = useState("");
  const [partialAcknowledged, setPartialAcknowledged] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function complete() {
    setBusy("complete");
    setError(null);
    try {
      await fetchJson(`/api/runs/${runId}/final`, { method: "POST", json: { action: "complete" } });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function approveInstantly() {
    setBusy("instantly");
    setError(null);
    try {
      await fetchJson(`/api/runs/${runId}/final`, {
        method: "POST",
        json: {
          action: "approve_instantly",
          confirm_title: confirmTitle,
          confirm_lead_count: Number(confirmCount),
          list_id: listId,
          idempotency_key: idempotencyKey,
        },
      });
      setDialogOpen(false);
      router.push(`/runs/${runId}/progress`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Final decision</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {uploadStatus === "completed" ? (
          <Alert tone="success">Instantly upload completed.</Alert>
        ) : uploadStatus === "failed" ? (
          <Alert tone="danger">The previous Instantly upload failed — you can approve it again.</Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={complete} disabled={busy !== null} data-testid="final-complete">
            {busy === "complete" ? "Completing…" : "Complete without uploading"}
          </Button>
          <Button
            onClick={() => setDialogOpen(true)}
            disabled={busy !== null || instantlyReadyCount === null}
            data-testid="final-instantly"
          >
            Approve Instantly upload…
          </Button>
        </div>
        <p className="text-xs text-charcoal/50">
          Uploads are never automatic. The upload itself runs on your local runner using the
          Instantly API key stored only on that machine.
        </p>
      </CardBody>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Confirm Instantly upload">
        <div className="space-y-3">
          <Alert tone="warning">
            This will upload {instantlyReadyCount ?? "?"} validated leads to Instantly. Type the
            campaign title and lead count exactly to confirm.
          </Alert>
          {blockedRowsCount > 0 ? (
            <Alert tone="danger" data-testid="export-blocked-warning">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={partialAcknowledged}
                  onChange={(e) => setPartialAcknowledged(e.target.checked)}
                  data-testid="export-partial-confirm"
                />
                <span>
                  {blockedRowsCount} lead(s) were blocked by the fallback resolver and will{" "}
                  <strong>not</strong> be included in this upload. I understand and want to
                  proceed with only the validated leads.
                </span>
              </label>
            </Alert>
          ) : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div>
            <Label htmlFor="confirm-title">Campaign title ({campaignTitle})</Label>
            <Input id="confirm-title" value={confirmTitle} onChange={(e) => setConfirmTitle(e.target.value)} data-testid="confirm-title" />
          </div>
          <div>
            <Label htmlFor="confirm-count">Lead count ({instantlyReadyCount ?? "?"})</Label>
            <Input
              id="confirm-count"
              inputMode="numeric"
              value={confirmCount}
              onChange={(e) => setConfirmCount(e.target.value)}
              data-testid="confirm-count"
            />
          </div>
          <div>
            <Label htmlFor="list-id">Instantly list / campaign ID</Label>
            <Input id="list-id" value={listId} onChange={(e) => setListId(e.target.value)} data-testid="confirm-list" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Back</Button>
            <Button
              onClick={approveInstantly}
              disabled={
                busy !== null ||
                !canConfirmInstantlyUpload({
                  confirmTitle,
                  campaignTitle,
                  confirmCount,
                  readyCount: instantlyReadyCount,
                  listId,
                  blockedRowsCount,
                  partialAcknowledged,
                })
              }
              data-testid="confirm-upload"
            >
              {busy === "instantly" ? "Approving…" : "Approve upload"}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
