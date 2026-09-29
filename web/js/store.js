// Minimal pub/sub store for cross-cutting app state (current user, theme). Not a framework —
// just enough so views outside the render tree (sw registration, media session) can read state.

function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      listeners.forEach((l) => l(state));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** @type {{get:()=>{user:null|{id:string,username:string,display_name:string}, ready:boolean, offline:boolean}, set:Function, subscribe:Function}} */
export const authStore = createStore({ user: null, ready: false, offline: false });

const CACHED_USER_KEY = 'booksnap:cached-user';

/** Persist the last known /api/me result so offline reloads can keep a downloaded book usable (C4). */
export function cacheUser(user) {
  try {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  } catch {
    // Storage full/unavailable — offline fallback just won't have a cached user.
  }
}

export function readCachedUser() {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearCachedUser() {
  localStorage.removeItem(CACHED_USER_KEY);
}

// Best-effort live indicator — the authoritative offline signal is still "did /api/me fail with a
// network/5xx error", set explicitly in app.js; this just reacts faster to browser connectivity changes.
window.addEventListener('online', () => authStore.set({ offline: false }));
window.addEventListener('offline', () => authStore.set({ offline: true }));

const THEME_KEY = 'booksnap:theme';
export const themeStore = createStore({ theme: localStorage.getItem(THEME_KEY) || 'auto' });

export function setTheme(theme) {
  themeStore.set({ theme });
  if (theme === 'auto') {
    localStorage.removeItem(THEME_KEY);
    document.documentElement.removeAttribute('data-theme');
  } else {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// Apply persisted theme immediately on load.
if (themeStore.get().theme !== 'auto') {
  document.documentElement.setAttribute('data-theme', themeStore.get().theme);
}

/** Per-user localStorage key prefix for playback progress, so logout can wipe just that user's data. */
export function progressStorageKey(userId, bookId) {
  return `booksnap:progress:${userId}:${bookId}`;
}

export function clearUserProgress(userId) {
  const prefix = `booksnap:progress:${userId}:`;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) localStorage.removeItem(key);
  }
}
