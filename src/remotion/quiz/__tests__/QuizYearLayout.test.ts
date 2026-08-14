import assert from "node:assert/strict";
import { optionFontSize, questionFontSize } from "../QuizYear";

function main(): void {
  assert.equal(questionFontSize("In which year did the first human land on the Moon?"), 56);
  assert.equal(questionFontSize("Which scientist first demonstrated the principle that now bears their name in a landmark experiment?"), 46);
  assert.equal(questionFontSize("What is the exact name of the historical agreement that established the administrative arrangement between these states after the conflict ended?"), 38);
  assert.equal(optionFontSize("1969"), 62);
  assert.equal(optionFontSize("Long answer label"), 34);
  console.log("QuizYear responsive card typography checks passed");
}

main();
