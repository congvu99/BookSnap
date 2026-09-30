// Background music catalogue. Files live in web/audio/ambient/ (sources + licences in CREDITS.md)
// and are loudness-normalised to the same level. `gain` stays at 1 (loudest); the listener sets the
// level with the slider. Lower it per track only if one must sit under the others.

/** @typedef {{id:string, label:string, url:string, gain:number}} AmbientTrack */

/** @type {AmbientTrack[]} */
export const AMBIENT_TRACKS = [
  { id: 'rain', label: 'Mưa', url: '/audio/ambient/rain.mp3', gain: 1 },
  { id: 'piano', label: 'Piano', url: '/audio/ambient/piano.mp3', gain: 1 },
  { id: 'fireplace-cafe', label: 'Lò sưởi', url: '/audio/ambient/fireplace-cafe.mp3', gain: 1 },
  { id: 'violin', label: 'Violin', url: '/audio/ambient/violin.mp3', gain: 1 },
];

/** @param {string|null|undefined} id @returns {AmbientTrack|null} */
export function findTrack(id) {
  return AMBIENT_TRACKS.find((t) => t.id === id) || null;
}
