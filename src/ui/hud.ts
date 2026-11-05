import { Ev, EV_STRIDE } from '../core/events';
import { ET } from '../sim/constants';
import { MUTATORS } from '../sim/content/mutators';
import { RARITY_NAMES, weaponDef } from '../sim/content/weapons';
import { UPGRADES } from '../sim/content/upgrades';
import { ACT_NAMES, actWave, WAVES } from '../sim/content/waves';
import { enemyDef } from '../sim/content/enemies';
import { WavePhase, type World } from '../sim/world';
import { hexCss, RARITY_HEX } from '../render/palette';

const ROMAN = ['I', 'II', 'III', 'IV', 'V'] as const;

/** Archive terminal lines per act transition: [seconds, text] */
const LORE: Record<number, readonly (readonly [number, string])[]> = {
  1: [
    [0.2, '> МОНОЛИТ: целостность 0%'],
    [0.9, '> карантин NULL снят'],
    [1.6, '> декомпиляция сектора ......... 100%'],
    [2.6, '> перенос материи → ядро синтеза'],
    [3.6, '> доступ: архив «ПЛОТЬ» · образцов: 4 112'],
    [4.7, '> синтез среды ████████████ ok'],
    [5.7, '> реставрация процесса «Вектор»: +40%'],
    [6.6, '> МОНОЛИТ был лишь стражем. ядро глубже.'],
    [7.6, '> итерация #{seed} продолжается_'],
  ],
  2: [
    [0.2, '> МАТКА: биомасса 0% · образцы утрачены'],
    [0.9, '> ткань сектора отклонена сборкой'],
    [1.6, '> декомпиляция органики ......... 100%'],
    [2.6, '> переплавка → литейная линия 9'],
    [3.6, '> доступ: архив «ЛИТЕЙНЫЙ ЦЕХ» · цикл пресса 2.0 с'],
    [4.7, '> синтез среды ████████████ ok'],
    [5.7, '> СБОРЩИК: сборка 9.3 · компонент «Вектор» (устаревший)'],
    [6.6, '> ты не сбой. ты — деталь, которую хотят заменить.'],
    [7.6, '> итерация #{seed} продолжается_'],
  ],
};

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document): T => {
  const e = root.querySelector<T>(sel);
  if (!e) throw new Error(`missing ${sel}`);
  return e;
};

