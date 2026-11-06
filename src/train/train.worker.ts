/// <reference lib="webworker" />
import { runEpisode, type EpisodeCfg } from './episode';

/** one headless game per job: { id, genome, cfg } → { id, metrics } */
self.onmessage = (e: MessageEvent<{ id: number; genome: number[]; cfg: EpisodeCfg }>) => {
  const { id, genome, cfg } = e.data;
  const metrics = runEpisode(genome, cfg);
  (self as unknown as Worker).postMessage({ id, metrics });
};
