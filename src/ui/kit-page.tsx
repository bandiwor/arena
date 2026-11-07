import { useSignal } from '@preact/signals';
import type { ComponentChildren, JSX } from 'preact';
import { PageNav } from '../app/nav';
import { DIFFICULTIES } from '../sim/content/difficulty';
import { Icon, ICONS, type IconName } from './icons';
import { Badge, Button, Card, IconButton, Kbd, Panel, Progress, Row, Section, Segmented, Slider, Tabs, TextField, Toggle } from './kit';

/** #/kit — every component in every state, live-wired, plus the icon set. */
const RAR = ['#2ef2ff', '#5cff9b', '#b36bff', '#ffb02e'];
const DIFF = DIFFICULTIES.map((d) => d.color);
type Group = 'all' | 'ctl' | 'cards' | 'icons';
/** top-level (never define components inside render: they would remount on every change) */
function Cell({ on, wide, children }: { on: boolean; wide?: boolean; children: ComponentChildren }): JSX.Element | null {
  return on ? <Panel class={`kit-cell${wide ? ' wide' : ''}`}>{children}</Panel> : null;
}
const Code = ({ children }: { children: string }): JSX.Element => <code class="kit-code">{children}</code>;

export default function KitPage(): JSX.Element {
  const tab = useSignal<Group>('all');
  const log = useSignal<string[]>([]);
  const say = (s: string): void => void (log.value = [s, ...log.value].slice(0, 8));
  const v = {
    t1: useSignal(true),
    t2: useSignal(false),
    t3: useSignal(true),
    s1: useSignal(0.6),
    s2: useSignal(1.2),
    s3: useSignal(0.03),
    seg1: useSignal(0.75),
    seg2: useSignal(1),
    seed: useSignal('211513'),
    w: useSignal(1),
    i: useSignal(1),
    card: useSignal(2),
    ico: useSignal<string>('cyan'),
  };
  const show = (g: Group): boolean => tab.value === 'all' || tab.value === g;
  const btn = (label: string) => (): void => say(`action  ${label}`);
  return (
    <>
      <PageNav />
      <header class="kit-head">
        <h1 class="title">
          UI<span>//</span>KIT
        </h1>
        <div class="sub">NULL//ARENA · компоненты интерфейса · src/ui/kit.tsx + icons.tsx + kit.css</div>
        <Tabs<Group>
          items={[
            { id: 'all', label: 'Все', icon: 'grid' },
            { id: 'ctl', label: 'Контролы', icon: 'joystick' },
            { id: 'cards', label: 'Карточки', icon: 'copy' },
            { id: 'icons', label: 'Иконки', icon: 'star' },
          ]}
          active={tab.value}
          onChange={(t) => {
            tab.value = t;
            say(`tab     ${t}`);
          }}
        />
      </header>
      <main class="kit-grid">
        <Cell on={show('icons')} wide>
          <Section title={`Иконки · ${Object.keys(ICONS).length}`} note="24-сетка, квадратные концы, срезанные углы, «пиксели»-акценты; цвет = currentColor">
            <div class="kit-row">
              <Segmented
                value={v.ico.value}
                options={[
                  { value: 'cyan', label: 'Циан', accent: '#2ef2ff' },
                  { value: 'magenta', label: 'Маджента', accent: '#ff2d7a' },
                  { value: 'amber', label: 'Янтарь', accent: '#ffa126' },
                  { value: 'ink', label: 'Текст', accent: '#cfd3ff' },
                ]}
                onChange={(c) => (v.ico.value = c)}
              />
            </div>
            <div class={`kit-icons ic-${v.ico.value}`}>
              {(Object.keys(ICONS) as IconName[]).map((n) => (
                <button key={n} title={`<Icon name="${n}" />`} onClick={() => say(`icon    ${n}`)}>
                  <Icon name={n} />
                  <span>{n}</span>
                </button>
              ))}
            </div>
            <Code>{`<Icon name="gear" />   ·   iconHtml('swap') для DOM-кода (HUD, тач)`}</Code>
          </Section>
        </Cell>
        <Cell on={show('ctl')}>
          <Section title="Кнопки">
            <div class="kit-row">
              <Button variant="primary" icon="play" onClick={btn('primary')}>
                Primary
              </Button>
              <Button onClick={btn('ghost')}>Ghost</Button>
              <Button variant="danger" icon="close" onClick={btn('danger')}>
                Danger
              </Button>
              <Button variant="link" onClick={btn('link')}>
                Link
              </Button>
              <Button disabled>Disabled</Button>
            </div>
            <div class="kit-row">
              <Button size="sm" icon="plus" onClick={btn('small')}>
                Small
              </Button>
              <Button icon="gear" onClick={btn('medium')}>
                Medium
              </Button>
              <Button size="lg" variant="primary" icon="bolt" onClick={btn('large')}>
                Large
              </Button>
              <IconButton icon="gear" label="Настройки" onClick={btn('icon gear')} />
              <IconButton icon="close" label="Закрыть" onClick={btn('icon close')} />
            </div>
            <div class="kit-row">
              {RAR.map((c, i) => (
                <Button key={c} accent={c} icon={(['bolt', 'spark', 'star', 'trophy'] as const)[i]} onClick={btn(`rarity ${i}`)}>
                  {['Обычное', 'Редкое', 'Эпик', 'Легенда'][i]}
                </Button>
              ))}
            </div>
            <div class="stack" style="width:260px">
              <Button variant="primary" wide icon="play" accent={DIFF[1]} onClick={btn('В бой')}>
                Wide · В бой
              </Button>
              <Button wide icon="gear" onClick={btn('Настройки')}>
                Wide · Настройки
              </Button>
            </div>
            <Code>{`<Button variant="primary" size="lg" icon="play" accent="#2ef2ff" onClick={start}>В бой</Button>`}</Code>
          </Section>
        </Cell>
        <Cell on={show('ctl')}>
          <Section title="Переключатели и ползунки">
            <Row label="Toggle (вкл)">
              <Toggle on={v.t1.value} onChange={(x) => (say(`change  t1 = ${x}`), (v.t1.value = x))} />
            </Row>
            <Row label="Toggle (выкл)">
              <Toggle on={v.t2.value} onChange={(x) => (say(`change  t2 = ${x}`), (v.t2.value = x))} />
            </Row>
            <Row label="Toggle с акцентом" hint="любой цвет через --ac">
              <Toggle on={v.t3.value} accent="#ffa126" onChange={(x) => (v.t3.value = x)} />
            </Row>
            <Row label="Slider">
              <Slider value={v.s1.value} min={0} max={1} step={0.05} onInput={(x) => (v.s1.value = x)} />
            </Row>
            <Row label="Slider до 150%">
              <Slider value={v.s2.value} min={0} max={1.5} step={0.05} accent="#ff2d7a" onInput={(x) => (v.s2.value = x)} />
            </Row>
            <Row label="Свой формат" hint="fmt: (v) => string">
              <Slider value={v.s3.value} min={0} max={0.08} step={0.005} fmt={(x) => `${(x * 1000).toFixed(0)} мс`} onInput={(x) => (v.s3.value = x)} />
            </Row>
            <Code>{`const vol = useSignal(0.55)\n<Row label="Музыка" hint="подсказка"><Slider value={vol.value} min={0} max={1} step={0.05} onInput={(x) => vol.value = x} /></Row>`}</Code>
          </Section>
        </Cell>
        <Cell on={show('ctl')}>
          <Section title="Сегменты, поле, клавиши">
            <Row label="Segmented">
              <Segmented value={v.seg1.value} options={[0.5, 0.75, 1].map((x) => ({ value: x, label: `${x * 100}%` }))} onChange={(x) => (v.seg1.value = x)} />
            </Row>
            <Row label="Цветные сегменты">
              <Segmented value={v.seg2.value} options={DIFFICULTIES.map((d, i) => ({ value: i, label: d.name, accent: DIFF[i] }))} onChange={(x) => (v.seg2.value = x)} />
            </Row>
            <Row label="Текстовое поле">
              <TextField value={v.seed.value} placeholder="seed" onInput={(x) => (v.seed.value = x)} />
            </Row>
            <Row label="Клавиши">
              <span>
                <Kbd>W</Kbd>
                <Kbd>A</Kbd>
                <Kbd>S</Kbd>
                <Kbd>D</Kbd> <Kbd>SPACE</Kbd> <Kbd>ESC</Kbd>
              </span>
            </Row>
            <Row label="Бейджи">
              <span>
                <Badge>новое</Badge> <Badge accent={RAR[2]}>эпик</Badge> <Badge accent={RAR[3]}>легенда</Badge>
              </span>
            </Row>
            <Row label="Прогресс">
              <div style="width:100%">
                <Progress value={v.s1.value} />
                <br />
                <Progress value={0.3} accent="#ff2d7a" />
              </div>
            </Row>
          </Section>
        </Cell>
        <Cell on={show('cards')} wide>
          <Section title="Карточки">
            <div class="kit-cards">
              {[
                { title: 'Перегретое ядро', body: '+20% урона', tag: 'обычное' },
                { title: 'Рикошет', body: 'Снаряды отскакивают от стен +1 раз', tag: 'редкое' },
                { title: 'Дуговой рельс', body: 'ЭПИК: луч пробивает 3 цели и замыкает машины', tag: 'эпик · оружие' },
                { title: 'Сингулярность', body: 'ЛЕГЕНДА: чёрная дыра, затягивает и схлопывается', tag: 'легенда', footer: '[ 4 ]' },
              ].map((c, i) => (
                <Card key={c.title} {...c} accent={RAR[i]!} selected={v.card.value === i} onClick={() => (say(`card    ${c.title}`), (v.card.value = i))} />
              ))}
            </div>
            <p class="kit-note">Цвет карточки виден всегда: полоса слева, заголовок, подложка. Выбор добавляет рамку и ромб — на тач-экране нет hover, поэтому ничего не прячется за наведением.</p>
            <Code>{`<Card title body tag accent="#b36bff" selected={sel.value === i} onClick={() => sel.value = i} />`}</Code>
          </Section>
        </Cell>
        <Cell on={show('ctl')}>
          <Section title="Секции и строки настроек">
            <Section title="Микшер эффектов" note="до 150%">
              <Row label="Оружие" hint="выстрелы, гильзы, рывок">
                <Slider value={v.w.value} min={0} max={1.5} step={0.05} onInput={(x) => (v.w.value = x)} />
              </Row>
              <Row label="Попадания">
                <Slider value={v.i.value} min={0} max={1.5} step={0.05} onInput={(x) => (v.i.value = x)} />
              </Row>
            </Section>
            <Code>{`<Section title="Микшер" note="заметка"><Row …/><Row …/></Section>`}</Code>
          </Section>
        </Cell>
        <Cell on={show('ctl')}>
          <Section title="Сигналы → события">
            <pre class="kit-log">{log.value.length ? log.value.join('\n') : 'события появятся здесь'}</pre>
            <Code>{`Компонент читает signal.value → перерисовывается только он`}</Code>
          </Section>
        </Cell>
      </main>
    </>
  );
}
