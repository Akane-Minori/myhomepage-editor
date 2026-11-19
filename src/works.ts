import * as fs from './fs';
import type { Tab } from './types';
import { Undo, clamp, round4, round1, pick, svgEl, imgInfo, importImage, isActive } from './util';
import { type PageData, type Panel, type Pt, panelPoints, hasMissing, shrinkPolygon, bounds, fitImage, pointsAttr, validate } from './geometry';

interface Label { text: string; panel: string; x: number; y: number; anchor: string; size: number; rotate: number; color: string }
interface WorksFile { height?: number; gap?: number; points: Pt[]; panels: Panel[]; labels?: Partial<Label>[]; font?: string }
interface PickPt { d: number; type: 'vertex' | 'edge'; idx?: number; a?: number; b?: number; pos: Pt }
type Drag =
  | { kind: 'point'; idx: number; pushed: boolean }
  | { kind: 'focus'; p: Panel; last: Pt; pushed: boolean }
  | { kind: 'label'; i: number; group: SVGGElement; x0: number; y0: number; ox: number; oy: number; pushed: boolean };

const FONT = 'Anton';
const ANCHORS: Record<string, { h: string; v: string }> = {
  'top-left': { h: 'start', v: 'text-before-edge' }, 'top': { h: 'middle', v: 'text-before-edge' }, 'top-right': { h: 'end', v: 'text-before-edge' },
  'left': { h: 'start', v: 'middle' }, 'center': { h: 'middle', v: 'middle' }, 'right': { h: 'end', v: 'middle' },
  'bottom-left': { h: 'start', v: 'text-after-edge' }, 'bottom': { h: 'middle', v: 'text-after-edge' }, 'bottom-right': { h: 'end', v: 'text-after-edge' },
};

let root!: HTMLElement;
let data: PageData = newData();
let labels: Label[] = [];
let mode: 'panel' | 'label' = 'panel';
let selPanel: string | null = null;
let sel = -1;
let splitMode = false;
let picks: PickPt[] = [];
let drag: Drag | null = null;
let scale = 500;
let lastWheel = 0;
let lastInput = 0;
const undo = new Undo();

const q = <T extends Element>(s: string) => root.querySelector<T>(s)!;
const svg = () => q<SVGSVGElement>('.wsvg');
const panelOf = (id: string) => data.panels.find(p => p.id === id) ?? null;

function newData(): PageData {
  const h = 0.5625;
  return { height: h, gap: 0.02, points: [[0, 0], [1, 0], [1, h], [0, h]], panels: [{ id: 'p1', points: [0, 1, 2, 3] }] };
}

function normalizeLabel(s: Partial<Label>): Label {
  return {
    text: pick(s.text, 'TEXT'), panel: pick(s.panel, ''), x: pick(s.x, 0.5), y: pick(s.y, round4(data.height / 2)),
    anchor: pick(s.anchor, 'center'), size: pick(s.size, 0.1), rotate: pick(s.rotate, 0), color: pick(s.color, '#ffffff'),
  };
}

// ---- 元に戻す ----
const snapshot = () => JSON.stringify({ data, labels, selPanel, sel });
function doUndo() {
  const s = undo.pop();
  if (!s) return;
  const o = JSON.parse(s) as { data: PageData; labels: Label[]; selPanel: string | null; sel: number };
  data = o.data; labels = o.labels; selPanel = o.selPanel; sel = o.sel;
  splitMode = false; picks = [];
  renderAll();
}
const push = () => undo.push(snapshot());

// ---- 描画 ----
function renderAll() {
  applyMode(); renderList(); fillLabelFields(); fillPanelFields(); fillPageFields(); renderStage(); check();
}

function applyMode() {
  q<HTMLElement>('.pbox').hidden = mode !== 'panel';
  q<HTMLElement>('.lbox').hidden = mode !== 'label';
  root.querySelectorAll<HTMLInputElement>('input[name="wmode"]').forEach(r => { r.checked = r.value === mode; });
}

function renderList() {
  q('.llist').replaceChildren(...labels.map((l, i) => {
    const b = document.createElement('button');
    b.className = 'item' + (i === sel ? ' now' : '');
    b.dataset.index = String(i);
    b.innerHTML = '<span></span>';
    b.firstElementChild!.textContent = `${i + 1}. ${l.text}`;
    return b;
  }));
}

