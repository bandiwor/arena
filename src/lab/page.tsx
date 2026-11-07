import './lab.css';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { PageNav } from '../app/nav';
import { paramsFor } from '../render/models/defs';
import * as L from './core';

/**
 * #/lab — the asset lab. The engine (./core) owns its canvas and renderer and is created once;
 * this page mounts the canvas, starts/stops the loop and draws the two side panels.
 */
export default function LabPage(): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current!.prepend(L.canvas);
    L.start();
    return () => {
      L.stop();
      L.canvas.remove();
    };
  }, []);
  return (
    <div class="lab" ref={host} onClick={L.unlockAudio}>
      <PageNav />
      <div class="lab-ui">
        <Left />
        <Right />
      </div>
    </div>
  );
}

function Btns({ title, items, on, onPick }: { title?: string; items: readonly string[]; on?: (k: string) => boolean; onPick: (k: string) => void }): JSX.Element {
  return (
    <div>
      {title && <h2>{title}</h2>}
      <div class="lab-btns">
        {items.map((k) => (
          <button key={k} class={on?.(k) ? 'on' : ''} onClick={() => onPick(k)}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

function Param({ label, min, max, step, value, onInput }: { label: string; min: number; max: number; step: number; value: number; onInput: (v: number) => void }): JSX.Element {
  // uncontrolled: the engine owns the value, the readout follows the thumb
  const out = useRef<HTMLOutputElement>(null);
  return (
    <label class="lab-param">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        defaultValue={String(value)}
        onInput={(e) => {
          const v = parseFloat(e.currentTarget.value);
          if (out.current) out.current.textContent = String(v);
          onInput(v);
        }}
      />
      <output ref={out}>{value}</output>
    </label>
  );
}

function Left(): JSX.Element {
  const u = L.ui;
  const fx = L.FX_KEYS();
  return (
    <div class="lab-side">
      <h1>
        NULL<span>//</span>LAB
      </h1>
      <div class="lab-info">процедурные ассеты · тот же рендер, что в игре</div>
      <Btns title="Модели" items={L.MODELS.map((m) => m.key)} on={(k) => k === u.model.value} onPick={(k) => L.api.model(k)} />
      <Btns title="Состояние" items={Object.keys(L.STATES)} on={(k) => L.STATES[k] === u.state.value} onPick={L.setState} />
      <Btns title="Действия" items={['hit-flash', 'death', 'elite', 'turntable', 'respawn-loop']} on={(k) => (k === 'elite' ? u.elite.value : k === 'turntable' ? u.spin.value : k === 'respawn-loop' ? u.spawnLoop.value : false)} onPick={L.action} />
      <div>
        <h2>Анимация</h2>
        <Param label="charge" min={0} max={1} step={0.01} value={0} onInput={(v) => L.setAnim('charge', v)} />
        <Param label="walk speed" min={0} max={1} step={0.01} value={0} onInput={(v) => L.setAnim('speed', v)} />
      </div>
      <Btns title="Камера" items={['iso', 'game', 'top', 'front', 'close']} onPick={L.camPreset} />
      <Btns title="FX" items={fx} onPick={L.runFx} />
      <Btns title="FX loop" items={['off', ...fx.filter((k) => !k.startsWith('decal'))]} on={(k) => (k === 'off' ? !u.loopFx.value : u.loopFx.value === k)} onPick={L.setLoopFx} />
      <Btns title="Звуки" items={[...L.SFX]} onPick={L.playSound} />
      <Btns title="Мутатор (пол)" items={['none', ...L.MUTATORS.map((m) => m.key)]} onPick={L.setMutatorKey} />
    </div>
  );
}

function Right(): JSX.Element {
  const u = L.ui;
  const cur = L.currentModel();
  const rev = u.paramsRev.value; // remount the sliders on model change / reset
  const p = paramsFor(cur);
  const S = L.post();
  return (
    <div class="lab-side right">
      <div key={`${cur.key}:${rev}`}>
        <h2>Параметры: {cur.name}</h2>
        {Object.entries(cur.params).map(([k, spec]) => (
          <Param key={k} label={k} min={spec.min} max={spec.max} step={spec.step} value={p[k] ?? spec.value} onInput={(v) => L.setParam(k, v)} />
        ))}
        <div class="lab-btns" style="margin-top:8px">
          <button onClick={L.copyParams}>copy params JSON</button>
          <button onClick={L.resetParams}>reset</button>
        </div>
      </div>
      <div>
        <h2>Пост-обработка</h2>
        <Param label="bloom" min={0} max={3} step={0.05} value={S.bloom} onInput={(v) => L.setPost('bloom', v)} />
        <Param label="threshold" min={0} max={3} step={0.05} value={S.threshold} onInput={(v) => L.setPost('threshold', v)} />
        <Param label="exposure" min={0.2} max={3} step={0.05} value={S.exposure} onInput={(v) => L.setPost('exposure', v)} />
        <Param label="scanlines" min={0} max={0.2} step={0.005} value={S.scan} onInput={(v) => L.setPost('scan', v)} />
        <Param label="grain" min={0} max={0.15} step={0.005} value={S.grain} onInput={(v) => L.setPost('grain', v)} />
        <Param label="vignette" min={0} max={1.5} step={0.05} value={S.vignette} onInput={(v) => L.setPost('vignette', v)} />
        <Param label="glitch" min={0} max={1.5} step={0.05} value={0} onInput={L.setGlitch} />
        <Param label="corruption" min={0} max={1} step={0.05} value={0} onInput={L.setCorruption} />
        <Btns items={['post on/off', 'shake', 'chroma', 'flash']} on={(k) => k === 'post on/off' && !u.postOn.value} onPick={L.postAction} />
      </div>
      <div class="lab-info">
        <h2>Инфо</h2>
        <b>{cur.name}</b>
        {'\n'}
        {u.info.value}
      </div>
    </div>
  );
}
