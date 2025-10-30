// SIMPLE: Compare Cache TGMD Data with What You See on Page
// Run on checking_system_4_student.html?coreId=C10993&year=K3

(async () => {
  const studentId = "C10993";
  const grade = "K3";
  
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("SIMPLE CACHE DATA INSPECTOR");
  console.log("═══════════════════════════════════════════════════════════\n");
  
  // Get cache data
  const db = await new Promise((resolve) => {
    const request = indexedDB.open('JotFormCacheDB');
    request.onsuccess = () => resolve(request.result);
  });
  
  const merged = await new Promise((resolve) => {
    const tx = db.transaction(['cache'], 'readonly');
    const request = tx.objectStore('cache').get('merged_jotform_qualtrics_cache');
    request.onsuccess = () => resolve(request.result);
  });
  
  const submission = merged?.submissions?.find(s => s.coreId === studentId && s.grade === grade);
  
  if (!submission) {
    console.log("❌ Student not found in cache");
    return;
  }
  
  console.log(`Student: ${studentId} ${grade}`);
  console.log(`Sources: ${JSON.stringify(submission._sources)}\n`);
  
  // Extract TGMD trial fields from cache
  const tgmdTrials = {};
  Object.entries(submission.answers || {}).forEach(([qid, answerObj]) => {
    if (answerObj?.name?.match(/^TGMD_\d{3}_\w+_t[12]$/)) {
      tgmdTrials[answerObj.name] = {
        qid: qid,
        answer: answerObj.answer,
        type: typeof answerObj.answer
      };
    }
  });
  
  console.log(`Found ${Object.keys(tgmdTrials).length} TGMD trial fields in cache\n`);
  
  // Group by criterion (without t1/t2)
  const byCriterion = {};
  for (const [fieldName, data] of Object.entries(tgmdTrials)) {
    const base = fieldName.replace(/_t[12]$/, ''); // Remove _t1 or _t2
    if (!byCriterion[base]) {
      byCriterion[base] = { t1: null, t2: null };
    }
    if (fieldName.endsWith('_t1')) {
      byCriterion[base].t1 = data.answer;
    } else if (fieldName.endsWith('_t2')) {
      byCriterion[base].t2 = data.answer;
    }
  }
  
  // Display in readable format
  console.log("CACHE DATA (what should be displayed):");
  console.log("═══════════════════════════════════════════════════════════\n");
  
  const tasks = {
    'Hop': ['111', '112', '113', '114'],
    'Jum': ['211', '212', '213', '214'],
    'Sli': ['311', '312', '313', '314'],
    'Dri': ['411', '412', '413'],
    'Cat': ['511', '512', '513'],
    'Thr': ['611', '612', '613', '614']
  };
  
  for (const [taskCode, criteria] of Object.entries(tasks)) {
    console.log(`${taskCode}:`);
    criteria.forEach(code => {
      const fieldName = `TGMD_${code}_${taskCode}`;
      const data = byCriterion[fieldName];
      if (data) {
        const t1 = data.t1 === '1' ? '✓' : data.t1 === '0' ? '✗' : '?';
        const t2 = data.t2 === '1' ? '✓' : data.t2 === '0' ? '✗' : '?';
        const score = (data.t1 === '1' ? 1 : 0) + (data.t2 === '1' ? 1 : 0);
        console.log(`  ${code}: T1=${t1} T2=${t2} → ${score}/2`);
      }
    });
    console.log('');
  }
  
  console.log("═══════════════════════════════════════════════════════════");
  console.log("NOW COMPARE THIS WITH WHAT YOU SEE ON THE PAGE");
  console.log("═══════════════════════════════════════════════════════════\n");
  
  console.log("Instructions:");
  console.log("1. Look at the TGMD table on the page");
  console.log("2. Compare T1/T2 values for each criterion");
  console.log("3. Check if scores (X/2) match");
  console.log("4. Note any mismatches below:\n");
  
  // Export full data for inspection
  console.log("Full TGMD trial data:");
  const export_data = {};
  for (const [fieldName, data] of Object.entries(tgmdTrials)) {
    export_data[fieldName] = data.answer;
  }
  console.table(export_data);
  
})();
