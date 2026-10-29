// Remote Config (Firebase on Android): ad switches and pacing. The defaults below are the values of
// the monetization doc; a value set in the Firebase console replaces its default once fetched. The
// last fetched values are kept on the device, so a start without network uses them.
import { LocalStore } from './LocalStore';
import { NativeBridge } from './NativeBridge';

export type PacingBand = { from: number; to: number; pacing: number[] };
export type InterPacing = {
  start_level: number; bands: PacingBand[]; after_last_band: 'hold_last' | 'stop';
  /** Try again on the lose screen: pacing over the Try agains in a row on one level (gaps, the last
   *  one repeating: [2] = the 2nd, 4th, 6th…), instead of the level bands */
  lose_screen?: { try_again?: { pacing?: number[] } };
};

const DEFAULTS = {
  active_banner: true,
  banner_start_level: 1,
  active_inter: true,
  inter_pacing_config: {
    start_level: 10,
    bands: [{ from: 10, to: 60, pacing: [1] }],
    after_last_band: 'hold_last',
    lose_screen: { try_again: { pacing: [2] } },
  } as InterPacing,
  min_inter_interval_sec: 60,
  min_between_reward_inter_sec: 30,
  max_inter_per_session: 10,
  /** the whole levels.json (minified), replacing the levels shipped in the app; '' = keep the app's */
  levels: '',
};
type Config = typeof DEFAULTS;
const KEY = 'ef.remoteConfig.v1';

const values: Config = { ...DEFAULTS };
let started: Promise<StartResult> | null = null;
const FETCH_TIMEOUT_MS = 5000;

/** How a start-up step ended: ok, failed (the native side said so), timeout, or web (no native SDK) */
export type StartResult = 'ok' | 'failed' | 'timeout' | 'web' | 'off';
/** Resolve `p`, or `onTimeout` after `ms` (a native answer that never comes must not hold the splash) */
export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise(ok => { const t = setTimeout(() => ok(onTimeout), ms); p.then(v => { clearTimeout(t); ok(v); }); });
}

/** Console strings → the type of the default ("true", "60", JSON, or text) */
function apply(raw: Record<string, string>) {
  for (const k of Object.keys(DEFAULTS) as (keyof Config)[]) {
    const s = raw[k];
    if (s === undefined || s === '') continue;
    const def = DEFAULTS[k];
    try {
      const v = typeof def === 'boolean' ? /^(true|1)$/i.test(s.trim())
        : typeof def === 'number' ? Number(s)
        : typeof def === 'string' ? s                      // kept as text (levels is parsed by ContentLoader)
        : JSON.parse(s);
      if (typeof def === 'number' && !Number.isFinite(v)) continue;
      (values as any)[k] = v;
    } catch { /* bad value in the console: keep the default */ }
  }
}

export const RemoteConfig = {
  get values(): Readonly<Config> { return values; },
  /**
   * Once at launch (splash, first step): the saved values now, the console values when the fetch
   * answers. Resolves when Firebase answered, either way (failed: the saved / default values stay).
   */
  start(): Promise<StartResult> {
    if (started) return started;
    const saved = LocalStore.json<Record<string, string>>(KEY, {});
    apply(saved);
    if (!NativeBridge.android) return (started = Promise.resolve('web'));
    const answered = new Promise<StartResult>(done => {
      NativeBridge.on('rc', msg => {
        if (msg.type !== 'values') return;
        // a fresh answer replaces everything: a key taken off the console goes back to its default
        if (msg.ok !== false && msg.values) { LocalStore.setJson(KEY, msg.values); Object.assign(values, DEFAULTS); apply(msg.values); }
        console.log(`[RC] ${msg.ok === false ? 'failed' : 'ok'} inter_pacing_config ${JSON.stringify(values.inter_pacing_config)}`);
        done(msg.ok === false ? 'failed' : 'ok');
      });
    });
    NativeBridge.call('remoteConfigFetch', JSON.stringify(Object.keys(DEFAULTS)));
    return (started = withTimeout(answered, FETCH_TIMEOUT_MS, 'timeout'));
  },
};
