import './style.css';
import './kit.css';
import { badge, bindKit, button, card, iconButton, kbd, panel, progress, row, section, segmented, slider, tabs, textField, toggle } from './kit';

/** UI kit showcase: every component in every state, live-wired (open /kit.html). */
const RAR = ['#2ef2ff', '#5cff9b', '#b36bff', '#ffb02e'];
const DIFF = ['#5cff9b', '#2ef2ff', '#ffa126', '#ff2d7a'];
const root = document.getElementById('kit')!;
const code = (s: string): string => `<code class="kit-code">${s.replace(/</g, '&lt;')}</code>`;

root.innerHTML = `
<header class="kit-head"><h1 class="title">UI<span>//</span>KIT</h1><div class="sub">NULL//ARENA · компоненты интерфейса · src/ui/kit.ts + kit.css</div>
${tabs([{ id: 'all', label: 'Все', icon: '◆' }, { id: 'ctl', label: 'Контролы', icon: '◎' }, { id: 'cards', label: 'Карточки', icon: '▣' }], 'all')}</header>
<main class="kit-grid">
${panel(section('Кнопки', `<div class="kit-row">${button('Primary', { variant: 'primary', icon: '▶' })}${button('Ghost')}${button('Danger', { variant: 'danger', icon: '✕' })}${button('Link', { variant: 'link' })}${button('Disabled', { disabled: true })}</div>
<div class="kit-row">${button('Small', { size: 'sm' })}${button('Medium')}${button('Large', { size: 'lg', variant: 'primary' })}${iconButton('⚙', 'x', 'Настройки')}${iconButton('✕', 'x', 'Закрыть')}</div>
<div class="kit-row">${RAR.map((c, i) => button(['Обычное', 'Редкое', 'Эпик', 'Легенда'][i]!, { accent: c })).join('')}</div>
<div class="stack" style="width:260px">${button('Wide · В бой', { variant: 'primary', wide: true, icon: '▶', accent: DIFF[1] })}${button('Wide · Настройки', { wide: true, icon: '⚙' })}</div>
${code("button('В бой', { variant: 'primary', size: 'lg', action: 'start', icon: '▶', accent: '#2ef2ff' })")}`), 'kit-cell')}
${panel(section('Переключатели и ползунки', row('Toggle (вкл)', toggle('t1', true)) + row('Toggle (выкл)', toggle('t2', false)) + row('Toggle с акцентом', toggle('t3', true, '#ffa126'), 'любой цвет через --ac') + row('Slider', slider('s1', 0.6, { min: 0, max: 1, step: 0.05 })) + row('Slider до 150%', slider('s2', 1.2, { min: 0, max: 1.5, step: 0.05, accent: '#ff2d7a' })) + row('Свой формат', slider('s3', 0.03, { min: 0, max: 0.08, step: 0.005, fmt: (v) => `${(v * 1000).toFixed(0)} мс` }), 'fmt: (v) => string') + code("row('Музыка', slider('music', 0.55, { min: 0, max: 1, step: 0.05 }), 'подсказка')")), 'kit-cell')}
${panel(section('Сегменты, поле, клавиши', row('Segmented', segmented('seg1', 0.75, [{ value: 0.5, label: '50%' }, { value: 0.75, label: '75%' }, { value: 1, label: '100%' }])) + row('Цветные сегменты', segmented('seg2', 1, ['Сигнал', 'Шум', 'Помехи', 'NULL'].map((l, i) => ({ value: i, label: l, accent: DIFF[i] })))) + row('Текстовое поле', textField('seed', '211513', 'seed')) + row('Клавиши', `${kbd('W')}${kbd('A')}${kbd('S')}${kbd('D')} ${kbd('SPACE')} ${kbd('ESC')}`) + row('Бейджи', `${badge('новое')} ${badge('эпик', RAR[2])} ${badge('легенда', RAR[3])}`) + row('Прогресс', `<div style="width:100%">${progress(0.62)}<br>${progress(0.3, '#ff2d7a')}</div>`)), 'kit-cell')}
${panel(section('Карточки', `<div class="kit-cards">${card({ title: 'Перегретое ядро', body: '+20% урона', tag: 'обычное', accent: RAR[0]! })}${card({ title: 'Рикошет', body: 'Снаряды отскакивают от стен +1 раз', tag: 'редкое', accent: RAR[1]! })}${card({ title: 'Дуговой рельс', body: 'ЭПИК: луч пробивает 3 цели и замыкает машины', tag: 'эпик · оружие', accent: RAR[2]!, selected: true })}${card({ title: 'Сингулярность', body: 'ЛЕГЕНДА: чёрная дыра, затягивает и схлопывается', tag: 'легенда', accent: RAR[3]!, footer: '[ 3 ]' })}</div>
<p class="kit-note">Цвет карточки виден всегда: полоса слева, заголовок, подложка. Выбор добавляет рамку и ◆ — на тач-экране нет hover, поэтому ничего не прячется за наведением.</p>
${code("card({ title, body, tag, accent: '#b36bff', selected: true, data: { d: 2 } })")}`), 'kit-cell wide g-cards')}
${panel(section('Секции и строки настроек', section('Микшер эффектов', row('Оружие', slider('w', 1, { min: 0, max: 1.5, step: 0.05 }), 'выстрелы, гильзы, рывок') + row('Попадания', slider('i', 1, { min: 0, max: 1.5, step: 0.05 })), 'до 150%') + code("section('Микшер', row(...) + row(...), 'заметка')")), 'kit-cell')}
${panel(section('Связывание', `<pre class="kit-log">события появятся здесь</pre>${code('bindKit(root, { onChange(key, value), onAction(id), onTab(id) })')}`), 'kit-cell')}
</main>`;

const log = root.querySelector<HTMLElement>('.kit-log')!;
const lines: string[] = [];
const say = (s: string): void => {
  lines.unshift(s);
  log.textContent = lines.slice(0, 8).join('\n');
};
bindKit(root, {
  onChange: (k, v) => say(`change  ${k} = ${typeof v === 'number' ? +v.toFixed(3) : v}`),
  onAction: (a) => say(`action  ${a}`),
  onTab: (t) => {
    say(`tab     ${t}`);
    root.querySelectorAll<HTMLElement>('.kit-cell').forEach((c) => c.classList.toggle('hidden', t !== 'all' && (t === 'cards') !== c.classList.contains('g-cards')));
  },
});
root.addEventListener('click', (e) => {
  const c = (e.target as HTMLElement).closest<HTMLElement>('.k-card');
  if (!c) return;
  c.parentElement!.querySelectorAll('.k-card').forEach((x) => x.classList.toggle('sel', x === c));
  say(`card    ${c.querySelector('h3')!.textContent}`);
});
