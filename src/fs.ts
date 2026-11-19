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

