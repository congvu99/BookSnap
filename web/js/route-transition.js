// Route transitions via the View Transitions API, with a plain update fallback. No Preact import,
// so the pure helpers (routeDepth, directionFor) run under `node --test`.
// View Transitions CSS in css/motion.css keys off <html data-nav="push|pop|tab"> while one runs; the
// CSS fallback instead reads data-enter on each .route-view, fixed when that view mounts (app.js).

/** @typedef {'push'|'pop'|'tab'|'none'} NavDirection */

// WebKit (Safari, and every browser on iOS) is left on the CSS fallback: its View Transitions stalled
// or crashed on our route changes (WebKit 26.6 crashes entering Của tôi), and Safari users saw no motion
// at all. The fallback animates the entering screen with the same push / pop / tab directions.
const IS_WEBKIT = typeof navigator !== 'undefined' && /Apple/.test(navigator.vendor || '');
const SUPPORTS_VT = typeof document !== 'undefined' && typeof document.startViewTransition === 'function' && !IS_WEBKIT;
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

// Never wait for animation frames inside the update callback: the browser stops rendering until it
// resolves, so requestAnimationFrame does not fire and the page freezes until the transition times
// out (~4s, then no animation). A macrotask is enough for Preact's microtask-batched render to land.
const afterRender = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    // CSS fallback: the remounted .route-view animates from its own data-enter (see app.js). Never
    // toggle a document-level attribute here: changing a live element's animation-name restarts the
    // animation, so the screen already shown would fade from transparent again.
    await update();
    return;
  }
  if (running) running.skipTransition();
  const root = document.documentElement;
  root.dataset.nav = direction;
  const transition = document.startViewTransition(async () => {
    await update();
    await afterRender();
  });
  running = transition;
  const clear = () => {
    if (running === transition) {
      running = null;
      delete root.dataset.nav;
      delete root.dataset.coverFlight; // a cover flight lasts exactly one transition
    }
  };
  transition.finished.then(clear, clear);
  // Skipping a running transition (fast taps) rejects `ready`; that is expected, not an error.
  transition.ready.catch(() => {});
  // updateCallbackDone rejects when `update` throws: surface it to the caller.
  await transition.updateCallbackDone;
}
