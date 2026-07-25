"use client";

import { useState } from "react";
import type { CampaignConfig, CampaignVariable } from "@aureli/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";

type VariableType = CampaignVariable["type"];

const VARIABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const OUTPUT_CLASSES = [
  "verified_fact",
  "evidence_backed_inference",
  "campaign_hypothesis",
  "aureli_offer",
  "conversational_bridge",
] as const;

interface VariableListEditorProps {
  variables: CampaignConfig["variables"];
  onChange: (mutate: (variables: CampaignConfig["variables"]) => void) => void;
}

function makeVariable(type: VariableType, previous?: CampaignVariable): CampaignVariable {
  const common = {
    required: previous?.required ?? true,
    evidence_required: previous?.evidence_required ?? false,
    must_differ_from: previous?.must_differ_from ?? [],
    examples_good: previous?.examples_good ?? [],
    examples_bad: previous?.examples_bad ?? [],
    allow_spintax: previous?.allow_spintax ?? false,
    ...(previous?.fallback ? { fallback: previous.fallback } : {}),
  };

  switch (type) {
    case "source":
      return { type, source_column: previous?.source_column ?? "source_column", ...common };
    case "static":
      return { type, value: previous?.value ?? "static value", ...common };
    case "system":
      return { type, system_value: previous?.system_value ?? "sender_company", ...common };
    case "generated":
      return {
        type,
        description: previous?.description ?? "Describe the generated value.",
        max_words: previous?.max_words ?? 18,
        output_class: previous?.output_class ?? "verified_fact",
        ...common,
      };
  }
}

function nextVariableName(variables: CampaignConfig["variables"]): string {
  let index = 1;
  let name = "new_variable";
  while (variables[name]) {
    index += 1;
    name = `new_variable_${index}`;
  }
  return name;
}

