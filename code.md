Project Path: myhomepage-editor

Source Tree:

```txt
myhomepage-editor
├── index.html
├── src
│   ├── diary.ts
│   ├── fs.ts
│   ├── games.ts
│   ├── geometry.ts
│   ├── main.ts
│   ├── style.css
│   ├── styles.css
│   ├── title.ts
│   ├── types.ts
│   ├── util.ts
│   └── works.ts
└── vite.config.ts

```

`index.html`:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ポートフォリオ エディター</title>
  <link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet" />
  <script type="module" src="/src/main.ts"></script>
</head>
<body>
  <header class="header">
    <div class="header__inner">
      <button id="pick" class="btn btn--primary">サイトのフォルダを選ぶ</button>
      <span id="root">(未選択)</span>
      <nav id="tabs" class="seg"></nav>
      <span id="status"></span>
    </div>
  </header>
  <main id="panels"></main>
</body>
</html>

```
`src\diary.ts`:

```ts
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import * as fs from './fs';
import type { Tab } from './types';

interface Article { id: string; date: string; title: string; body: string }

let el: HTMLElement;
let articles: Article[] = [];
let cur: Article | null = null;
let dirty = false;

const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
const sorted = () => articles.slice().sort((a, b) => b.date.localeCompare(a.date));

function markDirty(v = true) {
  dirty = v;
  if (v) fs.setStatus('未保存の変更があります');
}

// 画像1枚だけの段落を、中央揃えの <figure> + キャプションにする(本番の diary.js と同じ)
function renderBody(md: string): HTMLElement {
  const box = document.createElement('div');
  box.innerHTML = DOMPurify.sanitize(marked.parse(md, { breaks: true }) as string);
  box.querySelectorAll('p').forEach(p => {
    const img = p.querySelector(':scope > img');
    if (!img || p.children.length !== 1 || (p.textContent ?? '').trim() !== '') return;
    const fig = document.createElement('figure');
    fig.append(img);
    const alt = img.getAttribute('alt');
    if (alt) {
      const cap = document.createElement('figcaption');
      cap.textContent = alt;
      fig.append(cap);
    }
    p.replaceWith(fig);
  });
  box.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  return box;
}

function renderList() {
  q('.list').replaceChildren(...sorted().map(a => {
    const b = document.createElement('button');
    b.className = 'item' + (a === cur ? ' now' : '');
    b.innerHTML = '<small></small><span></span>';
    b.children[0].textContent = a.date;
    b.children[1].textContent = a.title || '(無題)';
    b.onclick = () => select(a);
    return b;
  }));
}

async function preview() {
  q('.p_date').textContent = cur?.date ?? '';
  q('.p_title').textContent = cur?.title ?? '';
  const box = renderBody(cur?.body ?? '');
  q('.p_text').replaceChildren(...Array.from(box.childNodes));
  for (const img of q('.p_text').querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    if (!src.startsWith('./img/')) continue;
    const url = await fs.imageUrl(src);
    if (url) img.src = url;
  }
}

function select(a: Article) {
  cur = a;
  q<HTMLFieldSetElement>('fieldset').disabled = false;
  q<HTMLInputElement>('.date').value = a.date.replace(/\./g, '-');
  q<HTMLInputElement>('.title').value = a.title;
  q<HTMLTextAreaElement>('.body').value = a.body;
  renderList();
  void preview();
}

async function save() {
  if (!fs.getRoot()) return;
  try {
    await fs.writeJson('json/diary.json', sorted());
    markDirty(false);
    fs.setStatus('日記を保存しました');
  } catch (e) { alert('保存できませんでした: ' + String((e as Error)?.message ?? e)); }
}

function newArticle() {
  const d = new Date();
  const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const id = date.replace(/\./g, '') + '-' + Math.random().toString(36).slice(2, 6);
  const a: Article = { id, date, title: '', body: '' };
  articles.push(a);
  markDirty();
  select(a);
  q<HTMLInputElement>('.title').focus();
}

