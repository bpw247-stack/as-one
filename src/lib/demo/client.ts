// A Supabase-shaped client over the in-memory demo backend, covering exactly
// the calls the app makes. Used only when EXPO_PUBLIC_DEMO=1.

import { DemoBackend, DemoError } from '@/lib/demo/backend';
import { DEMO_SONGS, DEMO_USER_ID } from '@/lib/demo/seed';

type Result<T> = { data: T; error: { message: string } | null };
const ok = <T>(data: T): Result<T> => ({ data, error: null });
const err = (e: unknown): Result<null> => ({
  data: null,
  error: { message: e instanceof Error ? e.message : String(e) },
});

// Screening is simulated with short word lists so the demo works offline.
// The real app asks Claude, which understands context instead of words.
const BLOCK_PATTERNS = [/\bkys\b/i, /kill yourself/i, /\bworthless\b/i, /\bpathetic\b/i, /\bidiot\b/i, /\bhate you\b/i, /\bloser\b/i, /\bstupid\b/i];
const CRISIS_PATTERNS = [
  /don'?t see the point/i, /\bend it\b/i, /kill myself/i, /want to die/i, /can'?t go on/i, /\bsuicid/i,
  /hurt myself/i, /no reason to live/i, /better off without me/i,
];
function screen(text: string): 'allow' | 'block' | 'crisis' {
  if (BLOCK_PATTERNS.some((p) => p.test(text))) return 'block';
  if (CRISIS_PATTERNS.some((p) => p.test(text))) return 'crisis';
  return 'allow';
}

type Filter = (row: Record<string, unknown>) => boolean;

function likeToRegex(pattern: string) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (c === '%') out += '.*';
    else if (c === '_') out += '.';
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

class Query implements PromiseLike<Result<unknown>> {
  private filters: Filter[] = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private max = Infinity;
  private single = false;

  constructor(
    private rows: () => Record<string, unknown>[],
    private columns = '*',
  ) {}