function linesToList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function VariableListEditor({ variables, onChange }: VariableListEditorProps) {
  const [renameError, setRenameError] = useState<string | null>(null);
  const entries = Object.entries(variables);

  function update(name: string, changes: Partial<CampaignVariable>) {
    onChange((draft) => {
      const variable = draft[name];
      if (variable) draft[name] = { ...variable, ...changes };
    });
  }

  function changeType(name: string, type: VariableType) {
    onChange((draft) => {
      const variable = draft[name];
      if (variable) draft[name] = makeVariable(type, variable);
    });
  }

  function rename(name: string, requestedName: string) {
    const nextName = requestedName.trim();
    if (nextName === name) return;
    if (!VARIABLE_NAME_RE.test(nextName)) {
      setRenameError("Variable names must start with a letter or underscore and contain only letters, numbers, and underscores.");
      return;
    }
    if (variables[nextName]) {
      setRenameError(`A variable named '${nextName}' already exists.`);
      return;
    }
    setRenameError(null);
    onChange((draft) => {
      const variable = draft[name];
      if (!variable) return;
      delete draft[name];
      draft[nextName] = variable;
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-evergreen-deep">Variables</h4>
          <p className="text-xs text-charcoal/60">Renaming a variable does not update its {"{{name}}"} references in email copy.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onChange((draft) => {
              draft[nextVariableName(draft)] = makeVariable("source");
            })
          }
        >
          Add variable
        </Button>
      </div>
      {renameError ? <p className="text-xs text-danger">{renameError}</p> : null}

      {entries.map(([name, variable], index) => {
        const otherNames = entries.map(([otherName]) => otherName).filter((otherName) => otherName !== name);
        return (
          <Card key={name}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge tone="evergreen">{variable.type}</Badge>
                <span>{name}</span>
              </CardTitle>
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  onChange((draft) => {
                    delete draft[name];
                  })
                }
              >
                Remove
              </Button>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <Label htmlFor={`variable-${index}-name`}>Name</Label>
                  <Input
                    id={`variable-${index}-name`}
                    defaultValue={name}
                    onBlur={(event) => rename(name, event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor={`variable-${index}-type`}>Type</Label>
                  <Select
                    id={`variable-${index}-type`}
                    value={variable.type}
                    onChange={(event) => changeType(name, event.target.value as VariableType)}
                  >
                    <option value="source">source</option>
                    <option value="generated">generated</option>
                    <option value="static">static</option>
                    <option value="system">system</option>
                  </Select>
                </div>
              </div>

              {variable.type === "source" ? (
                <div>
                  <Label htmlFor={`variable-${index}-source-column`}>Source column</Label>
                  <Input
                    id={`variable-${index}-source-column`}
                    defaultValue={variable.source_column ?? ""}
                    onBlur={(event) => update(name, { source_column: event.target.value })}
                  />
                </div>
              ) : null}

              {variable.type === "static" ? (
                <div>
                  <Label htmlFor={`variable-${index}-value`}>Value</Label>
                  <Input
                    id={`variable-${index}-value`}
                    defaultValue={variable.value ?? ""}
                    onBlur={(event) => update(name, { value: event.target.value })}
                  />
                </div>
              ) : null}

              {variable.type === "system" ? (
                <div>
                  <Label htmlFor={`variable-${index}-system-value`}>System value</Label>
                  <Input
                    id={`variable-${index}-system-value`}
                    placeholder="e.g. sender_company, today"
                    defaultValue={variable.system_value ?? ""}
                    onBlur={(event) => update(name, { system_value: event.target.value })}
                  />
                </div>
              ) : null}

              {variable.type === "generated" ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <Label htmlFor={`variable-${index}-description`}>Description</Label>
                    <Textarea
                      id={`variable-${index}-description`}
                      rows={3}
                      defaultValue={variable.description ?? ""}
                      onBlur={(event) => update(name, { description: event.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`variable-${index}-max-words`}>Maximum words</Label>
                    <Input
                      id={`variable-${index}-max-words`}
                      type="number"
                      min={1}
                      step={1}
                      defaultValue={variable.max_words ?? 18}
                      onBlur={(event) => {
                        const maxWords = Number(event.target.value);
                        if (Number.isInteger(maxWords) && maxWords > 0) update(name, { max_words: maxWords });
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`variable-${index}-output-class`}>Output class</Label>
                    <Select
                      id={`variable-${index}-output-class`}
                      value={variable.output_class ?? "verified_fact"}
                      onChange={(event) => update(name, { output_class: event.target.value as CampaignVariable["output_class"] })}
                    >
                      {OUTPUT_CLASSES.map((outputClass) => (
                        <option key={outputClass} value={outputClass}>{outputClass}</option>
                      ))}
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 text-sm md:col-span-2">
                    <input
                      type="checkbox"
                      checked={variable.evidence_required}
                      onChange={(event) => update(name, { evidence_required: event.target.checked })}
                    />
                    Evidence required
                  </label>
                  <div className="md:col-span-2">
                    <Label>Must differ from</Label>
                    {otherNames.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {otherNames.map((otherName) => {
                          const selected = variable.must_differ_from.includes(otherName);
                          return (
                            <button
                              key={otherName}
                              type="button"
                              className={`rounded-sm border px-2 py-1 text-xs font-medium ${selected ? "border-evergreen bg-evergreen text-white" : "border-sage bg-white text-charcoal"}`}
                              onClick={() =>
                                update(name, {
                                  must_differ_from: selected
                                    ? variable.must_differ_from.filter((item) => item !== otherName)
                                    : [...variable.must_differ_from, otherName],
                                })
                              }
                            >
                              {otherName}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-charcoal/50">Add another variable to set this constraint.</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor={`variable-${index}-examples-good`}>Good examples (one per line)</Label>
                    <Textarea
                      id={`variable-${index}-examples-good`}
                      rows={3}
                      defaultValue={variable.examples_good.join("\n")}
                      onBlur={(event) => update(name, { examples_good: linesToList(event.target.value) })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`variable-${index}-examples-bad`}>Bad examples (one per line)</Label>
                    <Textarea
                      id={`variable-${index}-examples-bad`}
                      rows={3}
                      defaultValue={variable.examples_bad.join("\n")}
                      onBlur={(event) => update(name, { examples_bad: linesToList(event.target.value) })}
                    />
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 rounded border border-sage-light bg-warm/50 p-3 md:grid-cols-2">
                <div className="md:col-span-2 text-xs font-medium uppercase tracking-wide text-charcoal/70">Common options</div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={variable.required}
                    onChange={(event) => update(name, { required: event.target.checked })}
                  />
                  Required
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={variable.allow_spintax}
                    onChange={(event) => update(name, { allow_spintax: event.target.checked })}
                  />
                  Allow spintax
                </label>
                <div className="md:col-span-2">
                  <Label htmlFor={`variable-${index}-fallback`}>Fallback (optional)</Label>
                  <Input
                    id={`variable-${index}-fallback`}
                    defaultValue={variable.fallback ?? ""}
                    onBlur={(event) => update(name, { fallback: event.target.value || undefined })}
                  />
                </div>
              </div>
            </CardBody>
          </Card>
        );
      })}
    </section>
  );
}
