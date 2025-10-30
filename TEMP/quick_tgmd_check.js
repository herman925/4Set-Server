// Quick TGMD Data Flow Check - Copy/Paste into Browser Console
// Student Page: checking_system_4_student.html?coreId=C10993&year=K3

(async () => {
  const studentId = "C10993";
  const grade = "K3";
  
  console.log("\n🔍 TGMD DATA FLOW CHECK FOR", studentId, grade, "\n");
  
  // Open IndexedDB (don't specify version - use current version)
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('JotFormCacheDB');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  // 1. Check Merged Cache
  console.log("1️⃣ MERGED CACHE:");
  const merged = await new Promise((resolve) => {
    const tx = db.transaction(['cache'], 'readonly');
    const request = tx.objectStore('cache').get('merged_jotform_qualtrics_cache');
    request.onsuccess = () => resolve(request.result);
  });
  
  const submission = merged?.submissions?.find(s => s.coreId === studentId && s.grade === grade);
  if (submission) {
    const tgmdInAnswers = Object.entries(submission.answers || {})
      .filter(([qid, obj]) => obj?.name?.startsWith('TGMD_'));
    const tgmdDirect = Object.keys(submission).filter(k => k.startsWith('TGMD_'));
    
    console.log(`   ✅ Found submission`);
    console.log(`   _sources: ${JSON.stringify(submission._sources)}`);
    console.log(`   TGMD in answers (QID-indexed): ${tgmdInAnswers.length} fields`);
    console.log(`   TGMD as direct props: ${tgmdDirect.length} fields`);
    
    if (tgmdInAnswers.length > 0) {
      console.log("\n   Sample answers (first 3):");
      tgmdInAnswers.slice(0, 3).forEach(([qid, obj]) => {
        console.log(`   QID ${qid}: ${obj.name} = "${obj.answer}"`);
      });
    }
    
    if (tgmdDirect.length > 0) {
      console.log("\n   ⚠️ Sample direct props (first 3):");
      tgmdDirect.slice(0, 3).forEach(field => {
        console.log(`   ${field} = ${JSON.stringify(submission[field])}`);
      });
    }
  } else {
    console.log("   ❌ Submission NOT found");
  }
  
  // 2. Check Page Display
  console.log("\n2️⃣ PAGE DISPLAY (mergedAnswers):");
  if (typeof mergedAnswers !== 'undefined') {
    const tgmdFields = Object.keys(mergedAnswers).filter(k => k.startsWith('TGMD_'));
    console.log(`   TGMD fields: ${tgmdFields.length}`);
    
    if (tgmdFields.length > 0) {
      console.log("\n   Sample (first 3):");
      tgmdFields.slice(0, 3).forEach(field => {
        const val = mergedAnswers[field];
        console.log(`   ${field}: ${typeof val === 'object' ? JSON.stringify(val) : val}`);
      });
    } else {
      console.log("   ❌ NO TGMD fields!");
    }
  } else {
    console.log("   ⚠️ mergedAnswers not defined");
  }
  
  // 3. Problem Identification
  console.log("\n📊 ANALYSIS:");
  
  if (submission) {
    const hasAnswersQID = Object.values(submission.answers || {})
      .some(obj => obj?.name?.startsWith('TGMD_'));
    const hasDirect = Object.keys(submission).some(k => k.startsWith('TGMD_'));
    
    if (hasDirect && !hasAnswersQID) {
      console.log("   ❌ PROBLEM: TGMD data exists as DIRECT properties, not in answers{}");
      console.log("   ROOT CAUSE: transformRecordsToSubmissions() didn't convert fieldName→QID");
      console.log("   SOLUTION: Check jotformquestions.json has TGMD field mappings");
      console.log("   FILES TO CHECK:");
      console.log("      - assets/js/jotform-cache.js (transformRecordsToSubmissions)");
      console.log("      - assets/jotformquestions.json (TGMD_* field definitions)");
    } else if (hasAnswersQID && typeof mergedAnswers !== 'undefined') {
      const pageHasTGMD = Object.keys(mergedAnswers).some(k => k.startsWith('TGMD_'));
      if (!pageHasTGMD) {
        console.log("   ❌ PROBLEM: Cache has TGMD in answers{}, but page doesn't");
        console.log("   ROOT CAUSE: validateStudent() not converting QID→fieldName");
        console.log("   FILES TO CHECK:");
        console.log("      - checking-system-student-page.js (validateStudent function)");
      } else {
        console.log("   ✅ Data flow looks correct!");
        console.log("   If display shows issues, check TaskValidator.validateAllTasks()");
      }
    }
  }
  
  console.log("\n");
})();
