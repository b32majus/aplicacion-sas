import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const data = new URL("../app/public/data/exams/", import.meta.url);
const ids = ["sas-radiodiagnostico-2015-turno-libre","sas-radiodiagnostico-2015-promocion-interna"];
const load = (p) => JSON.parse(readFileSync(new URL(p,data),"utf8"));
const cancelled = {
 "sas-radiodiagnostico-2015-turno-libre":[20,35,107,130,136,142],
 "sas-radiodiagnostico-2015-promocion-interna":[5,20,107,130,136,142],
};
test("RX 2015: los dos ejercicios conservan 6 anuladas y sustitución ordenada con 3 reservas", () => {
 const cat=load("catalog.json");
 assert.equal(cat.exams.length,22);
 assert.equal(cat.exams.filter(e=>e.id.startsWith("sas-administrativo-")).length,12);
 assert.equal(cat.exams.filter(e=>e.id.startsWith("sas-radiodiagnostico-")).length,10);
 for(const id of ids){
  const c=cat.exams.find(e=>e.id===id);
  assert.ok(c,id);
  const ex=load(id+".json");
  assert.deepEqual(ex,load(c.latestPath));
  assert.equal(ex.version.id,c.latestVersion);
  assert.equal(ex.qa.state,"publicable");
  assert.equal(ex.durationMinutes,180);
  assert.equal(ex.year,2015);
  assert.equal(ex.questions.length,153);
  assert.equal(ex.nominalQuestionCount,150);
  assert.equal(ex.scorableSet.state,"resolved");
  assert.equal(ex.scorableSet.count,147);
  assert.equal(c.questionCount,147);
  assert.deepEqual(ex.scorableSet.annulledNumbers,cancelled[id]);
  assert.deepEqual(ex.scorableSet.reserveNumbers,[151,152,153]);
  assert.deepEqual(ex.scorableSet.reserveUsedNumbers,[151,152,153]);
  assert.deepEqual(ex.scorableSet.orderedReserveResolution.substitutions,cancelled[id].slice(0,3).map((n,i)=>({annulledNumber:n,reserveNumber:151+i})));
  assert.deepEqual(ex.scorableSet.orderedReserveResolution.unreplacedAnnulledNumbers,cancelled[id].slice(3));
  assert.deepEqual(ex.questions.filter(q=>q.active).map(q=>q.sourceNumber),ex.scorableSet.questionNumbers);
  for(const q of ex.questions){
   assert.deepEqual(q.options.map(o=>o.id),["A","B","C","D"]);
   assert.ok(q.text.length>15);
   assert.ok(!q.text.startsWith("Técnico/a Especialista en Radiodiagnóstico "));
   assert.equal(q.correctOption,q.sourceAnswer==="ANULADA"?null:q.sourceAnswer);
   assert.equal(q.status,q.sourceAnswer==="ANULADA"?"annulled":q.sourceNumber>150?"reserve":"valid");
  }
 }
});
test("RX 2015: mapeo backend a Radiodiagnóstico sin alterar Administrativo",()=>{
 const sql=readFileSync(new URL("../supabase/migrations/20261121170000_register_radiodiagnostico_2015.sql",import.meta.url),"utf8");
 for(const id of ids)assert.ok(sql.includes("'"+id+"', 'radiodiagnostico'"));
 assert.doesNotMatch(sql,/delete\s+from|drop\s+table|update\s+public\.attempts/i);
});