function fillPageFields() {
  root.querySelectorAll<HTMLInputElement>('[data-page]').forEach(i => { i.value = String(data[i.dataset.page as 'height' | 'gap']); });
}

function fillPanelFields() {
  const p = selPanel ? panelOf(selPanel) : null;
  q<HTMLFieldSetElement>('.pfields').disabled = !p;
  q('.info').textContent = p ? `選択中: ${p.id}` : 'コマをクリックして選んでください';
  root.querySelectorAll<HTMLInputElement>('[data-pk]').forEach(i => {
    const k = i.dataset.pk;
    i.value = !p ? (k === 'color' ? '#ffffff' : '') : k === 'zoom' ? String(pick(p.zoom, 1)) : k === 'color' ? (p.color || '#ffffff') : p.id;
  });
  q('.colorNote').textContent = p && !p.color ? '(なし)' : '';
  q('.imgPath').textContent = p?.img ?? '(画像なし)';
  q('[data-a="split"]').classList.toggle('on', splitMode);
}

function fillLabelFields() {
  q<HTMLFieldSetElement>('.lfields').disabled = sel < 0;
  const g = sel < 0 ? null : labels[sel];
  const select = q<HTMLSelectElement>('.panelSel');
  select.replaceChildren(new Option('(なし)', ''));
  let found = !g || g.panel === '';
  for (const p of data.panels) { select.append(new Option(p.id, p.id)); if (g && p.id === g.panel) found = true; }
  if (!found && g) select.append(new Option(`${g.panel}(存在しません)`, g.panel));
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.lfields [data-key]').forEach(t => {
    t.value = g ? String((g as unknown as Record<string, unknown>)[t.dataset.key!]) : (t.getAttribute('type') === 'color' ? '#ffffff' : '');
  });
}

