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

