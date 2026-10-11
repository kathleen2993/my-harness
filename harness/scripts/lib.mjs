// 하네스 스크립트 공용 함수 (외부 패키지 없이 Node 내장 모듈만 사용)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RULES_PATH = path.join(ROOT, 'harness', 'rules.yaml');

// rules.yaml 읽기: "섹션:" 아래 "  키: 값" 두 단계만 지원 (주석 # 무시)
export function readRules(file = RULES_PATH) {
  const out = {};
  let section = null;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '');
    if (!line.trim()) continue;
    const top = /^([A-Za-z0-9_]+):\s*$/.exec(line);
    if (top) { section = top[1]; out[section] = {}; continue; }
    const kv = /^\s+([A-Za-z0-9_]+):\s*(.+?)\s*$/.exec(line);
    if (kv && section) out[section][kv[1]] = parseScalar(kv[2]);
  }
  return out;
}
function parseScalar(v) {
  if (/^'.*'$/.test(v) || /^".*"$/.test(v)) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function sha256File(file) {
  return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); }

// ---------- .docx → 텍스트 (zip 안의 word/document.xml) ----------
function unzipEntry(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('docx(zip) 형식이 아닙니다');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (name === wanted) {
      const lnlen = buf.readUInt16LE(local + 26), lelen = buf.readUInt16LE(local + 28);
      const data = buf.subarray(local + 30 + lnlen + lelen, local + 30 + lnlen + lelen + csize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error(wanted + ' 를 찾을 수 없습니다');
}
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function paraText(xml) {
  return decode(xml.replace(/<w:tab\/>/g, ' ').replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, ''));
}

// 표 안의 표(중첩 표)까지 정확히 나누기: 바깥 표의 행·칸만 구조로 잡고, 안쪽 표 글자는 그 칸의 텍스트에 포함한다
function parseTables(body) {
  const tokens = [...body.matchAll(/<w:tbl>|<\/w:tbl>|<w:tr[ >]|<\/w:tr>|<w:tc>|<\/w:tc>/g)];
  const tables = [];
  const stack = []; // { tbl, rows, row, cellStart }
  for (const m of tokens) {
    const tag = m[0], at = m.index;
    if (tag === '<w:tbl>') { stack.push({ rows: [], row: null, cellStart: -1, depthCell: 0 }); continue; }
    const top = stack[stack.length - 1];
    if (!top) continue;
    if (tag === '</w:tbl>') {
      stack.pop();
      if (stack.length === 0) tables.push(top.rows);
      continue;
    }
    if (tag.startsWith('<w:tr')) top.row = [];
    else if (tag === '</w:tr>') { if (top.row) top.rows.push(top.row); top.row = null; }
    else if (tag === '<w:tc>') top.cellStart = at + tag.length;
    else if (tag === '</w:tc>' && top.row && top.cellStart >= 0) {
      const cellXml = body.slice(top.cellStart, at);
      top.row.push((cellXml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(paraText).join('\n').trim());
      top.cellStart = -1;
    }
  }
  return tables;
}

// 문서 전체 텍스트 + 표 구조
export function readDocx(file) {
  const xml = unzipEntry(fs.readFileSync(file), 'word/document.xml').toString('utf8');
  const body = xml.replace(/^[\s\S]*?<w:body>/, '').replace(/<\/w:body>[\s\S]*$/, '');
  const paragraphs = (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(paraText);
  return { text: paragraphs.join('\n'), paragraphs, tables: parseTables(body) };
}

// 번호 칸 읽기: "1", "2.", "1혜택전면", "1(1단, 포맷 참고)", "6 (통전면으로 크게 제작)", "2 구성 -> 하단 참고" → { num, note }
// "2단", "3박스", "5만원"처럼 숫자 뒤에 단위가 붙은 내용은 번호로 보지 않는다
const NUM_CELL_RE = /^\s*(\d{1,2})(?!\d)\s*[.:]?\s*([\s\S]*)$/;
// 단위 뒤에 한글이 더 이어지면(구성, 통전면, 포맷) 단위가 아니다
const UNIT_AFTER_NUM = /^(?:(?:만원|천원|박스|세트|가지|시간|인용|단|개|매|종|만|천|원|팩|병|입|구|형|포|통|kg|g|ml|L)(?![가-힣a-z])|[%,]|\.\d)/i;
function readNumCell(c) {
  const m = NUM_CELL_RE.exec(c || '');
  if (!m) return null;
  const rest = m[2];
  if (UNIT_AFTER_NUM.test(rest)) return null;
  const note = rest.replace(/\s+/g, ' ').trim();
  if (note.length > 40) return null;      // 긴 글이면 번호 칸이 아니라 내용 칸
  return { num: parseInt(m[1], 10), note };
}
const isBlankRow = row => row.every(c => !c.trim());

// 표에서 슬라이드 칸 찾기: 번호 행 바로 아래 행의 같은 칸이 슬라이드 내용
// 번호 행이 통째로 비어 있으면(원본에 번호가 빠진 의뢰서), 바로 앞 번호 행에 이어지는 번호로 추정한다
export function slideCellsFromTables(tables) {
  const cells = [];
  for (const rows of tables) {
    let last = null; // { width, nextNum }
    for (let r = 0; r < rows.length - 1; r++) {
      const head = rows[r];
      const nums = head.map(c => (c.trim() ? readNumCell(c) : 'empty'));
      const valid = !nums.some(n => n === null) && nums.some(n => n && n !== 'empty');
      const seq = valid ? nums.filter(n => n !== 'empty').map(n => n.num) : [];
      if (valid && seq.every((n, i) => i === 0 || n === seq[i - 1] + 1)) {
        head.forEach((h, i) => {
          const n = nums[i];
          const content = (rows[r + 1][i] || '').trim();
          if (n !== 'empty' && content) cells.push({ num: n.num, note: n.note, text: content });
        });
        last = { width: head.length, nextNum: Math.max(...seq) + 1 };
        r++; // 내용 행은 건너뛴다
        continue;
      }
      if (last && isBlankRow(head) && head.length === last.width && !isBlankRow(rows[r + 1]) && rows[r + 1].length === last.width) {
        rows[r + 1].forEach((content, i) => {
          if (content.trim()) cells.push({ num: last.nextNum + i, note: '번호 추정 (의뢰서에 번호 없음)', text: content.trim() });
        });
        last = { width: last.width, nextNum: last.nextNum + last.width };
        r++;
      }
    }
  }
  return cells;
}

// 가격·할인율 토큰: 1,000 단위 쉼표 숫자 / 퍼센트
export const PRICE_RE = /\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?%/g;
export function priceTokens(str) { return (String(str || '').match(PRICE_RE) || []); }
