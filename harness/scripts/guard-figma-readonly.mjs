#!/usr/bin/env node
// PreToolUse 훅 (use_figma): 이 하네스에서 Claude는 Figma를 "읽기만" 한다.
// 생성·수정은 플러그인(사람 실행)이 한다. 코드에 변경 동작이 보이면 막는다.
let raw = '';
process.stdin.on('data', d => (raw += d)).on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const code = String((input.tool_input || {}).code || '');
  const MUTATIONS = [
    /\.characters\s*=(?!=)/, /\.visible\s*=(?!=)/, /\.name\s*=(?!=)/, /\.fills\s*=(?!=)/, /\.fontName\s*=(?!=)/,
    /\.remove\(\)/, /detachInstance\(/, /swapComponent\(/, /setProperties\(/, /appendChild\(/, /insertChild\(/,
    /figma\.create[A-Z]\w*\(/, /\.createInstance\(/, /\.clone\(\)/, /addComponentProperty\(/, /editComponentProperty\(/,
    /\.resize\(/, /\.x\s*=(?!=)/, /\.y\s*=(?!=)/
  ];
  const hit = MUTATIONS.find(re => re.test(code));
  if (hit) {
    console.error(`⛔ 차단: 이 하네스에서 Claude는 Figma를 읽기만 합니다 (감지: ${hit}). 생성·수정은 플러그인으로 하세요.`);
    process.exit(2);
  }
  process.exit(0);
});