function drawPanels(defs: SVGElement) {
  const s = svg();
  const edit = mode === 'panel';
  const showIds = q<HTMLInputElement>('.showIds').checked;

  data.panels.forEach((p, i) => {
    const pts = panelPoints(data, p);
    if (pts.length < 3 || hasMissing(pts)) return;
    const inner = shrinkPolygon(pts, data.gap);
    const shape = pointsAttr(inner);
    const box = bounds(inner);
    const info = p.img ? imgInfo(p.img, renderStage) : null;

    if (p.color) svgEl('polygon', { points: shape, fill: p.color }, s);
    else if (p.img && !info) svgEl('polygon', { points: shape, fill: '#999' }, s);
    else if (!p.img) svgEl('polygon', { points: shape, fill: '#aabbcc', 'fill-opacity': 0.5 }, s);

    if (p.img && info) {
      const clip = svgEl('clipPath', { id: 'clip' + i }, defs);
      svgEl('polygon', { points: shape }, clip);
      const f = fitImage(box, info.w, info.h, p.focus ?? [0.5, 0.5], pick(p.zoom, 1));
      svgEl('image', { href: info.url, x: f.x, y: f.y, width: f.w, height: f.h, 'clip-path': `url(#clip${i})`, preserveAspectRatio: 'none' }, s);
    }
    if (edit) {
      const on = p.id === selPanel;
      svgEl('polygon', { points: shape, fill: 'none', stroke: on ? '#ff8a1f' : '#ffffff', 'stroke-width': on ? 3 : 1, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, s);
    }
    if (showIds) {
      const t = svgEl('text', { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, 'font-size': 0.03, fill: '#ffffff', 'fill-opacity': 0.8, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-family': 'sans-serif', 'pointer-events': 'none' }, s);
      t.textContent = p.id;
    }
  });
}

// コマを編集するときの、クリック判定・点・分割の目印
function drawOverlay() {
  const s = svg();
  const showOrig = q<HTMLInputElement>('.showOrig').checked;
  const r = 6 / scale;
  data.panels.forEach((p, i) => {
    const pts = panelPoints(data, p);
    if (pts.length < 3 || hasMissing(pts)) return;
    const a: Record<string, string | number> = { 'data-panel': i, points: pointsAttr(pts), fill: 'transparent' };
    if (showOrig) { a.stroke = '#19c8ff'; a['stroke-dasharray'] = '4'; a['vector-effect'] = 'non-scaling-stroke'; }
    svgEl('polygon', a, s);
  });
  if (showOrig) {
    data.points.forEach((p, i) => svgEl('circle', { 'data-point': i, cx: p[0], cy: p[1], r, fill: '#19c8ff', stroke: '#000', 'vector-effect': 'non-scaling-stroke' }, s));
  }
  for (const pk of picks) svgEl('circle', { cx: pk.pos[0], cy: pk.pos[1], r: r * 1.3, fill: '#ff21ac', 'pointer-events': 'none' }, s);
}

function styleLabel(group: SVGGElement, l: Label, selected: boolean) {
  const text = group.querySelector('text') as SVGTextElement;
  const a = ANCHORS[l.anchor] ?? ANCHORS.center;
  text.setAttribute('x', String(l.x)); text.setAttribute('y', String(l.y));
  text.setAttribute('font-size', String(l.size)); text.setAttribute('fill', l.color);
  text.setAttribute('text-anchor', a.h); text.setAttribute('dominant-baseline', a.v);
  text.textContent = l.text;
  group.setAttribute('transform', `rotate(${l.rotate} ${l.x} ${l.y})`);
  const frame = group.querySelector('rect')!;
  if (selected) {
    const b = text.getBBox();
    frame.setAttribute('x', String(b.x)); frame.setAttribute('y', String(b.y));
    frame.setAttribute('width', String(b.width)); frame.setAttribute('height', String(b.height));
    frame.setAttribute('display', 'inline');
  } else frame.setAttribute('display', 'none');
}

function makeLabel(i: number) {
  const g = svgEl('g', { 'data-label': i, 'pointer-events': mode === 'label' ? 'auto' : 'none' }, svg()) as SVGGElement;
  svgEl('text', { 'font-family': `${FONT}, sans-serif`, style: 'cursor:move' }, g);
  svgEl('rect', { fill: 'none', stroke: '#ff8a1f', 'stroke-width': 0.003, 'stroke-dasharray': '0.01 0.01', 'pointer-events': 'none', display: 'none' }, g);
  styleLabel(g, labels[i], mode === 'label' && i === sel);
}

function renderStage() {
  const stage = q<HTMLElement>('.stage');
  const s = svg();
  scale = Math.max(100, Math.min(stage.clientWidth - 40, (stage.clientHeight - 40) / data.height));
  s.setAttribute('viewBox', `0 0 1 ${data.height}`);
  s.setAttribute('width', String(scale));
  s.setAttribute('height', String(scale * data.height));
  s.replaceChildren();
  const defs = svgEl('defs', {}, s);
  drawPanels(defs);
  labels.forEach((_, i) => makeLabel(i));
  if (mode === 'panel') drawOverlay();
}

function markSelected() {
  svg().querySelectorAll<SVGGElement>('g[data-label]').forEach(g => {
    const idx = Number(g.getAttribute('data-label'));
    styleLabel(g, labels[idx], mode === 'label' && idx === sel);
  });
}

function selectLabel(i: number) {
  sel = i;
  renderList(); fillLabelFields(); markSelected();
}

function check() {
  const msgs = validate(data);
  for (const l of labels) if (l.panel && !panelOf(l.panel)) msgs.push(`文字「${l.text}」: コマ ${l.panel} がありません`);
  q('.warn').textContent = msgs.join('\n');
}

function setMode(m: 'panel' | 'label') {
  mode = m; splitMode = false; picks = [];
  renderAll();
}

// ---- コマの分割 ----
function insertOnEdge(u: number, v: number, pos: Pt): number {
  const id = data.points.push(pos) - 1;
  for (const p of data.panels) {              // 辺を共有する全部のコマに、同じ点を入れる
    const L = p.points;
    for (let i = 0; i < L.length; i++) {
      const a = L[i], b = L[(i + 1) % L.length];
      if ((a === u && b === v) || (a === v && b === u)) { L.splice(i + 1, 0, id); break; }
    }
  }
  return id;
}

function newId(): string {
  let n = data.panels.length + 1;
  while (panelOf('p' + n)) n++;
  return 'p' + n;
}

function pickSplit(m: Pt) {
  const p = selPanel ? panelOf(selPanel) : null;
  if (!p) return;
  const L = p.points;
  let best: PickPt | null = null;
  for (const idx of L) {                       // 点の近く(8px 以内)なら、その点
    const pt = data.points[idx];
    const d = Math.hypot(pt[0] - m[0], pt[1] - m[1]);
    if (d < 8 / scale && (!best || d < best.d)) best = { d, type: 'vertex', idx, pos: pt };
  }
  if (!best) {                                 // 違えば、いちばん近い辺の上
    for (let k = 0; k < L.length; k++) {
      const a = data.points[L[k]], b = data.points[L[(k + 1) % L.length]];
      const abx = b[0] - a[0], aby = b[1] - a[1];
      const t = clamp(((m[0] - a[0]) * abx + (m[1] - a[1]) * aby) / (abx * abx + aby * aby), 0, 1);
      const pos: Pt = [a[0] + abx * t, a[1] + aby * t];
      const d = Math.hypot(pos[0] - m[0], pos[1] - m[1]);
      if (!best || d < best.d) best = { d, type: 'edge', a: L[k], b: L[(k + 1) % L.length], pos };
    }
  }
  if (!best) return;
  picks.push(best);
  if (picks.length === 2) { doSplit(); picks = []; splitMode = false; }
  renderAll();
}

function arc(L: number[], from: number, to: number): number[] {
  const out = [L[from]];
  for (let i = from; i !== to;) { i = (i + 1) % L.length; out.push(L[i]); }
  return out;
}

function doSplit() {
  const before = snapshot();
  const backup = JSON.stringify(data);
  const p = selPanel ? panelOf(selPanel) : null;
  if (!p) return;
  const ids = picks.map(pk => (pk.type === 'vertex' ? pk.idx! : insertOnEdge(pk.a!, pk.b!, pk.pos)));
  const L = p.points;
  const ia = L.indexOf(ids[0]), ib = L.indexOf(ids[1]);
  const fail = () => { data = JSON.parse(backup) as PageData; alert('別の辺(または別の点)を選んでください'); };
  if (ia < 0 || ib < 0 || ia === ib) { fail(); return; }
  const A = arc(L, ia, ib), B = arc(L, ib, ia);
  if (A.length < 3 || B.length < 3) { fail(); return; }
  undo.push(before);
  p.points = A;
  data.panels.push({ id: newId(), points: B });
}

// ---- 入力欄 ----
function setHeight(t: HTMLInputElement) {
  const h = Math.max(0.2, parseFloat(t.value) || data.height);
  push();
  for (const p of data.points) if (Math.abs(p[1] - data.height) < 1e-6) p[1] = h;   // 下端の点を一緒に動かす
  data.height = h;
  renderAll();
}

function onSideInput(e: Event) {
  const t = e.target as HTMLInputElement;
  const burst = () => { const first = e.timeStamp - lastInput > 500; lastInput = e.timeStamp; return first; };
  if (t.dataset.page === 'gap') {
    const v = parseFloat(t.value);
    if (isNaN(v) || v < 0) return;
    if (burst()) push();
    data.gap = v; renderStage();
  } else if (t.dataset.pk === 'color') {
    const p = selPanel ? panelOf(selPanel) : null;
    if (!p) return;
    if (burst()) push();
    p.color = t.value; renderStage();
  }
}

function onPanelField(t: HTMLInputElement) {
  const p = selPanel ? panelOf(selPanel) : null;
  if (!p) return;
  const key = t.dataset.pk;
  if (key === 'id') {
    const name = t.value.trim();
    if (!name || (name !== p.id && panelOf(name))) { fillPanelFields(); return; }
    push();
    for (const l of labels) if (l.panel === p.id) l.panel = name;
    p.id = name; selPanel = name;
  } else if (key === 'zoom') {
    const v = parseFloat(t.value);
    if (isNaN(v)) { fillPanelFields(); return; }
    push(); p.zoom = Math.max(1, v);
  } else if (key === 'color') p.color = t.value;   // 元に戻す用の記録は、入力中に済んでいる
  renderAll();
}

function onLabelField(t: HTMLInputElement | HTMLSelectElement) {
  if (sel < 0) return;
  const key = t.dataset.key!;
  const l = labels[sel] as unknown as Record<string, unknown>;
  if (t.getAttribute('type') === 'number') {
    const v = parseFloat(t.value);
    if (isNaN(v) || (key === 'size' && v <= 0)) { fillLabelFields(); return; }
    push(); l[key] = v;
  } else { push(); l[key] = t.value; }
  renderAll();
}

// 画像を選ぶと、「画像のフォルダ」にコピーして、コマに使う
function imgDir(): string {
  let d = q<HTMLInputElement>('.imgDir').value.trim().replace(/\\/g, '/') || './img/works/';
  if (!d.endsWith('/')) d += '/';
  return d;
}

async function onPanelImg(t: HTMLInputElement) {
  const f = t.files?.[0];
  t.value = '';
  const p = selPanel ? panelOf(selPanel) : null;
  if (!f || !p) return;
  push();
  const rel = imgDir() + f.name;
  await importImage(f, rel);
  p.img = rel; p.focus = [0.5, 0.5]; p.zoom = 1;
  renderAll();
}

function act(a: string) {
  const p = selPanel ? panelOf(selPanel) : null;
  if (a === 'save') void save();
  else if (a === 'split') { if (selPanel) { splitMode = !splitMode; picks = []; renderAll(); } }
  else if (a === 'clearImg') { if (p) { push(); delete p.img; delete p.focus; delete p.zoom; renderAll(); } }
  else if (a === 'clearColor') { if (p?.color) { push(); delete p.color; renderAll(); } }
  else if (a === 'addLabel') { push(); labels.push(normalizeLabel({})); sel = labels.length - 1; renderAll(); }
  else if (a === 'delLabel') { if (sel >= 0) { push(); labels.splice(sel, 1); sel = Math.min(sel, labels.length - 1); renderAll(); } }
}

// ---- ステージの操作 ----
function toLocal(e: MouseEvent): Pt {
  const r = svg().getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.width];
}

function onDown(e: PointerEvent) {
  if (e.button !== 0) return;
  (document.activeElement as HTMLElement | null)?.blur();
  const t = e.target as Element;
  if (mode === 'label') {
    const hit = t.closest('g[data-label]');
    if (!hit) return;
    const i = Number(hit.getAttribute('data-label'));
    const group = svg().querySelector<SVGGElement>(`g[data-label="${i}"]`);
    if (!group) return;
    if (i !== sel) selectLabel(i);
    const l = labels[i];
    drag = { kind: 'label', i, group, x0: e.clientX, y0: e.clientY, ox: l.x, oy: l.y, pushed: false };
    svg().setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  const m = toLocal(e);
  if (splitMode && selPanel) { pickSplit(m); return; }
  const pointAttr = t.getAttribute('data-point');
  const panelAttr = t.getAttribute('data-panel');
  if (pointAttr !== null) {
    drag = { kind: 'point', idx: Number(pointAttr), pushed: false };
    svg().setPointerCapture(e.pointerId);
  } else if (panelAttr !== null) {
    const p = data.panels[Number(panelAttr)];
    const was = selPanel === p.id;
    selPanel = p.id;
    if (was && p.img) { drag = { kind: 'focus', p, last: m, pushed: false }; svg().setPointerCapture(e.pointerId); }
    renderAll();
  }
}

function onMove(e: PointerEvent) {
  if (!drag) return;
  if (!drag.pushed) { push(); drag.pushed = true; }
  if (drag.kind === 'point') {
    const m = toLocal(e);
    const snap = (v: number) => (e.altKey ? v : Math.round(v / 0.005) * 0.005);
    data.points[drag.idx] = [round4(clamp(snap(m[0]), 0, 1)), round4(clamp(snap(m[1]), 0, data.height))];
    renderStage();
  } else if (drag.kind === 'focus') {
    const m = toLocal(e), p = drag.p;
    const info = p.img ? imgInfo(p.img, renderStage) : null;
    if (!info) return;
    const box = bounds(shrinkPolygon(panelPoints(data, p), data.gap));
    const fc = p.focus ?? [0.5, 0.5];
    const f = fitImage(box, info.w, info.h, fc, pick(p.zoom, 1));
    p.focus = [round4(clamp(fc[0] - (m[0] - drag.last[0]) / f.w, 0, 1)), round4(clamp(fc[1] - (m[1] - drag.last[1]) / f.h, 0, 1))];   // 画像を動かした向きと逆にずらす
    drag.last = m;
    renderStage();
  } else {
    const k = e.altKey ? 0.1 : 1;
    const l = labels[drag.i];
    l.x = round4(drag.ox + (e.clientX - drag.x0) / scale * k);
    l.y = round4(drag.oy + (e.clientY - drag.y0) / scale * k);
    styleLabel(drag.group, l, true);
    fillLabelFields();
  }
}

function onUp() {
  if (!drag) return;
  drag = null;
  renderAll();
}

function onWheel(e: WheelEvent) {
  const t = e.target as Element;
  if (mode === 'label') {
    const hit = t.closest('g[data-label]') as SVGGElement | null;
    if (!hit) return;
    e.preventDefault();
    const i = Number(hit.getAttribute('data-label'));
    if (i !== sel) selectLabel(i);
    if (e.timeStamp - lastWheel > 500) push();
    lastWheel = e.timeStamp;
    const d = e.deltaY || e.deltaX, l = labels[i];
    if (e.shiftKey) { const step = e.altKey ? 0.5 : 2; l.rotate = round1(l.rotate + (d < 0 ? -step : step)); }
    else { const step = e.altKey ? 1.01 : 1.04; l.size = round4(l.size * (d < 0 ? step : 1 / step)); }
    styleLabel(hit, l, true);
    fillLabelFields();
    return;
  }
  const attr = t.getAttribute('data-panel');
  if (attr === null) return;
  const p = data.panels[Number(attr)];
  if (p.id !== selPanel || !p.img) return;
  e.preventDefault();
  if (e.timeStamp - lastWheel > 500) push();
  lastWheel = e.timeStamp;
  p.zoom = Math.max(1, round4(pick(p.zoom, 1) * (e.deltaY < 0 ? 1.05 : 1 / 1.05)));
  renderStage();
  fillPanelFields();
}

// ---- 保存と読み込み ----
function buildOutput(): WorksFile & { font: string; labels: Label[] } {
  return {
    height: data.height, gap: data.gap,
    points: data.points.map(p => [round4(p[0]), round4(p[1])] as Pt),
    panels: data.panels.map(p => {
      const o: Panel = { id: p.id, points: p.points };
      if (p.color) o.color = p.color;
      if (p.img) { o.img = p.img; const fc = p.focus ?? [0.5, 0.5]; o.focus = [round4(fc[0]), round4(fc[1])]; o.zoom = pick(p.zoom, 1); }
      return o;
    }),
    font: FONT, labels,
  };
}

async function save() {
  if (!fs.getRoot()) { alert('先にサイトのフォルダを選んでください'); return; }
  try { await fs.writeJson('json/works.json', buildOutput()); fs.setStatus('作品を保存しました'); }
  catch (e) { alert('保存できませんでした: ' + String((e as Error)?.message ?? e)); }
}

function setData(obj: WorksFile | null) {
  if (!obj || !Array.isArray(obj.points) || !Array.isArray(obj.panels)) { data = newData(); labels = []; }
  else {
    data = {
      height: pick(obj.height, 0.5625), gap: pick(obj.gap, 0.02), points: obj.points,
      panels: obj.panels.map(s => {
        const p: Panel = { id: s.id, points: s.points };
        if (s.color) p.color = s.color;
        if (s.img) { p.img = s.img; p.focus = pick(s.focus, [0.5, 0.5] as Pt); p.zoom = pick(s.zoom, 1); }
        return p;
      }),
    };
    labels = (obj.labels ?? []).map(normalizeLabel);
  }
  selPanel = null; sel = labels.length ? 0 : -1; splitMode = false; picks = [];
  undo.clear();
  renderAll();
}

export const worksTab: Tab = {
  id: 'works',
  label: '作品',

  mount(el) {
    root = el;
    el.innerHTML = `
    <div class="ed">
      <aside class="side">
        <div class="row"><button class="btn btn--primary" data-a="save">保存 (Ctrl+S)</button></div>
        <h3>ページ</h3>
        <div class="form">
          <label>高さ(幅 = 1)<input type="number" data-page="height" step="0.05" min="0.2"></label>
          <label>隙間<input type="number" data-page="gap" step="0.005" min="0"></label>
          <label class="chk"><input type="checkbox" class="showOrig" checked> 元の形と点を表示(点のドラッグに必要)</label>
          <label class="chk"><input type="checkbox" class="showIds" checked> コマの名前を表示</label>
        </div>
        <h3>編集するもの</h3>
        <div class="form row">
          <label class="chk"><input type="radio" name="wmode" value="panel" checked> コマ(形・画像)</label>
          <label class="chk"><input type="radio" name="wmode" value="label"> 文字</label>
        </div>

        <div class="pbox form">
          <h3>コマ</h3>
          <div class="info"></div>
          <div class="row"><button class="btn btn--sm" data-a="split">分割(辺や点を2回クリック)</button></div>
          <label>画像のフォルダ<input type="text" class="imgDir" value="./img/works/"></label>
          <fieldset class="form pfields" disabled>
            <label>名前<input type="text" data-pk="id"></label>
            <div class="row"><input type="file" class="img" accept="image/*"><button class="btn btn--sm" data-a="clearImg">外す</button></div>
            <div class="path imgPath"></div>
            <label>ズーム<input type="number" data-pk="zoom" step="0.05" min="1"></label>
            <div class="row">背景色 <input type="color" data-pk="color"> <button class="btn btn--sm" data-a="clearColor">なし</button> <span class="colorNote"></span></div>
          </fieldset>
        </div>

        <div class="lbox form" hidden>
          <h3>文字一覧</h3>
          <div class="list llist"></div>
          <div class="row"><button class="btn btn--sm" data-a="addLabel">追加</button><button class="btn btn--sm btn--danger" data-a="delLabel">削除</button></div>
          <fieldset class="form lfields" disabled>
            <label>文字<input type="text" data-key="text"></label>
            <label>どのコマに付けるか<select class="panelSel" data-key="panel"></select></label>
            <label>基準点<select data-key="anchor">
              <option value="top-left">左上</option><option value="top">上</option><option value="top-right">右上</option>
              <option value="left">左</option><option value="center">中央</option><option value="right">右</option>
              <option value="bottom-left">左下</option><option value="bottom">下</option><option value="bottom-right">右下</option>
            </select></label>
            <label>色<input type="color" data-key="color"></label>
            <div class="nums">x <input type="number" data-key="x" step="0.01"> y <input type="number" data-key="y" step="0.01"></div>
            <div class="nums">大きさ <input type="number" data-key="size" step="0.01" min="0.01"> 回転 <input type="number" data-key="rotate" step="1"></div>
          </fieldset>
        </div>

        <h3>操作</h3>
        <p class="hint"><b>コマ</b>: 点をドラッグ(Alt で細かく)。選択中のコマは、ドラッグで画像の見せたい位置、ホイールでズーム<br>
          <b>文字</b>: ドラッグで移動、ホイールで大きさ、Shift+ホイールで回転<br>
          Ctrl+Z: 元に戻す / Esc: 分割をやめる<br>
          画像を選ぶと、「画像のフォルダ」にコピーされます<br>
          位置と大きさの単位は、ページの幅 = 1.0 です</p>
        <div class="warn"></div>
      </aside>
      <div class="stage"><svg class="wsvg" xmlns="http://www.w3.org/2000/svg"></svg></div>
    </div>`;

    const side = q<HTMLElement>('.side');
    side.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      const a = t.closest<HTMLElement>('[data-a]');
      if (a) { act(a.dataset.a!); return; }
      const row = t.closest<HTMLElement>('.llist .item');
      if (row) selectLabel(Number(row.dataset.index));
    });
    side.addEventListener('input', onSideInput);
    side.addEventListener('change', e => {
      const t = e.target as HTMLInputElement;
      if (t.classList.contains('showOrig') || t.classList.contains('showIds')) { renderStage(); return; }
      if (t.name === 'wmode') { setMode(t.value as 'panel' | 'label'); return; }
      if (t.classList.contains('img')) { void onPanelImg(t); return; }
      if (t.dataset.page === 'height') { setHeight(t); return; }
      if (t.dataset.pk) { onPanelField(t); return; }
      if (t.dataset.key) onLabelField(t);
    });

    const s = svg();
    s.addEventListener('pointerdown', onDown);
    s.addEventListener('pointermove', onMove);
    s.addEventListener('pointerup', onUp);
    s.addEventListener('pointercancel', onUp);
    s.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', () => { if (isActive(root)) renderStage(); });
    window.addEventListener('keydown', e => {
      if (!isActive(root)) return;
      if (e.key === 'Escape') { splitMode = false; picks = []; renderAll(); return; }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 's') { e.preventDefault(); void save(); return; }
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === 'z' && tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'SELECT') { e.preventDefault(); doUndo(); }
    });
    void document.fonts.load(`1em ${FONT}`).then(() => { if (root.isConnected) renderStage(); });
    renderAll();
  },

  async onRoot() {
    setData(await fs.readJson<WorksFile | null>('json/works.json', null));
    fs.setStatus('作品: 読み込みました');
  },
};

