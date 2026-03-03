import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: import.meta.env.VITE_INSFORGE_URL,
  anonKey: import.meta.env.VITE_INSFORGE_ANON_KEY,
});

export function setAuthToken(token: string | null) {
  insforge.http.userToken = token;
}

function checkError(error: any) {
  if (error) {
    const errStr = JSON.stringify(error);
    if (errStr.includes('JWT expired') || errStr.includes('PGRST301')) {
      localStorage.removeItem('splitmate-user');
      window.location.replace('/login');
    }
    throw new Error(errStr);
  }
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

function applyFilters(query: any, filters: { key: string; op: string; val: string }[]) {
  for (const f of filters) {
    if (f.op === 'eq') query = query.eq(f.key, f.val);
    if (f.op === 'neq') query = query.neq(f.key, f.val);
    if (f.op === 'gt') query = query.gt(f.key, f.val);
    if (f.op === 'lt') query = query.lt(f.key, f.val);
    if (f.op === 'like') query = query.like(f.key, f.val);
    if (f.op === 'in') query = query.in(f.key, f.val.replace(/^\(|\)$/g, '').split(','));
  }
  return query;
}

export async function dbQuery(table: string, params = '') {
  const { filters, selectVal, orderCol, orderAsc } = parseParams(params);
  let query = insforge.database.from(table).select(selectVal);
  query = applyFilters(query, filters);
  if (orderCol) query = query.order(orderCol, { ascending: orderAsc });
  const { data, error } = await query;
  checkError(error);
  return data;
}

export async function dbInsert(table: string, body: object) {
  const { data, error } = await insforge.database
    .from(table).insert([body]).select('*');
  checkError(error);
  return data;
}

export async function dbUpdate(table: string, params: string, body: object) {
  const { filters, selectVal } = parseParams(params);
  let query = insforge.database.from(table).update(body).select(selectVal);
  query = applyFilters(query, filters);
  const { data, error } = await query;
  checkError(error);
  return data;
}

export async function dbDelete(table: string, params: string) {
  const { filters } = parseParams(params);
  let query = insforge.database.from(table).delete();
  query = applyFilters(query, filters);
  const { data, error } = await query;
  checkError(error);
  return data;
}

export default insforge;
