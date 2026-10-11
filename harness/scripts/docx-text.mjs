#!/usr/bin/env node
// 의뢰서(.docx)를 슬라이드 칸 단위로 읽어 JSON으로 출력 (분석가가 p1에서 사용)
// 사용법: node harness/scripts/docx-text.mjs runs/<slug>/input/의뢰서.docx
import { readDocx, slideCellsFromTables } from './lib.mjs';
const file = process.argv[2];
if (!file) { console.error('사용법: docx-text.mjs <의뢰서.docx>'); process.exit(2); }
const d = readDocx(file);
const cells = slideCellsFromTables(d.tables);
const inCells = new Set(cells.map(c => c.text));
// 표 밖 문단 (메타데이터, 슬림배너 라벨, 빈 전면 요청 등)과 슬라이드 표가 아닌 표(슬림배너)를 따로 보여준다
const otherTables = d.tables.filter(rows => !rows.some(r => r.some(c => inCells.has(c.trim()))));
console.log(JSON.stringify({ paragraphsOutsideTables: d.paragraphs.filter(p => p.trim() && ![...inCells].some(c => c.includes(p.trim()))), slideCells: cells, otherTables }, null, 2));
