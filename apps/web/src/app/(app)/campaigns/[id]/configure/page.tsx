"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfigStep, type ChosenConfig } from "@/components/wizard/ConfigStep";
import { Alert } from "@/components/ui/misc";

export default function ConfigureCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [chosen, setChosen] = useState<ChosenConfig | null>(null);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-lg font-semibold text-evergreen-deep">Campaign configuration</h1>
      {chosen ? (
        <Alert tone="success">
          Saved “{chosen.name}”. New runs of this campaign can select it in the wizard.
        </Alert>
      ) : null}
      <ConfigStep
        campaignId={id}
        chosen={chosen}
        onChosen={(config) => {
          setChosen(config);
          if (config) router.refresh();
        }}
      />
    </div>
  );
}
