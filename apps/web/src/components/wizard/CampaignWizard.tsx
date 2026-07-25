"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import {
  PROTOCOL,
  isSalesNavigatorSearchUrl,
  type CredentialStatus,
} from "@aureli/shared";
import { fetchJson } from "@/lib/fetchJson";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { CsvUploadStep, type UploadResult } from "./CsvUploadStep";
import { ConfigStep, type ChosenConfig } from "./ConfigStep";
import { FallbackRulesStep, type ChosenFallbackRules } from "./FallbackRulesStep";

export interface RunnerSummary {
  id: string;
  name: string;
  status: string;
  last_seen_at: string | null;
  runner_version: string;
  protocol_version: string;
  credential_report: Record<string, CredentialStatus>;
}

interface DetailsForm {
  title: string;
  description: string;
  input_type: "csv" | "sales_navigator";
  max_leads: number;
}

const STEPS = ["Details", "Input source", "Configuration", "Confirm & start"] as const;

export function CampaignWizard({ runners }: { runners: RunnerSummary[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [campaign, setCampaign] = useState<{ id: string; title: string; input_type: string; max_leads: number } | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [snUrl, setSnUrl] = useState("");
  const [snLimit, setSnLimit] = useState(500);
  const [config, setConfig] = useState<ChosenConfig | null>(null);
  const [fallbackRules, setFallbackRules] = useState<ChosenFallbackRules | null>(null);
  const [allowPartial, setAllowPartial] = useState(false);
  const [mock, setMock] = useState(false);

  const details = useForm<DetailsForm>({
    defaultValues: { title: "", description: "", input_type: "csv", max_leads: 1000 },
    mode: "onBlur",
  });
  const inputType = details.watch("input_type");

  const onlineRunner = useMemo(() => {
    const cutoff = Date.now() - PROTOCOL.limits.runner_offline_after_seconds * 1000;
    return (
      runners.find(
        (r) => r.status === "active" && r.last_seen_at && new Date(r.last_seen_at).getTime() >= cutoff,
      ) ??
      runners.find((r) => r.status === "active") ??
      null
    );
  }, [runners]);

  async function submitDetails(values: DetailsForm) {
    setBusy(true);
    setError(null);
    try {
      const body = await fetchJson<{ campaign: { id: string } }>("/api/campaigns", {
        method: "POST",
        json: {
          title: values.title.trim(),
          description: values.description.trim(),
          input_type: values.input_type,
          max_leads: Number(values.max_leads),
        },
      });
      setCampaign({
        id: body.campaign.id,
        title: values.title.trim(),
        input_type: values.input_type,
        max_leads: Number(values.max_leads),
      });
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create campaign");
    } finally {
      setBusy(false);
    }
  }

  const snUrlValid = isSalesNavigatorSearchUrl(snUrl);
  const sourceReady =
    inputType === "csv" ? Boolean(upload?.validation.ok) : snUrlValid && snLimit >= 1;

  async function startPipeline() {
    if (!campaign || !config) return;
    setBusy(true);
    setError(null);
    try {
      const source =
        campaign.input_type === "csv"
          ? { type: "csv" as const, artifact_id: upload!.artifact_id }
          : {
              type: "sales_navigator" as const,
              url: snUrl,
              requested_limit: Math.min(snLimit, campaign.max_leads),
            };
      const body = await fetchJson<{ run_id: string; status: string }>("/api/runs", {
        method: "POST",
        json: {
          campaign_id: campaign.id,
          config_id: config.id,
          mock,
          source,
          allow_partial: allowPartial,
          fallback_rule_set_id: fallbackRules?.id ?? null,
        },
      });
      router.push(`/runs/${body.run_id}/progress`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the run");
      setBusy(false);
    }
  }

  const stageOneCreds = PROTOCOL.credential_keys.stage_one;
  const stageTwoCreds = PROTOCOL.credential_keys.stage_two;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <nav aria-label="Wizard steps" className="flex items-center gap-1 text-xs">
        {STEPS.map((label, index) => (
          <div key={label} className="flex items-center gap-1">
            {index > 0 ? <span className="text-charcoal/30">→</span> : null}
            <span
              aria-current={index === step ? "step" : undefined}
              className={
                index === step
                  ? "rounded bg-evergreen px-2 py-1 font-medium text-white"
                  : index < step
                    ? "rounded bg-sage-light px-2 py-1 text-evergreen-deep"
                    : "rounded px-2 py-1 text-charcoal/50"
              }
            >
              {index + 1}. {label}
            </span>
          </div>
        ))}
      </nav>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Campaign details</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={details.handleSubmit(submitDetails)} className="space-y-4">
              <div>
                <Label htmlFor="title">Campaign title *</Label>
                <Input
                  id="title"
                  data-testid="campaign-title"
                  {...details.register("title", { required: "Title is required", maxLength: 200 })}
                />
                {details.formState.errors.title ? (
                  <p className="mt-1 text-xs text-danger">{details.formState.errors.title.message}</p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea id="description" rows={2} {...details.register("description")} />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <fieldset>
                  <legend className="mb-1 block text-xs font-medium uppercase tracking-wide text-charcoal/70">
                    Input method *
                  </legend>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="radio" value="csv" {...details.register("input_type")} data-testid="input-csv" />
                      Existing CSV upload
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="radio" value="sales_navigator" {...details.register("input_type")} />
                      LinkedIn Sales Navigator search URL
                    </label>
                  </div>
                </fieldset>
                <div>
                  <Label htmlFor="max_leads">Maximum lead count (≤ {PROTOCOL.limits.max_leads_per_run})</Label>
                  <Input
                    id="max_leads"
                    type="number"
                    min={1}
                    max={PROTOCOL.limits.max_leads_per_run}
                    {...details.register("max_leads", {
                      required: true,
                      min: 1,
                      max: PROTOCOL.limits.max_leads_per_run,
                      valueAsNumber: true,
                    })}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={busy} data-testid="wizard-next-1">
                  {busy ? "Creating…" : "Continue"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {step === 1 && campaign ? (
        <div className="space-y-4">
          {campaign.input_type === "csv" ? (
            <CsvUploadStep campaignId={campaign.id} maxLeads={campaign.max_leads} onUploaded={setUpload} initial={upload} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>LinkedIn Sales Navigator URL</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div>
                  <Label htmlFor="sn-url">Search URL</Label>
                  <Input
                    id="sn-url"
                    placeholder="https://www.linkedin.com/sales/search/people?…"
                    value={snUrl}
                    onChange={(e) => setSnUrl(e.target.value)}
                  />
                  {snUrl && !snUrlValid ? (
                    <p className="mt-1 text-xs text-danger">
                      Must be a Sales Navigator search or list URL (linkedin.com/sales/search/… or /sales/lists/…).
                    </p>
                  ) : null}
                </div>
                <div className="max-w-xs">
                  <Label htmlFor="sn-limit">Requested lead limit (≤ {campaign.max_leads})</Label>
                  <Input
                    id="sn-limit"
                    type="number"
                    min={1}
                    max={campaign.max_leads}
                    value={snLimit}
                    onChange={(e) => setSnLimit(Number(e.target.value))}
                  />
                </div>
                <Alert tone="info">
                  The URL is processed on your connected local runner through Vayne (Sales Navigator
                  ingestion), then Icypeas (email discovery) and MillionVerifier (verification).
                  Direct LinkedIn scraping is not part of version one, and no LinkedIn cookie is
                  stored in the browser or cloud.
                </Alert>
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal/70">
                    Credentials on {onlineRunner ? `runner “${onlineRunner.name}”` : "your runner (none online)"}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {stageOneCreds.map((key) => {
                      const status = onlineRunner?.credential_report?.[key] ?? "unchecked";
                      return (
                        <Badge
                          key={key}
                          tone={status === "configured" ? "success" : status === "invalid" ? "danger" : "warning"}
                        >
                          {key}: {status}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              </CardBody>
            </Card>
          )}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
            <Button disabled={!sourceReady} onClick={() => setStep(2)} data-testid="wizard-next-2">
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 && campaign ? (
        <div className="space-y-4">
          <ConfigStep campaignId={campaign.id} onChosen={setConfig} chosen={config} />
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button disabled={!config} onClick={() => setStep(3)} data-testid="wizard-next-3">
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 && campaign ? (
        <Card>
          <CardHeader>
            <CardTitle>Confirm & start</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm md:grid-cols-2">
              <div className="flex justify-between border-b border-sage-light/60 py-1">
                <dt className="text-charcoal/60">Campaign</dt>
                <dd className="font-medium">{campaign.title}</dd>
              </div>
              <div className="flex justify-between border-b border-sage-light/60 py-1">
                <dt className="text-charcoal/60">Input type</dt>
                <dd>{campaign.input_type === "csv" ? "CSV upload" : "Sales Navigator URL"}</dd>
              </div>
              <div className="flex justify-between border-b border-sage-light/60 py-1">
                <dt className="text-charcoal/60">Lead count</dt>
                <dd>
                  {campaign.input_type === "csv"
                    ? `${upload?.validation.totalRows ?? 0} rows`
                    : `up to ${Math.min(snLimit, campaign.max_leads)}`}
                </dd>
              </div>
              <div className="flex justify-between border-b border-sage-light/60 py-1">
                <dt className="text-charcoal/60">Runner</dt>
                <dd>{onlineRunner ? onlineRunner.name : "None online — run will wait"}</dd>
              </div>
              <div className="flex justify-between border-b border-sage-light/60 py-1">
                <dt className="text-charcoal/60">Configuration</dt>
                <dd>{config?.name}</dd>
              </div>
              <div className="flex justify-between border-b border-sage-light/60 py-1">
                <dt className="text-charcoal/60">Pipeline stages</dt>
                <dd className="text-right text-xs">
                  1. Sourcing & verification → approval
                  <br />
                  2. GTM scoring & personalization → runs automatically into stage 3
                  <br />
                  3. Manual review fallback resolution → final approval → optional Instantly upload
                </dd>
              </div>
            </dl>

            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal/70">
                Credential readiness {onlineRunner ? `(${onlineRunner.name})` : "(no runner online)"}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[...stageOneCreds, ...stageTwoCreds].map((key) => {
                  const status = mock ? "configured" : (onlineRunner?.credential_report?.[key] ?? "unchecked");
                  return (
                    <Badge
                      key={key}
                      tone={status === "configured" ? "success" : status === "invalid" ? "danger" : "warning"}
                    >
                      {key}: {mock ? "n/a (mock)" : status}
                    </Badge>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={mock} onChange={(e) => setMock(e.target.checked)} data-testid="mock-toggle" />
              Mock run — simulate the full pipeline without calling paid APIs (clearly labeled)
            </label>

            <p className="text-xs text-charcoal/50">
              Cost estimates are not shown: the pipelines do not expose reliable per-lead pricing
              ahead of execution. Stage summaries report actual counts and any cost data the
              pipeline emits.
            </p>

            <FallbackRulesStep onChosen={setFallbackRules} chosen={fallbackRules} />

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={allowPartial}
                onChange={(e) => setAllowPartial(e.target.checked)}
                data-testid="allow-partial-toggle"
              />
              <span>
                Allow partial upload — if some leads can&apos;t be safely delivered, still let the
                run finish instead of stopping. <strong>Blocked leads are always excluded from
                Instantly exports either way</strong> — this only changes whether that counts as a
                hard stop or a warning.
              </span>
            </label>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={startPipeline} disabled={busy || !config || !sourceReady} data-testid="start-pipeline">
                {busy ? "Starting…" : "Start Pipeline"}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
