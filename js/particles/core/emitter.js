// emitter.js — one emitter per config. Owns its rate, bursts, shape, initial,
// modules. Per-frame: accumulates `rate * dt` for continuous emission and
// fires scheduled bursts. burst() is the on-demand path — that's what audio
// beats will eventually call.

import { point } from './shapes.js';
import { evalBoundScalar } from './bound.js';
import { packSpawnDescriptor, SHAPE_ID, DIR_MODE } from '../webgpu/spawn-descriptor.js';

const _tmpPos = new Float32Array(3);
const _tmpDir = new Float32Array(3);

// Module application order. Lower runs first per particle per frame.
// Forces accumulate into velocity; sets replace properties; muls compose;
// adds layer; constraints clamp/kill last. 'force-field' (curl etc.) is a
// force; 'overlife' (legacy) treated as set for ordering.
const MODULE_ORDER = {
  'force':       0,
  'force-field': 0,
  'set':         1,
  'overlife':    1,
  'mul':         2,
  'add':         3,
  'constraint':  4,
};

function rangeOr(rng, v, fallback, sys = null) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'object') {
    if ('source' in v && sys) {
      // Source-bound spawn-time value (e.g. initial.speed driven by an
      // audio channel). Evaluate at emitter level (particleIdx=-1).
      return evalBoundScalar(v, -1, sys, null) || 0;
    }
    if ('min' in v && 'max' in v) return rng.float(v.min, v.max);
  }
  return v;
}

// Initial-direction override modes:
//   'shape'         use the spawn-shape's outDir (default; same as omitting)
//   'outward'       radial unit vector from local origin to spawn position
//   'inward'        opposite of outward (toward origin)
//   [x, y, z]       fixed unit vector (auto-normalised)
//   { axis:[x,y,z], halfAngle:rad }
//                   uniform random direction within a cone around `axis`
function applyDirectionOverride(dirCfg, pos, dir, rng) {
  if (typeof dirCfg === 'string') {
    if (dirCfg === 'outward' || dirCfg === 'inward') {
      const len = Math.hypot(pos[0], pos[1], pos[2]);
      if (len > 1e-6) {
        const s = dirCfg === 'inward' ? -1 / len : 1 / len;
        dir[0] = pos[0] * s; dir[1] = pos[1] * s; dir[2] = pos[2] * s;
      }
    }
    return;
  }
  if (Array.isArray(dirCfg) && dirCfg.length >= 3) {
    const len = Math.hypot(dirCfg[0], dirCfg[1], dirCfg[2]) || 1;
    dir[0] = dirCfg[0] / len; dir[1] = dirCfg[1] / len; dir[2] = dirCfg[2] / len;
    return;
  }
  if (dirCfg && typeof dirCfg === 'object' && Array.isArray(dirCfg.axis)) {
    const ax = dirCfg.axis;
    const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
    const ay0 = ax[0] / al, ay1 = ax[1] / al, ay2 = ax[2] / al;
    const halfAngle = dirCfg.halfAngle ?? 0.3;
    const cosHA = Math.cos(halfAngle);
    const cosT = 1 - rng.next() * (1 - cosHA);
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const phi  = rng.next() * Math.PI * 2;
    // Build a perpendicular basis (r, s, axis).
    let rx, ry, rz;
    if (Math.abs(ay1) < 0.99) { rx = ay2; ry = 0; rz = -ay0; }
    else                      { rx = -ay1; ry = ay0; rz = 0; }
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const sx = ay1 * rz - ay2 * ry;
    const sy = ay2 * rx - ay0 * rz;
    const sz = ay0 * ry - ay1 * rx;
    const cp = Math.cos(phi), sp = Math.sin(phi);
    dir[0] = sinT * (cp * rx + sp * sx) + cosT * ay0;
    dir[1] = sinT * (cp * ry + sp * sy) + cosT * ay1;
    dir[2] = sinT * (cp * rz + sp * sz) + cosT * ay2;
  }
}

