import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required');
}

/**
 * One browser client owns auth, refresh-token rotation, database, storage and
 * realtime. Supabase keeps the refresh token across browser restarts and
 * refreshes access tokens until the user explicitly signs out.
 */
export const supabaseClient = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'splitmate-supabase-auth',
  },
});

/** PostgREST compatibility facade for the existing calculation service layer. */
const backend = {
  database: supabaseClient,
  auth: supabaseClient.auth,
  storage: supabaseClient.storage,
  realtime: supabaseClient.realtime,
};

interface QueryResult<T = unknown> {
  data: T | null;
  error: unknown;
}

type QueryBuilder = {
  eq: (key: string, val: string) => QueryBuilder;
  neq: (key: string, val: string) => QueryBuilder;
  gt: (key: string, val: string) => QueryBuilder;
  lt: (key: string, val: string) => QueryBuilder;
  like: (key: string, val: string) => QueryBuilder;
  in: (key: string, val: string[]) => QueryBuilder;
};

async function executeWithRetry<T = unknown>(queryFn: () => PromiseLike<QueryResult<T>>): Promise<T | undefined> {
  // Auth restoration is asynchronous on a cold browser start. Waiting here
  // prevents an authenticated query from being sent with the publishable key
  // only, which PostgREST correctly rejects and the UI could mistake for an
  // empty account.
  const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  if (!sessionData.session) throw new Error('Authentication required');

  let result = await queryFn();

  if (result.error) {
    const errorText = JSON.stringify(result.error);
    if (/JWT expired|PGRST301|401|refresh_token/i.test(errorText)) {
      const { error: refreshError } = await supabaseClient.auth.refreshSession();
      if (!refreshError) result = await queryFn();
    }
  }

  if (result.error) {
    const message = typeof result.error === 'object' && result.error && 'message' in result.error
      ? String(result.error.message)
      : JSON.stringify(result.error);
    throw new Error(message || 'Database error occurred');
  }

  return result.data ?? undefined;
}

function parseParams(params: string) {
  const filters: { key: string; op: string; val: string }[] = [];
  let selectVal = '*';
  let orderCol = '';
  let orderAsc = false;
  if (!params) return { filters, selectVal, orderCol, orderAsc };

  for (const part of params.split('&')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.substring(0, eqIdx);
    const val = part.substring(eqIdx + 1);
    if (key === 'select') {
      selectVal = val;
    } else if (key === 'order') {
      const [col, dir] = val.split('.');
      orderCol = col;
      orderAsc = dir !== 'desc';
    } else if (val.startsWith('eq.')) filters.push({ key, op: 'eq', val: val.substring(3) });
    else if (val.startsWith('neq.')) filters.push({ key, op: 'neq', val: val.substring(4) });
    else if (val.startsWith('gt.')) filters.push({ key, op: 'gt', val: val.substring(3) });
    else if (val.startsWith('lt.')) filters.push({ key, op: 'lt', val: val.substring(3) });
    else if (val.startsWith('like.')) filters.push({ key, op: 'like', val: val.substring(5) });
    else if (val.startsWith('in.')) filters.push({ key, op: 'in', val: val.substring(3) });
  }
  return { filters, selectVal, orderCol, orderAsc };
}

function applyFilters<T extends QueryBuilder>(query: T, filters: { key: string; op: string; val: string }[]): T {
  let filtered: QueryBuilder = query;
  for (const filter of filters) {
    if (filter.op === 'eq') filtered = filtered.eq(filter.key, filter.val);
    if (filter.op === 'neq') filtered = filtered.neq(filter.key, filter.val);
    if (filter.op === 'gt') filtered = filtered.gt(filter.key, filter.val);
    if (filter.op === 'lt') filtered = filtered.lt(filter.key, filter.val);
    if (filter.op === 'like') filtered = filtered.like(filter.key, filter.val);
    if (filter.op === 'in') filtered = filtered.in(filter.key, filter.val.replace(/^\(|\)$/g, '').split(','));
  }
  return filtered as T;
}

export async function dbQuery(table: string, params = '') {
  return executeWithRetry(async () => {
    const { filters, selectVal, orderCol, orderAsc } = parseParams(params);
    let query = supabaseClient.from(table).select(selectVal);
    query = applyFilters(query as unknown as QueryBuilder, filters) as unknown as typeof query;
    if (orderCol) query = query.order(orderCol, { ascending: orderAsc });
    return await query;
  });
}

export async function dbInsert(table: string, body: object) {
  return executeWithRetry(async () => supabaseClient.from(table).insert(body).select('*'));
}

export async function dbUpdate(table: string, params: string, body: object) {
  return executeWithRetry(async () => {
    const { filters, selectVal } = parseParams(params);
    let query = supabaseClient.from(table).update(body);
    query = applyFilters(query as unknown as QueryBuilder, filters) as unknown as typeof query;
    return await query.select(selectVal);
  });
}

export async function dbDelete(table: string, params: string) {
  return executeWithRetry(async () => {
    const { filters } = parseParams(params);
    let query = supabaseClient.from(table).delete();
    query = applyFilters(query as unknown as QueryBuilder, filters) as unknown as typeof query;
    return await query;
  });
}

export type { SupabaseClient };
export default backend;
