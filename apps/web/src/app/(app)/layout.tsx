import Link from "next/link";
import { redirect } from "next/navigation";
import {
  LayoutDashboard,
  PlusCircle,
  Cpu,
  KeyRound,
  FileCode2,
  ShieldAlert,
  LogOut,
} from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/campaigns/new", label: "New Campaign", icon: PlusCircle },
  { href: "/settings/runners", label: "Runners", icon: Cpu },
  { href: "/settings/credentials", label: "API Keys", icon: KeyRound },
  { href: "/settings/configurations", label: "Configurations", icon: FileCode2 },
  { href: "/settings/fallback-rules", label: "Fallback Rules", icon: ShieldAlert },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-52 shrink-0 flex-col border-r border-sage-light bg-evergreen-deep text-white">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-white/10 font-[family-name:var(--font-heading)] text-sm font-bold">
            A
          </div>
          <div className="text-sm font-semibold tracking-tight">Aureli Console</div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-2" aria-label="Primary">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 rounded px-2.5 py-2 text-[13px] text-white/80 hover:bg-white/10 hover:text-white"
            >
              <item.icon className="h-4 w-4" aria-hidden />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 px-4 py-3 text-[11px] text-white/50">
          Internal tool — v1
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between border-b border-sage-light bg-white px-4">
          <div className="text-xs text-charcoal/60">Aureli Automations · Campaign Processing</div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-charcoal/70" data-testid="user-email">
              {user.email}
            </span>
            <SignOutButton>
              <LogOut className="h-3.5 w-3.5" aria-hidden />
            </SignOutButton>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-5 py-5">{children}</main>
      </div>
    </div>
  );
}
