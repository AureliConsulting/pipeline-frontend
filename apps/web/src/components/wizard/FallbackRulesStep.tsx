"use client";
import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/fetchJson";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";

export interface ChosenFallbackRules {
  id: string;
  name: string;
}

interface SavedRuleSet {
  id: string;
  name: string;
  json: Record<string, unknown>;
  updated_at: string;
}

/**
 * Optional wizard step: pick a saved shared fallback-rules JSON, or leave it
 * unset to let the resolver fall back to its own built-in defaults. This
 * feeds the mandatory fallback_resolver stage that always runs after
 * stage_two — it is not itself a separate pipeline run.
 */
export function FallbackRulesStep({
  onChosen,
  chosen,
}: {
  onChosen: (rules: ChosenFallbackRules | null) => void;
  chosen: ChosenFallbackRules | null;
}) {
  const [saved, setSaved] = useState<SavedRuleSet[]>([]);
  const [mode, setMode] = useState<"select" | "edit">("select");
  const [jsonText, setJsonText] = useState("{}");
  const [name, setName] = useState("");
  const [validation, setValidation] = useState<{ ok: boolean; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchJson<{ fallback_rule_sets: SavedRuleSet[] }>("/api/fallback-rules")
      .then((body) => setSaved(body.fallback_rule_sets))
      .catch(() => setSaved([]));
  }, []);

  async function validate(text: string) {
    try {
      const body = await fetchJson<{ ok: boolean; error?: string }>("/api/fallback-rules/validate", {
        method: "POST",
        json: { json_text: text },
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
      const result = await validate(jsonText);
      if (!result?.ok) {
        setError("Fix the JSON before saving.");
        return;
      }
      const body = await fetchJson<{ fallback_rule_set: { id: string; name: string } }>("/api/fallback-rules", {
        method: "POST",
        json: { name: name.trim() || "Untitled rules", json_text: jsonText },
      });
      const chosenNow = { id: body.fallback_rule_set.id, name: body.fallback_rule_set.name };
      setSaved((prev) => [
        { id: chosenNow.id, name: chosenNow.name, json: {}, updated_at: new Date().toISOString() },
        ...prev,
      ]);
      onChosen(chosenNow);
      setMode("select");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save fallback rules");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fallback rules (optional)</CardTitle>
        <div className="flex gap-1.5">
          <Button size="sm" variant={mode === "select" ? "secondary" : "ghost"} onClick={() => setMode("select")}>
            Saved rule sets
          </Button>
          <Button size="sm" variant={mode === "edit" ? "secondary" : "ghost"} onClick={() => setMode("edit")} data-testid="fallback-rules-edit-tab">
            Create / edit
          </Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <Alert tone="info">
          The manual review fallback resolver always runs automatically after scoring &amp;
          personalization. Leave this unset to use its built-in safe defaults, or select a
          previously saved shared configuration to override them.
        </Alert>
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {mode === "select" ? (
          <div className="space-y-3">
            <div>
              <Label htmlFor="fallback-rules-select">Select a rule set</Label>
              <Select
                id="fallback-rules-select"
                data-testid="fallback-rules-select"
                value={chosen?.id ?? ""}
                onChange={(e) => {
                  const found = saved.find((r) => r.id === e.target.value);
                  onChosen(found ? { id: found.id, name: found.name } : null);
                }}
              >
                <option value="">Use built-in defaults</option>
                {saved.map((ruleSet) => (
                  <option key={ruleSet.id} value={ruleSet.id}>
                    {ruleSet.name} ({new Date(ruleSet.updated_at).toLocaleDateString()})
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => fileInput.current?.click()}>
                Upload JSON file
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (file.size > 256 * 1024) {
                    setError("JSON file is too large (max 256 KB).");
                    return;
                  }
                  const text = await file.text();
                  setJsonText(text);
                  setName(file.name.replace(/\.json$/i, ""));
                  setMode("edit");
                  void validate(text);
                }}
              />
            </div>
            {chosen ? (
              <Alert tone="success">Selected: {chosen.name}</Alert>
            ) : (
              <Alert tone="info">Using the resolver&apos;s built-in defaults.</Alert>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="max-w-sm">
              <Label htmlFor="fallback-rules-name">Rule set name</Label>
              <Input
                id="fallback-rules-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q3 outbound fallbacks"
                data-testid="fallback-rules-name"
              />
            </div>
            <div>
              <Label htmlFor="fallback-rules-json">Raw JSON</Label>
              <Textarea
                id="fallback-rules-json"
                data-testid="fallback-rules-json"
                rows={16}
                spellCheck={false}
                className="font-[family-name:var(--font-mono)] text-xs"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void validate(jsonText)} data-testid="fallback-rules-validate">
                Validate
              </Button>
              <Button onClick={save} disabled={busy} data-testid="fallback-rules-save">
                {busy ? "Saving…" : "Save & use these rules"}
              </Button>
              {validation ? (
                validation.ok ? (
                  <Badge tone="success">Valid JSON</Badge>
                ) : (
                  <Badge tone="danger">{validation.error ?? "Invalid"}</Badge>
                )
              ) : null}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
