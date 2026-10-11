#!/usr/bin/env node
// 판정 스크립트: 통과/실패는 이 스크립트가 rules.yaml 값으로만 정한다. (에이전트는 의견만)
// 사용법:
//   node harness/scripts/verify.mjs gate1 runs/<slug>
//   node harness/scripts/verify.mjs gate2 runs/<slug>
//   node harness/scripts/verify.mjs approval-init runs/<slug>
//   node harness/scripts/verify.mjs approval-check runs/<slug>
//   node harness/scripts/verify.mjs status runs/<slug>
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readRules, readJson, writeJson, readDocx, slideCellsFromTables, priceTokens, sha256File } from './lib.mjs';

const [cmd, runArg] = process.argv.slice(2);
if (!cmd || !runArg) { console.error('사용법: verify.mjs <gate1|gate2|approval-init|approval-check|status> runs/<slug>'); process.exit(2); }
const RUN = path.resolve(ROOT, runArg);
const rules = readRules();
const P = {
  state: path.join(RUN, 'state.json'),
  plan: path.join(RUN, 'plan', 'plan.json'),
  exportFile: path.join(RUN, 'check', 'figma-export.json'),
  approval: path.join(RUN, 'approval.md'),
  template: path.join(ROOT, 'harness', 'templates', 'approval.md'),
};
function inputDocx() {
  const dir = path.join(RUN, 'input');
  const f = fs.existsSync(dir) && fs.readdirSync(dir).find(n => n.toLowerCase().endsWith('.docx'));
  if (!f) throw new Error('input/ 폴더에 의뢰서(.docx)가 없습니다');
  return path.join(dir, f);
}
const EMPTY_REQ_RE = /(내용|자막|아무것도)\s*없는\s*전면|빈\s*전면/;
const BANNER_REQ_RE = /슬림\s*(배너|전면)|상단\s*(반투명\s*)?슬림/;
const COMP_TYPES = ['#MainCard_Prd', '#MainCard_Checklist', '#MainCard_Story', '#MainCard_MultiPrd', '#MainCard_Gift', 'NONE'];

