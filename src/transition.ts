import * as fs from './fs';
import type { Tab } from './types';

type Ease = 'linear' | 'step' | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic' | 'easeOutBack' | 'easeOutBounce';
type Key = { t: number; v: number; ease?: Ease };
type Target = { selector: string; pre?: string; rotate?: number; fps?: number; tracks: Record<string, Key[]> };
type Transition = { duration: number; background?: {t:number;v:string}[]; noise?: {t:number;v:string}[]; grid?: Record<string, any>; targets: Target[] };
const SCENES = ['title','hello','works','games','illusts','musics','diary'];
const PROPS = ['ox','oy','scale','rotAnim','alpha','blind','mono'];
const DEF: Record<string,number> = {ox:0,oy:0,scale:1,rotAnim:0,alpha:1,blind:1,mono:0};
let reloadTransitionData: (() => Promise<void>) | null = null;
const EASES: Ease[] = ['linear','step','easeInCubic','easeOutCubic','easeInOutCubic','easeOutBack','easeOutBounce'];
const empty = (): Transition => ({duration:1,background:[],noise:[],grid:{color:[],amount:[],ox:[],oy:[],pixel:[],interval:[]},targets:[]});
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));

export const transitionTab: Tab = {
 id:'transition', label:'シーン遷移',
 mount(root) {
  root.innerHTML = `<div class="tr-editor">
   <aside class="tr-side">
    <h3>遷移設定</h3><div class="tr-row"><select class="tr-pair"></select></div>
    <div class="tr-row"><label>遷移元<select class="tr-from"></select></label><label>遷移先<select class="tr-to"></select></label></div>
    <div class="tr-row"><button class="btn tr-new">新規</button><button class="btn tr-copy">複製</button><button class="btn btn--danger tr-delete">削除</button></div>
    <label>長さ (秒)<input class="tr-duration" type="number" min="0.05" step="0.1"></label>
    <h3>対象要素</h3><select class="tr-targets"></select>
    <div class="tr-row"><button class="btn tr-add-target">要素を追加</button><button class="btn tr-dup-target">複製</button><button class="btn btn--danger tr-del-target">削除</button></div>
    <label>CSSセレクタ<input class="tr-selector" list="tr-selectors" placeholder="#title, .scene-title"></label>
    <label>基準の transform (pre)<input class="tr-pre" placeholder="translate(-50%, -50%)"></label>
    <div class="tr-row"><label>基準回転°<input class="tr-rotate" type="number"></label><label>コマ落ちfps<input class="tr-fps" type="number" min="0"></label></div>
    <p class="hint">fps が 0 の場合は滑らかに再生します。</p>
    <h3>キーの編集</h3><div class="tr-keyform"><p class="hint">タイムライン上のキーを選択してください。</p></div>
    <div class="tr-row"><button class="btn tr-add-key">現在時刻にキー追加</button><button class="btn btn--danger tr-remove-key">キー削除</button></div>
    <h3>JSON</h3><div class="tr-row"><button class="btn btn--primary tr-save">transitions.json に保存</button><button class="btn tr-copy-json">JSONコピー</button></div>
    <textarea class="tr-json" spellcheck="false"></textarea>
    <div class="tr-row"><button class="btn tr-load-json">JSONを読み込む</button><button class="btn tr-import">ファイルから</button><input class="tr-file" type="file" accept=".json,application/json" hidden></div>
    <p class="hint">保存先: json/transitions.json</p>
   </aside>
   <section class="tr-work"><div class="tr-preview"><div class="tr-preview-screen"><div class="tr-preview-bg"></div><div class="tr-preview-label">プレビュー</div></div></div>
    <div class="tr-transport"><button class="btn tr-play">▶</button><input class="tr-time" type="range" min="0" max="1" step="0.001"><output class="tr-clock">0.00 / 1.00</output></div>
    <div class="tr-lanes"></div>
    <p class="hint">レーンをダブルクリックするとキーを追加できます。キーをドラッグすると時刻を変更します。</p>
   </section><datalist id="tr-selectors"></datalist></div>`;
  const $=<T extends HTMLElement = HTMLInputElement>(s:string)=>root.querySelector<T>(s)!;
  let data:Record<string,Transition>={'title>hello':empty()}, pair='title>hello', targetIndex=0, time=0, playing=false, selected:{prop:string,key:Key}|null=null;
  let raf=0,last=0;
  const tr=()=>data[pair]; const target=()=>tr()?.targets[targetIndex];
  const sorted=(a:Key[])=>[...a].sort((x,y)=>x.t-y.t);
  const getKeys=(g:Target,p:string)=>g.tracks[p]??(g.tracks[p]=[]);
  function evalKeys(a:Key[],t:number,d:number){const k=sorted(a);if(!k.length)return d;if(t<=k[0].t)return k[0].v;if(t>=k[k.length-1].t)return k[k.length-1].v;let i=0;while(k[i+1].t<t)i++;const x=k[i],y=k[i+1];let u=(t-x.t)/(y.t-x.t);const e=x.ease||'linear';let v=u;if(e==='step')v=0;else if(e==='easeInCubic')v=u**3;else if(e==='easeOutCubic')v=1-(1-u)**3;else if(e==='easeInOutCubic')v=u<.5?4*u**3:1-(-2*u+2)**3/2;else if(e==='easeOutBack')v=1+2.70158*(u-1)**3+1.70158*(u-1)**2;else if(e==='easeOutBounce'){const n=7.5625,z=2.75;v=u<1/z?n*u*u:u<2/z?n*(u-=1.5/z)*u+.75:u<2.5/z?n*(u-=2.25/z)*u+.9375:n*(u-=2.625/z)*u+.984375;}return x.v+(y.v-x.v)*v;}
  function normalize(){for(const [k,v] of Object.entries(data)){if(!/^[a-z]+>[a-z]+$/.test(k)||!v||typeof v!=='object'){delete data[k];continue;}v.duration=Math.max(.05,+v.duration||1);v.targets=Array.isArray(v.targets)?v.targets:[];v.targets.forEach(g=>{g.selector=String(g.selector||'');g.tracks=g.tracks&&typeof g.tracks==='object'?g.tracks:{};});}}
  function snapshot(){return JSON.stringify(data,null,2)}
  function updateJson(){ $('.tr-json').value=snapshot(); }
  function fillSelect(el:HTMLSelectElement,items:string[],value:string){el.replaceChildren(...items.map(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;return o;}));el.value=value;}
  function render(){normalize();const pairs=Object.keys(data);if(!pairs.length){data['title>hello']=empty();pair='title>hello';}if(!data[pair])pair=Object.keys(data)[0];
   fillSelect($<HTMLSelectElement>('.tr-pair'),Object.keys(data),pair);const [from,to]=pair.split('>');fillSelect($<HTMLSelectElement>('.tr-from'),SCENES,from);fillSelect($<HTMLSelectElement>('.tr-to'),SCENES,to);
   $('.tr-duration').value=String(tr().duration);$('.tr-time').max=String(tr().duration);$('.tr-time').value=String(time);$('.tr-clock').textContent=`${time.toFixed(2)} / ${tr().duration.toFixed(2)}`;
   const names=tr().targets.map((g,i)=>`${i+1}. ${g.selector||'(未設定)'}`);fillSelect($<HTMLSelectElement>('.tr-targets'),names,names[targetIndex]||'');
   const g=target();$('.tr-selector').disabled=!g;$('.tr-pre').disabled=!g;$('.tr-rotate').disabled=!g;$('.tr-fps').disabled=!g;
   if(g){$('.tr-selector').value=g.selector;$('.tr-pre').value=g.pre||'';$('.tr-rotate').value=String(g.rotate||0);$('.tr-fps').value=String(g.fps||0);}
   renderLanes();renderKeyForm();updateJson();drawPreview();
  }
  function renderLanes(){const box=$('.tr-lanes');box.replaceChildren();const g=target();if(!g){box.innerHTML='<p class="hint">対象要素を追加してください。</p>';return;}
   for(const p of PROPS){const row=document.createElement('div');row.className='tr-lane-row';const label=document.createElement('b');label.textContent=p;const lane=document.createElement('div');lane.className='tr-lane';const head=document.createElement('i');head.className='tr-head';head.style.left=`${time/tr().duration*100}%`;lane.append(head);
    const arr=getKeys(g,p);for(const k of arr){const mark=document.createElement('button');mark.className='tr-key'+(selected?.key===k?' on':'');mark.style.left=`${clamp(k.t/tr().duration,0,1)*100}%`;mark.title=`${k.t.toFixed(2)}s: ${k.v}`;mark.onpointerdown=e=>{e.preventDefault();selected={prop:p,key:k};mark.setPointerCapture(e.pointerId);const move=(ev:PointerEvent)=>{const r=lane.getBoundingClientRect();k.t=Math.round(clamp((ev.clientX-r.left)/r.width,0,1)*tr().duration*100)/100;time=k.t;render();};mark.onpointermove=move;mark.onpointerup=()=>{mark.onpointermove=null;};renderKeyForm();};mark.onclick=()=>{selected={prop:p,key:k};renderKeyForm();renderLanes();};lane.append(mark);}
    lane.ondblclick=e=>{if(e.target!==lane)return;const r=lane.getBoundingClientRect(),t=Math.round(clamp((e.clientX-r.left)/r.width,0,1)*tr().duration*100)/100;const k:Key={t,v:evalKeys(arr,t,DEF[p]),ease:'linear'};arr.push(k);selected={prop:p,key:k};time=t;render();};row.append(label,lane);box.append(row);
   }
  }
  function renderKeyForm(){const box=$('.tr-keyform');if(!selected){box.innerHTML='<p class="hint">タイムライン上のキーを選択してください。</p>';return;}const {prop,key}=selected;box.innerHTML=`<label>プロパティ ${prop}</label><label>時刻<input class="kf-time" type="number" min="0" step="0.01"></label><label>値<input class="kf-value" type="number" step="0.01"></label><label>イージング<select class="kf-ease">${EASES.map(e=>`<option>${e}</option>`).join('')}</select></label>`;$('.kf-time').value=String(key.t);$('.kf-value').value=String(key.v);$('.kf-ease').value=key.ease||'linear';$('.kf-time').onchange=()=>{key.t=clamp(+$<HTMLInputElement>('.kf-time').value,0,tr().duration);time=key.t;render();};$('.kf-value').onchange=()=>{key.v=+$<HTMLInputElement>('.kf-value').value||0;updateJson();drawPreview();};$('.kf-ease').onchange=()=>{key.ease=$<HTMLSelectElement>('.kf-ease').value as Ease;updateJson();};}
  function drawPreview(){const g=target();const bg=$('.tr-preview-bg');bg.style.background=tr().background?.[0]?.v||'#dfe5ea';const label=$('.tr-preview-label');if(!g){label.style.transform='';label.style.opacity='1';return;}const vals:Record<string,number>={};for(const p of PROPS)vals[p]=evalKeys(getKeys(g,p),time,DEF[p]);label.style.transform=`translate(${vals.ox}px,${vals.oy}px) ${g.pre||''} rotate(${(g.rotate||0)+vals.rotAnim}deg) scale(${vals.scale})`;label.style.opacity=String(vals.alpha);label.style.filter=vals.mono>0?`grayscale(${vals.mono*100}%)`:'';label.style.maskImage=vals.blind>=1?'':'linear-gradient(to right,#000 50%,transparent 50%)';}
  function setPair(n:string){pair=n;targetIndex=0;selected=null;time=0;playing=false;render();}
  function addPair(copy=false){const [f]=pair.split('>');let n='';for(const a of [f,...SCENES]){for(const b of SCENES){const k=`${a}>${b}`;if(a!==b&&!data[k]){n=k;break;}}if(n)break;}if(!n)return;data[n]=copy?JSON.parse(JSON.stringify(tr())):empty();setPair(n);}
  $('.tr-pair').onchange=()=>setPair($('.tr-pair').value);
  const changeScene=()=>{const n=$('.tr-from').value+'>'+$('.tr-to').value;if(n===pair)return;if($('.tr-from').value===$('.tr-to').value||data[n]){render();return;}data[n]=tr();delete data[pair];setPair(n);};$('.tr-from').onchange=changeScene;$('.tr-to').onchange=changeScene;
  $('.tr-new').onclick=()=>addPair(false);$('.tr-copy').onclick=()=>addPair(true);$('.tr-delete').onclick=()=>{if(Object.keys(data).length<2)return;delete data[pair];setPair(Object.keys(data)[0]);};
  $('.tr-duration').onchange=()=>{tr().duration=Math.max(.05,+$('.tr-duration').value||1);time=clamp(time,0,tr().duration);render();};
  $('.tr-targets').onchange=()=>{targetIndex=$<HTMLSelectElement>('.tr-targets').selectedIndex;selected=null;render();};
  $('.tr-add-target').onclick=()=>{tr().targets.push({selector:'',tracks:{}});targetIndex=tr().targets.length-1;render();};$('.tr-dup-target').onclick=()=>{const g=target();if(!g)return;tr().targets.splice(targetIndex+1,0,JSON.parse(JSON.stringify(g)));targetIndex++;render();};$('.tr-del-target').onclick=()=>{if(!target())return;tr().targets.splice(targetIndex,1);targetIndex=clamp(targetIndex,0,tr().targets.length-1);selected=null;render();};
  $('.tr-selector').onchange=()=>{if(target())target()!.selector=$('.tr-selector').value.trim();render();};$('.tr-pre').onchange=()=>{if(target())target()!.pre=$('.tr-pre').value.trim();updateJson();drawPreview();};$('.tr-rotate').onchange=()=>{if(target())target()!.rotate=+$<HTMLInputElement>('.tr-rotate').value||0;updateJson();drawPreview();};$('.tr-fps').onchange=()=>{if(target())target()!.fps=Math.max(0,+$<HTMLInputElement>('.tr-fps').value||0);updateJson();};
  $('.tr-add-key').onclick=()=>{const g=target();if(!g)return;const p=selected?.prop||'ox',a=getKeys(g,p),k:Key={t:time,v:evalKeys(a,time,DEF[p]),ease:'linear'};a.push(k);selected={prop:p,key:k};render();};$('.tr-remove-key').onclick=()=>{if(!selected)return;const a=getKeys(target()!,selected.prop),i=a.indexOf(selected.key);if(i>=0)a.splice(i,1);selected=null;render();};
  $('.tr-time').oninput=()=>{time=+$<HTMLInputElement>('.tr-time').value;drawPreview();$('.tr-clock').textContent=`${time.toFixed(2)} / ${tr().duration.toFixed(2)}`;};$('.tr-play').onclick=()=>{playing=!playing;if(playing&&time>=tr().duration)time=0;last=performance.now();};
  const tick=(now:number)=>{if(!root.isConnected){cancelAnimationFrame(raf);return;}raf=requestAnimationFrame(tick);if(playing){time+=Math.min(.1,(now-last)/1000);last=now;if(time>=tr().duration){time=tr().duration;playing=false;}$('.tr-time').value=String(time);$('.tr-clock').textContent=`${time.toFixed(2)} / ${tr().duration.toFixed(2)}`;drawPreview();}};raf=requestAnimationFrame(tick);
  $('.tr-save').onclick=async()=>{try{await fs.writeJson('json/transitions.json',data);fs.setStatus('transitions.json を保存しました');}catch(e){alert('保存できませんでした: '+String(e));}};
  $('.tr-copy-json').onclick=async()=>{try{await navigator.clipboard.writeText($('.tr-json').value);fs.setStatus('JSONをコピーしました');}catch{($('.tr-json') as HTMLTextAreaElement).select();}};
  $('.tr-load-json').onclick=()=>{try{const v=JSON.parse($('.tr-json').value);if(!v||Array.isArray(v)||typeof v!=='object')throw 0;data=v;pair=Object.keys(data)[0];selected=null;time=0;render();fs.setStatus('JSONを読み込みました');}catch{alert('JSONの形式が正しくありません。');}};
  $('.tr-import').onclick=()=>$('.tr-file').click();$('.tr-file').onchange=async()=>{const f=$<HTMLInputElement>('.tr-file').files?.[0];if(!f)return;$('.tr-json').value=await f.text();$('.tr-load-json').click();$('.tr-file').value='';};
  reloadTransitionData = async () => {
   const loaded = await fs.readJson<Record<string,Transition>>('json/transitions.json', {'title>hello':empty()});
   if (loaded && typeof loaded === 'object' && Object.keys(loaded).length) { data = loaded; pair = Object.keys(data)[0]; targetIndex = 0; selected = null; time = 0; playing = false; render(); }
  };
  render();
 },
 async onRoot(){
  if (reloadTransitionData) { await reloadTransitionData(); fs.setStatus('シーン遷移を読み込みました'); }
 }
};
