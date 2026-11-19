import * as fs from './fs';
import type { Tab } from './types';
import { Undo, round4, pick, imgInfo, dropImg, importImage, isActive } from './util';

interface Game {
  id: string; img: string; x: number; y: number; h: number;
  name_img: string; name_x: number; name_y: number; name_h: number;
  title: string; text: string; url: string; card_imgs: string[];
}

const DIR = './img/games/';
const RATIO = 16 / 9;

let root!: HTMLElement;
let games: Game[] = [];
let sel = -1;
let U = 500;                    // 1.0 にあたる長さ(px)
let showAll = false;
let lastWheel = 0;
const undo = new Undo();

type Drag = { kind: 'art' | 'name'; i: number; item: HTMLElement; x0: number; y0: number; ox: number; oy: number; pushed: boolean };
let drag: Drag | null = null;

const q = <T extends Element>(s: string) => root.querySelector<T>(s)!;

function normalize(s: Partial<Game>, i: number): Game {
  const x = pick(s.x, 0.3), y = pick(s.y, 0.1), h = pick(s.h, 0.8);
  return {
    id: pick(s.id, 'game' + (i + 1)), img: pick(s.img, ''), x, y, h,
    name_img: pick(s.name_img, ''), name_x: pick(s.name_x, x), name_y: pick(s.name_y, round4(y + h)), name_h: pick(s.name_h, 0.1),
    title: pick(s.title, ''), text: pick(s.text, ''), url: pick(s.url, ''), card_imgs: pick(s.card_imgs, []),
  };
}

// ---- 元に戻す ----
const push = () => undo.push(JSON.stringify({ games, sel }));
function doUndo() {
  const s = undo.pop();
  if (!s) return;
  const o = JSON.parse(s) as { games: Game[]; sel: number };
  games = o.games; sel = o.sel;
  render();
}

// ---- 描画 ----
function render() {
  renderList(); fillFields(); renderCardImgs(); renderStage(); check();
}

function renderList() {
  q('.glist').replaceChildren(...games.map((g, i) => {
    const b = document.createElement('button');
    b.className = 'item' + (i === sel ? ' now' : '');
    b.dataset.index = String(i);
    b.innerHTML = '<span></span>';
    b.firstElementChild!.textContent = `${i + 1}. ${g.title || g.id}`;
    return b;
  }));
}

function fillFields() {
  q<HTMLFieldSetElement>('.gfields').disabled = sel < 0;
  const g = sel < 0 ? null : games[sel];
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-key]').forEach(t => {
    t.value = g ? String((g as unknown as Record<string, unknown>)[t.dataset.key!] ?? '') : '';
  });
  root.querySelectorAll<HTMLElement>('[data-path]').forEach(e => {
    const p = g ? String((g as unknown as Record<string, unknown>)[e.dataset.path!] ?? '') : '';
    e.textContent = p || '(なし)';
  });
}

function renderCardImgs() {
  const box = q('.cardImgs');
  box.replaceChildren();
  if (sel < 0) return;
  games[sel].card_imgs.forEach((path, i) => {
    const row = document.createElement('div');
    row.className = 'cimg';
    const im = document.createElement('img');
    const info = imgInfo(path, renderCardImgs);
    if (info) im.src = info.url;
    const p = document.createElement('div');
    p.className = 'path';
    p.textContent = path;
    row.append(im, p);
    for (const [label, act] of [['↑', 'up'], ['↓', 'down'], ['外す', 'del']] as const) {
      const b = document.createElement('button');
      b.className = 'btn btn--sm';
      b.textContent = label;
      b.dataset.act = act;
      b.dataset.index = String(i);
      row.append(b);
    }
    box.append(row);
  });
}

function styleItem(el: HTMLElement, g: Game) {
  el.style.left = g.x * U + 'px';
  el.style.top = g.y * U + 'px';
  el.style.height = g.h * U + 'px';
  el.style.width = g.h * U * (imgInfo(g.img, renderStage)?.aspect ?? 0.6) + 'px';
  const nm = el.querySelector<HTMLElement>('.gname');
  if (nm) {
    nm.style.left = (g.name_x - g.x) * U + 'px';
    nm.style.top = (g.name_y - g.y) * U + 'px';
    nm.style.height = g.name_h * U + 'px';
    nm.style.width = g.name_h * U * (imgInfo(g.name_img, renderStage)?.aspect ?? 0.6) + 'px';
  }
}