export class Emitter {
  constructor(config = {}) {
    const defaultsInitial = {
      lifetime: 1.0,
      speed: 0,
      size: 0.5,
      rotation: 0,
      angularVelocity: 0,
      color: [1, 1, 1, 1],
    };
    this.config = {
      position: [0, 0, 0],
      shape: point(),
      rate: 0,
      bursts: [],
      modules: [],
      ...config,
    };
    // Field-by-field merge so user-provided `initial: { lifetime: ... }`
    // doesn't drop the other defaults (rotation, angularVelocity, color, ...).
    this.config.initial = { ...defaultsInitial, ...(config.initial || {}) };
    this.id = -1;
    this.system = null;

    // Continuous-rate accumulator.
    this._spawnAccum = 0;
    // Burst tracking — for repeating bursts, count of cycles already fired.
    this._burstState = this.config.bursts.map(() => ({ fired: false, lastCycle: -1 }));
    // Audio-source trigger state — rising-edge watcher per trigger entry.
    this.config.triggers = this.config.triggers || [];
    this._triggerLast = new Float32Array(this.config.triggers.length);

    // Phase 2.5 GPU spawn pipeline state. CPU walks rate/bursts/triggers each
    // frame and bumps _pendingSpawnCount; WebGPU's system.update consumes it
    // by writing a SpawnDescriptor + dispatching cs_spawn.
    this._pendingSpawnCount = 0;
    this._spawnIdxBase = 0;       // monotonically incremented; stable_rand seed input
  }

  _attach(system) {
    this.system = system;
  }

  _reset() {
    this._spawnAccum = 0;
    this._burstState = this.config.bursts.map(() => ({ fired: false, lastCycle: -1 }));
    if (this._triggerLast) this._triggerLast.fill(0);
  }

  // Public API: fire N particles immediately, optionally with a partial
  // override of the initial block (e.g. burst(50, { speed: 12 })).
  burst(count, overrides = null) {
    this._spawn(count, overrides);
  }

  _update(dt, time) {
    if (this.config.disabled) return;     // disabled emitter — stop spawning
    // Continuous rate emission. Rate may be a constant scalar or a Bound
    // (e.g. {source: 'audio.drum_band.hat', scale: 1500}) — evaluated each
    // frame at emitter level (particleIdx = -1; audio sources ignore it).
    let rate = this.config.rate;
    if (rate !== null && typeof rate === 'object') {
      rate = evalBoundScalar(rate, -1, this.system, null) || 0;
      if (rate < 0) rate = 0;
    }
    this._spawnAccum += (rate || 0) * dt;
    if (this._spawnAccum >= 1) {
      const n = Math.floor(this._spawnAccum);
      this._spawnAccum -= n;
      this._spawn(n);
    }
    // Bursts
    for (let i = 0; i < this.config.bursts.length; i++) {
      const b = this.config.bursts[i];
      const st = this._burstState[i];
      if (b.repeat && b.interval > 0) {
        const since = time - (b.time || 0);
        if (since >= 0) {
          const cycle = Math.floor(since / b.interval);
          if (cycle > st.lastCycle) {
            this._spawn(b.count);
            st.lastCycle = cycle;
          }
        }
      } else if (!st.fired && time >= (b.time || 0)) {
        this._spawn(b.count);
        st.fired = true;
      }
    }
    // Per-emitter audio-source triggers (Phase 2B). Rising-edge: was below
    // threshold last frame, above this frame. Replaces emit.onBeat /
    // emit.onOnset / emit.onTrigger modules (those were the same logic in
    // a wrapper module on a "host" emitter; this is the same logic on the
    // spawning emitter itself).
    const sys = this.system;
    if (this.config.triggers.length && sys && sys.audioFeed && sys.audioFeed.sample) {
      for (let i = 0; i < this.config.triggers.length; i++) {
        const t = this.config.triggers[i];
        const stripped = (t.source || '').replace(/^audio\./, '');
        const src = sys.audioFeed.sample(stripped) ?? 0;
        if (src > t.threshold && this._triggerLast[i] <= t.threshold) {
          const c = (typeof t.count === 'object' && t.count !== null)
            ? evalBoundScalar(t.count, -1, sys, null)
            : t.count;
          const n = Math.max(0, c | 0);
          if (n > 0) this._spawn(n);
        }
        this._triggerLast[i] = src;
      }
    }
  }

