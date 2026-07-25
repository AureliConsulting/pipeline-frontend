"use client";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SignOutButton({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Sign out"
      onClick={async () => {
        await getSupabaseBrowserClient().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      {children ?? "Sign out"}
    </Button>
  );
}
