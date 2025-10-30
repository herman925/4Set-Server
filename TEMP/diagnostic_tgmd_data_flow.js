/**
 * TGMD Data Flow Diagnostic Tool
 * 
 * PURPOSE: Compare cache data vs student page display for TGMD fields
 * SYMPTOM: Raw cache shows proper TGMD data, but student page shows "Not-Observed"
 * 
 * USAGE:
 * 1. Open checking_system_4_student.html in browser
 * 2. Navigate to student C10993 (or any student with TGMD data)
 * 3. Open browser console (F12)
 * 4. Copy and paste this entire script
 * 5. Review the detailed output showing data at each transformation layer
 */

(async function diagnoseTGMDDataFlow() {
  const studentId = "C10993"; // Change this to test different students
  const grade = "K3";
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("TGMD DATA FLOW DIAGNOSTIC");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`Student: ${studentId}, Grade: ${grade}\n`);
  
  // =========================================================================
  // LAYER 1: Check Qualtrics Raw Cache
  // =========================================================================
  console.log("─────────────────────────────────────────────────────────────");
  console.log("LAYER 1: QUALTRICS RAW CACHE (qualtrics_raw_responses)");
  console.log("─────────────────────────────────────────────────────────────");
  
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('JotFormCacheDB');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  const qualtricsCache = await new Promise((resolve, reject) => {
    const tx = db.transaction(['qualtrics_cache'], 'readonly');
    const store = tx.objectStore('qualtrics_cache');
    const request = store.get('qualtrics_raw_responses');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  if (qualtricsCache && qualtricsCache.responses) {
    const qualtricsRecord = qualtricsCache.responses.find(r => 
      r.coreId === studentId && r.grade === grade
    );
    
    if (qualtricsRecord) {
      console.log("✅ Found in Qualtrics raw cache");
      console.log(`   _sources: ${JSON.stringify(qualtricsRecord._sources)}`);
      
      // Check TGMD fields
      const tgmdFields = Object.keys(qualtricsRecord).filter(k => k.startsWith('TGMD_'));
      console.log(`   TGMD fields count: ${tgmdFields.length}`);
      
      // Sample first 5 TGMD fields
      console.log("\n   Sample TGMD data (first 5 fields):");
      tgmdFields.slice(0, 5).forEach(field => {
        const value = qualtricsRecord[field];
        console.log(`   ${field}: ${JSON.stringify(value)}`);
      });
    } else {
      console.log("❌ NOT found in Qualtrics raw cache");
    }
  } else {
    console.log("❌ Qualtrics raw cache is empty or missing");
  }
  
  // =========================================================================
  // LAYER 2: Check Merged Cache
  // =========================================================================
  console.log("\n─────────────────────────────────────────────────────────────");
  console.log("LAYER 2: MERGED CACHE (merged_jotform_qualtrics_cache)");
  console.log("─────────────────────────────────────────────────────────────");
  
  const mergedCache = await new Promise((resolve, reject) => {
    const tx = db.transaction(['cache'], 'readonly');
    const store = tx.objectStore('cache');
    const request = store.get('merged_jotform_qualtrics_cache');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  if (mergedCache && mergedCache.submissions) {
    const submission = mergedCache.submissions.find(s => 
      s.coreId === studentId && s.grade === grade
    );
    
    if (submission) {
      console.log("✅ Found in merged cache");
      console.log(`   _sources: ${JSON.stringify(submission._sources)}`);
      console.log(`   Has answers object: ${!!submission.answers}`);
      
      if (submission.answers) {
        // Find TGMD fields in QID-indexed answers
        const tgmdQids = [];
        const tgmdAnswers = [];
        
        for (const [qid, answerObj] of Object.entries(submission.answers)) {
          if (answerObj && answerObj.name && answerObj.name.startsWith('TGMD_')) {
            tgmdQids.push(qid);
            tgmdAnswers.push({ qid, ...answerObj });
          }
        }
        
        console.log(`   TGMD fields found: ${tgmdQids.length}`);
        
        if (tgmdQids.length > 0) {
          console.log("\n   Sample TGMD answers (first 5):");
          tgmdAnswers.slice(0, 5).forEach(a => {
            console.log(`   QID ${a.qid} (${a.name}): answer="${a.answer}", text="${a.text}"`);
          });
        } else {
          console.log("   ⚠️ NO TGMD fields found in answers object!");
          
          // Check if TGMD data exists as direct properties (not in answers)
          const directTGMD = Object.keys(submission).filter(k => k.startsWith('TGMD_'));
          if (directTGMD.length > 0) {
            console.log(`   ⚠️ Found ${directTGMD.length} TGMD fields as DIRECT properties (not in answers)`);
            console.log("   Sample direct TGMD properties:");
            directTGMD.slice(0, 5).forEach(field => {
              console.log(`   ${field}: ${JSON.stringify(submission[field])}`);
            });
          }
        }
      } else {
        console.log("   ❌ No answers object in submission!");
      }
    } else {
      console.log("❌ NOT found in merged cache");
    }
  } else {
    console.log("❌ Merged cache is empty or missing");
  }
  
  // =========================================================================
  // LAYER 3: Check Validation Cache
  // =========================================================================
  console.log("\n─────────────────────────────────────────────────────────────");
  console.log("LAYER 3: VALIDATION CACHE (student_task_validation_cache)");
  console.log("─────────────────────────────────────────────────────────────");
  
  const validationCache = await new Promise((resolve, reject) => {
    const tx = db.transaction(['validation_cache'], 'readonly');
    const store = tx.objectStore('validation_cache');
    const request = store.get('student_task_validation_cache');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  if (validationCache && validationCache[studentId]) {
    const studentValidation = validationCache[studentId];
    console.log("✅ Found in validation cache");
    
    // Check if TGMD task exists
    const tgmdTask = studentValidation.tasks?.find(t => t.taskId === 'TGMD');
    
    if (tgmdTask) {
      console.log(`   TGMD task found: ${tgmdTask.answered}/${tgmdTask.total} answered`);
      console.log(`   Completion: ${tgmdTask.percentage?.toFixed(1)}%`);
      
      // Check individual TGMD questions
      if (tgmdTask.questions && tgmdTask.questions.length > 0) {
        console.log(`   Total TGMD questions: ${tgmdTask.questions.length}`);
        
        const answeredQuestions = tgmdTask.questions.filter(q => q.answered);
        const unansweredQuestions = tgmdTask.questions.filter(q => !q.answered);
        
        console.log(`   Answered: ${answeredQuestions.length}`);
        console.log(`   Unanswered: ${unansweredQuestions.length}`);
        
        if (answeredQuestions.length > 0) {
          console.log("\n   Sample answered questions (first 5):");
          answeredQuestions.slice(0, 5).forEach(q => {
            console.log(`   ${q.question}: "${q.answer}"`);
          });
        }
        
        if (unansweredQuestions.length > 0) {
          console.log("\n   Sample unanswered questions (first 10):");
          unansweredQuestions.slice(0, 10).forEach(q => {
            console.log(`   ${q.question}`);
          });
        }
      } else {
        console.log("   ⚠️ TGMD task has no questions array!");
      }
    } else {
      console.log("   ❌ TGMD task NOT found in validation cache");
      
      if (studentValidation.tasks) {
        console.log(`   Available tasks: ${studentValidation.tasks.map(t => t.taskId).join(', ')}`);
      }
    }
  } else {
    console.log("❌ Student NOT found in validation cache");
  }
  
  // =========================================================================
  // LAYER 4: Check Current Page Display (mergedAnswers)
  // =========================================================================
  console.log("\n─────────────────────────────────────────────────────────────");
  console.log("LAYER 4: CURRENT PAGE DISPLAY (mergedAnswers global variable)");
  console.log("─────────────────────────────────────────────────────────────");
  
  if (typeof mergedAnswers !== 'undefined') {
    console.log("✅ mergedAnswers is available");
    
    // Find TGMD fields
    const tgmdFields = Object.keys(mergedAnswers).filter(k => k.startsWith('TGMD_'));
    console.log(`   TGMD fields count: ${tgmdFields.length}`);
    
    if (tgmdFields.length > 0) {
      console.log("\n   Sample TGMD fields (first 10):");
      tgmdFields.slice(0, 10).forEach(field => {
        const value = mergedAnswers[field];
        const type = typeof value;
        const display = type === 'object' ? JSON.stringify(value) : value;
        console.log(`   ${field} (${type}): ${display}`);
      });
    } else {
      console.log("   ❌ NO TGMD fields in mergedAnswers!");
      
      // Show what fields ARE available
      const allFields = Object.keys(mergedAnswers);
      console.log(`\n   Total fields in mergedAnswers: ${allFields.length}`);
      console.log("   Sample fields:");
      allFields.slice(0, 10).forEach(field => {
        console.log(`   - ${field}`);
      });
    }
  } else {
    console.log("❌ mergedAnswers is not defined on this page");
  }
  
  // =========================================================================
  // SUMMARY & DIAGNOSIS
  // =========================================================================
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("DIAGNOSIS & RECOMMENDATIONS");
  console.log("═══════════════════════════════════════════════════════════════");
  
  console.log("\n🔍 DATA FLOW ANALYSIS:");
  console.log("   Layer 1 (Qualtrics Raw) → Layer 2 (Merged Cache)");
  console.log("   Layer 2 (Merged Cache) → Layer 3 (Validation Cache)");
  console.log("   Layer 3 (Validation Cache) → Layer 4 (Page Display)");
  
  console.log("\n💡 COMMON ISSUES:");
  console.log("   1. TGMD data in raw cache but NOT in merged cache answers");
  console.log("      → transformRecordsToSubmissions() not converting fieldName to QID");
  console.log("      → Check jotformquestions.json mapping");
  
  console.log("\n   2. TGMD data in merged cache but NOT in validation cache");
  console.log("      → validateStudent() not extracting TGMD fields");
  console.log("      → Check TaskValidator.validateAllTasks()");
  
  console.log("\n   3. TGMD data in validation cache but NOT on page display");
  console.log("      → Page JavaScript not reading from correct cache");
  console.log("      → Check mergedAnswers population logic");
  
  console.log("\n   4. '[object Object]' display issues");
  console.log("      → Answer values are objects but code expects strings");
  console.log("      → Need to extract .answer or .text property");
  
  console.log("\n═══════════════════════════════════════════════════════════════\n");
  
})();
