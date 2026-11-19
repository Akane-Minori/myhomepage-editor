import * as fs from './fs';
import type { Tab } from './types';
import { Undo, round1, imgInfo, isActive } from './util';

interface Part { name: string; w: number; h: number; x: number; y: number; rotate: number }
interface Saved { x: number; y: number; w?: number; h?: number; z?: number; rotate?: number }
interface PosFile { canvas?: [number, number]; parts?: Record<string, Saved> }
type Drag =
  | { kind: 'move'; p: Part; sx: number; sy: number; ox: number; oy: number; pushed: boolean }
  | { kind: 'rot'; p: Part; pushed: boolean };

const W = 1920, H = 1080;
const DIR = 'img/title/';
const FILE = DIR + 'positions.json';

let root!: HTMLElement;
let parts: Part[] = [];          // 配列の後ろほど前面
let sel: Part | null = null;
let scale = 0.5;
let drag: Drag | null = null;
let lastKey = 0;
const undo = new Undo();
const els = new Map<string, HTMLImageElement>();

const q = <T extends Element>(s: string) => root.querySelector<T>(s)!;
const stage = () => q<HTMLElement>('.tstage');

// ---- 元に戻す ----
const snapshot = () => JSON.stringify({ parts: parts.map(p => ({ name: p.name, x: p.x, y: p.y, rotate: p.rotate })), sel: sel?.name ?? null });
const push = () => undo.push(snapshot());
function doUndo() {
  const s = undo.pop();
  if (!s) return;
  const o = JSON.parse(s) as { parts: { name: string; x: number; y: number; rotate: number }[]; sel: string | null };
  const byName = new Map(parts.map(p => [p.name, p]));
  parts = o.parts.flatMap(v => {
    const p = byName.get(v.name);
    if (!p) return [];
    p.x = v.x; p.y = v.y; p.rotate = v.rotate;
    return [p];
  });
  sel = parts.find(p => p.name === o.sel) ?? null;
  render();
}

