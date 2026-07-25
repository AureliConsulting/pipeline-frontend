"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/fetchJson";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";

export function StageOneActions({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "retry_failed" | "cancel") {
    if (action === "cancel" && !confirm("Cancel this run? This cannot be undone.")) return;
    setBusy(action);
    setError(null);
    try {
      await fetchJson(`/api/runs/${runId}/approve-stage-one`, { method: "POST", json: { action } });
      router.push(`/runs/${runId}/progress`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decision</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => act("approve")} disabled={busy !== null} data-testid="approve-stage-one">
            {busy === "approve" ? "Approving…" : "Approve & continue to GTM scoring"}
          </Button>
          <Button variant="secondary" onClick={() => act("retry_failed")} disabled={busy !== null}>
            Retry failed rows
          </Button>
          <Button variant="danger" onClick={() => act("cancel")} disabled={busy !== null}>
            Cancel run
          </Button>
        </div>
        <p className="text-xs text-charcoal/50">
          Approval starts pipeline two (Exa research, DeepSeek extraction, scoring,
          personalization) on your local runner. This spends API credits on real runs.
        </p>
      </CardBody>
    </Card>
  );
}
