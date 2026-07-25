/** Minimal chainable fake of the supabase-js query builder for unit tests. */
export interface TableFixture {
  rows: Array<Record<string, unknown>>;
}

export class FakeQuery {
  private filters: Array<[string, unknown]> = [];
  private updatePatch: Record<string, unknown> | null = null;
  private selecting = false;

  constructor(private table: TableFixture) {}

  select(_columns?: string) {
    this.selecting = true;
    return this;
  }

  update(patch: Record<string, unknown>) {
    this.updatePatch = patch;
    return this;
  }

  insert(row: Record<string, unknown>) {
    this.table.rows.push(row);
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push([column, values]);
    return this;
  }

  order() {
    return this;
  }
  limit() {
    return this;
  }
  gte() {
    return this;
  }
  gt() {
    return this;
  }

  private matches(row: Record<string, unknown>): boolean {
    return this.filters.every(([column, value]) =>
      Array.isArray(value) ? value.includes(row[column]) : row[column] === value,
    );
  }

  private apply(): Array<Record<string, unknown>> {
    const matched = this.table.rows.filter((row) => this.matches(row));
    if (this.updatePatch) {
      for (const row of matched) Object.assign(row, this.updatePatch);
    }
    return matched;
  }

  async maybeSingle() {
    const rows = this.apply();
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    const rows = this.apply();
    return rows[0]
      ? { data: rows[0], error: null }
      : { data: null, error: { message: "no rows" } };
  }

  then(resolve: (value: { data: unknown; error: null }) => void) {
    resolve({ data: this.apply(), error: null });
  }
}

export function fakeAdmin(tables: Record<string, TableFixture>) {
  return {
    from(name: string) {
      const table = tables[name] ?? { rows: [] };
      tables[name] = table;
      return new FakeQuery(table);
    },
    rpc: async () => ({ data: true, error: null }),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}
