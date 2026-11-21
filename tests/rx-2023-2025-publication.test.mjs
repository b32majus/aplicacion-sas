import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { validatePackageMedia } from "../app/src/exam-media.js";

const root = new URL("../app/public/data/exams/", import.meta.url);
const load = (filename) => JSON.parse(readFileSync(new URL(filename, root), "utf8"));
const variants = [
  ["sas-radiodiagnostico-2023-turno-libre", 2023,
    [17, 26, 33, 41, 49, 57, 65, 74]],
  ["sas-radiodiagnostico-2025-turno-libre", 2025,
    [15, 22, 29, 35, 43, 50, 57, 64, 71]],
  ["sas-radiodiagnostico-2025-promocion-interna", 2025,
    [15, 22, 29, 35, 43, 50, 57, 64, 71]],
];
test("RX 2023/2025: 3 versiones con 75 preguntas y 26 imágenes íntegras", () => {
  const catalog = load("catalog.json");
  assert.equal(catalog.exams.length, 19);
  assert.equal(catalog.exams.filter(e=>e.id.startsWith("sas-administrativo-")).length, 12);
  assert.equal(catalog.exams.filter(e=>e.id.startsWith("sas-radiodiagnostico-")).length, 7);
  for (const [id, year, mediaNumbers] of variants) {
    const entry = catalog.exams.find(e=>e.id===id);
    assert.ok(entry, id);
    const exam = load(id+".json");
    assert.deepEqual(exam, load(entry.latestPath));
    assert.equal(exam.version.id,entry.latestVersion);
    assert.equal(exam.year,year);
    assert.equal(exam.durationMinutes,120);
    assert.equal(exam.qa.state,"publicable");
    assert.equal(exam.questions.length,78);
    assert.equal(exam.scorableSet.count,75);
    assert.deepEqual(exam.scorableSet.annulledNumbers,[]);
    assert.deepEqual(exam.scorableSet.reserveNumbers,[151,152,153]);
    assert.deepEqual(exam.scorableSet.reserveUsedNumbers,[]);
    assert.deepEqual(exam.scorableSet.questionNumbers,Array.from({length:75},(_,i)=>i+1));
    assert.deepEqual(exam.questions.map(q=>q.sourceNumber),[...Array.from({length:75},(_,i)=>i+1),151,152,153]);
    validatePackageMedia(exam);
    const mediaQs=exam.questions.filter(q=>q.media?.length);
    assert.deepEqual(mediaQs.map(q=>q.sourceNumber),mediaNumbers);
    assert.equal(exam.media.assets.length,mediaNumbers.length);
    assert.equal(new Set(exam.media.assets.map(a=>a.path)).size,mediaNumbers.length);
    for (const q of exam.questions) {
      assert.deepEqual(q.options.map(o=>o.id),["A","B","C","D"]);
      assert.equal(q.correctOption,q.sourceAnswer);
      assert.equal(q.active,q.sourceNumber<=75);
      assert.ok(q.text.length>20);
    }
    for (const asset of exam.media.assets) {
      assert.ok(asset.path.startsWith(id+"/media/"));
      const png = readFileSync(new URL(asset.path,root));
      assert.equal(png.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
      assert.equal(png.readUInt32BE(16),asset.width);
      assert.equal(png.readUInt32BE(20),asset.height);
      assert.equal(createHash("sha256").update(png).digest("hex"),asset.sha256);
      assert.equal(asset.mime,"image/png");
      assert.ok(asset.width>=240 && asset.height>=240);
    }
  }
});
test("RX 2023/2025: los mapeos de oposición son solo los tres IDs", () => {
  const migration=readFileSync(new URL("../supabase/migrations/20261121200000_register_radiodiagnostico_2023_2025.sql",import.meta.url),"utf8");
  for(const [id] of variants)assert.ok(migration.includes("'"+id+"', 'radiodiagnostico'"));
  assert.doesNotMatch(migration,/delete\s+from|drop\s+table|update\s+public\.attempts/i);
});