function makeItem(i: number): HTMLElement {
  const g = games[i];
  const el = document.createElement('div');
  el.className = 'gitem' + (g.img ? '' : ' empty');
  el.dataset.index = String(i);
  if (g.img) {
    const im = document.createElement('img');
    const info = imgInfo(g.img, renderStage);
    if (info) im.src = info.url;
    el.append(im);
  } else el.append('立ち絵なし');

  if (g.name_img) {
    const nm = document.createElement('div');
    nm.className = 'gname';
    const im = document.createElement('img');
    const info = imgInfo(g.name_img, renderStage);
    if (info) im.src = info.url;
    nm.append(im);
    el.append(nm);
  }
  styleItem(el, g);
  return el;
}

function renderStage() {
  const stage = q<HTMLElement>('.stage');
  const gs = q<HTMLElement>('.gstage');
  U = Math.max(300, stage.clientHeight - 60);

  let extent = RATIO;
  for (const g of games) {
    extent = Math.max(extent, g.x + g.h * (imgInfo(g.img, renderStage)?.aspect ?? 0.6));
    if (g.name_img) extent = Math.max(extent, g.name_x + g.name_h * (imgInfo(g.name_img, renderStage)?.aspect ?? 0.6));
  }
  gs.style.width = (extent + 0.1) * U + 'px';
  gs.style.height = U + 'px';
  q('.gitems').replaceChildren(...games.map((_, i) => makeItem(i)));
  markSelected();
}

function markSelected() {
  for (const el of Array.from(q('.gitems').children) as HTMLElement[]) {
    const idx = Number(el.dataset.index);
    el.classList.toggle('sel', idx === sel);
    el.querySelector('.gname')?.classList.toggle('show', showAll || idx === sel);
  }
}

function select(i: number) {
  sel = i;
  renderList(); fillFields(); renderCardImgs(); markSelected();
}

function check() {
  const msgs: string[] = [];
  const seen = new Set<string>();
  for (const g of games) {
    if (seen.has(g.id)) msgs.push(`${g.id}: IDが重複しています`);
    seen.add(g.id);
    if (!g.img) msgs.push(`${g.id}: 立ち絵がありません`);
    for (const c of g.card_imgs) if (!c.startsWith(`${DIR}${g.id}/`)) msgs.push(`${g.id}: 紹介画像のパスがIDのフォルダと一致しません\n  ${c}`);
  }
  q('.warn').textContent = msgs.join('\n');
}

// ---- 一覧の操作 ----
function act(a: string) {
  if (a === 'save') { void save(); return; }
  if (a === 'add') {
    push();
    const last = games[games.length - 1];
    const x = last ? round4(last.x + last.h * (imgInfo(last.img, renderStage)?.aspect ?? 0.6) + 0.1) : 0.3;
    games.push(normalize({ x, y: 0.1, h: 0.8 }, games.length));
    sel = games.length - 1;
    render();
  } else if (a === 'del') {
    if (sel < 0) return;
    push(); games.splice(sel, 1); sel = Math.min(sel, games.length - 1); render();
  } else if (a === 'up' || a === 'down') {
    const j = sel + (a === 'up' ? -1 : 1);
    if (sel < 0 || j < 0 || j >= games.length) return;
    push();
    [games[sel], games[j]] = [games[j], games[sel]];
    sel = j; render();
  }
}

async function onFile(t: HTMLInputElement) {
  const files = Array.from(t.files ?? []);
  t.value = '';
  if (!files.length || sel < 0) return;
  push();
  const g = games[sel];
  const kind = t.dataset.file!;
  if (kind === 'card_imgs') {
    for (const f of files) {
      const rel = `${DIR}${g.id}/${f.name}`;
      await importImage(f, rel);
      if (!g.card_imgs.includes(rel)) g.card_imgs.push(rel);
    }
  } else {
    const rel = DIR + files[0].name;
    await importImage(files[0], rel);
    (g as unknown as Record<string, unknown>)[kind] = rel;
  }
  render();
}

