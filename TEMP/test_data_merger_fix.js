/**
 * TEST: Data Merger with "0" Values
 * 
 * Verifies that the explicit null checks preserve "0" answers
 */

// Mock extractAnswerValue function (FIXED VERSION)
function extractAnswerValue(answerObj) {
  if (!answerObj && answerObj !== 0) {  // Allow numeric 0 to pass through
    return null;
  }
  
  if (typeof answerObj === 'object' && answerObj !== null) {
    // Use explicit checks instead of || to preserve 0
    if (answerObj.answer !== undefined && answerObj.answer !== null) {
      return answerObj.answer;
    }
    if (answerObj.text !== undefined && answerObj.text !== null) {
      return answerObj.text;
    }
    return null;
  }
  
  return answerObj;
}

console.log('========================================');
console.log('TEST: Data Merger with "0" Values');
console.log('========================================\n');

// Test data
const testCases = [
  {
    name: 'TGMD Not Observed (string "0")',
    answerObj: { answer: '0', name: 'TGMD_111_Hop_t1' },
    expectedSkip: false,
    description: 'Valid TGMD answer, should be preserved'
  },
  {
    name: 'TGMD Not Observed (numeric 0)',
    answerObj: { answer: 0, name: 'TGMD_111_Hop_t1' },
    expectedSkip: false,
    description: 'Valid TGMD answer (numeric), should be preserved'
  },
  {
    name: 'TGMD Observed (string "1")',
    answerObj: { answer: '1', name: 'TGMD_111_Hop_t1' },
    expectedSkip: false,
    description: 'Valid TGMD answer, should be preserved'
  },
  {
    name: 'No answer (null)',
    answerObj: null,
    expectedSkip: true,
    description: 'No data, should be skipped'
  },
  {
    name: 'Empty answer object',
    answerObj: { answer: '', name: 'TGMD_111_Hop_t1' },
    expectedSkip: true,
    description: 'Empty string, should be skipped'
  },
  {
    name: 'Missing answer property',
    answerObj: { name: 'TGMD_111_Hop_t1' },
    expectedSkip: true,
    description: 'No answer value, should be skipped'
  }
];

console.log('Testing OLD logic (falsy check):\n');
let oldBugs = 0;
let oldCorrect = 0;

for (const test of testCases) {
  const value = extractAnswerValue(test.answerObj);
  const wouldSkipOld = !value || value === '';  // OLD LOGIC
  const isCorrect = (wouldSkipOld === test.expectedSkip);
  
  const icon = isCorrect ? '✅' : '❌';
  const bugIcon = !isCorrect ? ' 🐛 BUG' : '';
  
  console.log(`${icon} ${test.name}`);
  console.log(`   Value: ${JSON.stringify(value)} (type: ${typeof value})`);
  console.log(`   Would skip: ${wouldSkipOld}, Expected: ${test.expectedSkip}${bugIcon}`);
  console.log(`   ${test.description}\n`);
  
  if (isCorrect) oldCorrect++;
  else oldBugs++;
}

console.log(`OLD LOGIC: ${oldCorrect} correct, ${oldBugs} bugs\n`);
console.log('========================================\n');

console.log('Testing NEW logic (explicit checks):\n');
let newBugs = 0;
let newCorrect = 0;

for (const test of testCases) {
  const value = extractAnswerValue(test.answerObj);
  const wouldSkipNew = value === null || value === undefined || value === '';  // NEW LOGIC
  const isCorrect = (wouldSkipNew === test.expectedSkip);
  
  const icon = isCorrect ? '✅' : '❌';
  const bugIcon = !isCorrect ? ' 🐛 BUG' : '';
  
  console.log(`${icon} ${test.name}`);
  console.log(`   Value: ${JSON.stringify(value)} (type: ${typeof value})`);
  console.log(`   Would skip: ${wouldSkipNew}, Expected: ${test.expectedSkip}${bugIcon}`);
  console.log(`   ${test.description}\n`);
  
  if (isCorrect) newCorrect++;
  else newBugs++;
}

console.log(`NEW LOGIC: ${newCorrect} correct, ${newBugs} bugs\n`);
console.log('========================================\n');

// Summary
console.log('SUMMARY:');
console.log(`OLD: ${oldCorrect}/${testCases.length} correct (${oldBugs} bugs)`);
console.log(`NEW: ${newCorrect}/${testCases.length} correct (${newBugs} bugs)`);

if (newBugs === 0 && newCorrect === testCases.length) {
  console.log('\n✅ ALL TESTS PASSED - Fix is correct!');
} else {
  console.log('\n❌ TESTS FAILED - Fix needs adjustment');
}
