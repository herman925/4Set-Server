// COMPARE: Cache Data vs Student Page Display
// Run this on checking_system_4_student.html?coreId=C10993&year=K3

(async () => {
  const studentId = "C10993";
  const grade = "K3";
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("CACHE vs PAGE DISPLAY COMPARISON");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`Student: ${studentId}, Grade: ${grade}\n`);
  
  // Open IndexedDB
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('JotFormCacheDB');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  // 1. Get data from cache
  console.log("📦 STEP 1: Reading from Cache...");
  const merged = await new Promise((resolve) => {
    const tx = db.transaction(['cache'], 'readonly');
    const request = tx.objectStore('cache').get('merged_jotform_qualtrics_cache');
    request.onsuccess = () => resolve(request.result);
  });
  
  const submission = merged?.submissions?.find(s => s.coreId === studentId && s.grade === grade);
  
  if (!submission) {
    console.log("❌ Submission not found in cache!");
    return;
  }
  
  console.log(`✅ Found in cache`);
  console.log(`   _sources: ${JSON.stringify(submission._sources)}\n`);
  
  // Extract TGMD data from cache
  const cacheData = new Map();
  Object.entries(submission.answers || {}).forEach(([qid, answerObj]) => {
    if (answerObj?.name?.startsWith('TGMD_')) {
      cacheData.set(answerObj.name, {
        qid: qid,
        answer: answerObj.answer,
        text: answerObj.text,
        type: typeof answerObj.answer
      });
    }
  });
  
  console.log(`   TGMD fields in cache: ${cacheData.size}\n`);
  
  // 2. Get data from page display
  console.log("📄 STEP 2: Reading from Page Display...");
  
  // Try different possible global variables
  let pageData = null;
  let pageDataSource = null;
  
  if (typeof mergedAnswers !== 'undefined') {
    pageData = mergedAnswers;
    pageDataSource = 'mergedAnswers';
  } else if (typeof window.mergedAnswers !== 'undefined') {
    pageData = window.mergedAnswers;
    pageDataSource = 'window.mergedAnswers';
  } else if (typeof studentData !== 'undefined') {
    pageData = studentData;
    pageDataSource = 'studentData';
  } else if (typeof window.studentData !== 'undefined') {
    pageData = window.studentData;
    pageDataSource = 'window.studentData';
  }
  
  if (!pageData) {
    console.log("⚠️  Page data not found in global scope!");
    console.log("   Possible reasons:");
    console.log("   1. Page JavaScript hasn't loaded yet");
    console.log("   2. Data stored in different variable name");
    console.log("   3. Data stored in closure/module scope");
    console.log("\n   Trying alternative: Read from DOM elements...\n");
    
    // Alternative: Parse from DOM - Find TGMD table
    const tgmdSection = document.querySelector('[data-task="TGMD"]');
    if (tgmdSection) {
      const rows = tgmdSection.querySelectorAll('tbody tr');
      pageData = {};
      
      rows.forEach(row => {
        // Skip header rows (task group headers)
        if (row.querySelector('.font-semibold') && row.children.length === 1) {
          return;
        }
        
        // Skip the "慣用腳" (preferred foot) row
        if (row.innerHTML.includes('慣用腳')) {
          return;
        }
        
        // Parse criterion rows - these have 4 cells
        const cells = row.querySelectorAll('td');
        if (cells.length === 4) {
          const questionCell = cells[0].textContent.trim();
          const answerCell = cells[1].textContent.trim();
          const scoreCell = cells[2].textContent.trim();
          const resultCell = cells[3].textContent.trim();
          
          // Extract field name from first cell (format: TGMD_111_Hop)
          const match = questionCell.match(/TGMD_\d{3}_\w+/);
          if (match) {
            const baseField = match[0];
            
            // Parse trials from answer cell (T1: X, T2: Y)
            const answerLines = answerCell.split('\n').map(l => l.trim()).filter(l => l);
            
            let t1Value = null;
            let t2Value = null;
            
            answerLines.forEach(line => {
              if (line.startsWith('T1:')) {
                const icon = line.includes('✓') || line.includes('check') ? '1' :
                             line.includes('✗') || line.includes('x') ? '0' :
                             line.includes('?') || line.includes('help') ? null : null;
                t1Value = icon;
              } else if (line.startsWith('T2:')) {
                const icon = line.includes('✓') || line.includes('check') ? '1' :
                             line.includes('✗') || line.includes('x') ? '0' :
                             line.includes('?') || line.includes('help') ? null : null;
                t2Value = icon;
              }
            });
            
            // Store both trial fields
            pageData[`${baseField}_t1`] = t1Value !== null ? String(t1Value) : null;
            pageData[`${baseField}_t2`] = t2Value !== null ? String(t2Value) : null;
            
            console.log(`   Parsed: ${baseField}_t1="${pageData[`${baseField}_t1`]}", t2="${pageData[`${baseField}_t2`]}"`);
          }
        }
      });
      
      pageDataSource = 'DOM table (TGMD section)';
      console.log(`   Parsed ${Object.keys(pageData).length} trial fields from DOM`);
    }
  }
  
  if (!pageData) {
    console.log("❌ Cannot read page display data!");
    return;
  }
  
  console.log(`✅ Found page data in: ${pageDataSource}`);
  
  // Extract TGMD fields from page
  const displayData = new Map();
  Object.entries(pageData).forEach(([fieldName, value]) => {
    if (fieldName.startsWith('TGMD_')) {
      displayData.set(fieldName, value);
    }
  });
  
  console.log(`   TGMD fields on page: ${displayData.size}\n`);
  
  // 3. Compare
  console.log("🔍 STEP 3: Comparing Data...\n");
  
  // Find sample fields (trial-based fields for comparison)
  const sampleFields = [
    'TGMD_111_Hop_t1', 'TGMD_111_Hop_t2',
    'TGMD_114_Hop_t1', 'TGMD_114_Hop_t2',
    'TGMD_211_Jum_t1', 'TGMD_211_Jum_t2',
    'TGMD_511_Cat_t1', 'TGMD_511_Cat_t2',
    'TGMD_Hand', 'TGMD_Leg'
  ];
  
  let matchCount = 0;
  let mismatchCount = 0;
  let missingCount = 0;
  
  console.log("Comparing sample fields:\n");
  
  sampleFields.forEach((fieldName, index) => {
    const cached = cacheData.get(fieldName);
    const displayed = displayData.get(fieldName);
    
    console.log(`${index + 1}. ${fieldName}:`);
    
    if (!cached) {
      console.log(`   ⚠️  NOT in cache`);
      missingCount++;
    } else if (!displayed) {
      console.log(`   ❌ Cache: "${cached.answer}" (${cached.type})`);
      console.log(`   ⚠️  NOT on page display`);
      missingCount++;
    } else {
      // Extract display value (handle different structures)
      let displayValue = displayed;
      if (typeof displayed === 'object') {
        displayValue = displayed.answer || displayed.value || displayed.displayText || JSON.stringify(displayed);
      }
      
      const match = (cached.answer == displayValue) || (cached.text == displayValue);
      
      if (match) {
        console.log(`   ✅ Cache: "${cached.answer}" (${cached.type})`);
        console.log(`   ✅ Page:  "${displayValue}"`);
        matchCount++;
      } else {
        console.log(`   ❌ Cache: "${cached.answer}" (${cached.type})`);
        console.log(`   ❌ Page:  "${displayValue}"`);
        console.log(`   ⚠️  MISMATCH!`);
        mismatchCount++;
      }
    }
    console.log("");
  });
  
  // 4. Summary
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("COMPARISON SUMMARY:");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`Total fields compared: ${sampleFields.length}`);
  console.log(`✅ Matching: ${matchCount}`);
  console.log(`❌ Mismatching: ${mismatchCount}`);
  console.log(`⚠️  Missing: ${missingCount}\n`);
  
  if (matchCount === sampleFields.length) {
    console.log("🎉 PERFECT MATCH!");
    console.log("All cache data is correctly displayed on the page.");
  } else if (mismatchCount > 0) {
    console.log("⚠️  DATA MISMATCH DETECTED!");
    console.log("Cache and page display show different values.");
    console.log("Check for:");
    console.log("  - Data transformation errors");
    console.log("  - Display formatting issues");
    console.log("  - Validation calculation problems");
  } else if (missingCount > 0) {
    console.log("⚠️  DATA MISSING ON PAGE!");
    console.log("Cache has data but page doesn't display it.");
    console.log("Check for:");
    console.log("  - Variable scope issues (mergedAnswers not defined)");
    console.log("  - Page JavaScript not loaded");
    console.log("  - Data filtering/validation removing fields");
  }
  
  console.log("\n═══════════════════════════════════════════════════════════════\n");
  
  // 5. Export for detailed inspection
  console.log("💾 DETAILED DATA EXPORT:");
  console.log("Run these commands to inspect full data:\n");
  console.log("// View all cache TGMD data:");
  console.log("cacheData = new Map();");
  const cacheExport = {};
  cacheData.forEach((value, key) => {
    cacheExport[key] = { answer: value.answer, type: value.type };
  });
  console.table(cacheExport);
  
  if (displayData.size > 0) {
    console.log("\n// View all page display data:");
    const displayExport = {};
    displayData.forEach((value, key) => {
      displayExport[key] = typeof value === 'object' 
        ? (value.answer || value.value || value.displayText || '[object]')
        : value;
    });
    console.table(displayExport);
  }
  
})();
