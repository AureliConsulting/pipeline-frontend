"use client";

import type { CampaignEmail } from "@aureli/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";

interface EmailListEditorProps {
  emails: CampaignEmail[];
  onChange: (mutate: (emails: CampaignEmail[]) => void) => void;
}

function nextEmailId(emails: CampaignEmail[]): string {
  let index = emails.length + 1;
  while (emails.some((email) => email.id === `email_${index}`)) index += 1;
  return `email_${index}`;
}

export function EmailListEditor({ emails, onChange }: EmailListEditorProps) {
  function edit(mutator: (draft: CampaignEmail[]) => void) {
    onChange((draft) => {
      mutator(draft);
      draft.forEach((email, index) => {
        email.sequence_position = index + 1;
      });
    });
  }

  function update(index: number, changes: Partial<CampaignEmail>) {
    edit((draft) => {
      const email = draft[index];
      if (email) Object.assign(email, changes);
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-evergreen-deep">Emails</h4>
          <p className="text-xs text-charcoal/60">Sequence position is derived from this order.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            edit((draft) => {
              draft.push({
                id: nextEmailId(draft),
                sequence_position: draft.length + 1,
                delay_days: 0,
                subject: "",
                body: "Add email copy here.",
              });
            })
          }
        >
          Add email
        </Button>
      </div>

      {emails.map((email, index) => (
        <Card key={email.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Badge tone="evergreen">Email {index + 1}</Badge>
              <span>{email.id}</span>
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Move ${email.id} up`}
                disabled={index === 0}
                onClick={() =>
                  edit((draft) => {
                    const previous = draft[index - 1];
                    const current = draft[index];
                    if (previous && current) {
                      draft[index - 1] = current;
                      draft[index] = previous;
                    }
                  })
                }
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Move ${email.id} down`}
                disabled={index === emails.length - 1}
                onClick={() =>
                  edit((draft) => {
                    const current = draft[index];
                    const next = draft[index + 1];
                    if (current && next) {
                      draft[index] = next;
                      draft[index + 1] = current;
                    }
                  })
                }
              >
                ↓
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={emails.length === 1}
                onClick={() => edit((draft) => draft.splice(index, 1))}
              >
                Remove
              </Button>
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor={`email-${index}-id`}>ID</Label>
                <Input
                  id={`email-${index}-id`}
                  defaultValue={email.id}
                  onBlur={(event) => update(index, { id: event.target.value.trim() })}
                />
              </div>
              <div>
                <Label htmlFor={`email-${index}-delay`}>Delay days</Label>
                <Input
                  id={`email-${index}-delay`}
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={email.delay_days}
                  onBlur={(event) => {
                    const delayDays = Number(event.target.value);
                    if (Number.isInteger(delayDays) && delayDays >= 0) {
                      update(index, { delay_days: delayDays });
                    }
                  }}
                />
              </div>
            </div>
            <div>
              <Label htmlFor={`email-${index}-subject`}>Subject</Label>
              <Input
                id={`email-${index}-subject`}
                defaultValue={email.subject}
                onBlur={(event) => update(index, { subject: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor={`email-${index}-body`}>Body</Label>
              <p className="mb-1 text-[11px] text-charcoal/50">
                Guided-edit saves reformat the full file with double-quoted strings. Use Raw YAML to preserve hand-authored layout or comments.
              </p>
              <Textarea
                id={`email-${index}-body`}
                rows={10}
                spellCheck={false}
                className="font-[family-name:var(--font-mono)] text-xs"
                defaultValue={email.body}
                onBlur={(event) => update(index, { body: event.target.value })}
              />
            </div>
          </CardBody>
        </Card>
      ))}
    </section>
  );
}
