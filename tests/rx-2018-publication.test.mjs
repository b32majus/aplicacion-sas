import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const base = new URL("../app/public/data/exams/", import.meta.url);
const ids = ["sas-radiodiagnostico-2018-turno-libre", "sas-radiodiagnostico-2018-promocion-interna"];
const load = (name) => JSON.parse(readFileSync(new URL(name, base), "utf8"));

test("RX 2018: versioned originals, exact answers, five cases and legacy bank", () => {
  const catalog = load("catalog.json");
  assert.equal(catalog.exams.filter((e) => e.id.startsWith("sas-administrativo-")).length, 12);
  for (const id of ids) {
    const entry = catalog.exams.find((row) => row.id === id);
    assert.ok(entry, id + " listed in catalog");
    const alias = load(id + ".json");
    assert.deepEqual(alias, load(entry.latestPath));
    assert.equal(entry.latestVersion, alias.version.id);
    assert.equal(entry.questionCount, 150);
    assert.equal(alias.durationMinutes, 180);
    assert.equal(alias.qa.state, "publicable");
    assert.equal(alias.scorableSet.state, "resolved");
    assert.equal(alias.scorableSet.count, 150);
    assert.deepEqual(alias.scorableSet.questionNumbers, Array.from({ length: 150 }, (_, i) => i + 1));
    assert.deepEqual(alias.scorableSet.annulledNumbers, []);
    assert.deepEqual(alias.scorableSet.reserveNumbers, [151, 152, 153]);
    assert.deepEqual(alias.scorableSet.reserveUsedNumbers, []);
    assert.equal(alias.questions.length, 153);
    assert.deepEqual(alias.questions.map((q) => q.sourceNumber), Array.from({ length: 153 }, (_, i) => i + 1));
    for (const q of alias.questions) {
      assert.deepEqual(q.options.map((o) => o.id), ["A", "B", "C", "D"]);
      assert.equal(q.correctOption, q.sourceAnswer, "answer key q" + q.sourceNumber);
      assert.ok(q.text.length > 25, "has text for q" + q.sourceNumber);
      assert.equal(q.active, q.sourceNumber <= 150);
      for (const option of q.options) {
        assert.ok(!/CASO\s+(?:I|II|III|IV|V):/i.test(option.text), "no case bleed at q" + q.sourceNumber + option.id);
      }
    }
    for (let n = 101; n <= 150; n++) {
      const label = ["I", "II", "III", "IV", "V"][Math.floor((n - 101) / 10)];
      assert.ok(alias.questions[n-1].text.startsWith("CASO " + label + ":"), "case context at q" + n);
    }
    assert.equal(alias.questions[65].options[0].text, alias.questions[65].options[1].text);
    assert.equal(alias.questions[65].correctOption, "D");
  }
});