async function deleteArticle() {
  if (!cur || !confirm('この記事を削除します。画像フォルダも削除されます。')) return;
  const id = cur.id;
  articles = articles.filter(a => a !== cur);
  cur = null;
  q<HTMLFieldSetElement>('fieldset').disabled = true;
  await fs.removeDir(`img/diary/${id}`);
  renderList();
  void preview();
  await save();
}

// 最大幅1200pxに縮めて webp にする
async function toWebp(file: File): Promise<Uint8Array> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/webp', 0.85));
  return new Uint8Array(await blob!.arrayBuffer());
}

async function addImages(files: File[]) {
  if (!fs.getRoot() || !cur) { alert('フォルダを選び、記事を選んでから入れてください'); return; }
  const dir = `img/diary/${cur.id}`;
  let n = 0;
  for (const name of await fs.listNames(dir)) n = Math.max(n, parseInt(name) || 0);

  let text = '';
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const name = `${++n}.webp`;
    await fs.writeBinary(`${dir}/${name}`, await toWebp(f));
    text += `\n\n![](./img/diary/${cur.id}/${name})\n\n`;
  }
  if (!text) return;

  const t = q<HTMLTextAreaElement>('.body');
  t.setRangeText(text, t.selectionStart, t.selectionEnd, 'end');
  const i = t.value.lastIndexOf('![](', t.selectionStart) + 2;   // キャプション欄にカーソルを置く
  t.setSelectionRange(i, i);
  t.focus();
  t.dispatchEvent(new Event('input'));
  fs.setStatus('画像を保存しました(記事の保存も忘れずに)');
}

export const diaryTab: Tab = {
  id: 'diary',
  label: '日記',

  mount(root) {
    el = root;
    el.innerHTML = `
    <div class="diary">
      <div class="bar">
        <button class="btn new">新しい記事</button>
        <button class="btn btn--primary save">保存 (Ctrl+S)</button>
      </div>
      <nav class="list pane"></nav>
      <fieldset class="form pane" disabled>
        <label>日付<input type="date" class="date"></label>
        <label>タイトル<input type="text" class="title"></label>
        <label>本文(マークダウン)<textarea class="body"></textarea></label>
        <div class="row">
          <button class="btn btn--sm addimg" type="button">画像を挿入</button>
          <button class="btn btn--sm btn--danger del" type="button">この記事を削除</button>
          <input type="file" class="file" accept="image/*" multiple hidden>
        </div>
        <p class="hint">画像は貼り付け・ドラッグ&amp;ドロップでも入れられます。<br>
        画像は前後を空行で区切ってください。<code>![ここ](…)</code> の文字が、画像の下のキャプションになります。</p>
      </fieldset>
      <section class="preview pane">
        <div class="card">
          <p class="p_date"></p>
          <h2 class="p_title"></h2>
          <div class="p_text"></div>
        </div>
      </section>
    </div>`;

    q('.new').onclick = newArticle;
    q('.save').onclick = save;
    q('.del').onclick = () => { void deleteArticle(); };

    q<HTMLInputElement>('.date').oninput = e => { if (!cur) return; cur.date = (e.target as HTMLInputElement).value.replace(/-/g, '.'); markDirty(); renderList(); void preview(); };
    q<HTMLInputElement>('.title').oninput = e => { if (!cur) return; cur.title = (e.target as HTMLInputElement).value; markDirty(); renderList(); void preview(); };
    q<HTMLTextAreaElement>('.body').oninput = e => { if (!cur) return; cur.body = (e.target as HTMLTextAreaElement).value; markDirty(); void preview(); };

    const file = q<HTMLInputElement>('.file');
    q('.addimg').onclick = () => file.click();
    file.onchange = () => { void addImages(Array.from(file.files ?? [])); file.value = ''; };
    const body = q<HTMLTextAreaElement>('.body');
    body.addEventListener('dragover', e => e.preventDefault());
    body.addEventListener('drop', e => {
      const fl = Array.from(e.dataTransfer?.files ?? []);
      if (fl.length) { e.preventDefault(); void addImages(fl); }
    });
    body.addEventListener('paste', e => {
      const fl = Array.from(e.clipboardData?.files ?? []);
      if (fl.length) { e.preventDefault(); void addImages(fl); }
    });

    window.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && el.classList.contains('on')) { e.preventDefault(); void save(); }
    });
    window.addEventListener('beforeunload', e => { if (dirty) e.preventDefault(); });
  },

  async onRoot() {
    articles = await fs.readJson<Article[]>('json/diary.json', []);
    cur = null;
    dirty = false;
    q<HTMLFieldSetElement>('fieldset').disabled = true;
    renderList();
    void preview();
    fs.setStatus(`日記: ${articles.length} 件を読み込みました`);
  },
};

