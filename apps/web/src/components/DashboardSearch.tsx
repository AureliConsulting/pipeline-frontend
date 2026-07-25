"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PROTOCOL, STATUS_LABELS, type RunStatus } from "@aureli/shared";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function DashboardSearch({
  initialSearch,
  initialStatus,
}: {
  initialSearch: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState(initialStatus);

  function apply(nextSearch: string, nextStatus: string) {
    const params = new URLSearchParams();
    if (nextSearch.trim()) params.set("search", nextSearch.trim());
    if (nextStatus) params.set("status", nextStatus);
    router.replace(`/dashboard${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply(search, status);
      }}
      role="search"
      aria-label="Search campaigns"
    >
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by campaign title…"
        className="h-8 w-56"
        data-testid="campaign-search"
      />
      <Select
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          apply(search, e.target.value);
        }}
        className="h-8 w-44"
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        {PROTOCOL.run_statuses.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s as RunStatus]}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" variant="outline" data-testid="campaign-search-submit">
        Search
      </Button>
    </form>
  );
}
