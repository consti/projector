// Deterministic PRNG. Every effect draws from one of these seeded off the
// shared transport clock, so the control preview and the projector output
// simulate the same thing instead of drifting apart.
export class Rng {
  constructor(seed = 1) { this.s = (seed >>> 0) || 1; }
  next() {                       // xorshift32
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(n) { return (this.next() * n) | 0; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  pick(arr) { return arr[(this.next() * arr.length) | 0]; }
  // Box-Muller, cached
  gauss() {
    if (this._g != null) { const g = this._g; this._g = null; return g; }
    const u = Math.max(1e-7, this.next()), v = this.next();
    const r = Math.sqrt(-2 * Math.log(u)), t = 6.283185307 * v;
    this._g = r * Math.sin(t);
    return r * Math.cos(t);
  }
}

export const hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
