#!/usr/bin/env node
// PreToolUse 훅: 사람 전용·스크립트 전용 파일을 Claude가 직접 쓰지 못하게 막는다.
//  - runs/*/approval.md      → 사람만 (Claude 쓰기 금지)
//  - runs/*/check/gate*.json → verify.mjs만 (Write/Edit 금지)
//  - runs/*/input/**         → 사람만 (new-run.mjs가 복사)
//  - harness/rules.yaml      → 사람만 (판정 기준 임의 변경 금지)
// 막을 때는 exit 2 + 이유를 stderr로 (Claude에게 전달됨)
let raw = '';
process.stdin.on('data', d => (raw += d)).on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const tool = input.tool_name || '';
  const ti = input.tool_input || {};
  const norm = p => String(p || '').replace(/\\/g, '/');
  const PROTECTED = [
    [/\/runs\/[^/]+\/approval\.md$/, 'approval.md는 사람만 작성합니다. 빈 양식은 verify.mjs approval-init으로 만드세요.'],
    [/\/runs\/[^/]+\/check\/gate\d\.json$/, '게이트 결과는 판정 스크립트(verify.mjs)만 씁니다.'],
    [/\/runs\/[^/]+\/input\//, 'input/은 의뢰서 원본입니다. 수정하지 마세요.'],
    [/\/harness\/rules\.yaml$/, '판정 기준(rules.yaml)은 사람이 직접 수정합니다.'],
  ];
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const p = '/' + norm(ti.file_path || ti.notebook_path).replace(/^\/+/, '');
    for (const [re, why] of PROTECTED) if (re.test(p)) { console.error('⛔ 차단: ' + why); process.exit(2); }
  }
  if (tool === 'Bash') {
    const c = String(ti.command || '');
    const writes = /(>>?|\btee\b|\bsed\s+-i|\bcp\b|\bmv\b|\brm\b|\btruncate\b)/.test(c);
    if (writes && /approval\.md/.test(c)) { console.error('⛔ 차단: approval.md는 사람만 작성합니다.'); process.exit(2); }
    if (writes && /check\/gate\d\.json/.test(c)) { console.error('⛔ 차단: 게이트 결과는 verify.mjs만 씁니다.'); process.exit(2); }
    if (writes && /rules\.yaml/.test(c)) { console.error('⛔ 차단: rules.yaml은 사람이 직접 수정합니다.'); process.exit(2); }
  }
  process.exit(0);
});
