// The visuals settings that apply right now: the defaults, the global
// settings, and the overrides remembered for the track that is playing.
import { defaultVisualsCfg, videoKey } from './visuals.mjs';

export function visualsCfgFor(state, key) {
  const s = (state && state.settings) || {};
  const k = key === undefined ? videoKey(state && state.transport && state.transport.source) : key;
  const per = k && s.visualsByKey && s.visualsByKey[k];
  return { ...defaultVisualsCfg(), ...(s.visualsCfg || {}), ...(per || {}) };
}

/** Does this track carry its own visuals settings? */
export function hasVisualsOverride(state, key) {
  const s = (state && state.settings) || {};
  const k = key === undefined ? videoKey(state && state.transport && state.transport.source) : key;
  return !!(k && s.visualsByKey && s.visualsByKey[k]);
}
