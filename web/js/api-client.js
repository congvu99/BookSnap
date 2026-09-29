// Thin fetch wrapper matching the backend contract (see app/api_errors.py, app/api/serializers.py).
// Every error body is {error:{code,message,field}}. A 401 on any /api/* call (except auth) means
// the session cookie is gone — the caller should route to #/auth.

/** Emitted on window when any request receives 401, so app.js can redirect once. */
const UNAUTHORIZED_EVENT = 'booksnap:unauthorized';

/** Error class carrying the parsed backend error body. */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {{code:string,message:string,field?:string|null}} error
   * @param {Headers} headers
   */
  constructor(status, error, headers) {
    super(error.message || 'Lỗi không xác định');
    this.status = status;
    this.code = error.code;
    this.field = error.field || null;
    this.headers = headers;
  }
}

/**
 * @param {string} path e.g. '/api/books'
 * @param {RequestInit} [options]
 * @param {{skipAuthRedirect?: boolean}} [opts]
 * @returns {Promise<any>} parsed JSON body, or null for 204
 */
export async function apiFetch(path, options = {}, opts = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, { ...options, headers, body, credentials: 'same-origin' });
  } catch (networkErr) {
    throw new ApiError(0, { code: 'network_error', message: 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.' }, new Headers());
  }
  if (res.status === 401 && !opts.skipAuthRedirect) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }
  if (res.status === 204) return null;
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const errBody = (data && data.error) || { code: 'unknown_error', message: `Lỗi máy chủ (${res.status})` };
    throw new ApiError(res.status, errBody, res.headers);
  }
  return data;
}

export function onUnauthorized(handler) {
  window.addEventListener(UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
}

// ---- Auth ----
export const authApi = {
  register: (body) => apiFetch('/api/auth/register', { method: 'POST', body }, { skipAuthRedirect: true }),
  login: (body) => apiFetch('/api/auth/login', { method: 'POST', body }, { skipAuthRedirect: true }),
  logout: () => apiFetch('/api/auth/logout', { method: 'POST' }, { skipAuthRedirect: true }),
  me: () => apiFetch('/api/me', {}, { skipAuthRedirect: true }),
};

// ---- Account (the signed-in user) ----
export const accountApi = {
  /** {id, username, display_name, created_at, stats:{books_created, pages_captured, books_listening, bookmarks}} */
  profile: () => apiFetch('/api/me/profile'),
  /** Returns the updated /api/me shape. */
  update: (body) => apiFetch('/api/me', { method: 'PATCH', body }),
  /** {other_sessions_revoked}; the current device stays signed in. */
  changePassword: (body) => apiFetch('/api/me/password', { method: 'POST', body }),
};

// ---- Provider quota (shared by every account) ----
export const usageApi = {
  /** {as_of, services:[{service, label, unit, window, status, used, limit, remaining, resets_at, paused_until, waiting_chunks, last_quota_at}]} */
  get: () => apiFetch('/api/usage'),
};

// ---- Books ----
export const booksApi = {
  list: () => apiFetch('/api/books'),
  continueListening: () => apiFetch('/api/me/continue'),
  create: (body) => apiFetch('/api/books', { method: 'POST', body }),
  get: (id) => apiFetch(`/api/books/${id}`),
  patch: (id, body) => apiFetch(`/api/books/${id}`, { method: 'PATCH', body }),
  remove: (id) => apiFetch(`/api/books/${id}`, { method: 'DELETE' }),
  chunks: (id) => apiFetch(`/api/books/${id}/chunks`),
  getProgress: (id) => apiFetch(`/api/books/${id}/progress`),
  putProgress: (id, body) => apiFetch(`/api/books/${id}/progress`, { method: 'PUT', body }),
  exportUrl: (id) => `/api/books/${id}/export`,
};

// ---- Pages ----
export const pagesApi = {
  /** @param {string} bookId @param {Blob} blob @param {number} seq @param {string} uploadId */
  upload: (bookId, blob, seq, uploadId) => {
    const form = new FormData();
    form.append('image', blob, `page-${seq}.jpg`);
    form.append('seq', String(seq));
    form.append('upload_id', uploadId);
    return apiFetch(`/api/books/${bookId}/pages`, { method: 'POST', body: form });
  },
  retry: (pageId) => apiFetch(`/api/pages/${pageId}/retry`, { method: 'POST' }),
  /** Marks seq as permanently skipped so it stops blocking later pages (C2 contract). */
  discard: (bookId, seq) => apiFetch(`/api/books/${bookId}/pages/${seq}/discard`, { method: 'POST' }),
};

// ---- Chunks ----
export const chunksApi = {
  patch: (id, text) => apiFetch(`/api/chunks/${id}`, { method: 'PATCH', body: { text } }),
  retry: (id) => apiFetch(`/api/chunks/${id}/retry`, { method: 'POST' }),
};

// ---- Topics ----
export const topicsApi = {
  /** Topics that currently hold at least one book: [{id, name, book_count}] sorted by name. */
  list: () => apiFetch('/api/topics'),
};

// ---- Bookmarks (per user; PUT/DELETE are idempotent) ----
export const bookmarksApi = {
  /** [{book_id, book_title, chunk_seq, excerpt, created_at}] newest first. */
  list: () => apiFetch('/api/bookmarks'),
  /** Bookmarked chunk seqs of one book: number[]. */
  forBook: (bookId) => apiFetch(`/api/books/${bookId}/bookmarks`),
  add: (bookId, seq) => apiFetch(`/api/books/${bookId}/bookmarks/${seq}`, { method: 'PUT' }),
  remove: (bookId, seq) => apiFetch(`/api/books/${bookId}/bookmarks/${seq}`, { method: 'DELETE' }),
};

// ---- Voices ----
export const voicesApi = {
  list: () => apiFetch('/api/voices'),
};
