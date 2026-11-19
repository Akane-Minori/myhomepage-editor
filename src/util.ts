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

