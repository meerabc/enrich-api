import fs from "fs";

const cases = JSON.parse(fs.readFileSync("evals/cases.json", "utf-8"));
let passed = 0;
const failures = [];

for (const testCase of cases) {
  const res = await fetch("http://localhost:3000/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testCase.input),
  });
  const data = await res.json();

  if (data.category === testCase.expected_category) {
    passed++;
  } else {
    failures.push({ id: testCase.id, expected: testCase.expected_category, got: data.category ?? data.error });
  }
}

console.log(`score: ${passed}/${cases.length}`);
if (failures.length > 0) {
  console.log("failures:", JSON.stringify(failures, null, 2));
}