```
`src\fs.ts`:

```ts
// サイトのフォルダへの読み書きを、ここに集める(全タブ共通)
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, writeFile, readFile, readDir, mkdir, remove, exists } from '@tauri-apps/plugin-fs';

let root: string | null = null;
const listeners = new Set<() => void>();
const urlCache = new Map<string, string>();

export const getRoot = () => root;
export const onRootChange = (f: () => void) => { listeners.add(f); };

export async function pickRoot(): Promise<boolean> {
  const p = await open({ directory: true, title: 'サイトのフォルダ(index.html がある場所)' });
  if (typeof p !== 'string') return false;
  root = p.replace(/\\/g, '/');
  urlCache.clear();
  listeners.forEach(f => f());
  return true;
}

// "./img/a.webp" や "json/a.json" を、絶対パスにする
function abs(rel: string): string {
  if (!root) throw new Error('フォルダが選ばれていません');
  return `${root}/${rel.replace(/^\.?\//, '')}`;
}
const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/'));

export async function readJson<T>(rel: string, fallback: T): Promise<T> {
  const p = abs(rel);
  if (!(await exists(p))) return fallback;
  return JSON.parse(await readTextFile(p)) as T;
}

export async function writeJson(rel: string, data: unknown): Promise<void> {
  const p = abs(rel);
  await mkdir(parentOf(p), { recursive: true });
  await writeTextFile(p, JSON.stringify(data, null, 4));
}

export async function writeBinary(rel: string, bytes: Uint8Array): Promise<void> {
  const p = abs(rel);
  await mkdir(parentOf(p), { recursive: true });
  await writeFile(p, bytes);
}

export async function removeDir(rel: string): Promise<void> {
  const p = abs(rel);
  if (await exists(p)) await remove(p, { recursive: true });
}

export async function listNames(rel: string): Promise<string[]> {
  const p = abs(rel);
  if (!(await exists(p))) return [];
  return (await readDir(p)).map(e => e.name);
}

const MIME: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' };

// プレビュー用の画像URL(フォルダから読んで Blob URL にする)
export async function imageUrl(rel: string): Promise<string | null> {
  if (urlCache.has(rel)) return urlCache.get(rel)!;
  try {
    const bytes = await readFile(abs(rel));
    const ext = rel.split('.').pop()!.toLowerCase();
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: MIME[ext] ?? 'application/octet-stream' }));
    urlCache.set(rel, url);
    return url;
  } catch { return null; }
}

export function forgetImage(rel: string) {
  const u = urlCache.get(rel);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(rel);
}

export function setStatus(msg: string) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
}

```
`src\games.ts`:

```ts
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

```
`src\geometry.ts`:

```ts
// コマ割りの幾何計算(works / illusts で共通。座標は、ページの幅 = 1.0 の単位。x は右、y は下)
export type Pt = [number, number];

export interface Panel {
  id: string;
  points: number[];
  color?: string;
  img?: string;
  focus?: Pt;
  zoom?: number;
  back?: boolean;
}

export interface PageData {
  height: number;
  gap: number;
  points: Pt[];
  panels: Panel[];
}

export const panelPoints = (d: PageData, p: Panel): Pt[] => p.points.map(i => d.points[i]);
export const hasMissing = (pts: (Pt | undefined)[]) => pts.some(p => !p);