function stringsIn(obj, skipKeys = new Set(['num', 'type', 'compType', 'judgment', 'judgmentReason'])) {
  const out = [];
  (function walk(v, key) {
    if (skipKeys.has(key)) return;
    if (typeof v === 'string') out.push({ key, value: v });
    else if (Array.isArray(v)) v.forEach(x => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  })(obj, '');
  return out;
}
const isManual = s => s.manual === true;   // 디자이너가 직접 만들기로 정한 슬라이드 (플러그인은 빈 자리만)
const isJudgment = s => !isManual(s) && (Boolean(s.judgment) || s.type === 'JUDGMENT_NEEDED');
const skipContent = s => isManual(s) || isJudgment(s);

function check(id, value, limit, pass, details) { return { id, value, limit, pass, details: details && details.length ? details.slice(0, 30) : undefined }; }

function loadState() {
  return fs.existsSync(P.state) ? readJson(P.state) : { run: path.basename(RUN), stage: 'p1', gates: {} };
}
function finish(gateName, checks, outFile) {
  const state = loadState();
  const prev = state.gates[gateName] || { fails: 0 };
  const allPass = checks.every(c => c.pass);
  const fails = allPass ? prev.fails : prev.fails + 1;
  const max = rules.retry.max_fail_per_gate;
  const result = allPass ? 'pass' : (fails >= max ? 'blocked' : 'fail');
  const report = { gate: gateName, result, fails, maxFails: max, time: new Date().toISOString(), checks };
  writeJson(outFile, report);
  state.gates[gateName] = { result, fails, time: report.time };
  if (allPass) state.stage = gateName === 'gate1' ? 'p3' : 'approval';
  writeJson(P.state, state);
  console.log(`${gateName}: ${result.toUpperCase()} (실패 누적 ${fails}/${max})`);
  for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.id} = ${JSON.stringify(c.value)} (기준 ${JSON.stringify(c.limit)})${c.details ? '\n      ' + c.details.map(d => typeof d === 'string' ? d : JSON.stringify(d)).join('\n      ') : ''}`);
  if (result === 'blocked') console.log('  ⛔ 같은 게이트를 한도만큼 실패했습니다. 디자이너를 호출하세요.');
  process.exit(allPass ? 0 : 1);
}

// ---------------- gate1: 기획 검사 ----------------
function gate1() {
  const g = rules.gate1;
  const doc = readDocx(inputDocx());
  const plan = readJson(P.plan);
  const slides = plan.slides || [];
  const banners = plan.banners || [];
  const checks = [];

  const typeMissing = slides.filter(s => !s.type || !COMP_TYPES.includes(s.compType)).map(s => `#${s.num}: type=${s.type} compType=${s.compType}`);
  checks.push(check('type_missing', typeMissing.length, g.type_missing, typeMissing.length <= g.type_missing, typeMissing));

  const reqMissing = [];
  for (const s of slides) {
    if (skipContent(s) || s.compType === 'NONE') continue;
    if (s.compType === '#MainCard_Prd' && (!s.prdTitle || !s.discountPrice)) reqMissing.push(`#${s.num} 상품형: prdTitle·discountPrice 필수`);
    if (s.compType === '#MainCard_Checklist' && !(s.listItems || []).filter(Boolean).length) reqMissing.push(`#${s.num} 체크리스트형: listItems 1개 이상 필수`);
    if (s.compType === '#MainCard_MultiPrd') {
      const items = s.items || [];
      if (items.length < 2 || items.length > 5) reqMissing.push(`#${s.num} 다상품형: 상품 2~5개 필요 (현재 ${items.length})`);
      items.forEach((it, i) => { if (!it.prdTitle || !it.discountPrice) reqMissing.push(`#${s.num} 다상품형 상품${i + 1}: prdTitle·discountPrice 필수`); });
    }
    if (s.compType === '#MainCard_Gift' && !(s.gifts || []).some(x => x && x.name)) reqMissing.push(`#${s.num} 사은품형: gifts에 사은품명(name) 1개 이상 필수`);
    if (s.compType === '#MainCard_Story' && !['storyMain1', 'storyMain2', 'highlightText', 'storySub'].some(k => s[k]) && !(s.listItems || []).length) reqMissing.push(`#${s.num} 스토리형: 본문 1개 이상 필수`);
  }
  checks.push(check('required_field_missing', reqMissing.length, g.required_field_missing, reqMissing.length <= g.required_field_missing, reqMissing));

  const judg = slides.filter(isJudgment).map(s => `#${s.num}: ${s.judgmentReason || s.judgment}`);
  checks.push(check('judgment_needed', judg.length, g.judgment_needed, judg.length <= g.judgment_needed, judg));

  const over = slides.filter(s => (s.listItems || []).length > g.checklist_max_items).map(s => `#${s.num}: ${s.listItems.length}개`);
  checks.push(check('checklist_max_items', over.length, 0, over.length === 0, over));

  const cells = slideCellsFromTables(doc.tables);
  const emptyReq = EMPTY_REQ_RE.test(doc.text);
  const expected = cells.length + (emptyReq ? 1 : 0);
  checks.push(check('slide_count_match', `${slides.length}/${expected}`, g.slide_count_match, !g.slide_count_match || slides.length === expected,
    [`의뢰서 슬라이드 칸 ${cells.length}개 (${cells.map(c => c.num).join(',')})${emptyReq ? ' + 빈 전면 요청 1' : ''}`]));

  const srcTokens = new Set(priceTokens(doc.text));
  const notInSource = [];
  for (const { key, value } of stringsIn({ slides, banners })) for (const t of priceTokens(value)) if (!srcTokens.has(t)) notInSource.push(`${key}: "${t}" 원문에 없음`);
  // 반대 방향: 의뢰서 칸의 가격이 기획에서 빠졌는가 (판단 필요·직접 제작 슬라이드 제외)
  const omitted = [];
  for (const cell of cells) {
    const sl = slides.find(s => s.num === cell.num);
    if (sl && skipContent(sl)) continue;
    const have = new Set(stringsIn(sl || {}).flatMap(({ value }) => priceTokens(value)));
    for (const t of new Set(priceTokens(cell.text))) if (!have.has(t)) omitted.push(`#${cell.num}: 원문 "${t}"가 기획에 없음`);
  }
  const cellTexts = new Set(cells.map(c => c.text));
  const bannerSrc = doc.tables.filter(rows => !rows.some(r => r.some(c => cellTexts.has(c.trim())))).flat(2).join('\n');
  const bannerHave = new Set(stringsIn({ banners }).flatMap(({ value }) => priceTokens(value)));
  for (const t of new Set(priceTokens(bannerSrc))) if (!bannerHave.has(t)) omitted.push(`슬림배너: 원문 "${t}"가 기획에 없음`);
  const priceProblems = [...notInSource, ...omitted];
  checks.push(check('price_source_match', priceProblems.length === 0, g.price_source_match, !g.price_source_match || priceProblems.length === 0, priceProblems));

  const imgRe = new RegExp(g.image_instruction_pattern);
  const imgText = stringsIn({ slides, banners }).filter(({ value }) => value.split('\n').some(l => imgRe.test(l.trim()))).map(({ key, value }) => `${key}: "${value}"`);
  checks.push(check('image_instruction_as_text', imgText.length, g.image_instruction_as_text, imgText.length <= g.image_instruction_as_text, imgText));

  finish('gate1', checks, path.join(RUN, 'check', 'gate1.json'));
}

