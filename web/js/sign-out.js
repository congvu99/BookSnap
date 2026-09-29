// Shared sign-out: revoke the session server-side (best effort), then wipe this user's local state.
import { authApi } from './api-client.js';
import { authStore, clearCachedUser, clearUserProgress } from './store.js';

export async function signOut() {
  const user = authStore.get().user;
  try {
    await authApi.logout();
  } catch {
    // Ignore network errors on logout — clear local state regardless.
  }
  if (user) clearUserProgress(user.id);
  clearCachedUser();
  authStore.set({ user: null, ready: true, offline: false });
  window.location.hash = '#/auth';
}
