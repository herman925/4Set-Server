// TEST: Verify Answer Object Extraction Fix
// Run this AFTER rebuilding cache with the fix

(async () => {
  console.log("\n🧪 ANSWER OBJECT EXTRACTION TEST\n");
  
  const studentId = "C10993";
  const grade = "K3";
  
  // Open IndexedDB
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('JotFormCacheDB');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  // Get merged cache
  const merged = await new Promise((resolve) => {
    const tx = db.transaction(['cache'], 'readonly');
    const request = tx.objectStore('cache').get('merged_jotform_qualtrics_cache');
    request.onsuccess = () => resolve(request.result);
  });
  
  const submission = merged?.submissions?.find(s => s.coreId === studentId && s.grade === grade);
  
  if (submission) {
    console.log(`✅ Found submission for ${studentId} ${grade}`);
    console.log(`   _sources: ${JSON.stringify(submission._sources)}\n`);
    
    // Check TGMD fields
    const tgmdAnswers = Object.entries(submission.answers || {})
      .filter(([qid, obj]) => obj?.name?.startsWith('TGMD_'));
    
    console.log(`📊 TGMD Fields: ${tgmdAnswers.length} total\n`);
    
    // Test sample
    console.log("Testing first 5 TGMD fields:\n");
    
    let passCount = 0;
    let failCount = 0;
    
    tgmdAnswers.slice(0, 5).forEach(([qid, obj], index) => {
      const answerType = typeof obj.answer;
      const textType = typeof obj.text;
      const isValid = (answerType === 'string' || answerType === 'number') &&
                      (textType === 'string' || textType === 'number');
      
      if (isValid) {
        console.log(`✅ ${index + 1}. QID ${qid} (${obj.name})`);
        console.log(`   answer: "${obj.answer}" (${answerType})`);
        console.log(`   text: "${obj.text}" (${textType})\n`);
        passCount++;
      } else {
        console.log(`❌ ${index + 1}. QID ${qid} (${obj.name})`);
        console.log(`   answer: ${JSON.stringify(obj.answer)} (${answerType})`);
        console.log(`   text: ${JSON.stringify(obj.text)} (${textType})`);
        console.log(`   ⚠️  Still an object! Not fixed.\n`);
        failCount++;
      }
    });
    
    // Summary
    console.log("═══════════════════════════════════════");
    console.log("TEST RESULTS:");
    console.log(`✅ PASS: ${passCount}/5`);
    console.log(`❌ FAIL: ${failCount}/5`);
    
    if (failCount === 0) {
      console.log("\n🎉 ALL TESTS PASSED!");
      console.log("Answer objects are now properly extracted to plain values.");
      console.log("TGMD data should display correctly on student page.");
    } else {
      console.log("\n⚠️  TESTS FAILED!");
      console.log("Cache needs to be rebuilt for fix to take effect.");
      console.log("Click 'Refresh Cache' button to rebuild.");
    }
    console.log("═══════════════════════════════════════\n");
    
  } else {
    console.log(`❌ Submission not found for ${studentId} ${grade}`);
  }
})();