// ---------------- gate2: Figma 실제 상태 검사 ----------------
function gate2() {
  const g = rules.gate2;
  const doc = readDocx(inputDocx());
  const plan = readJson(P.plan);
  const ex = readJson(P.exportFile);
  const checks = [];
  const slides = ex.slides || [];
  const bannerItems = (ex.banners && ex.banners.items) || [];
  const allTexts = [...slides.flatMap(s => s.texts || []), ...bannerItems.flatMap(b => b.texts || [])];
  const visible = allTexts.filter(t => t.visible);

  const srcTokens = new Set(priceTokens(doc.text));
  const figmaTokens = visible.flatMap(t => priceTokens(t.chars).map(tok => ({ tok, layer: t.layer })));
  const figmaSet = new Set(figmaTokens.map(x => x.tok));
  const planTokens = stringsIn({ slides: (plan.slides || []).filter(s => !skipContent(s)), banners: plan.banners || [] }).flatMap(({ value }) => priceTokens(value));
  const notInSource = figmaTokens.filter(x => !srcTokens.has(x.tok)).map(x => `Figma ${x.layer}: "${x.tok}" 원문에 없음`);
  const missing = [...new Set(planTokens)].filter(t => !figmaSet.has(t)).map(t => `원문·기획의 "${t}"가 Figma에 없음`);
  const mismatch = notInSource.length + missing.length;
  checks.push(check('price_mismatch', mismatch, g.price_mismatch, mismatch <= g.price_mismatch, [...notInSource, ...missing]));

  const tplIds = new Set(Object.values(plan.templates || {}));
  const detached = [];
  for (const s of slides) for (const c of s.cards || []) {
    if (c.nodeType !== 'INSTANCE') detached.push(`${s.name}: "${c.name}" 은 ${c.nodeType} (인스턴스 아님)`);
    else if (tplIds.size && !tplIds.has(c.mainComponentId)) detached.push(`${s.name}: "${c.name}" 원본 ${c.mainComponentId}가 템플릿이 아님`);
  }
  checks.push(check('card_detached', detached.length, g.card_detached, detached.length <= g.card_detached, detached));

  const dummy = visible.filter(t => t.chars && (t.chars.trim().startsWith('#') || t.chars.trim() === t.layer)).map(t => `${t.layer}: "${t.chars}"`);
  checks.push(check('dummy_text', dummy.length, g.dummy_text, dummy.length <= g.dummy_text, dummy));

  // 기획한 글자가 Figma에 실제로 보이는가 (가격 외 내용 누락 검사)
  const norm = x => String(x || '').replace(/\s+/g, ' ').trim();
  const shownIn = texts => (texts || []).filter(t => t.visible).map(t => norm(t.chars));
  const TEXT_KEYS = new Set(['prdTitle', 'prdSubTitle', 'tag1', 'tag2', 'listItems', 'storyMain1', 'storyMain2', 'highlightText', 'storySub', 'target', 'name', 'condition', 'note', 'main', 'sub']);
  const found = (pool, value) => pool.some(t => t === norm(value) || t.includes(norm(value)));
  const contentMissing = [];
  (plan.slides || []).forEach((s, i) => {
    if (skipContent(s)) return;
    const pool = shownIn(slides[i] && slides[i].texts);   // 기획 i번째 슬라이드 글자는 Figma i번째 전면에서만 찾는다
    const exp = [];
    if (s.title && s.showTitle !== false) exp.push(['title', s.title]);
    for (const { key, value } of stringsIn(s)) if (TEXT_KEYS.has(key) && norm(value)) exp.push([key, value]);
    for (const [key, value] of exp) if (!found(pool, value)) contentMissing.push(`#${s.num} ${key}: "${value}" 가 Figma ${String(i + 1).padStart(2, '0')}번 전면에 보이지 않음`);
  });
  (plan.banners || []).forEach((b, i) => {
    if (norm(b.title) && !found(shownIn(bannerItems[i] && bannerItems[i].texts), b.title)) contentMissing.push(`슬림배너${i + 1} title: "${b.title}" 가 보이지 않음`);
  });
  checks.push(check('content_missing', contentMissing.length, g.content_missing, contentMissing.length <= g.content_missing, contentMissing));

  const fontSub = visible.filter(t => t.templateFont && t.font && t.font !== t.templateFont).map(t => `${t.layer}: ${t.templateFont} → ${t.font}`);
  checks.push(check('font_substituted', fontSub.length, g.font_substituted, fontSub.length <= g.font_substituted, fontSub));

  const expectedN = (plan.slides || []).length;
  const badOrder = slides.map((s, i) => s.name.startsWith(String(i + 1).padStart(2, '0') + '_') ? null : `${i + 1}번째: "${s.name}"`).filter(Boolean);
  checks.push(check('slide_count_match', `${slides.length}/${expectedN}`, g.slide_count_match, !g.slide_count_match || (slides.length === expectedN && badOrder.length === 0), badOrder));

  const bannerReq = BANNER_REQ_RE.test(doc.text) && (plan.banners || []).length > 0;
  const bannerOk = !bannerReq || Boolean(ex.banners && ex.banners.exists && bannerItems.length === plan.banners.length);
  checks.push(check('banner_required_if_requested', bannerOk, g.banner_required_if_requested, !g.banner_required_if_requested || bannerOk,
    bannerReq ? [`요청 ${plan.banners.length}개 / Figma ${bannerItems.length}개`] : ['요청 없음']));

  const emptyReq = EMPTY_REQ_RE.test(doc.text);
  const emptyIdx = (plan.slides || []).map((s, i) => (s.type === 'EMPTY' ? i : -1)).filter(i => i >= 0);
  const emptyOk = !emptyReq || (emptyIdx.length > 0 && emptyIdx.every(i => slides[i] && (slides[i].cards || []).length === 0));
  checks.push(check('empty_slide_required_if_requested', emptyOk, g.empty_slide_required_if_requested, !g.empty_slide_required_if_requested || emptyOk, [emptyReq ? '요청 있음' : '요청 없음']));

  finish('gate2', checks, path.join(RUN, 'check', 'gate2.json'));
}

