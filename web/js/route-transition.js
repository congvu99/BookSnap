// Route transitions via the View Transitions API, with a plain update fallback. No Preact import,
// so the pure helpers (routeDepth, directionFor) run under `node --test`.
// CSS in css/motion.css keys off <html data-nav="push|pop|tab"> while a transition runs.

/** @typedef {'push'|'pop'|'tab'|'none'} NavDirection */

const SUPPORTS_VT = typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
// css/motion.css only plays its own enter animation when View Transitions are unavailable.
if (SUPPORTS_VT) document.documentElement.dataset.vt = '';

const TAB_ROUTES = new Set(['library', 'me', 'account']);
const DEEP_ROUTES = new Set(['book', 'read', 'capture', 'browse', 'me-section', 'profiles', 'bookmarks']);

/**
 * Stack depth of a route: 0 for bottom-nav tabs, 1 for screens pushed over them, -1 when unknown.
 * @param {string} routeName
 */
export function routeDepth(routeName) {
  if (TAB_ROUTES.has(routeName)) return 0;
  if (DEEP_ROUTES.has(routeName)) return 1;
  return -1;
}

/** @param {any} r @returns {{ name: string, bookId?: string }} */
function asRoute(r) {
  return typeof r === 'string' ? { name: r } : r || { name: '' };
}

/**
 * Animation to use when going from one route to another. Routes may be names or route objects
 * ({ name, bookId }). Switching between read and listen of the same book is not a navigation.
 * @param {string|{name: string, bookId?: string}} fromRoute
 * @param {string|{name: string, bookId?: string}} toRoute
 * @returns {NavDirection}
 */
export function directionFor(fromRoute, toRoute) {
  const from = asRoute(fromRoute);
  const to = asRoute(toRoute);
  if (from.name === 'read' && to.name === 'read' && from.bookId === to.bookId) return 'none';
  const a = routeDepth(from.name);
  const b = routeDepth(to.name);
  if (a < 0 || b < 0) return 'none';
  if (a === 0 && b === 0) return from.name === to.name ? 'none' : 'tab';
  if (b > a) return 'push';
  if (b < a) return 'pop';
  // Same depth (>0): a lateral hop to another pushed screen still reads as going forward.
  return from.name === to.name && from.bookId === to.bookId ? 'none' : 'push';
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

/** @type {{ skipTransition: () => void } | null} */
let running = null;

/**
 * Run `update` (which must commit the new route's DOM) inside a view transition.
 * Resolves once the DOM update is done; the animation itself continues afterwards.
 * @param {NavDirection} direction
 * @param {() => void | Promise<void>} update
 * @returns {Promise<void>}
 */
export async function runRouteTransition(direction, update) {
  if (!SUPPORTS_VT || direction === 'none') {
    await update();
    return;
  }
  if (running) running.skipTransition();
  const root = document.documentElement;
  root.dataset.nav = direction;
  const transition = document.startViewTransition(async () => {
    await update();
    await nextFrame();
  });
  running = transition;
  const clear = () => {
    if (running === transition) {
      running = null;
      delete root.dataset.nav;
    }
  };
  transition.finished.then(clear, clear);
  // updateCallbackDone rejects when `update` throws: surface it to the caller.
  await transition.updateCallbackDone;
}