  // Phase 2.5 GPU spawn path: CPU integrates rate/bursts/triggers and bumps
  // _pendingSpawnCount instead of CPU-spawning into SoA arrays. WebGPU's
  // system.update consumes _pendingSpawnCount by packing a SpawnDescriptor
  // and dispatching cs_spawn. Same control-flow as _update, but every
  // `this._spawn(n)` call becomes `this._pendingSpawnCount += n`.
  _updateCPU(dt, time) {
    if (this.config.disabled) { this._pendingSpawnCount = 0; return; }
    let rate = this.config.rate;
    if (rate !== null && typeof rate === 'object') {
      rate = evalBoundScalar(rate, -1, this.system, null) || 0;
      if (rate < 0) rate = 0;
    }
    this._spawnAccum += (rate || 0) * dt;
    if (this._spawnAccum >= 1) {
      const n = Math.floor(this._spawnAccum);
      this._spawnAccum -= n;
      this._pendingSpawnCount += n;
    }
    for (let i = 0; i < this.config.bursts.length; i++) {
      const b = this.config.bursts[i];
      const st = this._burstState[i];
      if (b.repeat && b.interval > 0) {
        const since = time - (b.time || 0);
        if (since >= 0) {
          const cycle = Math.floor(since / b.interval);
          if (cycle > st.lastCycle) {
            this._pendingSpawnCount += b.count;
            st.lastCycle = cycle;
          }
        }
      } else if (!st.fired && time >= (b.time || 0)) {
        this._pendingSpawnCount += b.count;
        st.fired = true;
      }
    }
    const sys = this.system;
    if (this.config.triggers.length && sys && sys.audioFeed && sys.audioFeed.sample) {
      for (let i = 0; i < this.config.triggers.length; i++) {
        const t = this.config.triggers[i];
        const stripped = (t.source || '').replace(/^audio\./, '');
        const src = sys.audioFeed.sample(stripped) ?? 0;
        if (src > t.threshold && this._triggerLast[i] <= t.threshold) {
          const c = (typeof t.count === 'object' && t.count !== null)
            ? evalBoundScalar(t.count, -1, sys, null)
            : t.count;
          const n = Math.max(0, c | 0);
          if (n > 0) this._pendingSpawnCount += n;
        }
        this._triggerLast[i] = src;
      }
    }
  }

  // Phase 2.5: pack this emitter's current config into a 144B SpawnDescriptor
  // for cs_spawn. spawn_count = _pendingSpawnCount, base_slot = system.alive
  // (where new particles land), spawn_idx_base = monotonic counter.
  _buildSpawnDescriptor(buffer, byteOffset, base_slot, _writeBuffer) {
    const cfg = this.config;
    const initial = cfg.initial || {};
    const shape = cfg.shape || { type: 'point', params: {} };
    const shapeId = SHAPE_ID[shape.type] ?? SHAPE_ID.point;
    const sp = shape.params || {};

    // shape_params packing per-shape
    let shape_params = [0, 0, 0, 0];
    if (shape.type === 'sphere')      shape_params = [sp.radius ?? 1, sp.surface ? 1 : 0, 0, 0];
    else if (shape.type === 'cone')   shape_params = [sp.radius ?? 0.2, sp.halfAngle ?? Math.PI/8, 0, 0];
    else if (shape.type === 'box')    shape_params = [sp.sx ?? 1, sp.sy ?? 1, sp.sz ?? 1, 0];
    else if (shape.type === 'ring')   shape_params = [sp.radius ?? 1, sp.thickness ?? 0, sp.height ?? 0, 0];
    else if (shape.type === 'line')   shape_params = [sp.ax ?? 1, sp.ay ?? 0, sp.az ?? 0, sp.length ?? 1];
    else if (shape.type === 'disc')   shape_params = [sp.radius ?? 1, 0, 0, 0];

    // Direction-override mode + axis. JS supports: undefined (mode 0), 'outward',
    // 'inward', [x,y,z] fixed-vec (mode 3), { axis, halfAngle } cone (mode 4).
    // For line + disc, the JS factory ships an explicit `direction` vec3 in
    // params; treat as mode-3 fixed-vec.
    let direction_mode = DIR_MODE.none;
    let direction_axis = [0, 1, 0];
    let direction_half_angle = 0;
    const dirCfg = initial.direction;
    if (typeof dirCfg === 'string') {
      if (dirCfg === 'outward') direction_mode = DIR_MODE.outward;
      else if (dirCfg === 'inward') direction_mode = DIR_MODE.inward;
    } else if (Array.isArray(dirCfg)) {
      direction_mode = DIR_MODE.fixed;
      const len = Math.hypot(dirCfg[0], dirCfg[1], dirCfg[2]) || 1;
      direction_axis = [dirCfg[0]/len, dirCfg[1]/len, dirCfg[2]/len];
    } else if (dirCfg && typeof dirCfg === 'object' && Array.isArray(dirCfg.axis)) {
      direction_mode = DIR_MODE.cone;
      const ax = dirCfg.axis;
      const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
      direction_axis = [ax[0]/al, ax[1]/al, ax[2]/al];
      direction_half_angle = dirCfg.halfAngle ?? 0.3;
    } else if (shape.type === 'line' || shape.type === 'disc') {
      direction_mode = DIR_MODE.fixed;
      direction_axis = [sp.dx ?? 0, sp.dy ?? 1, sp.dz ?? 0];
    }

    // Range packing — accept scalar, { min, max }, [min, max], OR a Bound
    // source (e.g. { source: 'audio.drum_band.kick', scale: 15 }) which is
    // evaluated at emitter level (particleIdx=-1) once per spawn batch.
    // Lets `initial.speed` and friends pulse with audio intensity at
    // spawn time, so loud moments produce a higher fountain.
    const range = (v, def) => {
      if (typeof v === 'number') return [v, v];
      if (v && typeof v === 'object') {
        if ('source' in v) {
          const s = evalBoundScalar(v, -1, this.system, null) || 0;
          return [s, s];
        }
        if ('min' in v && 'max' in v) return [v.min, v.max];
      }
      if (Array.isArray(v) && v.length >= 2) return [v[0], v[1]];
      return [def, def];
    };

    packSpawnDescriptor(buffer, byteOffset, {
      spawn_count: this._pendingSpawnCount,
      base_slot,
      emitter_id: this.id,
      spawn_idx_base: this._spawnIdxBase,
      position: cfg.position || [0, 0, 0],
      shape_id: shapeId,
      shape_params,
      direction_mode,
      direction_axis,
      direction_half_angle,
      speed: range(initial.speed, 0),
      life:  range(initial.lifetime, 1),
      size:  range(initial.size, 0.5),
      rot:   range(initial.rotation, 0),
      avel:  range(initial.angularVelocity, 0),
      color: initial.color || [1, 1, 1, 1],
    });
  }

