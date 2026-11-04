import { Ev, EV_STRIDE } from '../core/events';
import { ET } from '../sim/constants';
import { MUTATORS } from '../sim/content/mutators';
import { RARITY_NAMES, weaponDef } from '../sim/content/weapons';
import { UPGRADES } from '../sim/content/upgrades';
import { WAVES } from '../sim/content/waves';
import { WavePhase, type World } from '../sim/world';
import { hexCss, RARITY_HEX } from '../render/palette';

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
  private readonly banner: HTMLElement;
  readonly upgrade: HTMLElement;
  private last = { hp: -1, max: -1, dash: -1, wave: -1, score: -1, mut: -1, slots: -1, boss: -1, offer: -1 };
  private bannerT = 0;
  onPick: ((n: number) => void) | null = null;

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'hud hidden';
    root.innerHTML = `
      <div class="hud-tl">
        <div class="hp"><b></b><i></i></div>
        <div class="hp-text"></div>
        <div class="dash">РЫВОК <span><i></i></span></div>
      </div>
      <div class="hud-tr"><div class="wave"></div><div class="score"></div><div class="mut hidden"></div></div>
      <div class="boss hidden"><div class="name">МОНОЛИТ</div><div class="bar"><i></i><div class="ticks"></div></div></div>
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
    this.boss = $('.boss', root);
    this.bossFill = $('.boss .bar > i', root);
    this.banner = $('.banner', root);
    this.upgrade = $('.upgrade', root);
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
        this.showBanner(boss ? 'МОНОЛИТ' : `ВОЛНА ${idx + 1}`, def?.name.toUpperCase() ?? '', boss ? '#9b5cff' : '#2ef2ff', 2.2);
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
    const waveKey = w.mode === 'sandbox' ? -2 : W.index * 10000 + left;
    if (waveKey !== L.wave) {
      if (w.mode === 'sandbox') this.waveEl.innerHTML = `ПЕСОЧНИЦА<small>отладка</small>`;
      else this.waveEl.innerHTML = `ВОЛНА ${W.index + 1}<small>${WAVES.length} ВСЕГО · ВРАГОВ: ${left}</small>`;
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
        h += `<div class="wslot ${i === p.cur ? 'on' : ''}" style="--rc:${hexCss(RARITY_HEX[wd.rarity]!)}"><div class="k">${i + 1} · ${RARITY_NAMES[wd.rarity]}</div><div class="n">${wd.name}</div></div>`;
      }
      this.weapons.innerHTML = h;
      L.slots = slots;
    }
    const bi = w.boss.id;
    const bossF = bi >= 0 && w.enemies.alive[bi] && w.enemies.type[bi] === ET.Boss ? w.enemies.hp[bi]! / w.enemies.maxHp[bi]! : -1;
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
          b.className = `card up r${u.rarity}`;
          b.style.setProperty('--cc', hexCss(RARITY_HEX[u.rarity]!));
          b.innerHTML = `<div class="rar">${RARITY_NAMES[u.rarity]}${u.weapon >= 0 ? ' · оружие' : ''}</div><h3>${u.name}</h3><p>${u.desc}</p><div class="key">[ ${k + 1} ]</div>`;
          b.onclick = () => this.onPick?.(k + 1);
          ups.appendChild(b);
        }
      }
      L.offer = offer;
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.innerHTML = '';
    }
  }

  reset(): void {
    this.last = { hp: -1, max: -1, dash: -1, wave: -1, score: -1, mut: -1, slots: -1, boss: -1, offer: -1 };
    this.banner.innerHTML = '';
    this.bannerT = 0;
  }
}