export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function isConvex(pts: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export interface Box { x0: number; y0: number; x1: number; y1: number }
export function bounds(pts: Pt[]): Box {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// 各辺を gap の半分だけ内側へずらし、隣り合う辺の交点を新しい頂点にする
export function shrinkPolygon(pts: Pt[], gap: number): Pt[] {
  const n = pts.length, h = gap / 2;
  const side = signedArea(pts) > 0 ? 1 : -1;
  const lines = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const dx = (q[0] - p[0]) / len, dy = (q[1] - p[1]) / len;
    return { px: p[0] - dy * side * h, py: p[1] + dx * side * h, dx, dy };
  });
  return pts.map((o, i) => {
    const a = lines[(i + n - 1) % n], b = lines[i];
    const cross = a.dx * b.dy - a.dy * b.dx;
    let x: number, y: number;
    if (Math.abs(cross) < 1e-9) { x = b.px; y = b.py; }
    else {
      const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / cross;
      x = a.px + a.dx * t; y = a.py + a.dy * t;
    }
    const dist = Math.hypot(x - o[0], y - o[1]), limit = h * 4;   // 鋭角で頂点が飛ばないように抑える
    if (dist > limit) { x = o[0] + (x - o[0]) * limit / dist; y = o[1] + (y - o[1]) * limit / dist; }
    return [x, y] as Pt;
  });
}

// コマの中に、絵を「枠を埋める」大きさで置いた位置を返す
export function fitImage(box: Box, imgW: number, imgH: number, focus: Pt = [0.5, 0.5], zoom = 1) {
  const sc = Math.max((box.x1 - box.x0) / imgW, (box.y1 - box.y0) / imgH) * zoom;
  const w = imgW * sc, h = imgH * sc;
  let x = (box.x0 + box.x1) / 2 - focus[0] * w;
  let y = (box.y0 + box.y1) / 2 - focus[1] * h;
  x = Math.min(Math.max(x, box.x1 - w), box.x0);
  y = Math.min(Math.max(y, box.y1 - h), box.y0);
  return { x, y, w, h };
}

export const pointsAttr = (pts: Pt[]) => pts.map(p => `${p[0]},${p[1]}`).join(' ');

export function validate(d: PageData): string[] {
  const w: string[] = [];
  for (const p of d.panels) {
    const pts = panelPoints(d, p);
    if (hasMissing(pts)) { w.push(`${p.id}: 存在しない点を使っています`); continue; }
    if (pts.length < 3) { w.push(`${p.id}: 点が3つ未満です`); continue; }
    if (Math.abs(signedArea(pts)) < 1e-6) w.push(`${p.id}: つぶれています`);
    else if (!isConvex(pts)) w.push(`${p.id}: へこんだ形です`);
  }
  return w;
}

```
`src\main.ts`:

```ts
import './style.css';
import { pickRoot, getRoot, onRootChange, setStatus } from './fs';
import type { Tab } from './types';
import { diaryTab } from './diary';
import { gamesTab } from './games';
import { worksTab } from './works';

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
  placeholder('title', 'タイトル配置'),
  placeholder('logo', 'ロゴアニメ'),
  placeholder('transition', 'シーン遷移'),
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

```
`src\style.css`:

```css
/* サイトエディター: 見た目はゲームランチャーに合わせてある */
:root {
  --bg: #f5f7f9;
  --card-bg: #ffffff;
  --text: #333333;
  --text-muted: #6b6b6b;
  --border: #e1e5e9;
  --c-green: #1aff1a;
  --c-blue: #19c8ff;
  --c-blue-hover: #5ad7ff;
  --c-blue-soft: #e6f7fe;
  --c-orange: #ff8a1f;
  --radius-sm: 8px;
  --shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; overscroll-behavior: none; }
img { -webkit-user-drag: none; }
body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "Meiryo", "Hiragino Kaku Gothic ProN", "MS PGothic", sans-serif;
  font-size: 14px;
}