// ---------------- 승인 ----------------
function approvalInit() {
  if (fs.existsSync(P.approval)) {
    const cur = fs.readFileSync(P.approval, 'utf8');
    const untouched = /결과:\s*미정/.test(cur) && !/^- \[[xX]\]/m.test(cur) && /- 승인자:\s*$/m.test(cur);
    if (!untouched) { console.log('approval.md를 사람이 작성 중입니다. 덮어쓰지 않습니다.'); return; }
    console.log('작성되지 않은 빈 양식이라 새 지문으로 다시 만듭니다.');
  }
  const t = fs.readFileSync(P.template, 'utf8')
    .replace('{{RUN}}', path.basename(RUN))
    .replace('{{DOCX_HASH}}', sha256File(inputDocx()))
    .replace('{{PLAN_HASH}}', sha256File(P.plan));
  fs.writeFileSync(P.approval, t);
  console.log('approval.md 빈 양식을 만들었습니다. 디자이너가 직접 작성하세요.');
}
function approvalCheck() {
  if (!fs.existsSync(P.approval)) { console.log('approval: WAIT (approval.md 없음)'); process.exit(1); }
  const s = fs.readFileSync(P.approval, 'utf8');
  const result = (/결과:\s*(승인|반려)/.exec(s) || [])[1] || '미정';
  const boxes = (s.match(/^- \[( |x|X)\]/gm) || []);
  const checked = boxes.filter(b => /x/i.test(b)).length;
  const docxHash = (/의뢰서 지문:\s*(sha256:[0-9a-f]+)/.exec(s) || [])[1];
  const planHash = (/기획 지문:\s*(sha256:[0-9a-f]+)/.exec(s) || [])[1];
  const hashOk = docxHash === sha256File(inputDocx()) && planHash === sha256File(P.plan);
  const g2 = fs.existsSync(path.join(RUN, 'check', 'gate2.json')) ? readJson(path.join(RUN, 'check', 'gate2.json')).result : 'none';
  let verdict = 'WAIT';
  if (!hashOk) verdict = 'BLOCKED';
  else if (result === '반려') verdict = 'REJECTED';
  else if (result === '승인' && checked === boxes.length && boxes.length > 0 && g2 === 'pass') verdict = 'APPROVED';
  console.log(`approval: ${verdict}  (결과=${result}, 체크 ${checked}/${boxes.length}, 지문 ${hashOk ? '일치' : '불일치 → 승인 무효'}, 게이트2=${g2})`);
  const state = loadState();
  state.approval = { verdict, time: new Date().toISOString() };
  if (verdict === 'APPROVED') state.stage = 'done';
  writeJson(P.state, state);
  process.exit(verdict === 'APPROVED' ? 0 : 1);
}
function status() {
  const st = loadState();
  console.log(JSON.stringify(st, null, 2));
}

try {
  const handlers = { gate1, gate2, 'approval-init': approvalInit, 'approval-check': approvalCheck, status };
  if (!handlers[cmd]) { console.error('알 수 없는 명령: ' + cmd); process.exit(2); }
  handlers[cmd]();
} catch (e) {
  console.error('ERROR: ' + e.message);
  process.exit(3);
}