  select(columns = '*') {
    this.columns = columns;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((r) => r[column] !== value);
    return this;
  }
  ilike(column: string, pattern: string) {
    const re = likeToRegex(pattern);
    this.filters.push((r) => re.test(String(r[column] ?? '')));
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  /** Supports the and(a.eq.x,b.eq.y),and(...) form the app uses. */
  or(expression: string) {
    const groups = [...expression.matchAll(/and\(([^)]*)\)/g)].map((m) =>
      m[1].split(',').map((cond) => {
        const [column, , value] = cond.split('.');
        return { column, value };
      }),
    );
    this.filters.push((r) => groups.some((g) => g.every(({ column, value }) => String(r[column]) === value)));
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.sort = { column, ascending: options.ascending ?? true };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle<T>() {
    this.single = true;
    return this as unknown as PromiseLike<Result<T | null>>;
  }
  returns<T>() {
    return this as unknown as PromiseLike<Result<T>>;
  }

  private run(): Result<unknown> {
    try {
      let rows = this.rows().filter((r) => this.filters.every((f) => f(r)));
      if (this.sort) {
        const { column, ascending } = this.sort;
        rows = rows.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
      }
      rows = rows.slice(0, this.max);
      if (this.columns !== '*') {
        const keep = this.columns.split(',').map((c) => c.trim());
        rows = rows.map((r) => Object.fromEntries(keep.map((k) => [k, r[k]])));
      }
      return ok(this.single ? (rows[0] ?? null) : rows);
    } catch (e) {
      return err(e);
    }
  }

  then<A = Result<unknown>, B = never>(
    onfulfilled?: ((value: Result<unknown>) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

type Session = { user: { id: string; email: string } };
type AuthListener = (event: string, session: Session | null) => void;

export function createDemoClient() {
  const db = new DemoBackend();
  let session: Session | null = { user: { id: DEMO_USER_ID, email: 'alex@example.com' } };
  const listeners = new Set<AuthListener>();
  const setSession = (next: Session | null, event: string) => {
    session = next;
    listeners.forEach((l) => l(event, session));
  };
  const me = () => session?.user.id ?? '';
  // Let the UI settle between actions the way a network round trip would.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 120));

  async function invokeScreen(body: Record<string, any>) {
    const text =
      body.action === 'profile' ? `${body.display_name} ${body.bio}` : String(body.body ?? '');
    const verdict = screen(text);
    if (verdict === 'block') {
      return { status: 'blocked', paused: db.recordBlockedAttempt(me(), 'harassment', text) };
    }
    const crisis = verdict === 'crisis';
    if (body.action === 'post') {
      if (crisis && !body.crisis_acknowledged) return { status: 'crisis' };
      const song = body.kind === 'song' ? (DEMO_SONGS.find((s) => s.id === body.song_id) ?? null) : null;
      const id = db.createPost(me(), { ...body, crisis, song } as Parameters<DemoBackend['createPost']>[1]);
      return { status: 'ok', id, support: crisis };
    }
    if (body.action === 'comment') {
      const id = db.addComment(me(), body.post_id, body.body, body.reply_to ?? null);
      return { status: 'ok', id, support: crisis };
    }
    const p = db.profile(me());
    p.display_name = String(body.display_name).trim();
    p.bio = String(body.bio).trim();
    return { status: 'ok', support: crisis };
  }

  return {
    auth: {
      async getSession() {
        return { data: { session }, error: null };
      },
      onAuthStateChange(listener: AuthListener) {
        listeners.add(listener);
        return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
      },
      async signInWithPassword({ email }: { email: string; password: string }) {
        await tick();
        // Any email signs in to the demo; accounts created in this visit sign in as themselves.
        const id = db.emails.get(email.trim().toLowerCase()) ?? DEMO_USER_ID;
        if (!db.profiles.has(id)) return { data: { session: null }, error: { message: 'That account was deleted.' } };
        setSession({ user: { id, email } }, 'SIGNED_IN');
        return { data: { session }, error: null };
      },
      async signUp({ email, options }: { email: string; password: string; options?: { data?: Record<string, string> } }) {
        await tick();
        try {
          const id = db.signUp(email, options?.data ?? {});
          setSession({ user: { id, email } }, 'SIGNED_IN');
          return { data: { session }, error: null };
        } catch (e) {
          return { data: { session: null }, error: { message: e instanceof Error ? e.message : String(e) } };
        }
      },
      async signOut() {
        setSession(null, 'SIGNED_OUT');
        return { error: null };
      },
      startAutoRefresh() {},
      stopAutoRefresh() {},
    },

    from(table: string) {
      return new Query(() => db.table(table, me()));
    },

    async rpc(name: string, args: Record<string, unknown> = {}) {
      await tick();
      try {
        const data = db.rpc(name, me(), args);
        if (name === 'delete_account') setSession(null, 'SIGNED_OUT');
        return ok(data ?? null);
      } catch (e) {
        return err(e);
      }
    },

    functions: {
      async invoke(name: string, { body }: { body: Record<string, any> }) {
        await tick();
        try {
          if (name === 'screen') return ok(await invokeScreen(body));
          if (name === 'songs') {
            const q = String(body.query ?? '').trim().toLowerCase();
            return ok({
              songs: q
                ? DEMO_SONGS.filter((s) => `${s.title} ${s.artist}`.toLowerCase().includes(q))
                : [],
            });
          }
          return err(new DemoError(`Not available in the demo: ${name}`));
        } catch (e) {
          return err(e);
        }
      },
    },

    storage: {
      from() {
        return {
          async upload(path: string, data: string | ArrayBuffer | Blob, options?: { contentType?: string }) {
            if (typeof data === 'string') {
              db.storage.set(path, data);
            } else {
              const blob = data instanceof Blob ? data : new Blob([data], { type: options?.contentType });
              db.storage.set(path, URL.createObjectURL(blob));
            }
            return { data: { path }, error: null };
          },
          async createSignedUrls(paths: string[]) {
            return ok(paths.map((path) => ({ path, signedUrl: db.storage.get(path) ?? null, error: null })));
          },
        };
      },
    },
  };
}
