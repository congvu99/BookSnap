// Shared sign-out of the family account: revoke the session server-side (best effort), then forget
// who this device is. Per-profile progress stays (see progressStorageKey in store.js).
import { authApi } from './api-client.js';
import { authStore, clearCachedUser } from './store.js';

export async function signOut() {
  try {
    await authApi.logout();
  } catch {
    // Ignore network errors on logout — clear local state regardless.
  }
  clearCachedUser();
  authStore.set({ user: null, needsProfile: false, ready: true, offline: false });
  window.location.hash = '#/auth';
}
