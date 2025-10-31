/**
 * TEST: Qualtrics Merge - "0" vs null/undefined
 * 
 * PURPOSE: Verify that "0" (Not Observed) is treated as valid answer in TGMD
 * BUG: data-merger.js treats "0" as falsy, skipping valid TGMD data
 * 
 * SCENARIO:
 * - JotForm: No TGMD data
 * - Qualtrics: All TGMD = "0" (Not Observed)
 * - Expected: Merged record should have TGMD_*_t1 = "0", TGMD_*_t2 = "0"
 * - Actual: Merged record has NO TGMD fields (skipped due to falsy check)
 */

console.log('========================================');
console.log('TEST: "0" vs null in Qualtrics Merge');
console.log('========================================\n');

// Simulate extractAnswerValue function (from data-merger.js)
function extractAnswerValue(answerObj) {
  if (!answerObj) {
    return null;
  }
  
  if (typeof answerObj === 'object' && answerObj !== null) {
    return answerObj.answer || answerObj.text || null;
  }
  
  return answerObj;
}

// Test cases
const testCases = [
  {
    name: 'TGMD Not Observed (0)',
    answerObj: { answer: '0', text: '0', name: 'TGMD_111_Hop_t1' },
    expected: '0'
  },
  {
    name: 'TGMD Observed (1)',
    answerObj: { answer: '1', text: '1', name: 'TGMD_111_Hop_t1' },
    expected: '1'
  },
  {
    name: 'No answer (null)',
    answerObj: null,
    expected: null
  },
  {
    name: 'Empty string',
    answerObj: { answer: '', text: '', name: 'TGMD_111_Hop_t1' },
    expected: null // or ''
  },
  {
    name: 'Undefined',
    answerObj: undefined,
    expected: null
  }
];

console.log('Part 1: Test extractAnswerValue\n');
let passedPart1 = 0;
let failedPart1 = 0;

for (const test of testCases) {
  const result = extractAnswerValue(test.answerObj);
  const passed = (result === test.expected || (result === '' && test.expected === null));
  
  if (passed) {
    console.log(`✅ ${test.name}: ${JSON.stringify(result)}`);
    passedPart1++;
  } else {
    console.log(`❌ ${test.name}: Expected ${JSON.stringify(test.expected)}, got ${JSON.stringify(result)}`);
    failedPart1++;
  }
}

console.log(`\nPart 1 Results: ${passedPart1} passed, ${failedPart1} failed\n`);

// Part 2: Test the merge condition (THE BUG)
console.log('Part 2: Test Merge Condition (Current Code)\n');
console.log('Code: if (!qualtricsValue || qualtricsValue === "") { continue; }\n');

const mergeTests = [
  {
    name: 'TGMD Not Observed (0)',
    value: '0',
    shouldMerge: true, // "0" is valid answer
  },
  {
    name: 'TGMD Observed (1)',
    value: '1',
    shouldMerge: true,
  },
  {
    name: 'No answer (null)',
    value: null,
    shouldMerge: false,
  },
  {
    name: 'Empty string',
    value: '',
    shouldMerge: false,
  },
  {
    name: 'Zero number (0)',
    value: 0,  // numeric zero
    shouldMerge: true, // "0" converted to number should still be valid
  }
];

let bugs = 0;
let correct = 0;

console.log('Testing actual JavaScript truthiness:\n');

for (const test of mergeTests) {
  // ACTUAL JavaScript behavior
  const willSkip = !test.value || test.value === '';
  const shouldSkip = !test.shouldMerge;
  const isCorrect = (willSkip === shouldSkip);
  
  const icon = isCorrect ? '✅' : '❌';
  const bugIcon = (test.shouldMerge && willSkip) ? ' 🐛 BUG' : '';
  
  console.log(`${icon} ${test.name}: value=${JSON.stringify(test.value)} (typeof=${typeof test.value})`);
  console.log(`   !value=${!test.value}, value===""=${test.value === ''}`);
  console.log(`   → Will skip: ${willSkip}, Should skip: ${shouldSkip}${bugIcon}`);
  
  if (test.shouldMerge && willSkip) {
    bugs++;
  } else if (!test.shouldMerge && !willSkip) {
    bugs++;
  } else {
    correct++;
  }
}

console.log(`\nPart 2 Results: ${bugs} BUG(S) FOUND, ${correct} correct\n`);

// Part 3: Proposed fix
console.log('Part 3: Proposed Fix\n');
console.log('Code: if (qualtricsValue === null || qualtricsValue === undefined || qualtricsValue === "") { continue; }\n');

console.log('Testing proposed fix:\n');

let fixedCorrect = 0;
let fixedIncorrect = 0;

for (const test of mergeTests) {
  const willSkipFixed = test.value === null || test.value === undefined || test.value === '';
  const shouldSkip = !test.shouldMerge;
  const correct = (willSkipFixed === shouldSkip);
  
  const icon = correct ? '✅' : '❌';
  
  console.log(`${icon} ${test.name}: value="${test.value}" → Skip=${willSkipFixed}`);
  console.log(`   Expected to skip: ${shouldSkip}, Will skip: ${willSkipFixed}`);
  
  if (correct) {
    fixedCorrect++;
  } else {
    fixedIncorrect++;
  }
}

console.log(`\nPart 3 Results: ${fixedCorrect} correct, ${fixedIncorrect} incorrect\n`);

// Summary
console.log('========================================');
console.log('SUMMARY');
console.log('========================================\n');
console.log('PROBLEM: Current code treats "0" as falsy');
console.log('         if (!qualtricsValue || qualtricsValue === "") { continue; }');
console.log('         ↑ This treats "0" as false, skipping valid TGMD data\n');
console.log('IMPACT:  If Qualtrics has all TGMD="0" (Not Observed)');
console.log('         Merge skips ALL fields, student shows NO TGMD data\n');
console.log('FIX:     Check for null/undefined/empty explicitly');
console.log('         if (qualtricsValue === null || qualtricsValue === undefined || qualtricsValue === "") { continue; }');
console.log('         ↑ This treats "0" as valid, preserving TGMD data\n');
console.log(`VERDICT: ${bugs > 0 ? '🐛 BUG CONFIRMED' : '✅ ALL TESTS PASSED'}`);