/** DOM HUD. Writes to the DOM only when a value actually changes. */
export class Hud {
  readonly root: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpLag: HTMLElement;
  private readonly hpBox: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly dashFill: HTMLElement;
  private readonly waveEl: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly mutEl: HTMLElement;
  private readonly weapons: HTMLElement;
  private readonly boss: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossName: HTMLElement;
  private bossWho = -2;
  private readonly log: HTMLElement;
  private logLines: readonly (readonly [number, string])[] = [];
  private logT = -1;
  private logFor = -1;
  private logShown = '';
  private readonly banner: HTMLElement;
  private readonly comboEl: HTMLElement;
  private readonly comboNum: HTMLElement;
  private readonly comboBar: HTMLElement;
  private lastCombo = -1;
  private lastTier = 0;
  readonly upgrade: HTMLElement;
  private last = { hp: -1, max: -1, dash: -1, wave: -1, score: -1, mut: -1, slots: -1, boss: -1, offer: -1 };
  private bannerT = 0;
  onPick: ((n: number) => void) | null = null;
  showFps = false;
  private fpsEl: HTMLElement | null = null;
  private fpsShown = -1;
  /** tapped weapon slot (0-based) */
  onSlot: ((n: number) => void) | null = null;

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'hud hidden';
    root.innerHTML = `
      <div class="hud-tl">
        <div class="hp"><b></b><i></i></div>
        <div class="hp-text"></div>
        <div class="dash">РЫВОК <span><i></i></span></div>
      </div>
      <div class="hud-tr"><div class="wave"></div><div class="score"></div><div class="combo hidden"><b></b><span>КОМБО</span><i><u></u></i></div><div class="mut hidden"></div></div>
      <div class="lore-log hidden"></div><div class="boss hidden"><div class="name">МОНОЛИТ</div><div class="bar"><i></i><div class="ticks"></div></div></div>
      <div class="weapons"></div>
      <div class="banner"></div>
      <div class="screen clear upgrade hidden"><div class="col"><div class="sub">ВЫБЕРИ МОДУЛЬ</div><div class="ups"></div></div></div>`;
    parent.appendChild(root);
    this.root = root;
    this.hpFill = $('.hp > i', root);
    this.hpLag = $('.hp > b', root);
    this.hpBox = $('.hp', root);
    this.hpText = $('.hp-text', root);
    this.dashFill = $('.dash i', root);
    this.waveEl = $('.wave', root);
    this.scoreEl = $('.score', root);
    this.mutEl = $('.mut', root);
    this.weapons = $('.weapons', root);
    this.weapons.addEventListener('pointerdown', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      this.onSlot?.(parseInt(t.dataset['slot']!, 10));
    });
    this.boss = $('.boss', root);
    this.bossFill = $('.boss .bar > i', root);
    this.bossName = $('.boss .name', root);
    this.log = $('.lore-log', root);
    this.banner = $('.banner', root);
    this.upgrade = $('.upgrade', root);
    this.comboEl = $('.combo', root);
    this.comboNum = $('.combo b', root);
    this.comboBar = $('.combo u', root);
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  showBanner(title: string, sub: string, color: string, time = 2): void {
    this.banner.innerHTML = `<h1 style="color:${color}">${title}</h1><p>${sub}</p>`;
    this.bannerT = time;
  }

  onEvent(t: number, d: Float32Array, o: number): void {
    switch (t) {
      case Ev.WaveStart: {
        const idx = d[o + 1]! - 1;
        const def = WAVES[idx];
        const boss = d[o + 3]! > 0.5;
        const aw = actWave(idx);
        const flesh = aw.act === 1;
        const col = boss ? (flesh ? '#ff2d7a' : '#9b5cff') : flesh ? '#ff6a7a' : '#2ef2ff';
        const foundry = aw.act === 2;
        const col2 = foundry ? (boss ? '#ffa126' : '#ffc46a') : col;
        const last = idx === WAVES.length - 1 || (WAVES[idx + 1]?.act ?? 0) !== aw.act;
        this.showBanner(boss ? (def?.name ?? 'БОСС') : `ВОЛНА ${aw.n}`, boss ? `АКТ ${ROMAN[aw.act]} · ${last ? 'ФИНАЛ' : 'СТРАЖ ЛИНИИ'}` : (def?.name.toUpperCase() ?? ''), col2, 2.2);
        // archive note for this wave, typed into the terminal log
        if (def?.lore && this.logT < 0) this.startLines([[1.2, `> ${def.lore}`]], 6.5);
        break;
      }
      case Ev.ActTransition:
        break; // the log is started from update() when the transition phase is seen
      case Ev.ActSynth: {
        const act = d[o + 3]!;
        this.showBanner(`АКТ ${ROMAN[act]}`, ACT_NAMES[act] ?? '', act === 1 ? '#ff2d4a' : act === 2 ? '#ffa126' : '#2ef2ff', 3.2);
        break;
      }
      case Ev.WaveClear:
        this.showBanner('ЗАЧИЩЕНО', 'сигнал стабилен', '#b6ff3b', 1.5);
        break;
      case Ev.Mutator: {
        const m = MUTATORS[d[o + 1]!];
        if (m && d[o + 2]! > 0.5) this.showBanner(m.name, m.desc, hexCss(m.color), 2.6);
        break;
      }
      case Ev.WeaponGained: {
        const w = weaponDef(d[o + 1]!);
        if (w.rarity >= 2) this.showBanner(w.name.toUpperCase(), RARITY_NAMES[w.rarity]!.toUpperCase() + ' ОРУЖИЕ', hexCss(RARITY_HEX[w.rarity]!), 2.4);
        break;
      }
      case Ev.BossPhase:
        this.showBanner(`ФАЗА ${d[o + 3]!}`, 'целостность нарушена', '#ff2d7a', 1.6);
        break;
    }
    void EV_STRIDE;
  }

  /** optional FPS counter (settings → Игра) */
  fps(v: number): void {
    if (!this.showFps) {
      if (this.fpsEl) this.fpsEl.classList.add('hidden');
      return;
    }
    if (!this.fpsEl) {
      this.fpsEl = document.createElement('div');
      this.fpsEl.className = 'fps-counter';
      this.root.appendChild(this.fpsEl);
    }
    this.fpsEl.classList.remove('hidden');
    const r = Math.round(v);
    if (r !== this.fpsShown) {
      this.fpsShown = r;
      this.fpsEl.textContent = `${r} FPS`;
    }
  }

  update(w: World, dt: number): void {
    const p = w.player;
    const L = this.last;
    const hp = Math.ceil(p.hp);
    if (hp !== L.hp || p.maxHp !== L.max) {
      const f = Math.max(0, p.hp / p.maxHp);
      this.hpFill.style.transform = `scaleX(${f})`;
      this.hpLag.style.transform = `scaleX(${f})`;
      this.hpText.textContent = `${hp} / ${Math.round(p.maxHp)}`;
      this.hpBox.classList.toggle('low', f < 0.3);
      L.hp = hp;
      L.max = p.maxHp;
    }
    const dash = Math.round((1 - p.dashCd / (0.85 * p.stats.dashCdMul)) * 20) / 20;
    if (dash !== L.dash) {
      this.dashFill.style.transform = `scaleX(${Math.max(0, Math.min(1, dash))})`;
      L.dash = dash;
    }
    const W = w.wave;
    const left = Math.max(0, W.totalThisWave - W.killedThisWave);
    const inTrans = W.phase === WavePhase.Transition;
    const waveKey = w.mode === 'sandbox' ? -2 : inTrans ? -3 - W.index : W.index * 10000 + left;
    if (inTrans && this.logT < 0 && this.logFor !== W.index) {
      this.logFor = W.index;
      this.startLog(WAVES[W.index]?.act ?? 1);
      this.logT = W.t;
    }
    if (waveKey !== L.wave) {
      if (w.mode === 'sandbox') this.waveEl.innerHTML = `ПЕСОЧНИЦА<small>отладка</small>`;
      else if (inTrans) this.waveEl.innerHTML = `СИНТЕЗ СЕКТОРА<small>АРХИВ «${ACT_NAMES[WAVES[W.index]?.act ?? 1]}»</small><small class="iter">ИТЕРАЦИЯ #${w.seed}</small>`;
      else {
        const aw = actWave(W.index);
        this.waveEl.innerHTML = `ВОЛНА ${aw.n}/${aw.total}<small>АКТ ${ROMAN[aw.act]} · ${ACT_NAMES[aw.act]} · ВРАГОВ: ${left}</small><small class="iter">ИТЕРАЦИЯ #${w.seed}</small>`;
      }
      L.wave = waveKey;
    }
    if (w.stats.score !== L.score) {
      this.scoreEl.textContent = w.stats.score.toString().padStart(7, '0');
      L.score = w.stats.score;
    }
    if (w.mutators !== L.mut) {
      let name = '';
      let col = '#fff';
      for (let m = 0; m < MUTATORS.length; m++)
        if (w.mutators & (1 << m)) {
          name = MUTATORS[m]!.name;
          col = hexCss(MUTATORS[m]!.color);
        }
      this.mutEl.classList.toggle('hidden', !name);
      this.mutEl.textContent = name;
      this.mutEl.style.color = col;
      L.mut = w.mutators;
    }
    let slots = p.cur + 1;
    for (let i = 0; i < p.slotCount; i++) slots = slots * 8 + p.slots[i]! + 1;
    if (slots !== L.slots) {
      let h = '';
      for (let i = 0; i < p.slotCount; i++) {
        const wd = weaponDef(p.slots[i]!);
        h += `<div class="wslot ${i === p.cur ? 'on' : ''}" data-slot="${i}" style="--rc:${hexCss(RARITY_HEX[wd.rarity]!)}"><div class="k">${i + 1} · ${RARITY_NAMES[wd.rarity]}</div><div class="n">${wd.name}</div></div>`;
      }
      this.weapons.innerHTML = h;
      L.slots = slots;
    }
    let bi = w.boss.id;
    if (!(bi >= 0 && w.enemies.alive[bi] && w.enemies.type[bi] === ET.Boss)) bi = w.miniBoss;
    const bossF = bi >= 0 && w.enemies.alive[bi] ? w.enemies.hp[bi]! / w.enemies.maxHp[bi]! : -1;
    if (bi !== this.bossWho) {
      this.bossWho = bi;
      if (bi >= 0) this.bossName.textContent = enemyDef(w.enemies.type[bi]!).name;
    }
    const bq = Math.round(bossF * 400) / 400;
    if (bq !== L.boss) {
      this.boss.classList.toggle('hidden', bossF < 0);
      if (bossF >= 0) this.bossFill.style.transform = `scaleX(${Math.max(0, bossF)})`;
      L.boss = bq;
    }
    // upgrade picker
    let offer = 0;
    if (W.phase === WavePhase.Upgrade) for (let k = 0; k < W.offerCount; k++) offer = offer * 64 + W.offer[k]! + 1;
    offer = offer > 0 ? offer + W.index * 1e7 : 0;
    if (offer !== L.offer) {
      this.upgrade.classList.toggle('hidden', !offer);
      if (offer) {
        const ups = $('.ups', this.upgrade);
        ups.innerHTML = '';
        for (let k = 0; k < W.offerCount; k++) {
          const u = UPGRADES[W.offer[k]!]!;
          const b = document.createElement('button');
          b.className = `k-card up r${u.rarity}`;
          b.style.setProperty('--ac', hexCss(RARITY_HEX[u.rarity]!));
          b.innerHTML = `<em>${RARITY_NAMES[u.rarity]}${u.weapon >= 0 ? ' · оружие' : ''}</em><h3>${u.name}</h3><p>${u.desc}</p><footer class="key">[ ${k + 1} ]</footer>`;
          b.onclick = () => this.onPick?.(k + 1);
          ups.appendChild(b);
        }
      }
      L.offer = offer;
    }
    this.updateLog(dt, w.seed);
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.innerHTML = '';
    }
  }

  /** combo is presentation-only (from the FX director) */
  setCombo(n: number, left01: number, tier: number): void {
    if (n !== this.lastCombo) {
      const show = n >= 3;
      this.comboEl.classList.toggle('hidden', !show);
      if (show) {
        this.comboNum.textContent = `×${n}`;
        this.comboEl.classList.remove('bump');
        void this.comboEl.offsetWidth; // restart CSS animation
        this.comboEl.classList.add('bump');
      }
      this.lastCombo = n;
    }
    if (tier !== this.lastTier) {
      this.comboEl.dataset['tier'] = String(tier);
      this.lastTier = tier;
    }
    if (n >= 3) this.comboBar.style.transform = `scaleX(${Math.max(0, left01).toFixed(3)})`;
  }

  /** terminal log of the archive, typed out during an act transition */
  startLog(act: number): void {
    this.startLines(LORE[act] ?? [], 10.5);
  }

  private logEnd = 10.5;
  private startLines(lines: readonly (readonly [number, string])[], end: number): void {
    this.logLines = lines;
    this.logEnd = end;
    this.logT = 0;
    this.logShown = '';
    this.log.classList.remove('hidden', 'out');
  }

  private updateLog(dt: number, seed: number): void {
    if (this.logT < 0) return;
    this.logT += dt;
    const CPS = 46; // characters per second
    let out = '';
    for (const [at, text0] of this.logLines) {
      if (this.logT < at) break;
      const text = text0.replace('{seed}', String(seed));
      const n = Math.min(text.length, Math.floor((this.logT - at) * CPS));
      out += text.slice(0, n) + (n < text.length ? '█' : '') + '\n';
    }
    if (out !== this.logShown) {
      this.log.textContent = out;
      this.logShown = out;
    }
    if (this.logT > this.logEnd - 1) this.log.classList.add('out');
    if (this.logT > this.logEnd) {
      this.log.classList.add('hidden');
      this.logT = -1;
    }
  }

  reset(): void {
    this.logT = -1;
    this.logFor = -1;
    this.log.classList.add('hidden');
    this.bossWho = -2;
    this.last = { hp: -1, max: -1, dash: -1, wave: -1, score: -1, mut: -1, slots: -1, boss: -1, offer: -1 };
    this.banner.innerHTML = '';
    this.bannerT = 0;
  }
}
