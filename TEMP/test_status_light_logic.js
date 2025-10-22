/**
 * Test script to verify status light calculation logic
 * Simulates CM task data for C10880
 */

// Simulate CM task validation data
const cmTaskData = {
  taskId: 'cm',
  answeredQuestions: 7,
  totalQuestions: 7,
  correctAnswers: 0,
  terminated: true,
  terminationIndex: 6, // Terminated at Q7 (index 6)
  hasPostTerminationAnswers: false,
  completionPercentage: 100,
  accuracyPercentage: 0
};

// Test the calculateTaskStatusLight logic
function calculateTaskStatusLight(taskData) {
  if (!taskData || taskData.error) return '⚪ Not Started';
  
  const answered = taskData.answeredQuestions || 0;
  const total = taskData.totalQuestions || 0;
  
  // No data yet
  if (total === 0 || answered === 0) {
    return '⚪ Not Started';
  }
  
  // Post-termination data detected (yellow)
  if (taskData.hasPostTerminationAnswers) {
    return '🟡 Post-Term';
  }
  
  // Properly terminated/timed out (green)
  if ((taskData.terminated || taskData.timedOut) && answered > 0) {
    return '🟢 Complete';
  }
  
  // All questions answered (green)
  if (answered === total) {
    return '🟢 Complete';
  }
  
  // Started but not complete (red)
  if (answered > 0) {
    return '🔴 Incomplete';
  }
  
  // Not started (grey)
  return '⚪ Not Started';
}

// Test the cache building logic
function testCacheBuildLogic(validation) {
  const answered = validation.answeredQuestions || 0;
  const total = validation.totalQuestions || 0;
  
  const isComplete = (answered === total && total > 0) || 
                     (validation.terminated && !validation.hasPostTerminationAnswers && answered > 0) ||
                     (validation.timedOut && !validation.hasPostTerminationAnswers && answered > 0);
  
  return {
    taskId: validation.taskId,
    complete: isComplete,
    answered,
    total,
    hasPostTerminationAnswers: validation.hasPostTerminationAnswers || false
  };
}

// Test the class page display logic
function testClassPageDisplayLogic(foundTask) {
  if (!foundTask) return 'status-grey';
  
  // Post-term detection (yellow): Task has answers after termination
  if (foundTask.hasPostTerminationAnswers) return 'status-yellow';
  
  // Complete (green): All questions answered or properly terminated
  if (foundTask.complete) return 'status-green';
  
  // Incomplete (red): Started but not complete
  if (foundTask.answered > 0) return 'status-red';
  
  // Not started (grey): No answers yet
  return 'status-grey';
}

// Run tests
console.log('=== CM Task Data ===');
console.log(JSON.stringify(cmTaskData, null, 2));

console.log('\n=== Export Status Light ===');
const exportStatus = calculateTaskStatusLight(cmTaskData);
console.log('Result:', exportStatus);
console.log('Expected: 🟢 Complete');
console.log('Match:', exportStatus === '🟢 Complete' ? '✅ PASS' : '❌ FAIL');

console.log('\n=== Cache Build Logic ===');
const cacheData = testCacheBuildLogic(cmTaskData);
console.log('Cache Data:', JSON.stringify(cacheData, null, 2));
console.log('complete:', cacheData.complete);
console.log('Expected: true');
console.log('Match:', cacheData.complete === true ? '✅ PASS' : '❌ FAIL');

console.log('\n=== Class Page Display Logic ===');
const displayStatus = testClassPageDisplayLogic(cacheData);
console.log('Display Status:', displayStatus);
console.log('Expected: status-green');
console.log('Match:', displayStatus === 'status-green' ? '✅ PASS' : '❌ FAIL');

console.log('\n=== Overall Test ===');
const allPassed = exportStatus === '🟢 Complete' && 
                  cacheData.complete === true && 
                  displayStatus === 'status-green';
console.log(allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED');
