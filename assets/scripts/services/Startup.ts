// App start, while the splash plays: Remote Config first (ad and store rules depend on it), the ad
// SDK alongside it, the store last. Every step answers — done, failed or timed out — and the game
// opens only when all three have: the splash waits for run().
import { RemoteConfig, StartResult } from './RemoteConfig';
import { Ads, AdViews } from './Ads';
import { Purchases } from './Purchases';

export type StartupReport = { remoteConfig: StartResult; ads: StartResult; store: StartResult };

let running: Promise<StartupReport> | null = null;

export const Startup = {
  /** Start everything once; later calls get the same answer */
  run(views: AdViews): Promise<StartupReport> {
    if (running) return running;
    running = (async () => {
      const remoteConfig = RemoteConfig.start();
      const ads = Ads.start(views);                      // alongside Remote Config
      const rc = await remoteConfig;
      const store = await Purchases.start();             // last
      const report = { remoteConfig: rc, ads: await ads, store };
      console.log('[startup]', JSON.stringify(report));
      return report;
    })();
    return running;
  },
};
