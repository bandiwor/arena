import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { modelSkills } from '../../train/models';
import { GameScreens } from '../../ui/menus';
import { gameHost } from '../game-host';
import { navigate, route } from '../router';

/** #/ — the arena. The game itself persists; this page only shows/suspends it and draws menus. */
export default function GamePage(): JSX.Element {
  const host = gameHost(); // shows / suspends itself with the route
  // #/watch/<model>/<diff> — opened from the training page: watch the trained model play
  const watch = route.value.params['watch'];
  const booted = host.booted.value;
  useEffect(() => {
    if (!booted || !watch) return;
    const skill = modelSkills().find((b) => b.key === `model:${watch}`);
    if (skill) host.startBot(skill, parseInt(route.value.params['diff'] ?? '1', 10));
    navigate('#/', { replace: true });
  }, [booted, watch]);
  return <GameScreens host={host} />;
}
