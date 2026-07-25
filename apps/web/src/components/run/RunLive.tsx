"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PROTOCOL, isRunStatus, isTerminal, type RunStatus } from "@aureli/shared";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchJson } from "@/lib/fetchJson";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, ProgressBar, StatTile } from "@/components/ui/misc";

export interface RunDetail {
  id: string;
  status: string;
  current_stage: string | null;
  next_stage: string;
  mock: boolean;
  lead_count: number | null;
  progress: Record<string, unknown>;
  error: string | null;
  warnings: string[];
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  campaigns?: { id: string; title: string } | null;
  run_stages?: StageRow[];
  runner_devices?: { id: string; name: string; last_seen_at: string | null; runner_version: string; status: string } | null;
}

export interface StageRow {
  stage: string;
  status: string;
  attempt: number;
  counts: Record<string, number | undefined>;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface EventRow {
  seq: number;
  stage: string;
  ts: string;
  severity: string;
  event_type: string;
  message: string;
  current_item: number | null;
  total_items: number | null;
  exa_query_count: number | null;
  retry_count: number | null;
  cost_usd: number | null;
}

const STAGE_LABELS: Record<string, string> = {
  stage_one: "Stage 1 · Sourcing & verification",
  stage_two: "Stage 2 · GTM scoring & personalization",
  instantly_upload: "Instantly upload",
};

function elapsed(from: string | null, to: string | null): string {
  if (!from) return "—";
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function RunLive({ initialRun, initialEvents }: { initialRun: RunDetail; initialEvents: EventRow[] }) {
  const [run, setRun] = useState<RunDetail>(initialRun);
  const [events, setEvents] = useState<EventRow[]>(initialEvents);
  const [logOpen, setLogOpen] = useState(true);
  const [logLimit, setLogLimit] = useState(150);
  const [realtimeOk, setRealtimeOk] = useState(false);
  const [, forceTick] = useState(0);
  const lastSeq = useRef(initialEvents.length > 0 ? Math.max(...initialEvents.map((e) => e.seq)) : -1);

  const status = (isRunStatus(run.status) ? run.status : "queued") as RunStatus;
  const terminal = isTerminal(status);

  const refresh = useCallback(async () => {
    try {
      const [runBody, eventsBody] = await Promise.all([
        fetchJson<{ run: RunDetail }>(`/api/runs/${initialRun.id}`),
        fetchJson<{ events: EventRow[] }>(`/api/runs/${initialRun.id}/events?after_seq=${lastSeq.current}`),
      ]);
      setRun(runBody.run);
      if (eventsBody.events.length > 0) {
        setEvents((prev) => {
          const merged = [...prev, ...eventsBody.events];
          const seen = new Set<number>();
          const unique = merged.filter((e) => (seen.has(e.seq) ? false : (seen.add(e.seq), true)));
          unique.sort((a, b) => a.seq - b.seq);
          lastSeq.current = unique.length > 0 ? unique[unique.length - 1]!.seq : lastSeq.current;
          return unique.slice(-PROTOCOL.limits.live_events_retained_per_run);
        });
      }
    } catch {
      /* transient poll failure — next tick will retry */
    }
  }, [initialRun.id]);

  // Supabase Realtime with polling fallback.
  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let channelOk = false;
    let supabase: ReturnType<typeof getSupabaseBrowserClient> | null = null;
    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      supabase = null;
    }
    const channel = supabase
      ?.channel(`run-${initialRun.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pipeline_runs", filter: `id=eq.${initialRun.id}` },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "run_events", filter: `run_id=eq.${initialRun.id}` },
        () => void refresh(),
      )
      .subscribe((state) => {
        channelOk = state === "SUBSCRIBED";
        setRealtimeOk(channelOk);
      });

    // Poll every 5s as fallback (and every 20s even with realtime, as a safety net).
    pollTimer = setInterval(() => {
      if (!channelOk) void refresh();
      forceTick((t) => t + 1); // re-render elapsed clocks
    }, 5000);
    const safetyTimer = setInterval(() => void refresh(), 20000);

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      clearInterval(safetyTimer);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [initialRun.id, refresh]);

  const stages = run.run_stages ?? [];
  const stageOne = stages.find((s) => s.stage === "stage_one");
  const stageTwo = stages.find((s) => s.stage === "stage_two");
  const progress = run.progress ?? {};
  const currentItem = Number(progress.current_item ?? 0);
  const totalItems = Number(progress.total_items ?? run.lead_count ?? 0);
  const exaCount = Number(progress.exa_query_count ?? 0);

  const counts = useMemo(() => {
    const merged: Record<string, number> = {};
    for (const stage of stages) {
      for (const [key, value] of Object.entries(stage.counts ?? {})) {
        if (typeof value === "number") merged[key] = (merged[key] ?? 0) + value;
      }
    }
    return merged;
  }, [stages]);

  const runnerOnline =
    run.runner_devices?.last_seen_at &&
    Date.now() - new Date(run.runner_devices.last_seen_at).getTime() <
      PROTOCOL.limits.runner_offline_after_seconds * 1000;

  const overallPct =
    status === "completed" || status === "completed_with_warnings"
      ? 100
      : status.startsWith("stage_two") || status === "awaiting_final_approval" || status === "uploading_to_instantly"
        ? 50 + stagePct(stageTwo, currentItem, totalItems) / 2
        : stagePct(stageOne, currentItem, totalItems) / 2;

  return (
    <div className="space-y-4" data-testid="run-live" data-status={status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-evergreen-deep">
            {run.campaigns?.title ?? "Run"}
          </h1>
          <StatusBadge status={status} mock={run.mock} />
        </div>
        <div className="flex items-center gap-2">
          {status === "awaiting_stage_one_approval" ? (
            <Link href={`/runs/${run.id}/review`}>
              <Button data-testid="goto-review">Review stage-one results</Button>
            </Link>
          ) : null}
          {status === "awaiting_final_approval" || terminal ? (
            <Link href={`/runs/${run.id}/results`}>
              <Button data-testid="goto-results" variant={terminal ? "outline" : "primary"}>
                {terminal ? "View results" : "Review final results"}
              </Button>
            </Link>
          ) : null}
          {!terminal && status !== "uploading_to_instantly" ? (
            <Button
              variant="outline"
              onClick={async () => {
                if (!confirm("Cancel this run?")) return;
                await fetchJson(`/api/runs/${run.id}/cancel`, { method: "POST" });
                void refresh();
              }}
            >
              Cancel run
            </Button>
          ) : null}
        </div>
      </div>

      {run.error ? <Alert tone="danger">{run.error}</Alert> : null}
      {run.warnings?.length ? (
        <Alert tone="warning">{run.warnings[run.warnings.length - 1]}</Alert>
      ) : null}
      {(status === "stage_one_failed" || status === "stage_two_failed") ? (
        <FailureDecision runId={run.id} onDecided={() => void refresh()} />
      ) : null}
      {status === "awaiting_runner" ? (
        <Alert tone="warning">
          No runner is online. Start your local runner (`python -m aureli_runner run`) — the run
          will begin automatically. Closing this browser tab does not affect the run.
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <StatTile label="Overall" value={`${Math.round(overallPct)}%`} />
        <StatTile
          label="Leads"
          value={totalItems > 0 ? `${currentItem}/${totalItems}` : (run.lead_count ?? "—")}
        />
        <StatTile label="Exa queries" value={exaCount} />
        <StatTile label="Successful" value={counts.successful ?? counts.verified ?? 0} />
        <StatTile label="Retried" value={counts.retried ?? 0} />
        <StatTile
          label="Failed / review"
          value={`${counts.failed ?? 0} / ${counts.manual_review ?? 0}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {[stageOne, stageTwo].map((stage, index) =>
          stage ? (
            <Card key={stage.stage}>
              <CardHeader>
                <CardTitle>{STAGE_LABELS[stage.stage] ?? stage.stage}</CardTitle>
                <Badge
                  tone={
                    stage.status === "completed"
                      ? "success"
                      : stage.status === "failed"
                        ? "danger"
                        : stage.status === "running" || stage.status === "retrying"
                          ? "evergreen"
                          : "neutral"
                  }
                >
                  {stage.status}
                  {stage.attempt > 1 ? ` · attempt ${stage.attempt}` : ""}
                </Badge>
              </CardHeader>
              <CardBody className="space-y-2">
                <ProgressBar
                  value={stage.status === "completed" ? 100 : stagePct(stage, currentItem, totalItems)}
                  label={`${stage.stage} progress`}
                />
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {Object.entries(stage.counts ?? {})
                    .filter(([, v]) => typeof v === "number")
                    .map(([key, value]) => (
                      <Badge key={key} tone="neutral">
                        {key.replace(/_/g, " ")}: {value}
                      </Badge>
                    ))}
                </div>
                <div className="text-xs text-charcoal/60">
                  Elapsed: {elapsed(stage.started_at, stage.ended_at)}
                </div>
                {stage.error ? <Alert tone="danger">{stage.error}</Alert> : null}
              </CardBody>
            </Card>
          ) : (
            <Card key={index}>
              <CardBody className="text-sm text-charcoal/50">Stage pending…</CardBody>
            </Card>
          ),
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Runner</CardTitle>
          <div className="flex items-center gap-2 text-xs">
            <Badge tone={runnerOnline ? "success" : "warning"}>
              {run.runner_devices
                ? runnerOnline
                  ? "Connected"
                  : "Offline"
                : "Not claimed yet"}
            </Badge>
            <Badge tone={realtimeOk ? "success" : "neutral"}>
              {realtimeOk ? "Realtime" : "Polling"}
            </Badge>
          </div>
        </CardHeader>
        <CardBody className="flex flex-wrap gap-x-8 gap-y-1 text-xs text-charcoal/70">
          <span>Device: {run.runner_devices?.name ?? "—"}</span>
          <span>
            Last heartbeat:{" "}
            {run.runner_devices?.last_seen_at
              ? new Date(run.runner_devices.last_seen_at).toLocaleTimeString()
              : "—"}
          </span>
          <span>Runner version: {run.runner_devices?.runner_version || "—"}</span>
          <span>Run elapsed: {elapsed(run.started_at, run.completed_at)}</span>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live log</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-charcoal/50">
              {events.length} recent events (full log is a downloadable artifact)
            </span>
            <Button size="sm" variant="ghost" onClick={() => setLogOpen((v) => !v)}>
              {logOpen ? "Collapse" : "Expand"}
            </Button>
          </div>
        </CardHeader>
        {logOpen ? (
          <CardBody className="p-0">
            <div className="max-h-96 overflow-auto bg-charcoal px-3 py-2" data-testid="live-log">
              {events.length === 0 ? (
                <p className="log-line text-sage">Waiting for events…</p>
              ) : (
                <>
                  {events.length > logLimit ? (
                    <button
                      type="button"
                      className="log-line mb-1 text-sage underline"
                      onClick={() => setLogLimit((v) => v + 200)}
                    >
                      Show {Math.min(200, events.length - logLimit)} earlier events…
                    </button>
                  ) : null}
                  {events.slice(-logLimit).map((event) => (
                    <p
                      key={event.seq}
                      className={`log-line ${
                        event.severity === "error"
                          ? "text-[#f0b5ac]"
                          : event.severity === "warn"
                            ? "text-[#ecd9a7]"
                            : "text-sage-light"
                      }`}
                    >
                      <span className="text-sage/70">
                        {new Date(event.ts).toLocaleTimeString()} [{event.stage}]
                      </span>{" "}
                      {event.message}
                      {typeof event.current_item === "number" && typeof event.total_items === "number"
                        ? ` (${event.current_item}/${event.total_items})`
                        : ""}
                    </p>
                  ))}
                </>
              )}
            </div>
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}

function stagePct(stage: StageRow | undefined, currentItem: number, totalItems: number): number {
  if (!stage) return 0;
  if (stage.status === "completed") return 100;
  if (stage.status === "pending") return 0;
  if (totalItems > 0) return Math.min(99, Math.round((currentItem / totalItems) * 100));
  return 10;
}

function FailureDecision({ runId, onDecided }: { runId: string; onDecided: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(action: "retry_failed" | "skip_failed" | "cancel") {
    setBusy(action);
    setError(null);
    try {
      await fetchJson(`/api/runs/${runId}/failure-decision`, { method: "POST", json: { action } });
      onDecided();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Alert tone="danger">
      <div className="space-y-2">
        <p className="font-medium">
          Automatic retries are exhausted. Successful rows are preserved — choose how to proceed:
        </p>
        {error ? <p>{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => decide("retry_failed")} disabled={busy !== null}>
            Retry failed rows
          </Button>
          <Button size="sm" variant="secondary" onClick={() => decide("skip_failed")} disabled={busy !== null}>
            Continue, skip failed rows
          </Button>
          <Link href={`/runs/${runId}/results`}>
            <Button size="sm" variant="outline">Download partial output</Button>
          </Link>
          <Button size="sm" variant="danger" onClick={() => decide("cancel")} disabled={busy !== null}>
            Cancel run
          </Button>
        </div>
      </div>
    </Alert>
  );
}
