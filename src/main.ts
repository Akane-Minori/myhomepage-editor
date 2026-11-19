import './style.css';
import { pickRoot, getRoot, onRootChange, setStatus } from './fs';
import type { Tab } from './types';
import { diaryTab } from './diary';
import { gamesTab } from './games';
import { worksTab } from './works';
import { titleTab } from './title';
import { transitionTab } from './transition';

// 移植が済んだタブから、ここに足していく
function placeholder(id: string, label: string): Tab {
  return {
    id, label,
    mount(el) { el.innerHTML = `<div class="placeholder">${label}(これから移植します)</div>`; },
    onRoot() {},
  };
}

const tabs: Tab[] = [
  worksTab,
  gamesTab,
  placeholder('illusts', 'イラスト'),
  diaryTab,
  titleTab,
  placeholder('logo', 'ロゴアニメ'),
  transitionTab,
];

const nav = document.getElementById('tabs')!;
const panels = document.getElementById('panels')!;
const buttons = new Map<string, HTMLButtonElement>();
const panelEls = new Map<string, HTMLElement>();

function show(id: string) {
  buttons.forEach((b, k) => b.classList.toggle('on', k === id));
  panelEls.forEach((p, k) => p.classList.toggle('on', k === id));
  localStorage.setItem('lastTab', id);
  window.dispatchEvent(new Event('resize'));   // 表示されたタブが、大きさを測り直せるように
}

for (const t of tabs) {
  const b = document.createElement('button');
  b.textContent = t.label;
  b.onclick = () => show(t.id);
  nav.append(b);
  buttons.set(t.id, b);

  const p = document.createElement('section');
  p.className = 'tab';
  panels.append(p);
  panelEls.set(t.id, p);
  t.mount(p);
}

show(localStorage.getItem('lastTab') ?? tabs[0].id);

document.getElementById('pick')!.onclick = () => { void pickRoot(); };
onRootChange(async () => {
  document.getElementById('root')!.textContent = getRoot() ?? '';
  for (const t of tabs) {
    try { await t.onRoot(); } catch (e) { setStatus(`${t.label}: 読み込み失敗 (${String((e as Error)?.message ?? e)})`); }
  }
});

