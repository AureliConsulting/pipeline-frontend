"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FallbackRulesStep, type ChosenFallbackRules } from "@/components/wizard/FallbackRulesStep";

/** Standalone create/edit surface for the settings library page — reuses the
 * wizard step's select/edit/save UI, but only cares about the save side
 * effect (refreshing the server-rendered list), not "chosen for this run". */
export function FallbackRulesManager() {
  const router = useRouter();
  const [chosen, setChosen] = useState<ChosenFallbackRules | null>(null);

  return (
    <FallbackRulesStep
      chosen={chosen}
      onChosen={(rules) => {
        setChosen(rules);
        router.refresh();
      }}
    />
  );
}
