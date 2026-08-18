import { createClient } from '@insforge/sdk';
import { refreshPersistentSession } from './authSession';

const insforge = createClient({
  baseUrl: import.meta.env.VITE_INSFORGE_URL,
  anonKey: import.meta.env.VITE_INSFORGE_ANON_KEY,
  retryCount: 2,
});

export function setAuthToken(token: string | null) {
  insforge.setAccessToken(token);
}

export function setLegacyRefreshToken(token: string | null) {
  insforge.getHttpClient().setRefreshToken(token);
}

interface QueryResult<T = unknown> {
  data?: T;
  error?: unknown;
}

type QueryBuilder = {
  eq: (key: string, val: string) => QueryBuilder;
  neq: (key: string, val: string) => QueryBuilder;
  gt: (key: string, val: string) => QueryBuilder;
  lt: (key: string, val: string) => QueryBuilder;
  like: (key: string, val: string) => QueryBuilder;
  in: (key: string, val: string[]) => QueryBuilder;
};

async function executeWithRetry<T = unknown>(queryFn: () => Promise<QueryResult<T>>): Promise<T | undefined> {
  let result = await queryFn();

  if (result.error) {
    const errStr = JSON.stringify(result.error);
    // The stable SDK refreshes automatically. This fallback routes refreshes
    // through our same-origin auth proxy for browsers that block third-party cookies.
    if (errStr.includes('JWT expired') || errStr.includes('PGRST301') || errStr.includes('AUTH_UNAUTHORIZED') || errStr.includes('401')) {
      const refreshResult = await refreshPersistentSession();
      if (refreshResult.status !== 'refreshed') {
        throw new Error('Your login is saved. Reconnect to refresh this data.');
      }
      setAuthToken(refreshResult.accessToken);
      result = await queryFn();
    }
  }

  // Check if error still persists after retry
  if (result.error) {
    const finalErrStr = JSON.stringify(result.error);
    throw new Error(finalErrStr || 'Database error occurred');
  }

  return result.data;
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
  for (const f of filters) {
    if (f.op === 'eq') filtered = filtered.eq(f.key, f.val);
    if (f.op === 'neq') filtered = filtered.neq(f.key, f.val);
    if (f.op === 'gt') filtered = filtered.gt(f.key, f.val);
    if (f.op === 'lt') filtered = filtered.lt(f.key, f.val);
    if (f.op === 'like') filtered = filtered.like(f.key, f.val);
    if (f.op === 'in') filtered = filtered.in(f.key, f.val.replace(/^\(|\)$/g, '').split(','));
  }
  return filtered as T;
}

export async function dbQuery(table: string, params = '') {
  return executeWithRetry(async () => {
    const { filters, selectVal, orderCol, orderAsc } = parseParams(params);
    let query = insforge.database.from(table).select(selectVal);
    query = applyFilters(query, filters);
    if (orderCol) query = query.order(orderCol, { ascending: orderAsc });
    return await query;
  });
}

export async function dbInsert(table: string, body: object) {
  return executeWithRetry(async () => {
    return await insforge.database.from(table).insert([body]).select('*');
  });
}

export async function dbUpdate(table: string, params: string, body: object) {
  return executeWithRetry(async () => {
    const { filters, selectVal } = parseParams(params);
    let query = insforge.database.from(table).update(body);
    query = applyFilters(query, filters);
    return await query.select(selectVal);
  });
}

export async function dbDelete(table: string, params: string) {
  return executeWithRetry(async () => {
    const { filters } = parseParams(params);
    let query = insforge.database.from(table).delete();
    query = applyFilters(query, filters);
    return await query;
  });
}

export default insforge;
