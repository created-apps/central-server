/**
 * GET-only PostgREST client for one source Supabase project.
 *
 * An unconfigured source is a normal state: every query returns []. A failed
 * query also returns [] and is logged, so one unreachable source does not stop
 * the others from being read. Nothing here can write.
 */

type Filters = Record<string, string>;

export class ReadOnlySource {
  constructor(
    readonly name: string,
    private readonly url: string,
    private readonly key: string,
  ) {}

  get enabled(): boolean {
    return Boolean(this.url && this.key);
  }

  private headers(): Record<string, string> {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, Accept: "application/json" };
  }

  async select<T = Record<string, any>>(
    table: string,
    opts: { columns?: string; filters?: Filters; order?: string; limit?: number } = {},
  ): Promise<T[]> {
    if (!this.enabled) return [];
    const params = new URLSearchParams();
    params.set("select", opts.columns ?? "*");
    params.set("limit", String(opts.limit ?? 1000));
    for (const [column, expression] of Object.entries(opts.filters ?? {})) params.append(column, expression);
    if (opts.order) params.set("order", opts.order);

    const endpoint = `${this.url.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(table)}?${params}`;
    try {
      const res = await fetch(endpoint, { headers: this.headers(), signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        console.warn(`[${this.name}] ${table} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return [];
      }
      const body = await res.json();
      return Array.isArray(body) ? (body as T[]) : [];
    } catch (err) {
      console.warn(`[${this.name}] ${table} failed: ${(err as Error).message}`);
      return [];
    }
  }

  async selectOne<T = Record<string, any>>(
    table: string,
    opts: { columns?: string; filters?: Filters; order?: string } = {},
  ): Promise<T | null> {
    const rows = await this.select<T>(table, { ...opts, limit: 1 });
    return rows[0] ?? null;
  }

  /** A time-limited download URL for one object in a private bucket. */
  async signedUrl(bucket: string, path: string, expiresIn: number): Promise<string | null> {
    if (!this.enabled || !path) return null;
    const base = this.url.replace(/\/$/, "");
    const objectPath = path.split("/").map(encodeURIComponent).join("/");
    try {
      const res = await fetch(`${base}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${objectPath}`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.warn(`[${this.name}] sign ${bucket}/${path} returned ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
      const signed = body.signedURL ?? body.signedUrl;
      return signed ? `${base}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}` : null;
    } catch (err) {
      console.warn(`[${this.name}] sign failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * A private storage object's bytes, read with the service key. null when
   * the object is missing; throws when storage fails or the file is too big.
   */
  async download(bucket: string, path: string, maxBytes: number): Promise<{ body: Buffer; contentType: string | null } | null> {
    if (!this.enabled || !path) return null;
    const base = this.url.replace(/\/$/, "");
    const objectPath = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${base}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${objectPath}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`[${this.name}] storage returned ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new Error(`[${this.name}] file is too large`);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > maxBytes) throw new Error(`[${this.name}] file is too large`);
    return { body, contentType: res.headers.get("content-type") };
  }
}

/** PostgREST filter for a case-insensitive exact email match. */
export function emailFilter(email: string): string {
  const escaped = email.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  return `ilike.${escaped}`;
}

/** Re-checks an ilike match exactly, since ilike treats some characters loosely. */
export function sameEmail<T extends Record<string, any>>(rows: T[], field: string, email: string): T[] {
  const wanted = email.trim().toLowerCase();
  return rows.filter((r) => String(r[field] ?? "").trim().toLowerCase() === wanted);
}
