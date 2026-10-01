// In-memory stale-while-revalidate cache for screen data. Entries are namespaced by profile id so one
// profile's data can never render for another; the whole cache is dropped on profile change / sign-out.
// No Preact here: views wire it to state with peekCached (initial state) + loadCached (refresh in an effect).

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const ANON = 'anon';

/** @type {Map<string, Map<string, {value: any, at: number}>>} profileId -> key -> entry */
const profiles = new Map();
/** @type {Map<string, Promise<any>>} in-flight fetches, one per profile+key */
const inflight = new Map();
// Bumped on clear so a fetch that started before a profile switch cannot write into the new cache.
let generation = 0;

const profileKey = (profileId) => (profileId == null ? ANON : String(profileId));

/** Cached entry younger than ttlMs, else null. @returns {{value: any, at: number}|null} */
export function peekEntry(key, { profileId = null, ttlMs = DEFAULT_TTL_MS, now = Date.now() } = {}) {
  const entry = profiles.get(profileKey(profileId))?.get(key);
  if (!entry) return null;
  if (now - entry.at > ttlMs) return null;
  return entry;
}

/** Cached value (possibly stale), or undefined. */
export function peekCached(key, opts = {}) {
  const entry = peekEntry(key, opts);
  return entry ? entry.value : undefined;
}

/** Store a value directly (optimistic edits, results already fetched elsewhere). */
export function setCached(key, value, { profileId = null, now = Date.now() } = {}) {
  const pk = profileKey(profileId);
  let bucket = profiles.get(pk);
  if (!bucket) profiles.set(pk, (bucket = new Map()));
  bucket.set(key, { value, at: now });
}

/** Drop one entry. */
export function invalidateCached(key, { profileId = null } = {}) {
  profiles.get(profileKey(profileId))?.delete(key);
}

/** Drop everything for every profile. */
export function clearViewCache() {
  profiles.clear();
  inflight.clear();
  generation++;
}

/**
 * Stale-while-revalidate read. `value` is whatever is cached now (undefined on a first visit);
 * `refresh` always runs the fetcher (shared with a fetch already in flight), stores the result and
 * resolves with it. It rejects when the fetcher rejects and leaves the old entry untouched.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fetcher
 * @param {{ profileId?: string|null, ttlMs?: number }} [opts]
 * @returns {{ value: T|undefined, refresh: Promise<T> }}
 */
export function cached(key, fetcher, opts = {}) {
  const { profileId = null } = opts;
  const value = peekCached(key, opts);
  const flightKey = `${profileKey(profileId)}\u0000${key}`;
  let refresh = inflight.get(flightKey);
  if (!refresh) {
    const startedIn = generation;
    refresh = Promise.resolve()
      .then(fetcher)
      .then((result) => {
        if (startedIn === generation) setCached(key, result, { profileId });
        return result;
      })
      .finally(() => {
        if (inflight.get(flightKey) === refresh) inflight.delete(flightKey);
      });
    inflight.set(flightKey, refresh);
  }
  return { value, refresh };
}

/**
 * Effect helper: starts a revalidation and reports the outcome unless cancelled.
 * Usage: useEffect(() => loadCached(key, fetcher, { profileId }, { onValue, onError }), []).
 * @returns {() => void} cancel (safe as an effect cleanup)
 */
export function loadCached(key, fetcher, opts, { onValue, onError }) {
  let cancelled = false;
  cached(key, fetcher, opts).refresh.then(
    (result) => {
      if (!cancelled) onValue(result);
    },
    (err) => {
      if (!cancelled && onError) onError(err);
    }
  );
  return () => {
    cancelled = true;
  };
}

/** Clear the cache whenever the signed-in profile changes (switch, sign-out). @returns {() => void} unsubscribe */
export function watchProfile(store) {
  let lastId = store.get().user?.id ?? null;
  return store.subscribe((state) => {
    const id = state.user?.id ?? null;
    if (id === lastId) return;
    lastId = id;
    clearViewCache();
  });
}

// Browser only: store.js touches window/localStorage at import, so node tests skip this and call watchProfile directly.
if (typeof window !== 'undefined') {
  import('./store.js').then((m) => watchProfile(m.authStore)).catch(() => {});
}
