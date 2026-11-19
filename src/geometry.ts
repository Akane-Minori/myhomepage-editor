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

