// Thin fetch wrapper matching the backend contract (see app/api_errors.py, app/api/serializers.py).
// Every error body is {error:{code,message,field}}. A 401 on any /api/* call (except auth) means
// the session cookie is gone — the caller should route to #/auth. A 409 profile_required /
// profile_mismatch means the device must pick a profile again (deleted, or switched in another tab).
import { authStore } from './store.js';
import { PROFILE_REQUIRED_CODES } from './auth-error-kind.js';
import { noteNetworkUse } from './connection-warmup.js';

/** Emitted on window when any request receives 401, so app.js can redirect once. */
const UNAUTHORIZED_EVENT = 'booksnap:unauthorized';
/** Emitted on window when any request (even with skipAuthRedirect) says a profile must be picked. */
const PROFILE_REQUIRED_EVENT = 'booksnap:profile-required';

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
  noteNetworkUse();
  const headers = new Headers(options.headers || {});
  // The cookie (and so the selected profile) is shared by every tab: tell the server which profile
  // this tab is showing, so a stale tab gets 409 instead of writing into another profile.
  const profileId = authStore.get().user?.id;
  if (profileId && !headers.has('X-Profile-Id')) headers.set('X-Profile-Id', profileId);
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
    if (res.status === 409 && PROFILE_REQUIRED_CODES.has(errBody.code)) {
      // Carry the profile the request was made for: a reply to a request sent before a profile
      // switch says nothing about the profile now in use.
      window.dispatchEvent(new CustomEvent(PROFILE_REQUIRED_EVENT, { detail: { code: errBody.code, profileId: headers.get('X-Profile-Id') } }));
    }
    throw new ApiError(res.status, errBody, res.headers);
  }
  return data;
}

export function onUnauthorized(handler) {
  window.addEventListener(UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
}

/** @param {string|null|undefined} profileId */
function profileHeader(profileId) {
  return profileId ? { 'X-Profile-Id': profileId } : {};
}

export function onProfileRequired(handler) {
  window.addEventListener(PROFILE_REQUIRED_EVENT, handler);
  return () => window.removeEventListener(PROFILE_REQUIRED_EVENT, handler);
}

// ---- Auth ----
// register/login return {id, username, display_name, avatar, account:{id, username}, profile_required};
// the profile fields are null while profile_required (several profiles, none picked yet).
export const authApi = {
  /** {registration_open}: false once the family account exists. */
  status: () => apiFetch('/api/auth/status', {}, { skipAuthRedirect: true }),
  register: (body) => apiFetch('/api/auth/register', { method: 'POST', body }, { skipAuthRedirect: true }),
  login: (body) => apiFetch('/api/auth/login', { method: 'POST', body }, { skipAuthRedirect: true }),
  logout: () => apiFetch('/api/auth/logout', { method: 'POST' }, { skipAuthRedirect: true }),
  me: () => apiFetch('/api/me', {}, { skipAuthRedirect: true }),
};

// ---- Profiles of the family account (work before a profile is picked) ----
export const profilesApi = {
  /** [{id, display_name, avatar}] in creation order. */
  list: () => apiFetch('/api/profiles'),
  create: (body) => apiFetch('/api/profiles', { method: 'POST', body }),
  update: (id, body) => apiFetch(`/api/profiles/${id}`, { method: 'PATCH', body }),
  /** Needs the family password; the profile's books go to the oldest remaining profile. */
  remove: (id, password) => apiFetch(`/api/profiles/${id}`, { method: 'DELETE', body: { password } }),
  /** Returns the /api/me shape of the picked profile. */
  select: (id) => apiFetch(`/api/profiles/${id}/select`, { method: 'POST' }),
};

// ---- Shelf ("Kệ của tôi", per profile; idempotent) ----
export const shelfApi = {
  /** profileId pins the write to the profile that made it (see putProgress). */
  add: (bookId, profileId) => apiFetch(`/api/me/shelf/${bookId}`, { method: 'PUT', headers: profileHeader(profileId) }),
  remove: (bookId, profileId) => apiFetch(`/api/me/shelf/${bookId}`, { method: 'DELETE', headers: profileHeader(profileId) }),
};

// ---- Account (the signed-in profile; password belongs to the family account) ----
export const accountApi = {
  /** {id, username, display_name, avatar, created_at, stats:{books_created, pages_captured, books_listening, bookmarks}} */
  profile: () => apiFetch('/api/me/profile'),
  /** Returns the updated /api/me shape. */
  update: (body) => apiFetch('/api/me', { method: 'PATCH', body }),
  /** {other_sessions_revoked}; the current device stays signed in. */
  changePassword: (body) => apiFetch('/api/me/password', { method: 'POST', body }),
};

// ---- Provider quota (shared by the whole family) ----
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
  /** Voice for audio not generated yet; existing audio keeps its voice. */
  setVoice: (id, body) => apiFetch(`/api/books/${id}/voice`, { method: 'PUT', body }),
  /** Skip the tail grace period so the last chunk is voiced now. */
  sealTail: (id) => apiFetch(`/api/books/${id}/seal-tail`, { method: 'POST' }),
  remove: (id) => apiFetch(`/api/books/${id}`, { method: 'DELETE' }),
  chunks: (id) => apiFetch(`/api/books/${id}/chunks`),
  /** Where each captured page starts in the chunks: [{page_seq, status, chunk_seq, chunk_frac, excerpt}]. */
  pageAnchors: (id) => apiFetch(`/api/books/${id}/page-anchors`),
  /** profileId pins the request to that profile (a stale tab must not write into another one). */
  getProgress: (id, profileId) => apiFetch(`/api/books/${id}/progress`, { headers: profileHeader(profileId) }),
  putProgress: (id, body, profileId) => apiFetch(`/api/books/${id}/progress`, { method: 'PUT', body, headers: profileHeader(profileId) }),
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

// ---- Bookmarks (per profile; PUT/DELETE are idempotent) ----
export const bookmarksApi = {
  /** [{book_id, book_title, chunk_seq, excerpt, created_at}] newest first. */
  list: () => apiFetch('/api/bookmarks'),
  /** Bookmarked chunk seqs of one book: number[]. */
  forBook: (bookId) => apiFetch(`/api/books/${bookId}/bookmarks`),
  add: (bookId, seq, profileId) => apiFetch(`/api/books/${bookId}/bookmarks/${seq}`, { method: 'PUT', headers: profileHeader(profileId) }),
  remove: (bookId, seq, profileId) => apiFetch(`/api/books/${bookId}/bookmarks/${seq}`, { method: 'DELETE', headers: profileHeader(profileId) }),
};

// ---- Voices ----
export const voicesApi = {
  /** {default_provider, providers:{[p]:{default, voices[], configured, preview_urls:{[voice]:url}}}} */
  list: () => apiFetch('/api/voices'),
  /** After an <audio> error: re-request the preview to learn the API error code (null if it now plays). */
  previewErrorCode: async (url) => {
    try {
      await apiFetch(url);
      return null;
    } catch (err) {
      return err.code || 'unknown_error';
    }
  },
};
