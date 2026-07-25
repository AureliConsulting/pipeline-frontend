"use client";
import { useEffect, useRef, useState } from "react";
import { stringify as yamlStringify } from "yaml";
import { CANONICAL_CONFIG_YAML, type CampaignConfig } from "@aureli/shared";
import { fetchJson } from "@/lib/fetchJson";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { EmailListEditor } from "./EmailListEditor";
import { VariableListEditor } from "./VariableListEditor";

export interface ChosenConfig {
  id: string;
  name: string;
}

interface SavedConfig {
  id: string;
  name: string;
  yaml_text: string;
  updated_at: string;
}

interface ValidationResponse {
  ok: boolean;
  syntax_errors: string[];
  schema_errors: string[];
  normalized: CampaignConfig | null;
  spintax_tokens: string[];
}

/**
 * Step 3: campaign configuration.
 * - Select a previously saved configuration,
 * - upload a YAML file,
 * - start from the canonical Aureli configuration,
 * - guided edits for email sequences and typed variables that regenerate
 *   YAML with values double-quoted so Instantly spintax is never damaged,
 * - an advanced raw-YAML editor (stored verbatim),
 * - server-side syntax + schema validation and a read-only normalized preview.
 */
export function ConfigStep({
  campaignId,
  onChosen,
  chosen,
}: {
  campaignId: string;
  onChosen: (config: ChosenConfig | null) => void;
  chosen: ChosenConfig | null;
}) {
  const [saved, setSaved] = useState<SavedConfig[]>([]);
  const [mode, setMode] = useState<"select" | "edit">("select");
  const [yamlText, setYamlText] = useState(CANONICAL_CONFIG_YAML);
  const [name, setName] = useState("");
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchJson<{ configs: SavedConfig[] }>("/api/configs")
      .then((body) => setSaved(body.configs))
      .catch(() => setSaved([]));
  }, []);

  async function validate(text: string): Promise<ValidationResponse | null> {
    try {
      const body = await fetchJson<ValidationResponse>("/api/configs/validate", {
        method: "POST",
        json: { yaml_text: text },
      });
      setValidation(body);
      return body;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation request failed");
      return null;
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await validate(yamlText);
      if (!result?.ok) {
        setError("Fix the validation errors before saving.");
        return;
      }
      const body = await fetchJson<{ config: { id: string; name: string } }>("/api/configs", {
        method: "POST",
        json: { name: name.trim() || "Untitled configuration", yaml_text: yamlText, campaign_id: campaignId },
      });
      const chosenNow = { id: body.config.id, name: body.config.name };
      setSaved((prev) => [{ id: chosenNow.id, name: chosenNow.name, yaml_text: yamlText, updated_at: new Date().toISOString() }, ...prev]);
      onChosen(chosenNow);
      setMode("select");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save configuration");
    } finally {
      setBusy(false);
    }
  }

  /** Guided edits replace fields on the parsed config, then re-emit the whole
   *  document with double-quoted strings so spintax remains legible and safe. */
  function applyGuidedEdit(mutate: (config: CampaignConfig) => void) {
    const current = validation?.normalized;
    if (!current) {
      setError("Validate the YAML first, then use guided edits.");
      return;
    }
    const copy: CampaignConfig = JSON.parse(JSON.stringify(current));
    mutate(copy);
    const text = yamlStringify(copy, { defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", lineWidth: 0 });
    setYamlText(text);
    void validate(text);
  }

  const normalized = validation?.normalized ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaign configuration</CardTitle>
        <div className="flex gap-1.5">
          <Button size="sm" variant={mode === "select" ? "secondary" : "ghost"} onClick={() => setMode("select")}>
            Saved configurations
          </Button>
          <Button size="sm" variant={mode === "edit" ? "secondary" : "ghost"} onClick={() => setMode("edit")} data-testid="config-edit-tab">
            Create / edit
          </Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {mode === "select" ? (
          <div className="space-y-3">
            {saved.length === 0 ? (
              <Alert tone="info">
                No saved configurations yet. Create one from the canonical Aureli configuration.
              </Alert>
            ) : (
              <div>
                <Label htmlFor="config-select">Select a configuration</Label>
                <Select
                  id="config-select"
                  data-testid="config-select"
                  value={chosen?.id ?? ""}
                  onChange={(e) => {
                    const found = saved.find((c) => c.id === e.target.value);
                    onChosen(found ? { id: found.id, name: found.name } : null);
                  }}
                >
                  <option value="">— choose —</option>
                  {saved.map((config) => (
                    <option key={config.id} value={config.id}>
                      {config.name} ({new Date(config.updated_at).toLocaleDateString()})
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setYamlText(CANONICAL_CONFIG_YAML);
                  setName("");
                  setValidation(null);
                  setMode("edit");
                  void validate(CANONICAL_CONFIG_YAML);
                }}
                data-testid="config-from-canonical"
              >
                Create from canonical
              </Button>
              <Button variant="outline" onClick={() => fileInput.current?.click()}>
                Upload YAML file
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".yaml,.yml,.json,text/yaml"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (file.size > 256 * 1024) {
                    setError("YAML file is too large (max 256 KB).");
                    return;
                  }
                  const text = await file.text();
                  setYamlText(text);
                  setName(file.name.replace(/\.(ya?ml|json)$/i, ""));
                  setMode("edit");
                  void validate(text);
                }}
              />
            </div>
            {chosen ? <Alert tone="success">Selected: {chosen.name}</Alert> : null}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="max-w-sm">
              <Label htmlFor="config-name">Configuration name</Label>
              <Input id="config-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Market validation v1" data-testid="config-name" />
            </div>

            {normalized ? (
              <details className="rounded border border-sage-light bg-warm/50 p-3">
                <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-charcoal/70">
                  Guided email and variable edits (spintax-safe)
                </summary>
                <div className="mt-3 space-y-5">
                  <EmailListEditor
                    emails={normalized.emails}
                    onChange={(mutate) =>
                      applyGuidedEdit((config) => {
                        mutate(config.emails);
                        config.emails.forEach((email, index) => {
                          email.sequence_position = index + 1;
                        });
                      })
                    }
                  />
                  <VariableListEditor
                    variables={normalized.variables}
                    onChange={(mutate) =>
                      applyGuidedEdit((config) => {
                        mutate(config.variables);
                      })
                    }
                  />
                </div>
                <p className="mt-2 text-[11px] text-charcoal/50">
                  Settings, generation, and eligibility stay in Raw YAML. Guided edits rewrite the whole file with double-quoted strings.
                </p>
              </details>
            ) : null}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <Label htmlFor="yaml-editor">Raw YAML (advanced — stored exactly as written)</Label>
                <span className="text-[11px] text-charcoal/50">
                  Quote values containing {"{spintax|braces}"} so YAML keeps them verbatim.
                </span>
              </div>
              <Textarea
                id="yaml-editor"
                data-testid="yaml-editor"
                rows={16}
                spellCheck={false}
                className="font-[family-name:var(--font-mono)] text-xs"
                value={yamlText}
                onChange={(e) => setYamlText(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void validate(yamlText)} data-testid="config-validate">
                Validate
              </Button>
              <Button onClick={save} disabled={busy} data-testid="config-save">
                {busy ? "Saving…" : "Save & use this configuration"}
              </Button>
              {validation ? (
                validation.ok ? (
                  <Badge tone="success">Valid — matches the pipeline schema</Badge>
                ) : (
                  <Badge tone="danger">Invalid</Badge>
                )
              ) : null}
              {validation && validation.spintax_tokens.length > 0 ? (
                <Badge tone="info">{validation.spintax_tokens.length} spintax/placeholder token(s) detected</Badge>
              ) : null}
            </div>

            {validation && !validation.ok ? (
              <div className="space-y-1">
                {validation.syntax_errors.map((message) => (
                  <Alert key={message} tone="danger">YAML syntax: {message}</Alert>
                ))}
                {validation.schema_errors.map((message) => (
                  <Alert key={message} tone="danger">Schema: {message}</Alert>
                ))}
              </div>
            ) : null}

            {normalized ? (
              <div>
                <button
                  type="button"
                  className="text-xs font-medium text-evergreen underline"
                  onClick={() => setShowPreview((value) => !value)}
                >
                  {showPreview ? "Hide" : "Show"} normalized configuration preview (read-only)
                </button>
                {showPreview ? (
                  <pre className="mt-2 max-h-72 overflow-auto rounded border border-sage-light bg-charcoal p-3 text-[11px] leading-relaxed text-sage-light">
                    {JSON.stringify(normalized, null, 2)}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