  _applyModules(dt, time) {
    if (this.config.disabled) return;     // disabled emitter — no module effects
    const mods = this.config.modules;
    if (!mods || mods.length === 0) return;
    const sys = this.system;
    // Re-bucket by kind when the modules array changes. The per-module
    // `.disabled` flag is checked inside the hot loops below so toggling it
    // takes effect immediately without invalidating these buckets.
    if (this._sortedMods !== mods || this._sortedModsLen !== mods.length) {
      this._sortedMods = mods;
      this._sortedModsLen = mods.length;
      this._deathMods       = mods.filter(m => m.kind === 'death');
      this._emitMods        = mods.filter(m => m.kind === 'emit');
      this._perParticleMods = mods.filter(m => m.kind !== 'death' && m.kind !== 'emit')
        .slice().sort((a, b) => MODULE_ORDER[a.kind || 'force'] - MODULE_ORDER[b.kind || 'force']);
    }
    // Emitter-level modules run ONCE per frame (i = -1 sentinel).
    for (const m of this._emitMods) if (!m.disabled) m(sys, -1, dt, time);
    // Per-particle modules run once per particle.
    const ordered = this._perParticleMods;
    if (ordered.length === 0) return;
    for (let i = 0; i < sys.alive; i++) {
      if (sys.emitterId[i] !== this.id) continue;
      for (let m = 0; m < ordered.length; m++) {
        if (ordered[m].disabled) continue;
        ordered[m](sys, i, dt, time);
      }
    }
  }

  _spawn(count, overrides = null) {
    if (count <= 0 || !this.system) return;
    const sys = this.system;
    const rng = sys.rng;
    const cfg = overrides ? { ...this.config.initial, ...overrides } : this.config.initial;
    const pos = this.config.position;
    const shape = this.config.shape;
    const col = cfg.color || [1, 1, 1, 1];
    const dirCfg = cfg.direction;
    for (let n = 0; n < count; n++) {
      shape.sample(rng, _tmpPos, _tmpDir);
      // Optional initial-direction override — decouples velocity direction
      // from the spawn shape. See applyDirectionOverride for the modes.
      if (dirCfg) applyDirectionOverride(dirCfg, _tmpPos, _tmpDir, rng);
      const slot = sys._spawnOne(this.id,
        pos[0] + _tmpPos[0],
        pos[1] + _tmpPos[1],
        pos[2] + _tmpPos[2]);
      if (slot < 0) {
        // Pool full. _spawnOne already counted 1 drop for this attempt;
        // attribute the remaining (count - n - 1) un-attempted spawns too.
        sys.stats.dropped += count - n - 1;
        return;
      }
      const speed = rangeOr(rng, cfg.speed, 0, sys);
      sys.vel[slot * 3]     = _tmpDir[0] * speed;
      sys.vel[slot * 3 + 1] = _tmpDir[1] * speed;
      sys.vel[slot * 3 + 2] = _tmpDir[2] * speed;
      sys.life[slot] = rangeOr(rng, cfg.lifetime, 1, sys);
      sys.size[slot] = rangeOr(rng, cfg.size, 1, sys);
      sys.rot[slot]  = rangeOr(rng, cfg.rotation, 0, sys);
      sys.avel[slot] = rangeOr(rng, cfg.angularVelocity, 0, sys);
      sys.color[slot * 4]     = col[0];
      sys.color[slot * 4 + 1] = col[1];
      sys.color[slot * 4 + 2] = col[2];
      sys.color[slot * 4 + 3] = col[3] === undefined ? 1 : col[3];
    }
  }
}
