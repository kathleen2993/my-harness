#!/usr/bin/env node
// 새 실행 폴더 만들기
// 사용법: node harness/scripts/new-run.mjs <의뢰서.docx> <의뢰자이름> <YYMMDD_HHMM>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, writeJson } from './lib.mjs';

const [docx, requester, when] = process.argv.slice(2);
if (!docx || !requester || !/^\d{6}_\d{4}$/.test(when || '')) {
  console.error('사용법: new-run.mjs <의뢰서.docx> <의뢰자이름> <YYMMDD_HHMM>   예: new-run.mjs 의뢰서.docx 홍길동 261020_1100');
  process.exit(2);
}
const slug = `${when}_${requester}`;
const run = path.join(ROOT, 'runs', slug);
if (fs.existsSync(run)) { console.error(`이미 있는 실행입니다: runs/${slug} → "전면 이어서 해줘"로 이어서 진행하세요`); process.exit(1); }
for (const d of ['input', 'plan', 'check']) fs.mkdirSync(path.join(run, d), { recursive: true });
const src = path.resolve(docx);
fs.copyFileSync(src, path.join(run, 'input', path.basename(docx)));
// 옛날 Word 형식(.doc)은 .docx로 바꿔서 함께 둔다 (원본 .doc도 보관)
// 1순위: Microsoft Word (표가 그대로 남음) / 2순위: Mac 내장 textutil (표가 사라져 슬라이드 칸 인식이 안 될 수 있음)
if (/\.doc$/i.test(docx)) {
  const out = path.join(run, 'input', path.basename(docx).replace(/\.doc$/i, '.docx'));
  const script = 'on run argv\n tell application "Microsoft Word"\n open (POSIX file (item 1 of argv))\n set d to active document\n save as d file name (item 2 of argv) file format format document\n close d saving no\n end tell\nend run';
  const word = spawnSync('osascript', ['-e', script, src, out], { encoding: 'utf8', timeout: 120000 });
  if (word.status === 0 && fs.existsSync(out)) {
    console.log('.doc 파일을 Microsoft Word로 .docx 변환했습니다: input/' + path.basename(out));
  } else {
    const r = spawnSync('textutil', ['-convert', 'docx', '-output', out, src], { encoding: 'utf8' });
    if (r.status !== 0 || !fs.existsSync(out)) { console.error('.doc → .docx 변환 실패. Word에서 .docx로 저장한 뒤 다시 실행하세요.'); process.exit(3); }
    console.log('⚠️ Word 변환 실패 → textutil로 변환했습니다. 표가 사라져 슬라이드 칸을 못 찾을 수 있습니다. 가능하면 Word에서 .docx로 저장해 주세요.');
  }
}
writeJson(path.join(run, 'state.json'), { run: slug, created: new Date().toISOString(), stage: 'p1', gates: {} });
console.log(`runs/${slug} 생성 완료 (input/ plan/ check/ state.json)`);
