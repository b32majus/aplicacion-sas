import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { validatePackageMedia } from "../app/src/exam-media.js";
const root=new URL("../app/public/data/exams/",import.meta.url);
const read=(path)=>JSON.parse(readFileSync(new URL(path,root),"utf8"));
const cases=[
 ["sas-radiodiagnostico-2021-turno-libre",23,[122]],
 ["sas-radiodiagnostico-2021-turno-libre-aplazada",24,[]],
 ["sas-radiodiagnostico-2021-promocion-interna",23,[122]],
];
test("RX 2021: tres exámenes, 153 preguntas cada uno y 70 figuras completas",()=>{
 const cat=read("catalog.json");
 assert.equal(cat.exams.length,22);
 assert.equal(cat.exams.filter(e=>e.id.startsWith("sas-administrativo-")).length,12);
 assert.equal(cat.exams.filter(e=>e.id.startsWith("sas-radiodiagnostico-")).length,10);
 let images=0;
 for(const [id,figureCount,annulled] of cases){
  const item=cat.exams.find(e=>e.id===id);
  assert.ok(item,id);
  const pack=read(id+".json");
  assert.deepEqual(pack,read(item.latestPath));
  assert.equal(pack.version.id,item.latestVersion);
  assert.equal(pack.year,2021);
  assert.equal(pack.durationMinutes,180);
  assert.equal(pack.questions.length,153);
  assert.equal(pack.scorableSet.count,150);
  assert.equal(item.questionCount,150);
  assert.deepEqual(pack.scorableSet.annulledNumbers,annulled);
  assert.deepEqual(pack.scorableSet.reserveNumbers,[151,152,153]);
  assert.deepEqual(pack.scorableSet.reserveUsedNumbers,annulled.length?[151]:[]);
  assert.equal(pack.questions[121].status,annulled.length?"annulled":"valid");
  assert.equal(pack.questions[150].active,!!annulled.length);
  assert.equal(pack.questions[150].displayLabel,annulled.length?"R1":null);
  assert.equal(pack.media.assets.length,figureCount);
  validatePackageMedia(pack);
  const usedAssets=new Set();
  for(const q of pack.questions){
   assert.deepEqual(q.options.map(o=>o.id),["A","B","C","D"]);
   assert.equal(q.correctOption,q.sourceAnswer==="ANULADA"?null:q.sourceAnswer);
   if(q.media)for(const ref of q.media)usedAssets.add(ref.asset);
   // Relación exacta: no basta con que exista la imagen; debe coincidir
   // con su numeración en la pregunta del cuadernillo oficial.
   const cited=[...new Set([...q.text.matchAll(/\bIMAGEN(?:ES)?\s*(\d+)/gi)].map(m=>+m[1]))];
   const linked=(q.media??[]).map(ref=>ref.asset);
   assert.deepEqual(linked,cited.map(n=>"figure-"+String(n).padStart(2,"0")),
     "image-to-question mismatch at source q"+q.sourceNumber);
  }
  assert.equal(usedAssets.size,figureCount,"every source figure used by at least one real question");
  for(const start of [101,111,121,131,141]){
   for(let n=start;n<start+10;n++){
    const q=pack.questions[n-1];
    assert.match(q.text,/^CASO\s+PR[ÁA]CTICO\s+\d+:/i,"every shuffled question retains practical case context");
   }
  }
  const assetIds=new Set(pack.media.assets.map(a=>a.id));
  assert.equal(assetIds.size,figureCount);
  for(const a of pack.media.assets){
   assert.ok(a.path.startsWith(id+"/media/"));
   const png=readFileSync(new URL(a.path,root));
   assert.equal(png.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
   assert.equal(png.readUInt32BE(16),a.width);
   assert.equal(png.readUInt32BE(20),a.height);
   assert.equal(createHash("sha256").update(png).digest("hex"),a.sha256);
   assert.ok(a.width>160 && a.height>130);
  }
  images+=figureCount;
 }
 assert.equal(images,70);
});
test("RX 2021: solo tres mapeos a Radiodiagnóstico y ninguna operación destructiva",()=>{
 const sql=readFileSync(new URL("../supabase/migrations/20261121210000_register_radiodiagnostico_2021.sql",import.meta.url),"utf8");
 for(const [id] of cases)assert.ok(sql.includes("'"+id+"', 'radiodiagnostico'"));
 assert.doesNotMatch(sql,/delete\s+from|drop\s+table|update\s+public\.attempts/i);
});