/* ---- ヘッダー ---- */
.header { flex: none; background: #272727; color: #fff; user-select: none; }
.header__inner { display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 24px; }
#root { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #bdbdbd; font-size: .8rem; }
#status { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #bdbdbd; font-size: .82rem; text-align: right; }

.seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: #3a3a3a; }
.seg button { padding: 5px 16px; border: 0; border-radius: 999px; background: transparent; color: #ddd; font: inherit; font-size: .85rem; font-weight: 700; white-space: nowrap; cursor: pointer; }
.seg button:hover { background: #4a4a4a; }
.seg button.on { background: var(--c-blue); color: #fff; }

/* ---- ボタン ---- */
.btn { padding: 5px 16px; border: none; border-radius: 14px; background: #fff; color: var(--text); box-shadow: inset 0 0 0 2px var(--c-blue); font: inherit; font-size: .82rem; font-weight: 700; cursor: pointer; white-space: nowrap; }
.btn:hover:not(:disabled) { background: var(--c-blue-soft); }
.btn:disabled { opacity: .5; cursor: default; }
.btn--primary { background: var(--c-blue); color: #fff; box-shadow: none; }
.btn--primary:hover:not(:disabled) { background: var(--c-blue-hover); }
.btn--danger { color: #d96500; box-shadow: inset 0 0 0 2px var(--c-orange); }
.btn--danger:hover:not(:disabled) { background: #fff4e8; }
.btn--sm { padding: 3px 12px; font-size: .78rem; }
.btn.on { background: var(--c-blue); color: #fff; }

/* ---- タブの入れ物 ---- */
#panels { flex: 1; min-height: 0; position: relative; }
.tab { position: absolute; inset: 0; display: none; }
.tab.on { display: flex; }
.placeholder { margin: auto; color: var(--text-muted); }

/* ---- 共通レイアウト: 左に入力(.side)、右に作業エリア(.stage) ---- */
.ed { display: flex; width: 100%; height: 100%; min-height: 0; }
.side { width: 320px; flex: none; overflow-y: auto; padding: 16px 18px 24px; display: flex; flex-direction: column; gap: 10px; background: #fff; border-right: 1px solid #ccc; }
.side h3 { margin: 8px 0 0; padding-bottom: 3px; font-size: .95rem; border-bottom: 3px solid var(--c-blue); }
.stage { flex: 1; min-width: 0; overflow: auto; padding: 20px; background: #e9edf0; }
.warn { color: #d96500; white-space: pre-wrap; font-size: .8rem; }
.path { color: var(--text-muted); font-size: .75rem; word-break: break-all; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.hint { margin: 0; color: var(--text-muted); font-size: .78rem; line-height: 1.6; overflow-wrap: anywhere; }

/* ---- 一覧 ---- */
.list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.side .list { grid-template-columns: minmax(0, 1fr); max-height: 200px; overflow: auto; padding: 2px; }
.list .item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: 8px 14px; border: 0; border-radius: var(--radius-sm); background: var(--card-bg); box-shadow: var(--shadow); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.list .item:hover { background: var(--c-blue-soft); }
.list .item.now { box-shadow: inset 0 0 0 2px var(--c-blue), var(--shadow); }
.list .item small { color: var(--text-muted); font-size: .75rem; }
.list .item span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }

/* ---- 入力フォーム ---- */
.form { display: flex; flex-direction: column; gap: 10px; min-width: 0; margin: 0; padding: 0; border: 0; }
.form label { display: flex; flex-direction: column; gap: 4px; color: var(--text-muted); font-size: .78rem; font-weight: 700; }
.form input:not([type="file"]), .form select, .form textarea { width: 100%; padding: 6px 12px; border: 2px solid var(--border); border-radius: 17px; background: #fff; color: var(--text); font: inherit; font-size: .85rem; font-weight: 400; }
.form textarea { border-radius: var(--radius-sm); line-height: 1.7; resize: vertical; }
.form input:focus, .form select:focus, .form textarea:focus { outline: none; border-color: var(--c-blue); }
.form label.chk { flex-direction: row; align-items: center; gap: 6px; }
.form input[type="checkbox"], .form input[type="radio"], .form input[type="color"] { width: auto; padding: 0; }
.nums { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: .78rem; font-weight: 700; color: var(--text-muted); }
.form .nums input { width: 76px; }

/* ---- ゲームタブ ---- */
.gstage { position: relative; background: #cfd8df; touch-action: none; user-select: none; }
.gguide { position: absolute; left: 0; top: 0; height: 100%; aspect-ratio: 16 / 9; border: 1px dashed #0006; padding: 2px 6px; font-size: 11px; color: #0008; pointer-events: none; }
.gitems { position: absolute; inset: 0; }
.gitem { position: absolute; cursor: move; }
.gitem img { display: block; width: 100%; height: 100%; pointer-events: none; }
.gitem:hover { z-index: 6; }
.gitem.sel { outline: 2px solid var(--c-blue); z-index: 5; }
.gitem.empty { display: flex; align-items: center; justify-content: center; border: 1px dashed #666; background: #8884; font-size: 12px; }
.gname { position: absolute; display: none; outline: 1px dashed #19c8ff; cursor: move; }
.gname img { display: block; width: 100%; height: 100%; pointer-events: none; }
.gname.show, .gitem:hover .gname { display: block; }
.cimg { display: flex; align-items: center; gap: 4px; }
.cimg img { width: 48px; height: 48px; flex: none; object-fit: contain; background: #e9edf0; }
.cimg .path { flex: 1; min-width: 0; }

/* ---- 作品タブ ---- */
.wsvg { display: block; touch-action: none; user-select: none; background: repeating-conic-gradient(#dde3e8 0% 25%, #eef2f5 0% 50%) 50% / 24px 24px; }

/* ---- 日記タブ ---- */
.diary { display: grid; grid-template-columns: 260px minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); width: 100%; height: 100%; }
.diary .bar { grid-column: 1 / -1; display: flex; gap: 8px; padding: 8px 16px; background: #fff; border-bottom: 1px solid #ccc; }
.diary .pane { min-height: 0; overflow-y: auto; padding: 16px 20px 24px; }
.diary .list { display: flex; flex-direction: column; background: #f5f7f9; border-right: 1px solid #ccc; }
.diary fieldset.form { background: #fff; border-right: 1px solid #ccc; }
.diary textarea.body { flex: 1; min-height: 320px; }
.diary .preview { background: #e9edf0; }
.card { max-width: 700px; margin: 0 auto; padding: 24px 16px 48px; background: #fff; color: #222; }
.p_title { margin: 0 0 12px; font-size: 30px; font-weight: 700; line-height: 1.5; }
.p_date { margin: 0 0 24px; font-size: 14px; color: #888; }
.p_text { font-size: 16px; line-height: 2; }
.p_text p { margin: 0 0 1.4em; }
.p_text a { color: #1a7f6b; }
.p_text h1, .p_text h2, .p_text h3 { margin: 2em 0 .8em; line-height: 1.5; }
.p_text blockquote { margin: 1.6em 0; padding: .2em 0 .2em 1.2em; border-left: 3px solid #ccc; color: #666; }
.p_text pre { padding: 12px; overflow: auto; background: #333; color: #fff; }
.p_text figure { margin: 2em 0; text-align: center; }
.p_text figure img { max-width: 100%; border-radius: 4px; }
.p_text figcaption { margin-top: .6em; font-size: 13px; color: #888; }

/* ---- タイトル配置タブ ---- */
.stage--center { display: flex; }
.twrap { position: relative; margin: auto; flex: none; }
.tstage { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform-origin: 0 0; box-shadow: 0 0 0 1px #ccc; overflow: hidden; touch-action: none; user-select: none; }
.tstage.checker { background: conic-gradient(#ccc 25%, #fff 0 50%, #ccc 0 75%, #fff 0) 0 0 / 40px 40px; }
.timgs { position: absolute; inset: 0; }
.timgs img { position: absolute; max-width: none; cursor: move; user-select: none; }
.tstage.guides img.sel { outline: 3px solid var(--c-blue); }
.tcross { display: none; position: absolute; pointer-events: none; background: rgba(25, 200, 255, .45); }
.tstage.guides .tcross { display: block; }
.tvx { left: 960px; top: 0; width: 2px; height: 100%; }
.tvy { left: 0; top: 540px; width: 100%; height: 2px; }
.thandle { position: absolute; display: none; border-radius: 50%; background: var(--c-orange); border: 2px solid #fff; cursor: grab; z-index: 99999; touch-action: none; }
.tempty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-muted); font-size: 18px; pointer-events: none; }

```
`src\styles.css`:

```css
.logo.vite:hover {
  filter: drop-shadow(0 0 2em #747bff);
}

.logo.typescript:hover {
  filter: drop-shadow(0 0 2em #2d79c7);
}
:root {
  font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;

  color: #0f0f0f;
  background-color: #f6f6f6;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

.container {
  margin: 0;
  padding-top: 10vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  text-align: center;
}

.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: 0.75s;
}

.logo.tauri:hover {
  filter: drop-shadow(0 0 2em #24c8db);
}

.row {
  display: flex;
  justify-content: center;
}

a {
  font-weight: 500;
  color: #646cff;
  text-decoration: inherit;
}

a:hover {
  color: #535bf2;
}

h1 {
  text-align: center;
}

input,
button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  color: #0f0f0f;
  background-color: #ffffff;
  transition: border-color 0.25s;
  box-shadow: 0 2px 2px rgba(0, 0, 0, 0.2);
}

button {
  cursor: pointer;
}

button:hover {
  border-color: #396cd8;
}
button:active {
  border-color: #396cd8;
  background-color: #e8e8e8;
}

input,
button {
  outline: none;
}

#greet-input {
  margin-right: 5px;
}

@media (prefers-color-scheme: dark) {
  :root {
    color: #f6f6f6;
    background-color: #2f2f2f;
  }

  a:hover {
    color: #24c8db;
  }

  input,
  button {
    color: #ffffff;
    background-color: #0f0f0f98;
  }
  button:active {
    background-color: #0f0f0f69;
  }
}

```
`src\title.ts`:

```ts
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

```
`src\types.ts`:

```ts
export interface Tab {
  id: string;
  label: string;
  // 画面を作る(最初に1回)
  mount(el: HTMLElement): void;
  // フォルダが選ばれた(選び直された)とき。JSONの読み込みはここで行う
  onRoot(): void | Promise<void>;
}

```
`src\util.ts`:

```ts
// 全タブで使う小さな道具
import * as fs from './fs';

export const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
export const round4 = (v: number) => Math.round(v * 10000) / 10000;
export const round1 = (v: number) => Math.round(v * 10) / 10;
export const pick = <T>(v: T | undefined | null, d: T): T => (v === undefined || v === null ? d : v);

// 元に戻す(状態を JSON 文字列で積む)
export class Undo {
  private st: string[] = [];
  push(s: string) { this.st.push(s); if (this.st.length > 100) this.st.shift(); }
  pop(): string | undefined { return this.st.pop(); }
  clear() { this.st = []; }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svgEl(tag: string, attrs: Record<string, string | number>, parent?: Element): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.append(e);
  return e;
}

// ---- プレビュー用の画像(URL と大きさ)。読み込みが終わると onReady が呼ばれる ----
export interface ImgInfo { url: string; w: number; h: number; aspect: number }
const info = new Map<string, ImgInfo | null>();
const pending = new Set<string>();
fs.onRootChange(() => { info.clear(); pending.clear(); });

export function imgInfo(path: string, onReady: () => void): ImgInfo | null {
  if (!path) return null;
  if (info.has(path)) return info.get(path) ?? null;
  if (!pending.has(path)) {
    pending.add(path);
    void (async () => {
      let result: ImgInfo | null = null;
      const url = await fs.imageUrl(path);
      if (url) {
        const im = new Image();
        im.src = url;
        try { await im.decode(); result = { url, w: im.naturalWidth, h: im.naturalHeight, aspect: im.naturalWidth / im.naturalHeight }; } catch { /* 読めない */ }
      }
      info.set(path, result);
      pending.delete(path);
      onReady();
    })();
  }
  return null;
}

export function dropImg(path: string) {
  info.delete(path);
  pending.delete(path);
  fs.forgetImage(path);
}

// 選んだ画像ファイルを、サイトのフォルダ(rel)にそのままコピーする
export async function importImage(file: File, rel: string) {
  await fs.writeBinary(rel, new Uint8Array(await file.arrayBuffer()));
  dropImg(rel);
}

// いま表示されているタブか(ショートカットを、自分のタブでだけ効かせるため)
export const isActive = (el: HTMLElement) => el.classList.contains('on');

```
`src\works.ts`:

```ts
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

```
`vite.config.ts`:

```ts
import { defineConfig } from "vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

```