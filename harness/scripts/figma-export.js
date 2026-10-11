// 판정자(qa-judge)가 use_figma에 그대로 넣어 실행하는 "읽기 전용" 스크립트.
// 실행 전 아래 값을 바꾼다:  __PAGE_ID__ → 결과가 있는 페이지 ID,  __MODULE_ID__ → plan.json templates.mobileLiveModule,
//                             __WRAPPER__ → 그대로 두면 가장 최근 전면CG_묶음
// 결과(JSON)를 오케스트레이터가 runs/<slug>/check/figma-export.json 으로 저장한다.
const PAGE_ID = '__PAGE_ID__';
const WRAPPER = '__WRAPPER__';
const MODULE_ID = '__MODULE_ID__';
const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);

const fontOf = t => (t.fontName === figma.mixed ? 'mixed' : `${t.fontName.family} ${t.fontName.style}`);
function shown(n, root) { let q = n; while (q && q !== root) { if (!q.visible) return false; q = q.parent; } return true; }
async function templateFont(textNode, root) {
  // 가장 바깥 인스턴스(= 카드·배너 템플릿)의 원본 컴포넌트에서 "같은 위치"의 글자 레이어 폰트를 찾는다.
  // 인스턴스 하위 레이어 ID는 "I<인스턴스ID>;<원본 컴포넌트 안의 ID>" 형식이라 위치를 정확히 짝지을 수 있다.
  // (템플릿이 안쪽 부품의 굵기를 바꿔 둔 경우도 템플릿 기준으로 비교된다)
  let outer = null;
  for (let q = textNode.parent; q; q = q.parent) { if (q.type === 'INSTANCE') outer = q; if (q === root) break; }
  if (!outer) return null;
  const prefix = 'I' + outer.id + ';';
  if (textNode.id.startsWith(prefix)) {
    const rel = textNode.id.slice(prefix.length);
    // 1순위: 전면 프레임 템플릿(#MobileLive-Module) 안의 같은 이름 카드 — 플러그인은 이 카드를 그대로 쓰므로 여기서 바꿔 둔 스타일이 기준
    if (MODULE_ID && MODULE_ID !== '__MODULE_ID__') {
      const mod = await figma.getNodeByIdAsync(MODULE_ID);
      const modCard = mod && mod.findOne(n => n.type === 'INSTANCE' && n.name === outer.name);
      const viaModule = modCard && await figma.getNodeByIdAsync('I' + modCard.id + ';' + rel);
      if (viaModule && viaModule.type === 'TEXT') return fontOf(viaModule);
    }
    // 2순위: 카드·배너 컴포넌트 원본
    const src = await figma.getNodeByIdAsync(rel);
    if (src && src.type === 'TEXT') return fontOf(src);
  }
  // ID로 못 찾으면 같은 이름 + 같은 순번으로 짝짓기
  const mc = await outer.getMainComponentAsync();
  if (!mc) return null;
  const idx = outer.findAll(n => n.type === 'TEXT' && n.name === textNode.name).indexOf(textNode);
  const src = mc.findAll(n => n.type === 'TEXT' && n.name === textNode.name)[idx];
  return src ? fontOf(src) : null;
}
async function textsOf(root) {
  const out = [];
  for (const t of root.findAll(n => n.type === 'TEXT')) {
    out.push({ layer: t.name, chars: t.characters, visible: shown(t, root), font: fontOf(t), templateFont: await templateFont(t, root) });
  }
  return out;
}
const pick = prefix => {
  const list = page.children.filter(n => n.name.startsWith(prefix));
  return WRAPPER && WRAPPER !== '__WRAPPER__' ? list.find(n => n.name === WRAPPER) : list[list.length - 1];
};

const wrap = pick('전면CG_묶음');
if (!wrap) return { error: '전면CG_묶음 프레임을 찾을 수 없습니다' };
const slides = [];
for (const s of wrap.children) {
  const cards = [];
  for (const c of s.findAll(n => n.name.startsWith('#MainCard') && (n.type === 'INSTANCE' || n.type === 'FRAME' || n.type === 'COMPONENT'))) {
    if (c.parent && c.parent.name && c.parent.name.startsWith('#MainCard')) continue; // 카드 안의 하위 프레임 제외
    const mc = c.type === 'INSTANCE' ? await c.getMainComponentAsync() : null;
    cards.push({ name: c.name, nodeType: c.type, mainComponentId: mc ? mc.id : null, mainComponentName: mc ? mc.name : null });
  }
  slides.push({ name: s.name, cards, texts: await textsOf(s) });
}
const bwrap = page.children.filter(n => n.name.startsWith('슬림배너_묶음')).slice(-1)[0];
const banners = { exists: Boolean(bwrap), items: [] };
if (bwrap) for (const b of bwrap.children) banners.items.push({ name: b.name, nodeType: b.type, texts: await textsOf(b) });

return { exportedAt: new Date().toISOString(), page: page.name, wrapper: wrap.name, slides, banners };
