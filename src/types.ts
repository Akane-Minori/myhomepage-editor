export interface Tab {
  id: string;
  label: string;
  // 画面を作る(最初に1回)
  mount(el: HTMLElement): void;
  // フォルダが選ばれた(選び直された)とき。JSONの読み込みはここで行う
  onRoot(): void | Promise<void>;
}

