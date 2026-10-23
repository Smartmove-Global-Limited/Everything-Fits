// Remote Config (Firebase on Android): ad switches and pacing. The defaults below are the values of
// the monetization doc; a value set in the Firebase console replaces its default once fetched. The
// last fetched values are kept on the device, so a start without network uses them.
import { LocalStore } from './LocalStore';
import { NativeBridge } from './NativeBridge';

export type PacingBand = { from: number; to: number; pacing: number[] };
export type InterPacing = { start_level: number; bands: PacingBand[]; after_last_band: 'hold_last' | 'stop' };

const DEFAULTS = {
  active_banner: true,
  banner_start_level: 1,
  active_inter: true,
  inter_pacing_config: {
    start_level: 5,
    bands: [{ from: 20, to: 30, pacing: [5] }, { from: 31, to: 60, pacing: [5] }],
    after_last_band: 'hold_last',
  } as InterPacing,
  min_inter_interval_sec: 60,
  min_between_reward_inter_sec: 30,
  max_inter_per_session: 10,
};
type Config = typeof DEFAULTS;
const KEY = 'ef.remoteConfig.v1';

const values: Config = { ...DEFAULTS };
let started = false;

/** Console strings → the type of the default ("true", "60", JSON) */
function apply(raw: Record<string, string>) {
  for (const k of Object.keys(DEFAULTS) as (keyof Config)[]) {
    const s = raw[k];
    if (s === undefined || s === '') continue;
    const def = DEFAULTS[k];
    try {
      const v = typeof def === 'boolean' ? /^(true|1)$/i.test(s.trim())
        : typeof def === 'number' ? Number(s)
        : JSON.parse(s);
      if (typeof def === 'number' && !Number.isFinite(v)) continue;
      (values as any)[k] = v;
    } catch { /* bad value in the console: keep the default */ }
  }
}

export const RemoteConfig = {
  get values(): Readonly<Config> { return values; },
  /** Once at launch: the saved values now, the console values when the fetch answers */
  start() {
    if (started) return;
    started = true;
    const saved = LocalStore.json<Record<string, string>>(KEY, {});
    apply(saved);
    if (!NativeBridge.android) return;
    NativeBridge.on('rc', msg => {
      if (msg.type !== 'values' || !msg.values) return;
      LocalStore.setJson(KEY, msg.values);
      apply(msg.values);
    });
    NativeBridge.call('remoteConfigFetch', JSON.stringify(Object.keys(DEFAULTS)));
  },
};
