#!/usr/bin/env node
/**
 * Node.js Test for grade-detector-test.js
 * 
 * This script verifies that grade-detector-test.js works in Node.js environment
 * using the UMD (Universal Module Definition) pattern.
 */

const GradeDetector = require('./grade-detector-test.js');

console.log('=== Grade Detector Node.js Compatibility Test ===\n');

let passCount = 0;
let failCount = 0;

function test(name, condition, expected, actual) {
    if (condition) {
        console.log(`✅ PASS: ${name}`);
        passCount++;
    } else {
        console.log(`❌ FAIL: ${name}`);
        console.log(`   Expected: ${expected}`);
        console.log(`   Got: ${actual}`);
        failCount++;
    }
}

// Test 1: Module loaded correctly
test(
    'GradeDetector module loaded',
    typeof GradeDetector === 'object',
    'object',
    typeof GradeDetector
);

// Test 2: determineGrade function exists
test(
    'determineGrade function exists',
    typeof GradeDetector.determineGrade === 'function',
    'function',
    typeof GradeDetector.determineGrade
);

// Test 3: Test with Qualtrics recordedDate (K2)
const test3Result = GradeDetector.determineGrade({
    recordedDate: '2024-10-07T05:10:05.400Z'
});
test(
    'Determine grade from Qualtrics recordedDate (Oct 2024 = K2)',
    test3Result === 'K2',
    'K2',
    test3Result
);

// Test 4: Test with JotForm sessionkey (K3)
const test4Result = GradeDetector.determineGrade({
    sessionkey: '10261_20251014_10_59'
});
test(
    'Determine grade from JotForm sessionkey (Oct 2025 = K3)',
    test4Result === 'K3',
    'K3',
    test4Result
);

// Test 5: Test with K1 recordedDate (Feb 2024 falls in 2023/24 school year)
const test5Result = GradeDetector.determineGrade({
    recordedDate: '2024-02-15T10:30:00.000Z'
});
test(
    'Determine grade from recordedDate (Feb 2024 = K1)',
    test5Result === 'K1',
    'K1',
    test5Result
);

// Test 6: Test with invalid data
const test6Result = GradeDetector.determineGrade({});
test(
    'Handle missing data gracefully',
    test6Result === 'Unknown',
    'Unknown',
    test6Result
);

// Test 7: Test determineGradeFromRecordedDate directly
const test7Result = GradeDetector.determineGradeFromRecordedDate('2024-09-01T00:00:00.000Z');
test(
    'determineGradeFromRecordedDate (Sep 2024 = K2)',
    test7Result === 'K2',
    'K2',
    test7Result
);

// Test 8: Test determineGradeFromSessionKey directly
const test8Result = GradeDetector.determineGradeFromSessionKey('10001_20230815_09_00');
test(
    'determineGradeFromSessionKey (Aug 2023 = K1)',
    test8Result === 'K1',
    'K1',
    test8Result
);

// Test 9: Test hybrid approach (recordedDate takes priority)
const test9Result = GradeDetector.determineGrade({
    recordedDate: '2024-10-01T00:00:00.000Z', // K2
    sessionkey: '10001_20230815_09_00' // K1
});
test(
    'Hybrid approach - recordedDate takes priority over sessionkey',
    test9Result === 'K2',
    'K2',
    test9Result
);

// Test 10: Test getSchoolYear helper
const test10Result = GradeDetector.getSchoolYear('2024-10-01T00:00:00.000Z');
test(
    'getSchoolYear helper function (Oct 2024 = 2024)',
    test10Result === 2024,
    '2024',
    test10Result
);

// Test 11: Test school year boundary (July still in previous school year)
const test11Result = GradeDetector.determineGrade({
    recordedDate: '2024-07-31T23:59:59.000Z'
});
test(
    'School year boundary - July 2024 = K1 (still in 2023/24)',
    test11Result === 'K1',
    'K1',
    test11Result
);

// Test 12: Test school year boundary (August starts new school year)
const test12Result = GradeDetector.determineGrade({
    recordedDate: '2024-08-01T00:00:00.000Z'
});
test(
    'School year boundary - August 2024 = K2 (start of 2024/25)',
    test12Result === 'K2',
    'K2',
    test12Result
);

// Summary
console.log('\n=== Test Summary ===');
console.log(`Total: ${passCount + failCount}`);
console.log(`✅ Passed: ${passCount}`);
console.log(`❌ Failed: ${failCount}`);

if (failCount === 0) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
} else {
    console.log('\n⚠️  Some tests failed!');
    process.exit(1);
}
