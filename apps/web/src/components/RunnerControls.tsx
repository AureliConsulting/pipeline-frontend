"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/fetchJson";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/misc";

export function PairRunnerButton() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<{ code: string; expires_at: string; command: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const body = await fetchJson<{ code: string; expires_at: string; command: string }>(
        "/api/runners/pairing-codes",
        { method: "POST" },
      );
      setCode(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a pairing code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
          setCode(null);
          void generate();
        }}
        data-testid="connect-runner"
      >
        Connect Runner
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Connect a local runner">
        <div className="space-y-3">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {code ? (
            <>
              <p className="text-sm">
                On the computer that will run pipelines, run this within{" "}
                {Math.round((new Date(code.expires_at).getTime() - Date.now()) / 60000)} minutes:
              </p>
              <pre className="overflow-x-auto rounded bg-charcoal p-3 text-xs text-sage-light">
                {code.command}
              </pre>
              <p className="text-xs text-charcoal/60">
                The code is one-time use. The runner receives a device token stored only in a
                protected local file; you can revoke it here at any time.
              </p>
              <Button variant="outline" size="sm" onClick={generate} disabled={busy}>
                Generate a new code
              </Button>
            </>
          ) : (
            <p className="text-sm text-charcoal/60">Generating code…</p>
          )}
        </div>
      </Dialog>
    </>
  );
}

export function RevokeRunnerButton({ runnerId }: { runnerId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="danger"
      size="sm"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Revoke this runner? Its token stops working immediately.")) return;
        setBusy(true);
        try {
          await fetchJson(`/api/runners/${runnerId}/revoke`, { method: "POST" });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      Revoke
    </Button>
  );
}