// ---- 描画 ----
function place(p: Part) {
  const e = els.get(p.name);
  if (e) Object.assign(e.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px', rotate: p.rotate + 'deg' });
}

function placeHandle() {
  const h = q<HTMLElement>('.thandle');
  if (!sel || !q<HTMLInputElement>('.guides').checked) { h.style.display = 'none'; return; }
  const cx = sel.x + sel.w / 2, cy = sel.y + sel.h / 2, a = sel.rotate * Math.PI / 180;
  const r = Math.hypot(sel.w, sel.h) / 2 + 40 / scale, s = 26 / scale;
  Object.assign(h.style, { display: 'block', width: s + 'px', height: s + 'px', left: cx + Math.sin(a) * r - s / 2 + 'px', top: cy - Math.cos(a) * r - s / 2 + 'px' });
}

function fillSide() {
  q<HTMLFieldSetElement>('.tfields').disabled = !sel;
  q<HTMLInputElement>('.px').value = sel ? String(sel.x) : '';
  q<HTMLInputElement>('.py').value = sel ? String(sel.y) : '';
  q<HTMLInputElement>('.pr').value = sel ? String(sel.rotate) : '';
}

function renderList() {
  q('.tlist').replaceChildren(...parts.slice().reverse().map(p => {
    const b = document.createElement('button');
    b.className = 'item' + (p === sel ? ' now' : '');
    b.innerHTML = '<span></span>';
    b.firstElementChild!.textContent = p.name;
    b.onclick = () => select(p);
    return b;
  }));
}

function fit() {
  const area = q<HTMLElement>('.stage');
  scale = Math.max(0.1, Math.min((area.clientWidth - 40) / W, (area.clientHeight - 40) / H));
  const wrap = q<HTMLElement>('.twrap');
  wrap.style.width = W * scale + 'px';
  wrap.style.height = H * scale + 'px';
  stage().style.transform = `scale(${scale})`;
}

function render() {
  fit();
  els.clear();
  q('.timgs').replaceChildren(...parts.map((p, i) => {
    const e = document.createElement('img');
    e.dataset.name = p.name;
    e.style.zIndex = String(i);
    e.classList.toggle('sel', p === sel);
    const info = imgInfo(DIR + p.name, render);
    if (info) { p.w = info.w; p.h = info.h; e.src = info.url; }
    els.set(p.name, e);
    place(p);
    return e;
  }));
  q('.tempty').toggleAttribute('hidden', parts.length > 0);
  renderList(); fillSide(); placeHandle();
}

function markSel() {
  els.forEach((e, name) => e.classList.toggle('sel', name === sel?.name));
  renderList(); fillSide(); placeHandle();
}

function select(p: Part | null) { sel = p; markSel(); }

// ---- 操作 ----
function moveZ(d: number) {
  if (!sel) return;
  const i = parts.indexOf(sel), j = i + d;
  if (j < 0 || j >= parts.length) return;
  push();
  [parts[i], parts[j]] = [parts[j], parts[i]];
  render();
}

function onDown(e: PointerEvent) {
  if (e.button !== 0) return;
  (document.activeElement as HTMLElement | null)?.blur();
  const t = e.target as HTMLElement;
  const st = stage();
  if (t.classList.contains('thandle') && sel) {
    drag = { kind: 'rot', p: sel, pushed: false };
    st.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  const name = t.closest<HTMLElement>('img[data-name]')?.dataset.name;
  const p = parts.find(v => v.name === name);
  if (!p) return;
  if (p !== sel) select(p);
  drag = { kind: 'move', p, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, pushed: false };
  st.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onMove(e: PointerEvent) {
  if (!drag) return;
  if (!drag.pushed) { push(); drag.pushed = true; }
  const p = drag.p;
  if (drag.kind === 'move') {
    p.x = Math.round(drag.ox + (e.clientX - drag.sx) / scale);
    p.y = Math.round(drag.oy + (e.clientY - drag.sy) / scale);
    if (q<HTMLInputElement>('.snap').checked) {
      if (Math.abs(p.x + p.w / 2 - W / 2) < 12) p.x = Math.round(W / 2 - p.w / 2);
      if (Math.abs(p.y + p.h / 2 - H / 2) < 12) p.y = Math.round(H / 2 - p.h / 2);
    }
  } else {
    const b = stage().getBoundingClientRect();
    const mx = (e.clientX - b.left) / scale, my = (e.clientY - b.top) / scale;
    let deg = Math.atan2(mx - (p.x + p.w / 2), -(my - (p.y + p.h / 2))) * 180 / Math.PI;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    p.rotate = round1(deg);
  }
  place(p); fillSide(); placeHandle();
}

function onUp() { drag = null; }

function onKey(e: KeyboardEvent) {
  if (!isActive(root)) return;
  const tag = (e.target as HTMLElement).tagName;
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void save(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') { e.preventDefault(); doUndo(); return; }
  if (!sel || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const s = e.shiftKey ? 10 : 1;
  const d: Record<string, [number, number]> = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] };
  const rot = e.key === '[' ? -s : e.key === ']' ? s : 0;
  if (!d[e.key] && !rot) return;
  e.preventDefault();
  if (e.timeStamp - lastKey > 500) push();
  lastKey = e.timeStamp;
  if (rot) sel.rotate += rot; else { sel.x += d[e.key][0]; sel.y += d[e.key][1]; }
  place(sel); fillSide(); placeHandle();
}

function onSideInput(e: Event) {
  const t = e.target as HTMLInputElement;
  if (!sel) return;
  const v = parseFloat(t.value);
  if (isNaN(v)) return;
  if (e.timeStamp - lastKey > 500) push();
  lastKey = e.timeStamp;
  if (t.classList.contains('px')) sel.x = v;
  else if (t.classList.contains('py')) sel.y = v;
  else if (t.classList.contains('pr')) sel.rotate = v;
  else return;
  place(sel); placeHandle();
}

function onSideClick(e: Event) {
  const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
  if (a === 'save') void save();
  else if (a === 'r0') { if (sel) { push(); sel.rotate = 0; place(sel); fillSide(); placeHandle(); } }
  else if (a === 'up') moveZ(1);
  else if (a === 'down') moveZ(-1);
}

function onSideChange(e: Event) {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  const st = stage();
  if (t.classList.contains('bg')) {
    st.classList.toggle('checker', t.value === 'checker');
    st.style.background = t.value === 'checker' ? '' : t.value;
  } else if (t.classList.contains('guides')) {
    st.classList.toggle('guides', (t as HTMLInputElement).checked);
    placeHandle();
  }
}

// ---- 保存と読み込み ----
async function save() {
  if (!fs.getRoot()) { alert('先にサイトのフォルダを選んでください'); return; }
  const out: { canvas: [number, number]; parts: Record<string, Saved> } = { canvas: [W, H], parts: {} };
  parts.forEach((p, i) => { out.parts[p.name] = { x: p.x, y: p.y, w: p.w, h: p.h, z: i, rotate: p.rotate }; });
  try { await fs.writeJson(FILE, out); fs.setStatus('タイトル配置を保存しました'); }
  catch (e) { alert('保存できませんでした: ' + String((e as Error)?.message ?? e)); }
}

export const titleTab: Tab = {
  id: 'title',
  label: 'タイトル配置',

  mount(el) {
    root = el;
    el.innerHTML = `
    <div class="ed">
      <aside class="side">
        <div class="row"><button class="btn btn--primary" data-a="save">保存 (Ctrl+S)</button></div>
        <h3>表示</h3>
        <div class="form">
          <label>背景<select class="bg"><option value="#ffffff">白</option><option value="#222222">黒</option><option value="#8fb4d9">青</option><option value="checker">市松</option></select></label>
          <label class="chk"><input type="checkbox" class="guides" checked> 枠と中央線を表示</label>
          <label class="chk"><input type="checkbox" class="snap"> 中央にスナップ</label>
        </div>
        <h3>パーツ(上ほど前面)</h3>
        <div class="list tlist"></div>
        <fieldset class="form tfields" disabled>
          <div class="nums">x <input type="number" class="px"> y <input type="number" class="py"></div>
          <div class="nums">回転 <input type="number" class="pr" step="1"> ° <button class="btn btn--sm" data-a="r0">0°</button></div>
          <div class="row"><button class="btn btn--sm" data-a="up">前面へ</button><button class="btn btn--sm" data-a="down">背面へ</button></div>
        </fieldset>
        <h3>操作</h3>
        <p class="hint">ドラッグで移動。矢印キーで移動(Shift で10px)<br>
          [ ] で回転。オレンジの丸のドラッグでも回転(Shift で15°刻み)<br>
          Ctrl+Z: 元に戻す<br>
          img/title/ の画像を自動で並べます。位置は img/title/positions.json に保存されます</p>
      </aside>
      <div class="stage stage--center">
        <div class="twrap">
          <div class="tstage guides" style="background:#ffffff">
            <div class="timgs"></div>
            <div class="tcross tvx"></div><div class="tcross tvy"></div>
            <div class="thandle"></div>
          </div>
          <div class="tempty" hidden>img/title/ に画像がありません</div>
        </div>
      </div>
    </div>`;

    const side = q<HTMLElement>('.side');
    side.addEventListener('click', onSideClick);
    side.addEventListener('input', onSideInput);
    side.addEventListener('change', onSideChange);

    const st = stage();
    st.addEventListener('pointerdown', onDown);
    st.addEventListener('pointermove', onMove);
    st.addEventListener('pointerup', onUp);
    st.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', () => { if (isActive(root)) { fit(); placeHandle(); } });
    window.addEventListener('keydown', onKey);
    render();
  },

  async onRoot() {
    const names = (await fs.listNames(DIR)).filter(n => /\.(png|webp|jpe?g|gif)$/i.test(n)).sort((a, b) => a.localeCompare(b));
    const f = await fs.readJson<PosFile | null>(FILE, null);
    const saved = f?.parts ?? {};
    parts = names.map((name, i) => {
      const s = saved[name];
      return {
        p: { name, w: s?.w ?? 0, h: s?.h ?? 0, x: s ? s.x : 40 + (i % 6) * 300, y: s ? s.y : 40 + Math.floor(i / 6) * 260, rotate: s?.rotate ?? 0 } as Part,
        z: s?.z ?? i,
      };
    }).sort((a, b) => a.z - b.z).map(o => o.p);
    sel = null;
    undo.clear();
    render();
    fs.setStatus(`タイトル配置: ${parts.length} 枚を読み込みました` + (f ? '(位置を復元)' : '(位置ファイルなし。仮の格子状に並べました)'));
  },
};