function onField(t: HTMLInputElement | HTMLTextAreaElement) {
  if (sel < 0) return;
  const key = t.dataset.key as keyof Game;
  const g = games[sel] as unknown as Record<string, unknown>;
  if (t instanceof HTMLInputElement && t.type === 'number') {
    const v = parseFloat(t.value);
    if (isNaN(v)) { fillFields(); return; }
    push(); g[key] = v;
  } else { push(); g[key] = t.value; }
  render();
}

// ---- ステージの操作 ----
function onDown(e: PointerEvent) {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  const hit = target.closest<HTMLElement>('.gitem');
  if (!hit) return;
  const onName = !!target.closest('.gname');
  const i = Number(hit.dataset.index);

  (document.activeElement as HTMLElement | null)?.blur();   // 入力中の欄を確定させる(描き直されるので、そのあと要素を探す)
  const item = q('.gitems').querySelector<HTMLElement>(`.gitem[data-index="${i}"]`);
  if (!item) return;
  if (i !== sel) select(i);

  const g = games[i];
  drag = onName && item.querySelector('.gname')
    ? { kind: 'name', i, item, x0: e.clientX, y0: e.clientY, ox: g.name_x, oy: g.name_y, pushed: false }
    : { kind: 'art', i, item, x0: e.clientX, y0: e.clientY, ox: g.x, oy: g.y, pushed: false };
  q('.gstage').setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onMove(e: PointerEvent) {
  if (!drag) return;
  if (!drag.pushed) { push(); drag.pushed = true; }
  const k = e.altKey ? 0.1 : 1;
  const dx = (e.clientX - drag.x0) / U * k, dy = (e.clientY - drag.y0) / U * k;
  const g = games[drag.i];
  if (drag.kind === 'art') { g.x = round4(drag.ox + dx); g.y = round4(drag.oy + dy); }
  else { g.name_x = round4(drag.ox + dx); g.name_y = round4(drag.oy + dy); }
  styleItem(drag.item, g);
  fillFields();
}

function onUp() {
  if (!drag) return;
  drag = null;
  renderStage(); check();
}

function onWheel(e: WheelEvent) {
  const target = e.target as HTMLElement;
  const hit = target.closest<HTMLElement>('.gitem');
  if (!hit) return;
  e.preventDefault();
  const i = Number(hit.dataset.index);
  if (i !== sel) select(i);
  if (e.timeStamp - lastWheel > 500) push();
  lastWheel = e.timeStamp;
  const step = e.altKey ? 1.01 : 1.04;
  const f = e.deltaY < 0 ? step : 1 / step;
  const g = games[i];
  if (target.closest('.gname')) g.name_h = round4(g.name_h * f); else g.h = round4(g.h * f);
  styleItem(hit, g);
  fillFields();
}

async function save() {
  if (!fs.getRoot()) { alert('先にサイトのフォルダを選んでください'); return; }
  try { await fs.writeJson('json/games.json', games); fs.setStatus('ゲーム一覧を保存しました'); }
  catch (e) { alert('保存できませんでした: ' + String((e as Error)?.message ?? e)); }
}

export const gamesTab: Tab = {
  id: 'games',
  label: 'ゲーム',

  mount(el) {
    root = el;
    el.innerHTML = `
    <div class="ed">
      <aside class="side">
        <div class="row"><button class="btn btn--primary" data-a="save">保存 (Ctrl+S)</button></div>
        <h3>ゲーム一覧</h3>
        <div class="list glist"></div>
        <div class="row">
          <button class="btn btn--sm" data-a="add">追加</button>
          <button class="btn btn--sm btn--danger" data-a="del">削除</button>
          <button class="btn btn--sm" data-a="up">↑</button>
          <button class="btn btn--sm" data-a="down">↓</button>
        </div>
        <fieldset class="form gfields" disabled>
          <h3>カード</h3>
          <label>ID<input type="text" data-key="id"></label>
          <label>タイトル<input type="text" data-key="title"></label>
          <label>説明文<textarea data-key="text" rows="5"></textarea></label>
          <label>DLリンク<input type="text" data-key="url" placeholder="https://..."></label>
          <label>紹介画像(複数可。./img/games/&lt;ID&gt;/ に保存)<input type="file" data-file="card_imgs" accept="image/*" multiple></label>
          <div class="cardImgs form"></div>

          <h3>立ち絵</h3>
          <div class="row"><input type="file" data-file="img" accept="image/*"><button class="btn btn--sm" data-clear="img">外す</button></div>
          <div class="path" data-path="img"></div>
          <div class="nums">x <input type="number" data-key="x" step="0.01"> y <input type="number" data-key="y" step="0.01"> h <input type="number" data-key="h" step="0.01"></div>

          <h3>名前画像(ホバー時)</h3>
          <div class="row"><input type="file" data-file="name_img" accept="image/*"><button class="btn btn--sm" data-clear="name_img">外す</button></div>
          <div class="path" data-path="name_img"></div>
          <div class="nums">x <input type="number" data-key="name_x" step="0.01"> y <input type="number" data-key="name_y" step="0.01"> h <input type="number" data-key="name_h" step="0.01"></div>
        </fieldset>
        <label class="form chk"><input type="checkbox" class="showAll"> すべての名前画像を表示</label>
        <h3>操作</h3>
        <p class="hint">立ち絵・名前画像: ドラッグで移動(Alt で細かく)、ホイールで大きさ<br>
          Ctrl+Z: 元に戻す / 位置と大きさの単位は、画面の高さ = 1.0<br>
          画像を選ぶと、./img/games/ にコピーされます</p>
        <div class="warn"></div>
      </aside>
      <div class="stage"><div class="gstage"><div class="gguide">1画面目(16:9)</div><div class="gitems"></div></div></div>
    </div>`;

    const side = q<HTMLElement>('.side');
    side.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      const a = t.closest<HTMLElement>('[data-a]');
      if (a) { act(a.dataset.a!); return; }
      const clear = t.closest<HTMLElement>('[data-clear]');
      if (clear && sel >= 0) { push(); (games[sel] as unknown as Record<string, unknown>)[clear.dataset.clear!] = ''; render(); return; }
      const row = t.closest<HTMLElement>('.glist .item');
      if (row) { select(Number(row.dataset.index)); return; }
      const c = t.closest<HTMLElement>('[data-act]');
      if (c && sel >= 0) {
        const i = Number(c.dataset.index), list = games[sel].card_imgs;
        const a2 = c.dataset.act;
        if (a2 === 'del') { push(); list.splice(i, 1); }
        else {
          const j = i + (a2 === 'up' ? -1 : 1);
          if (j < 0 || j >= list.length) return;
          push(); [list[i], list[j]] = [list[j], list[i]];
        }
        render();
      }
    });
    side.addEventListener('change', e => {
      const t = e.target as HTMLInputElement | HTMLTextAreaElement;
      if (t.classList.contains('showAll')) { showAll = (t as HTMLInputElement).checked; markSelected(); return; }
      if (t instanceof HTMLInputElement && t.type === 'file') { void onFile(t); return; }
      if (t.dataset.key) onField(t);
    });

    const gs = q<HTMLElement>('.gstage');
    gs.addEventListener('pointerdown', onDown);
    gs.addEventListener('pointermove', onMove);
    gs.addEventListener('pointerup', onUp);
    gs.addEventListener('pointercancel', onUp);
    gs.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', () => { if (isActive(root)) renderStage(); });
    window.addEventListener('keydown', e => {
      if (!isActive(root) || !(e.ctrlKey || e.metaKey)) return;
      if (e.key === 's') { e.preventDefault(); void save(); return; }
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === 'z' && tag !== 'TEXTAREA' && tag !== 'INPUT') { e.preventDefault(); doUndo(); }
    });
    render();
  },

  async onRoot() {
    const list = await fs.readJson<Partial<Game>[]>('json/games.json', []);
    games = list.map(normalize);
    sel = games.length ? 0 : -1;
    undo.clear();
    for (const g of games) { dropImg(g.img); dropImg(g.name_img); }
    render();
    fs.setStatus(`ゲーム: ${games.length} 件を読み込みました`);
  },
};

