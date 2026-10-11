#!/usr/bin/env node
// 게이트·훅 회귀 테스트: 규칙을 고칠 때마다 기존 판정이 깨지지 않았는지 한 번에 확인한다.
// 사용법: node harness/tests/run-tests.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../scripts/lib.mjs';

const RUN_REL = 'runs/__test__';
const RUN = path.join(ROOT, RUN_REL);
const S = f => path.join(ROOT, 'harness', 'scripts', f);
const FX = path.join(ROOT, 'harness', 'tests', 'fixtures');
const clone = o => JSON.parse(JSON.stringify(o));
const goodPlan = JSON.parse(fs.readFileSync(path.join(FX, 'plan.good.json'), 'utf8'));
const goodExport = JSON.parse(fs.readFileSync(path.join(FX, 'figma-export.good.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(cond, name) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; }
function setup() {
  fs.rmSync(RUN, { recursive: true, force: true });
  for (const d of ['input', 'plan', 'check']) fs.mkdirSync(path.join(RUN, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'samples', 'sample_request.docx'), path.join(RUN, 'input', 'sample_request.docx'));
  fs.writeFileSync(path.join(RUN, 'state.json'), JSON.stringify({ run: '__test__', stage: 'p1', gates: {} }));
}
const writePlan = p => fs.writeFileSync(path.join(RUN, 'plan', 'plan.json'), JSON.stringify(p, null, 2));
const writeExport = e => fs.writeFileSync(path.join(RUN, 'check', 'figma-export.json'), JSON.stringify(e, null, 2));
function verify(cmd) { return spawnSync('node', [S('verify.mjs'), cmd, RUN_REL], { cwd: ROOT, encoding: 'utf8' }); }
function gateResult(name) { return JSON.parse(fs.readFileSync(path.join(RUN, 'check', `${name}.json`), 'utf8')); }
function failedIds(name) { return gateResult(name).checks.filter(c => !c.pass).map(c => c.id); }
function guard(script, input) { return spawnSync('node', [S(script)], { input: JSON.stringify(input), encoding: 'utf8' }).status; }

// ---------- 의뢰서 표 해석 ----------
console.log('\n[의뢰서 번호 칸 해석]');
{
  const { slideCellsFromTables } = await import('../scripts/lib.mjs');
  const n = rows => slideCellsFromTables([rows]).length;
  ok(n([['1혜택전면', '2 구성전면', '3'], ['a', 'b', 'c']]) === 3, '"1혜택전면 / 2 구성전면 / 3" → 번호 행');
  ok(n([['1(1단, 포맷)', '2.', '6 (통전면으로 크게 제작)'], ['a', 'b', 'c']]) === 0, '이어지지 않는 번호(1,2,6) → 번호 행 아님');
  ok(n([['2단 박스 분리'], ['a']]) === 0 && n([['5만원 이상'], ['a']]) === 0, '"2단", "5만원" → 번호 아님');
  const inferred = slideCellsFromTables([[['1', '2', '3'], ['a', 'b', 'c'], ['', '', ''], ['d', 'e', 'f']]]);
  ok(inferred.length === 6 && inferred[3].num === 4 && /추정/.test(inferred[3].note), '비어 있는 번호 행 → 4·5·6으로 추정 + 메모');
}

// ---------- gate1 ----------
console.log('\n[게이트1: 기획 검사]');
setup(); writePlan(goodPlan);
let r = verify('gate1');
ok(r.status === 0, '정상 기획 → PASS');
if (r.status !== 0) console.log(r.stdout, r.stderr);

const g1Cases = [
  ['계산한 가격(35,401) → price_source_match', p => { p.slides[1].discountPrice = '35,401'; }, 'price_source_match'],
  ['원문 가격(32,922) 누락 → price_source_match', p => { delete p.slides[1].dualDiscountPrice; p.slides[1].hasDual = false; }, 'price_source_match'],
  ['상품명 누락 → required_field_missing', p => { delete p.slides[2].prdTitle; }, 'required_field_missing'],
  ['"(이미지)"를 글자로 → image_instruction_as_text', p => { p.slides[5].storySub = '(이미지)'; }, 'image_instruction_as_text'],
  ['판단 필요 남음 → judgment_needed', p => { Object.assign(p.slides[3], { manual: false, judgment: '판단 필요', judgmentReason: '2단 다상품' }); }, 'judgment_needed'],
  ['체크 항목 6개 → checklist_max_items', p => { p.slides[0].listItems = ['a', 'b', 'c', 'd', 'e', 'f']; }, 'checklist_max_items'],
  ['빈 전면 빠짐 → slide_count_match', p => { p.slides.pop(); }, 'slide_count_match'],
  ['타입 없음 → type_missing', p => { delete p.slides[2].compType; }, 'type_missing'],
  ['다상품형 상품 1개뿐 → required_field_missing', p => { p.slides[3].items.pop(); }, 'required_field_missing'],
  ['다상품형 상품 가격 누락 → price_source_match', p => { delete p.slides[3].items[1].discountPrice; delete p.slides[3].items[1].discountRate; }, 'price_source_match'],
  ['사은품명 없음 → required_field_missing', p => { p.slides[4].gifts[0].name = ''; }, 'required_field_missing'],
];
for (const [name, mutate, id] of g1Cases) {
  setup(); const p = clone(goodPlan); mutate(p); writePlan(p);
  r = verify('gate1');
  ok(r.status === 1 && failedIds('gate1').includes(id), name);
}

console.log('\n[게이트1: 실패 한도]');
setup(); { const p = clone(goodPlan); p.slides[1].discountPrice = '35,401'; writePlan(p); }
verify('gate1'); verify('gate1'); verify('gate1');
ok(gateResult('gate1').result === 'blocked', '같은 게이트 3회 실패 → BLOCKED');

// ---------- gate2 ----------
console.log('\n[게이트2: Figma 검사]');
setup(); writePlan(goodPlan); writeExport(goodExport);
r = verify('gate2');
ok(r.status === 0, '정상 결과 → PASS');
if (r.status !== 0) console.log(r.stdout, r.stderr);

const txt = (e, slide, layer) => e.slides[slide].texts.find(t => t.layer === layer);
const g2Cases = [
  ['Figma 가격 오기입(35,401) → price_mismatch', e => { txt(e, 1, '#Discounted price_txt').chars = '35,401'; }, 'price_mismatch'],
  ['카드가 detach됨 → card_detached', e => { e.slides[1].cards[0].nodeType = 'FRAME'; e.slides[1].cards[0].mainComponentId = null; }, 'card_detached'],
  ['다른 컴포넌트로 만든 카드 → card_detached', e => { e.slides[2].cards[0].mainComponentId = '1:817'; }, 'card_detached'],
  ['사은품 금액대별 목록이 안 보임 → content_missing', e => { e.slides[4].texts.forEach(x => { if (x.layer.startsWith('#Check_')) x.visible = false; }); }, 'content_missing'],
  ['상품명이 Figma에 없음 → content_missing', e => { e.slides[2].texts = e.slides[2].texts.filter(x => x.layer !== '#Prd_Title_txt'); }, 'content_missing'],
  ['다상품형 Figma 가격 누락 → price_mismatch', e => { e.slides[3].texts = e.slides[3].texts.filter(x => x.chars !== '41,600'); }, 'price_mismatch'],
  ['더미 글자 남음 → dummy_text', e => { txt(e, 1, '#Prd_Title_txt').chars = '#Prd_Title_txt'; }, 'dummy_text'],
  ['폰트 대체됨 → font_substituted', e => { txt(e, 1, '#Prd_Title_txt').font = 'Inter Bold'; }, 'font_substituted'],
  ['순서 이름 틀림 → slide_count_match', e => { e.slides[2].name = '05_#MobileLive-Module'; }, 'slide_count_match'],
  ['슬림배너 없음 → banner_required_if_requested', e => { e.banners = { exists: false, items: [] }; }, 'banner_required_if_requested'],
  ['빈 전면에 카드 있음 → empty_slide_required_if_requested', e => { e.slides[6].cards = [{ name: '#MainCard_Prd', nodeType: 'INSTANCE', mainComponentId: '7:564' }]; }, 'empty_slide_required_if_requested'],
];
for (const [name, mutate, id] of g2Cases) {
  setup(); writePlan(goodPlan); const e = clone(goodExport); mutate(e); writeExport(e);
  r = verify('gate2');
  ok(r.status === 1 && failedIds('gate2').includes(id), name);
}

// ---------- 승인 ----------
console.log('\n[승인]');
setup(); writePlan(goodPlan); writeExport(goodExport); verify('gate2');
r = verify('approval-init');
ok(r.status === 0 && fs.existsSync(path.join(RUN, 'approval.md')), 'approval-init → 빈 양식 생성 (exit 0)');
ok(verify('status').status === 0, 'status → exit 0');
ok(verify('없는명령').status === 2, '알 수 없는 명령 → exit 2');
r = verify('approval-check');
ok(r.status === 1 && /WAIT/.test(r.stdout), '미작성 → WAIT');
const ap = path.join(RUN, 'approval.md');
fs.writeFileSync(ap, fs.readFileSync(ap, 'utf8').replace('- 승인자:', '- 승인자: 테스트').replace('결과: 미정', '결과: 승인').replace(/- \[ \]/g, '- [x]'));
r = verify('approval-check');
ok(r.status === 0 && /APPROVED/.test(r.stdout), '사람이 승인 + 체크 4개 → APPROVED');
{ const p = clone(goodPlan); p.bgColor = '#FFFFFF'; writePlan(p); }
r = verify('approval-check');
ok(r.status === 1 && /BLOCKED/.test(r.stdout), '승인 후 기획 변경 → 지문 불일치 BLOCKED');

// ---------- 훅 ----------
console.log('\n[훅: 쓰기 차단]');
const P = f => path.join(ROOT, f);
ok(guard('guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: P('runs/x/approval.md') } }) === 2, 'approval.md 쓰기 → 차단');
ok(guard('guard-write.mjs', { tool_name: 'Edit', tool_input: { file_path: P('runs/x/check/gate2.json') } }) === 2, '게이트 결과 직접 수정 → 차단');
ok(guard('guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: P('runs/x/input/a.docx') } }) === 2, '의뢰서 원본 수정 → 차단');
ok(guard('guard-write.mjs', { tool_name: 'Edit', tool_input: { file_path: P('harness/rules.yaml') } }) === 2, 'rules.yaml 수정 → 차단');
ok(guard('guard-write.mjs', { tool_name: 'Bash', tool_input: { command: 'echo "결과: 승인" > runs/x/approval.md' } }) === 2, 'Bash로 approval.md 쓰기 → 차단');
ok(guard('guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: P('runs/x/plan/plan.json') } }) === 0, 'plan/ 쓰기 → 허용');
ok(guard('guard-write.mjs', { tool_name: 'Bash', tool_input: { command: 'node harness/scripts/verify.mjs gate1 runs/x' } }) === 0, 'verify.mjs 실행 → 허용');
console.log('\n[훅: Figma 읽기 전용]');
ok(guard('guard-figma-readonly.mjs', { tool_name: 'mcp__f__use_figma', tool_input: { code: 'const t = figma.currentPage.findOne(n => n.type === "TEXT"); t.characters = "x";' } }) === 2, '글자 수정 → 차단');
ok(guard('guard-figma-readonly.mjs', { tool_name: 'mcp__f__use_figma', tool_input: { code: 'n.detachInstance();' } }) === 2, 'detach → 차단');
ok(guard('guard-figma-readonly.mjs', { tool_name: 'mcp__f__use_figma', tool_input: { code: fs.readFileSync(S('figma-export.js'), 'utf8') } }) === 0, '검수용 읽기 스크립트 → 허용');

fs.rmSync(RUN, { recursive: true, force: true });
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
