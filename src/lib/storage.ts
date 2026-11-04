import { supabaseClient } from './db';

const STORAGE_REFERENCE_PREFIX = 'supabase-storage://';
const STORAGE_BUCKETS = new Set(['avatars', 'receipts']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateUpload(file: File) {
  if (!file.size) throw new Error('The selected file is empty');
  if (file.size > 5 * 1024 * 1024) throw new Error('Images must be 5 MB or smaller');
  if (!IMAGE_TYPES.has(file.type)) throw new Error('Only JPEG, PNG and WebP images are supported');
}

export function createStorageReference(bucket: string, path: string) {
  return `${STORAGE_REFERENCE_PREFIX}${bucket}/${encodeURIComponent(path)}`;
}

export function parseStorageReference(reference?: string | null) {
  if (!reference?.startsWith(STORAGE_REFERENCE_PREFIX)) return null;
  const value = reference.slice(STORAGE_REFERENCE_PREFIX.length);
  const separator = value.indexOf('/');
  if (separator <= 0) return null;
  const bucket = value.slice(0, separator);
  let path: string;
  try { path = decodeURIComponent(value.slice(separator + 1)); }
  catch { throw new Error('Invalid attachment reference'); }
  // eslint-disable-next-line no-control-regex -- Reject control characters in object paths.
  if (!STORAGE_BUCKETS.has(bucket) || !path || /[\\\x00-\x1f]/.test(path)
    || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid attachment reference');
  }
  return { bucket, path };
}

export function safeStorageFileName(fileName: string) {
  return fileName.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'upload';
}

interface StorageResult<T> {
  data: T | null;
  error: unknown;
}

function storageErrorMessage(error: unknown) {
  if (typeof error === 'object' && error) {
    if ('message' in error && typeof error.message === 'string') return error.message;
    if ('error' in error && typeof error.error === 'string') return error.error;
  }
  return 'Storage request failed';
}

function isStorageAuthError(error: unknown) {
  const value = typeof error === 'object' && error ? error as Record<string, unknown> : {};
  const status = value.statusCode ?? value.status;
  return status === 401 || /jwt|token.*expired|unauthorized|not authenticated/i.test(storageErrorMessage(error));
}

async function executeStorageRequest<T>(operation: () => PromiseLike<StorageResult<T>>) {
  let result = await operation();
  if (result.error && isStorageAuthError(result.error)) {
    const { error: refreshError } = await supabaseClient.auth.refreshSession();
    if (!refreshError) result = await operation();
  }
  if (result.error) throw new Error(storageErrorMessage(result.error));
  if (!result.data) throw new Error('Storage did not return the saved file');
  return result.data;
}

export async function uploadPrivateFile(bucket: string, path: string, file: File) {
  validateUpload(file);
  parseStorageReference(createStorageReference(bucket, path));
  const data = await executeStorageRequest(() => supabaseClient.storage.from(bucket).upload(path, file, {
      cacheControl: '3600',
      contentType: file.type || undefined,
      upsert: false,
    }));
  if (data.path !== path) throw new Error('Storage returned an unexpected file path');
  return createStorageReference(bucket, path);
}

export async function getSignedStorageUrl(reference: string, expiresIn = 3600) {
  const parsed = parseStorageReference(reference);
  // Stored strings are untrusted: never turn javascript:, data:, or arbitrary
  // external URLs into a clickable attachment or tracking image.
  if (!parsed) throw new Error('Invalid attachment reference');
  const data = await executeStorageRequest(() => supabaseClient.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.path, expiresIn));
  return data.signedUrl;
}

export async function deleteStorageReference(reference?: string | null) {
  const parsed = parseStorageReference(reference);
  if (!parsed) return;
  await executeStorageRequest(() => supabaseClient.storage.from(parsed.bucket).remove([parsed.path]));
}
