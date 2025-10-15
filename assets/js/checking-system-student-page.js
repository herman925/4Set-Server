/**
 * Student Detail Page Controller
 * Handles URL parameter parsing, data loading, and UI population
 */
(() => {
  let studentData = null;
  let schoolData = null;
  let classData = null;
  let taskRegistry = null; // Centralized task identifier mappings
  let systemPassword = null;

  /**
   * Load task metadata from survey-structure.json for centralized identifier mapping
   */
  async function loadTaskRegistry() {
    try {
      const response = await fetch('assets/tasks/survey-structure.json');
      const surveyStructure = await response.json();
      taskRegistry = surveyStructure.taskMetadata || {};
      
      const taskCount = Object.keys(taskRegistry).length;
      console.log('[StudentPage] Task metadata loaded from survey-structure:', taskCount, 'tasks');
    } catch (error) {
      console.error('[StudentPage] Failed to load task metadata:', error);
      taskRegistry = {}; // Fallback to empty registry
    }
  }

  /**
   * Initialize the student detail page
   */
  async function init() {
    try {
      // Load task registry first
      await loadTaskRegistry();
      
      // Parse URL parameters - only need coreId
      const urlParams = new URLSearchParams(window.location.search);
      const coreId = urlParams.get('coreId'); // Core ID (e.g., C10002)

      if (!coreId) {
        showError('No Core ID provided in URL');
        return;
      }

      // Check if data is already decrypted and cached
      const cachedData = window.CheckingSystemData?.getCachedData();
      
      if (cachedData && cachedData.credentials) {
        // Use cached data (includes credentials from home page)
        await loadStudentFromCache(coreId, cachedData);
      } else {
        // No cached data or missing credentials - redirect to home page
        showError('Please go through home page to load data first.');
        setTimeout(() => {
          window.location.href = 'checking_system_home.html';
        }, 2000);
        return;
      }

      // Update breadcrumbs - all context derived from loaded data
      updateBreadcrumbs();

      // Fetch Jotform data for this student
      await fetchAndPopulateJotformData(coreId);

    } catch (error) {
      console.error('Failed to initialize student page:', error);
      showError('Failed to load student data: ' + error.message);
    }
  }

  /**
   * Load student data from cached session data
   */
  async function loadStudentFromCache(coreId, cachedData) {
    console.log('[StudentPage] ========== LOADING FROM CACHE ==========');
    console.log('[StudentPage] Looking for Core ID:', coreId);
    console.log('[StudentPage] Total students in cache:', cachedData.coreIdMap.size);
    
    // Look up student in cached data
    studentData = cachedData.coreIdMap.get(coreId);
    
    if (!studentData) {
      console.error('[StudentPage] ❌ Student NOT FOUND in cache');
      console.log('[StudentPage] Available Core IDs (first 10):', Array.from(cachedData.coreIdMap.keys()).slice(0, 10));
      showError(`Student with Core ID ${coreId} not found in cached data`);
      return;
    }

    console.log('[StudentPage] ✅ Student found:', {
      coreId: studentData.coreId,
      studentId: studentData.studentId,
      studentName: studentData.studentName,
      schoolId: studentData.schoolId,
      classId: studentData.classId
    });

    // Look up related school and class
    if (studentData.schoolId) {
      schoolData = cachedData.schoolIdMap.get(studentData.schoolId);
    }
    
    if (studentData.classId) {
      classData = cachedData.classIdMap.get(studentData.classId);
    }

    console.log('[StudentPage] School found:', schoolData ? schoolData.schoolNameChinese : 'NOT FOUND');
    console.log('[StudentPage] Class found:', classData ? classData.actualClassName : 'NOT FOUND');
    console.log('[StudentPage] ==========================================');

    // Populate student profile
    populateStudentProfile();
    
    // Update page title
    populatePageTitle();
    
    // Build dynamic Task Progress section (now that we have student gender)
    await buildTaskProgressSection();

    console.log('Student data loaded:', studentData);
  }

  /**
   * Prompt for system password to decrypt data
   */
  async function promptForPassword(studentId) {
    const password = prompt('Enter system password to decrypt student data:');
    
    if (!password) {
      showError('Password required to load student data');
      return;
    }

    systemPassword = password;

    try {
      // Load all data
      const allData = await window.CheckingSystemData.loadAllData(systemPassword);
      
      // Cache it
      window.CheckingSystemData.cacheData(allData);
      
      // Load student
      await loadStudentFromCache(studentId, allData);
    } catch (error) {
      showError('Failed to decrypt data. Please check your password.');
      throw error;
    }
  }

  /**
   * Populate student profile section
   */
  function populateStudentProfile() {
    if (!studentData) {
      console.warn('[StudentPage] ❌ populateStudentProfile called but studentData is null!');
      return;
    }

    console.log('[StudentPage] ========== POPULATING PROFILE ==========');
    console.log('[StudentPage] Student Name:', studentData.studentName);
    console.log('[StudentPage] Student ID:', studentData.studentId);

    // Update page elements
    updateTextContent('student-core-id', studentData.coreId);
    updateTextContent('student-student-id', studentData.studentId);
    updateTextContent('student-name', studentData.studentName);
    updateTextContent('student-gender', studentData.gender === 'M' ? 'Male' : 'Female');
    updateTextContent('student-group', studentData.group);
    
    if (schoolData) {
      updateTextContent('student-school-id', schoolData.schoolId);
      updateTextContent('student-school-name', `${schoolData.schoolNameChinese} (${schoolData.schoolName})`);
      updateTextContent('student-district', schoolData.district);
    }
    
    if (classData) {
      updateTextContent('student-class-id', classData.classId);
      updateTextContent('student-class-name', classData.actualClassName);
      updateTextContent('student-teacher', classData.teacherNames || 'N/A');
    }

    console.log('[StudentPage] Profile population complete');
    console.log('[StudentPage] ==========================================');
  }

  /**
   * Update page title with student name
   */
  function populatePageTitle() {
    if (!studentData) return;

    document.title = `Student Detail · ${studentData.studentName} · 4Set Checking System`;
    
    // Update header title if exists
    const headerTitle = document.querySelector('h1');
    if (headerTitle) {
      headerTitle.textContent = `Student: ${studentData.studentName}`;
    }
  }

  /**
   * Update breadcrumbs - derive all context from loaded data (no URL params needed)
   */
  function updateBreadcrumbs() {
    const breadcrumbsNav = document.querySelector('nav.text-sm');
    if (!breadcrumbsNav || !studentData) return;

    let breadcrumbs = [];

    // Derive context from student's school data
    const district = schoolData?.district;
    const group = schoolData?.group;

    // Add district if available
    if (district) {
      breadcrumbs.push(`<a href="checking_system_1_district.html?district=${encodeURIComponent(district)}" class="hover:text-[color:var(--primary)] transition-colors">${district}</a>`);
    }

    // Add group if available
    if (group) {
      breadcrumbs.push(`<a href="checking_system_1_group.html?group=${group}" class="hover:text-[color:var(--primary)] transition-colors">Group ${group}</a>`);
    }

    // Add school (derived from student data)
    if (schoolData) {
      breadcrumbs.push(`<a href="checking_system_2_school.html?schoolId=${schoolData.schoolId}" class="hover:text-[color:var(--primary)] transition-colors">${schoolData.schoolNameChinese} (${schoolData.schoolName})</a>`);
    }

    // Add class (derived from student data)
    if (classData) {
      breadcrumbs.push(`<a href="checking_system_3_class.html?classId=${classData.classId}" class="hover:text-[color:var(--primary)] transition-colors">${classData.actualClassName}</a>`);
    }

    // Add student (current page, not a link)
    breadcrumbs.push(`<span class="text-[color:var(--foreground)] font-medium">${studentData.studentName}</span>`);

    // Update breadcrumbs HTML
    breadcrumbsNav.innerHTML = breadcrumbs.join('<span class="text-[color:var(--border)]"> / </span>');
  }

  /**
   * Helper function to update text content safely
   */
  function updateTextContent(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value || 'N/A';
      console.log(`[StudentPage] ✅ Updated ${id}:`, value);
    } else {
      console.warn(`[StudentPage] ❌ Element not found: ${id}`);
    }
  }

  /**
   * Show error message
   */
  function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'fixed top-4 right-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg z-50';
    errorDiv.innerHTML = `
      <strong class="font-bold">Error: </strong>
      <span class="block sm:inline">${message}</span>
    `;
    document.body.appendChild(errorDiv);

    setTimeout(() => errorDiv.remove(), 5000);
  }

  /**
   * Fetch Jotform submissions for this student and populate UI
   */
  async function fetchAndPopulateJotformData(coreId) {
    try {
      // Check cache first
      const cacheKey = `student_jotform_${coreId}`;
      const cached = sessionStorage.getItem(cacheKey);
      
      if (cached) {
        console.log('[StudentPage] ========== CACHE LOOKUP ==========');
        console.log('[StudentPage] Cache key:', cacheKey);
        
        const cachedData = JSON.parse(cached);
        const expiresAt = new Date(cachedData.expiresAt);
        const now = new Date();
        const timeRemaining = Math.round((expiresAt - now) / 1000 / 60); // minutes
        
        if (now < expiresAt) {
          console.log('[StudentPage] ✅ CACHE HIT - Using cached data');
          console.log(`[StudentPage]   Cached at: ${cachedData.timestamp}`);
          console.log(`[StudentPage]   Expires at: ${cachedData.expiresAt} (${timeRemaining} minutes remaining)`);
          console.log(`[StudentPage]   Submissions merged: ${cachedData.submissionCount}`);
          console.log(`[StudentPage]   Fields: ${Object.keys(cachedData.mergedAnswers).length}`);
          console.log('[StudentPage] ==========================================');
          
          populateJotformData(cachedData);
          return;
        } else {
          console.log('[StudentPage] ❌ CACHE EXPIRED - Fetching fresh data');
          console.log(`[StudentPage]   Expired ${Math.abs(timeRemaining)} minutes ago`);
          console.log('[StudentPage] ==========================================');
        }
      } else {
        console.log('[StudentPage] ========== CACHE LOOKUP ==========');
        console.log('[StudentPage] ❌ CACHE MISS - No cached data found');
        console.log('[StudentPage] ==========================================');
      }

      // Load question mappings
      const questionsResponse = await fetch('assets/jotformquestions.json');
      const questionsData = await questionsResponse.json();
      
      // Find Core ID question - it's called "student-id" in Jotform (QID 20)
      const coreIdQid = questionsData['student-id'];
      
      if (!coreIdQid) {
        showError('student-id field not found in jotformquestions.json');
        return;
      }

      // Use shared Jotform API module (mirroring processor_agent.ps1 METHOD 1: filter API)
      console.log('[StudentPage] ========== FETCHING JOTFORM DATA ==========');
      console.log('[StudentPage] Fetching Jotform data for Core ID:', coreId);
      
      const allSubmissions = await window.JotformAPI.fetchStudentSubmissions(coreId, coreIdQid);
      const totalReturned = allSubmissions.length;
      
      console.log(`[StudentPage] Filter API returned: ${totalReturned} submissions`);
      
      // VALIDATE EXACT MATCHES (like processor_agent.ps1 does - lines 1376-1395)
      const coreIdNumeric = coreId.startsWith('C') ? coreId.substring(1) : coreId;
      const submissions = [];
      
      console.log('[StudentPage] Validating each submission for EXACT match...');
      
      for (const sub of allSubmissions) {
        // Extract student-id value (try .answer first, fallback to .text)
        let studentIdValue = null;
        if (sub.answers?.[coreIdQid]?.answer) {
          studentIdValue = sub.answers[coreIdQid].answer;
        } else if (sub.answers?.[coreIdQid]?.text) {
          studentIdValue = sub.answers[coreIdQid].text;
        }
        
        // Normalize whitespace (like processor_agent.ps1)
        if (studentIdValue) {
          studentIdValue = studentIdValue.trim().replace(/\s+/g, ' ');
        }
        
        // Check for EXACT match
        if (studentIdValue === coreIdNumeric) {
          submissions.push(sub);
          console.log(`[StudentPage]   ✅ EXACT MATCH: ${studentIdValue} (Submission ID: ${sub.id})`);
        }
      }
      
      console.log(`[StudentPage] Validation complete: ${submissions.length} exact matches out of ${totalReturned} returned`);
      
      if (submissions.length !== totalReturned) {
        console.warn(`[StudentPage] ⚠️ Jotform filter is BROKEN - returned ${totalReturned} but only ${submissions.length} match!`);
        console.warn(`[StudentPage] Using client-side filtering as fallback (like processor_agent.ps1)`);
      } else {
        console.log(`[StudentPage] ✅ Filter working correctly!`);
      }
      
      console.log('[StudentPage] ==========================================');

      if (submissions.length === 0) {
        showNoDataMessage();
        return;
      }

      // Extract and log sessionkeys
      console.log('[StudentPage] ========== SESSIONKEY EXTRACTION ==========');
      console.log(`[StudentPage] Found ${submissions.length} submissions for Core ID ${coreId}`);
      const sessionKeys = submissions.map((sub, index) => {
        const sessionKeyQid = questionsData['sessionkey'];
        const sessionKey = sub.answers?.[sessionKeyQid]?.answer || sub.answers?.[sessionKeyQid]?.text || 'UNKNOWN';
        console.log(`[StudentPage]   Submission ${index + 1}: ${sessionKey} (ID: ${sub.id}, Created: ${sub.created_at})`);
        return sessionKey;
      });
      console.log('[StudentPage] ==========================================');

      // Merge submissions (prefer earliest for overlaps, fill missing from later)
      const mergedData = mergeSubmissions(submissions, questionsData);

      // Calculate completion metrics
      const metrics = calculateCompletionMetrics(mergedData, questionsData);

      // Cache the results (merged data only, not all 517 raw submissions!)
      console.log('[StudentPage] ========== CACHING MERGED DATA ==========');
      const cacheData = {
        coreId,
        submissionCount: submissions.length,
        mergedAnswers: mergedData,
        metrics,
        timestamp: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour TTL
      };
      
      console.log('[StudentPage] Cache key:', cacheKey);
      console.log('[StudentPage] Cache contents:');
      console.log(`[StudentPage]   Core ID: ${cacheData.coreId}`);
      console.log(`[StudentPage]   Submissions merged: ${cacheData.submissionCount}`);
      console.log(`[StudentPage]   Unique fields in merged data: ${Object.keys(cacheData.mergedAnswers).length}`);
      console.log(`[StudentPage]   Completion: ${cacheData.metrics.completionPercentage}%`);
      console.log(`[StudentPage]   Cached at: ${cacheData.timestamp}`);
      console.log(`[StudentPage]   Expires at: ${cacheData.expiresAt}`);
      
      // Show sample of merged fields
      const sampleFields = Object.keys(cacheData.mergedAnswers).slice(0, 5);
      if (sampleFields.length > 0) {
        console.log('[StudentPage]   Sample merged fields (first 5):');
        sampleFields.forEach(field => {
          const value = cacheData.mergedAnswers[field].answer || cacheData.mergedAnswers[field].text || '—';
          console.log(`[StudentPage]     - ${field}: ${value}`);
        });
      }
      
      try {
        const cacheString = JSON.stringify(cacheData);
        const cacheSizeKB = (cacheString.length / 1024).toFixed(2);
        console.log(`[StudentPage]   Cache size: ${cacheSizeKB} KB`);
        
        sessionStorage.setItem(cacheKey, cacheString);
        console.log('[StudentPage] ✅ Successfully cached merged data');
      } catch (e) {
        console.warn('[StudentPage] ❌ Failed to cache (quota exceeded):', e.message);
        // Continue without caching - not critical
      }
      
      console.log('[StudentPage] ==========================================');

      // Populate UI
      populateJotformData(cacheData);

    } catch (error) {
      console.error('Failed to fetch Jotform data:', error);
      showError(`Failed to load submission data: ${error.message}`);
    }
  }

  /**
   * Merge multiple submissions (prefer earliest for overlaps, fill missing from later)
   */
  function mergeSubmissions(submissions, questionsData) {
    console.log('[StudentPage] ========== MERGING SUBMISSIONS ==========');
    console.log(`[StudentPage] Input: ${submissions.length} submissions to merge`);
    
    // Sort by created_at (earliest first)
    const sorted = submissions.sort((a, b) => 
      new Date(a.created_at) - new Date(b.created_at)
    );

    // Log sorted order with sessionkey timestamps
    console.log('[StudentPage] Sorted by created_at (EARLIEST FIRST):');
    const sessionKeyQid = questionsData['sessionkey'];
    sorted.forEach((sub, index) => {
      const sessionKey = sub.answers?.[sessionKeyQid]?.answer || sub.answers?.[sessionKeyQid]?.text || 'UNKNOWN';
      console.log(`[StudentPage]   ${index + 1}. ${sessionKey} (Created: ${sub.created_at})`);
    });

    // Create reverse mapping: QID -> field name
    const qidToFieldName = {};
    for (const [fieldName, qid] of Object.entries(questionsData)) {
      qidToFieldName[qid] = fieldName;
    }

    const merged = {};
    const mergeStats = {
      totalFields: 0,
      filledFromSubmission: {},
      overlaps: 0,
      overlapsKeptOldest: []
    };

    // Initialize stats counters
    sorted.forEach((sub, index) => {
      const sessionKey = sub.answers?.[sessionKeyQid]?.answer || sub.answers?.[sessionKeyQid]?.text || `Submission${index + 1}`;
      mergeStats.filledFromSubmission[sessionKey] = 0;
    });

    console.log('[StudentPage] Merge Logic: a) Fill missing fields from ANY record, b) Keep OLDEST for overlaps');
    console.log('[StudentPage] Processing fields...');

    // Merge answers - iterate through sorted (earliest first)
    // This ensures EARLIEST submission "wins" for any field
    for (let i = 0; i < sorted.length; i++) {
      const submission = sorted[i];
      const sessionKey = submission.answers?.[sessionKeyQid]?.answer || submission.answers?.[sessionKeyQid]?.text || `Submission${i + 1}`;
      let fieldsAddedFromThisSubmission = 0;

      for (const [qid, answer] of Object.entries(submission.answers || {})) {
        const fieldName = qidToFieldName[qid];
        
        if (!fieldName || !answer.answer) continue;

        if (!merged[fieldName]) {
          // NEW FIELD - fill missing data
          merged[fieldName] = answer;
          fieldsAddedFromThisSubmission++;
          mergeStats.totalFields++;
        } else {
          // OVERLAP DETECTED - already have this field from earlier submission
          mergeStats.overlaps++;
          mergeStats.overlapsKeptOldest.push({
            field: fieldName,
            keptFrom: Object.keys(mergeStats.filledFromSubmission)[0], // First submission
            skippedFrom: sessionKey
          });
        }
      }

      mergeStats.filledFromSubmission[sessionKey] = fieldsAddedFromThisSubmission;
      
      if (fieldsAddedFromThisSubmission > 0) {
        console.log(`[StudentPage]   ✅ ${sessionKey}: Added ${fieldsAddedFromThisSubmission} fields`);
      } else {
        console.log(`[StudentPage]   ⏭️  ${sessionKey}: No new fields (all overlaps)`);
      }
    }

    console.log('[StudentPage] ');
    console.log('[StudentPage] MERGE STATISTICS:');
    console.log(`[StudentPage]   Total unique fields: ${mergeStats.totalFields}`);
    console.log(`[StudentPage]   Overlaps detected: ${mergeStats.overlaps}`);
    console.log('[StudentPage]   Fields contributed by each submission:');
    for (const [sessionKey, count] of Object.entries(mergeStats.filledFromSubmission)) {
      console.log(`[StudentPage]     - ${sessionKey}: ${count} fields`);
    }

    if (mergeStats.overlaps > 0) {
      console.log(`[StudentPage]   Overlap handling: Kept OLDEST value for ${mergeStats.overlaps} fields`);
      if (mergeStats.overlapsKeptOldest.length <= 5) {
        mergeStats.overlapsKeptOldest.forEach(overlap => {
          console.log(`[StudentPage]     - ${overlap.field}: Kept from ${overlap.keptFrom}, skipped ${overlap.skippedFrom}`);
        });
      } else {
        console.log(`[StudentPage]     (First 3 examples shown)`);
        mergeStats.overlapsKeptOldest.slice(0, 3).forEach(overlap => {
          console.log(`[StudentPage]     - ${overlap.field}: Kept from ${overlap.keptFrom}, skipped ${overlap.skippedFrom}`);
        });
      }
    }

    console.log('[StudentPage] ==========================================');

    return merged;
  }

  /**
   * Calculate completion metrics from merged answers
   */
  function calculateCompletionMetrics(mergedAnswers, questionsData) {
    const totalQuestions = Object.keys(questionsData).length;
    const answeredQuestions = Object.keys(mergedAnswers).length;
    const completionPercentage = totalQuestions > 0 
      ? Math.round((answeredQuestions / totalQuestions) * 100) 
      : 0;

    // Group by set (if metadata available)
    const bySet = {
      set1: { answered: 0, total: 0 },
      set2: { answered: 0, total: 0 },
      set3: { answered: 0, total: 0 },
      set4: { answered: 0, total: 0 }
    };

    // TODO: Group questions by set using metadata from questionsData

    return {
      totalQuestions,
      answeredQuestions,
      completionPercentage,
      bySet
    };
  }

  /**
   * Populate UI with Jotform data
   */
  async function populateJotformData(data) {
    try {
      console.log('[StudentPage] ========== POPULATING UI ==========');
      
      // Update completion percentage if element exists
      const completionEl = document.querySelector('[data-completion]');
      if (completionEl && data.metrics) {
        completionEl.textContent = `${data.metrics.completionPercentage}%`;
      }

      // Validate all tasks using the merged answers
      console.log('[StudentPage] Validating tasks with TaskValidator...');
      
      if (!window.TaskValidator) {
        throw new Error('TaskValidator not loaded');
      }
      
      const taskValidation = await window.TaskValidator.validateAllTasks(data.mergedAnswers);
      
      console.log('[StudentPage] Task validation complete:', taskValidation);
      
      // Populate task tables with real data
      populateTaskTables(taskValidation, data.mergedAnswers);
      
      console.log('[StudentPage] UI population complete');
      console.log('[StudentPage] ==========================================');
    } catch (error) {
      console.error('[StudentPage] ❌ Error populating UI:', error);
      showError(`Failed to populate task data: ${error.message}`);
      throw error; // Re-throw to see full stack trace
    }
  }

  /**
   * Populate task tables with validated question data
   */
  function populateTaskTables(taskValidation, mergedAnswers) {
    console.log('[StudentPage] Populating task tables...');
    
    // No need for taskIdMap - use the actual filename from metadata
    // The data-task attribute will be set to the filename (e.g., "HeadToeKneeShoulder")
    
    // Iterate through each validated task
    for (const [taskId, validation] of Object.entries(taskValidation)) {
      if (validation.error) {
        console.warn(`[StudentPage] Skipping ${taskId}: ${validation.error}`);
        continue;
      }
      
      // Find the corresponding task element by matching the task ID
      // TaskValidator may use aliases (e.g., "htks") or full IDs (e.g., "headtoekneeshoulder")
      const allTasks = document.querySelectorAll('[data-task-id]');
      const taskElement = Array.from(allTasks).find(el => {
        const dataTaskId = el.getAttribute('data-task-id');
        
        // Direct match: dataTaskId === taskId
        if (dataTaskId.toLowerCase() === taskId.toLowerCase()) {
          return true;
        }
        
        // Reverse match: Check if taskId is an alias for dataTaskId
        // E.g., taskId="htks" should match dataTaskId="headtoekneeshoulder"
        if (taskRegistry) {
          for (const [filename, metadata] of Object.entries(taskRegistry)) {
            // Check if dataTaskId matches this task's canonical ID
            if (dataTaskId.toLowerCase() === metadata.id.toLowerCase()) {
              // Now check if taskId is either the same ID or one of its aliases
              if (taskId.toLowerCase() === metadata.id.toLowerCase()) {
                return true; // Both match the canonical ID
              }
              if (metadata.aliases && metadata.aliases.some(alias => 
                alias.toLowerCase() === taskId.toLowerCase()
              )) {
                return true; // taskId is an alias for this task
              }
            }
          }
        }
        
        return false;
      });
      
      if (!taskElement) {
        console.log(`[StudentPage] No HTML element for task: ${taskId}`);
        continue;
      }
      
      // Find the table body within this task
      const tbody = taskElement.querySelector('table tbody');
      if (!tbody) {
        console.log(`[StudentPage] No table found for task: ${taskId}`);
        continue;
      }
      
      // Clear dummy data
      tbody.innerHTML = '';
      
      // Check if this is a Y/N task (all questions are Y/N)
      const isYNTask = validation.questions.length > 0 && 
                       validation.questions.every(q => q.isYNQuestion);
      
      // Hide "Correct Answer" column header for Y/N tasks
      const table = taskElement.querySelector('table');
      const correctAnswerHeader = table?.querySelector('thead th:nth-child(3)');
      if (correctAnswerHeader) {
        correctAnswerHeader.style.display = isYNTask ? 'none' : '';
      }
      
      // Populate with real questions
      for (const question of validation.questions) {
        const row = document.createElement('tr');
        row.setAttribute('data-state', question.isCorrect ? 'correct' : 'incorrect');
        row.setAttribute('data-missing', question.studentAnswer === null ? 'true' : 'false');
        row.className = 'hover:bg-[color:var(--muted)]/30';
        
        row.innerHTML = `
          <td class="py-2 px-2 text-[color:var(--foreground)] font-mono">${question.id}</td>
          <td class="py-2 px-2 text-[color:var(--muted-foreground)]">${question.studentAnswer || '—'}</td>
          <td class="py-2 px-2 text-[color:var(--muted-foreground)]" style="display: ${isYNTask ? 'none' : ''}">${question.correctAnswer || '—'}</td>
          <td class="py-2 px-2">
            ${question.studentAnswer === null 
              ? '<span class="answer-pill incorrect"><i data-lucide="minus" class="w-3 h-3"></i>Not answered</span>'
              : question.isCorrect 
                ? '<span class="answer-pill correct"><i data-lucide="check" class="w-3 h-3"></i>Correct</span>'
                : '<span class="answer-pill incorrect"><i data-lucide="x" class="w-3 h-3"></i>Incorrect</span>'
            }
          </td>
          <td class="py-2 px-2 text-xs text-[color:var(--muted-foreground)]">—</td>
        `;
        
        tbody.appendChild(row);
      }
      
      // Update task summary (answered/total questions)
      const answeredCountEl = taskElement.querySelector('.answered-count');
      const totalCountEl = taskElement.querySelector('.total-count');
      
      if (answeredCountEl) {
        answeredCountEl.textContent = validation.answeredQuestions;
        console.log(`[StudentPage] Set answered-count for ${taskId}: "${answeredCountEl.textContent}" (target was ${validation.answeredQuestions})`);
      } else {
        console.warn(`[StudentPage] answered-count element not found for ${taskId}`);
      }
      
      if (totalCountEl) {
        totalCountEl.textContent = validation.totalQuestions;
        console.log(`[StudentPage] Set total-count for ${taskId}: "${totalCountEl.textContent}" (target was ${validation.totalQuestions})`);
      } else {
        console.warn(`[StudentPage] total-count element not found for ${taskId}`);
      }
      
      console.log(`[StudentPage] ✅ Updated counts for ${taskId}: ${validation.answeredQuestions}/${validation.totalQuestions}`);
      
      // Populate termination checklist if task has termination points
      populateTerminationChecklist(taskElement, taskId, validation, mergedAnswers);
      
      console.log(`[StudentPage] ✅ Populated ${taskId}: ${validation.questions.length} questions`);
    }
    
    // Reinitialize Lucide icons
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  /**
   * Show "no data" message
   */
  function showNoDataMessage() {
    const mainContent = document.querySelector('main');
    if (mainContent) {
      const notice = document.createElement('div');
      notice.className = 'entry-card p-6 text-center';
      notice.innerHTML = `
        <i data-lucide="inbox" class="w-12 h-12 mx-auto text-[color:var(--muted-foreground)] mb-4"></i>
        <h3 class="text-lg font-semibold mb-2">No Submissions Found</h3>
        <p class="text-[color:var(--muted-foreground)]">This student hasn't submitted any assessment data yet.</p>
      `;
      mainContent.appendChild(notice);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }

  /**
   * Build Task Progress section dynamically from survey-structure.json
   */
  async function buildTaskProgressSection() {
    console.log('[StudentPage] ========== BUILDING TASK PROGRESS ==========');
    
    try {
      // Load survey structure
      const structureResponse = await fetch('assets/tasks/survey-structure.json');
      const surveyStructure = await structureResponse.json();
      
      // Sort sets by order
      const sortedSets = surveyStructure.sets.sort((a, b) => a.order - b.order);
      
      console.log(`[StudentPage] Found ${sortedSets.length} sets to render`);
      
      // Get student gender for conditional visibility (TEC_Male vs TEC_Female)
      // Normalize gender values: "M" / "m" / "Male" -> "male", "F" / "f" / "Female" -> "female"
      let studentGender = studentData?.gender?.toLowerCase() || null;
      if (studentGender === 'm') studentGender = 'male';
      if (studentGender === 'f') studentGender = 'female';
      
      console.log(`[StudentPage] Student gender: ${studentGender || 'unknown'}`);
      
      // Find the Task Progress section by looking for all details.entry-card
      // and checking their summary text
      const allDetailCards = document.querySelectorAll('details.entry-card');
      let taskProgressSection = null;
      
      for (const card of allDetailCards) {
        const summary = card.querySelector('summary');
        if (summary && summary.textContent.includes('Task Progress')) {
          taskProgressSection = card;
          break;
        }
      }
      
      if (!taskProgressSection) {
        console.warn('[StudentPage] Task Progress section not found in HTML');
        return;
      }
      
      // Get the content container (div after summary)
      const taskProgressContainer = taskProgressSection.querySelector('summary + div');
      
      if (!taskProgressContainer) {
        console.warn('[StudentPage] Task Progress container not found in HTML');
        return;
      }
      
      // Clear existing hardcoded content (including "Set 1: 第一組" header)
      taskProgressContainer.innerHTML = '';
      
      // Create a NEW divide-y container for our dynamic content
      const dynamicContainer = document.createElement('div');
      dynamicContainer.className = 'divide-y divide-[color:var(--border)] bg-[color:var(--muted)]/20';
      taskProgressContainer.appendChild(dynamicContainer);
      
      // Build each set
      for (const set of sortedSets) {
        console.log(`[StudentPage] Building ${set.name} (${set.id})...`);
        
        // Sort sections within set
        const sortedSections = set.sections.sort((a, b) => a.order - b.order);
        
        // Filter sections based on visibility conditions
        const visibleSections = [];
        
        for (const section of sortedSections) {
          // Check visibility conditions (e.g., gender-based)
          if (section.showIf) {
            if (section.showIf.gender && section.showIf.gender !== studentGender) {
              console.log(`[StudentPage]   Skipping ${section.file} (gender mismatch)`);
              continue;
            }
          }
          
          // Load task metadata (title)
          const taskId = section.file.replace('.json', '');
          const taskMetadata = await loadTaskMetadata(taskId);
          
          visibleSections.push({
            ...section,
            metadata: taskMetadata
          });
        }
        
        console.log(`[StudentPage]   ${visibleSections.length} visible tasks in ${set.name}`);
        
        // Skip empty sets
        if (visibleSections.length === 0) {
          continue;
        }
        
        // Create a COLLAPSIBLE SET CONTAINER
        const setContainer = document.createElement('details');
        setContainer.className = 'set-group border-b border-[color:var(--border)]';
        setContainer.setAttribute('data-set-id', set.id);
        // Collapsed by default
        
        // Create set header (summary for collapse)
        const setHeader = document.createElement('summary');
        setHeader.className = 'set-header px-4 py-3 bg-[color:var(--muted)]/40 cursor-pointer hover:bg-[color:var(--muted)]/60 transition-colors flex items-center justify-between';
        // Create set label (Set 1, Set 2, etc.)
        const setNumber = set.id.replace('set', '');
        const setLabel = `Set ${setNumber}`;
        
        setHeader.innerHTML = `
          <div class="flex items-center gap-3">
            <i data-lucide="chevron-right" class="w-4 h-4 text-[color:var(--muted-foreground)] transition-transform set-chevron"></i>
            <h3 class="text-sm font-semibold text-[color:var(--foreground)]">${setLabel}</h3>
            <span class="text-xs text-[color:var(--muted-foreground)] font-mono">${visibleSections.length} tasks</span>
          </div>
          <div class="text-xs text-[color:var(--muted-foreground)]">
            <span class="completion-summary set-${set.id}-summary">—</span>
          </div>
        `;
        setContainer.appendChild(setHeader);
        
        // Create tasks container within this set
        const tasksContainer = document.createElement('div');
        tasksContainer.className = 'set-tasks divide-y divide-[color:var(--border)] bg-white';
        
        // Add all tasks for this set
        for (const section of visibleSections) {
          const taskElement = createTaskElement(section, set);
          tasksContainer.appendChild(taskElement);
        }
        
        setContainer.appendChild(tasksContainer);
        dynamicContainer.appendChild(setContainer);
      }
      
      console.log('[StudentPage] Task Progress structure built successfully');
      console.log('[StudentPage] ==========================================');
      
      // Reinitialize Lucide icons
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
      
    } catch (error) {
      console.error('[StudentPage] Failed to build Task Progress:', error);
    }
  }
  
  /**
   * Load task metadata (title, etc.) from task JSON file
   */
  async function loadTaskMetadata(taskId) {
    try {
      const response = await fetch(`assets/tasks/${taskId}.json`);
      const taskData = await response.json();
      
      return {
        id: taskData.id || taskId.toLowerCase(),
        title: taskData.title || taskId,
        filename: taskId
      };
    } catch (error) {
      console.warn(`[StudentPage] Failed to load metadata for ${taskId}:`, error.message);
      return {
        id: taskId.toLowerCase(),
        title: taskId,
        filename: taskId
      };
    }
  }
  
  /**
   * Create a task element for the Task Progress section
   */
  function createTaskElement(section, set) {
    const metadata = section.metadata;
    const taskId = metadata.id;
    
    // Create task details element
    const details = document.createElement('details');
    details.className = 'task-expand';
    details.setAttribute('data-task', metadata.filename);
    details.setAttribute('data-task-id', metadata.id); // Add the actual task ID for matching!
    details.setAttribute('data-set', set.id);
    
    // Create summary (task header)
    const summary = document.createElement('summary');
    summary.className = 'px-4 py-3 grid gap-2 sm:grid-cols-[minmax(0,220px)_minmax(0,200px)_minmax(0,120px)_minmax(0,1fr)] sm:items-center cursor-pointer hover:bg-white/60 transition-colors';
    
    summary.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="status-circle status-grey" title="Loading..."></span>
        <strong class="text-[color:var(--foreground)] text-sm">${metadata.title}</strong>
      </div>
      <div class="flex flex-wrap items-center gap-1 text-xs">
        <span class="badge-pill bg-[color:var(--muted)] text-[color:var(--muted-foreground)]">${metadata.filename}</span>
        <span class="stage-badges"></span>
      </div>
      <div class="text-xs text-[color:var(--muted-foreground)] font-mono">
        <span class="answered-count">0</span> / <span class="total-count">0</span>
      </div>
      <div class="flex flex-wrap gap-2 text-xs text-[color:var(--muted-foreground)] sm:justify-end">
        <span class="task-status-summary">—</span>
      </div>
    `;
    
    // Create task content (termination checklist + table)
    const contentDiv = document.createElement('div');
    contentDiv.className = 'bg-[color:var(--muted)]/20 border-t border-[color:var(--border)] px-4 py-3 space-y-3';
    
    contentDiv.innerHTML = `
      <!-- Termination Checklist (will be populated if exists) -->
      <div class="termination-checklist hidden">
        <span class="text-xs font-semibold text-[color:var(--foreground)] uppercase tracking-wide">Termination checklist · ${metadata.filename}</span>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-[color:var(--muted-foreground)] mt-2 termination-rules">
          <!-- Dynamically populated -->
        </div>
      </div>
      
      <!-- Question Table -->
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="text-xs text-[color:var(--muted-foreground)] uppercase bg-[color:var(--muted)]/60">
            <tr>
              <th class="text-left font-medium pb-2 px-2">Question</th>
              <th class="text-left font-medium pb-2 px-2">Student Answer</th>
              <th class="text-left font-medium pb-2 px-2">Correct Answer</th>
              <th class="text-left font-medium pb-2 px-2">Result</th>
              <th class="text-left font-medium pb-2 px-2">Last Updated</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[color:var(--border)]">
            <tr><td colspan="5" class="py-4 px-2 text-center text-[color:var(--muted-foreground)]">Loading task data...</td></tr>
          </tbody>
        </table>
      </div>
    `;
    
    details.appendChild(summary);
    details.appendChild(contentDiv);
    
    return details;
  }

  /**
   * Populate termination checklist for tasks that have termination rules
   * Note: Termination values (0/1) are RECORDED by test administrators in the PDF,
   * not calculated. They document whether termination happened during assessment.
   */
  function populateTerminationChecklist(taskElement, taskId, validation, mergedAnswers) {
    console.log(`[StudentPage] Checking termination rules for task: ${taskId}`);
    
    // Define termination rules metadata for tasks that have them
    const terminationRules = {
      'erv': [
        { id: 'ERV_Ter1', description: 'Fewer than 5 correct in ERV_Q1–ERV_Q12', range: ['ERV_Q1', 'ERV_Q2', 'ERV_Q3', 'ERV_Q4', 'ERV_Q5', 'ERV_Q6', 'ERV_Q7', 'ERV_Q8', 'ERV_Q9', 'ERV_Q10', 'ERV_Q11', 'ERV_Q12'] },
        { id: 'ERV_Ter2', description: 'Fewer than 5 correct in ERV_Q13–ERV_Q24', range: ['ERV_Q13', 'ERV_Q14', 'ERV_Q15', 'ERV_Q16', 'ERV_Q17', 'ERV_Q18', 'ERV_Q19', 'ERV_Q20', 'ERV_Q21', 'ERV_Q22', 'ERV_Q23', 'ERV_Q24'] },
        { id: 'ERV_Ter3', description: 'Fewer than 5 correct in ERV_Q25–ERV_Q36', range: ['ERV_Q25', 'ERV_Q26', 'ERV_Q27', 'ERV_Q28', 'ERV_Q29', 'ERV_Q30', 'ERV_Q31', 'ERV_Q32', 'ERV_Q33', 'ERV_Q34', 'ERV_Q35', 'ERV_Q36'] }
      ]
      // Add more tasks with termination rules here
    };
    
    const rules = terminationRules[taskId];
    if (!rules || rules.length === 0) {
      console.log(`[StudentPage] No termination rules defined for ${taskId}`);
      return; // No termination rules for this task
    }
    
    console.log(`[StudentPage] Found ${rules.length} termination rules for ${taskId}`);
    
    const checklistDiv = taskElement.querySelector('.termination-checklist');
    const rulesContainer = taskElement.querySelector('.termination-rules');
    
    if (!checklistDiv || !rulesContainer) {
      console.warn(`[StudentPage] Termination elements not found for ${taskId}:`, {
        checklistDiv: !!checklistDiv,
        rulesContainer: !!rulesContainer
      });
      return;
    }
    
    console.log(`[StudentPage] Populating termination checklist for ${taskId}`);
    
    // Clear and populate rules
    rulesContainer.innerHTML = '';
    
    for (const rule of rules) {
      // Get termination value from merged Jotform data (not in validation.questions)
      const terminationField = mergedAnswers[rule.id];
      
      if (!terminationField) {
        console.warn(`[StudentPage] Termination field not found in data: ${rule.id}`);
        continue; // Skip if termination field not recorded
      }
      
      // Get the RECORDED value (what administrator marked in PDF: 0 = passed, 1 = triggered)
      const recordedValue = terminationField.answer || terminationField.text;
      const recordedTriggered = recordedValue === '1' || recordedValue === 1;
      
      console.log(`[StudentPage] Processing termination rule ${rule.id}:`, {
        recorded: recordedValue,
        triggered: recordedTriggered
      });
      
      // CALCULATE what it SHOULD be based on actual answers
      const questionsInRange = validation.questions.filter(q => rule.range.includes(q.id));
      const correctInRange = questionsInRange.filter(q => q.isCorrect).length;
      const totalInRange = questionsInRange.length;
      const calculatedTriggered = correctInRange < 5; // Threshold: fewer than 5 correct
      
      // COMPARE: Flag if there's a mismatch
      const mismatch = recordedTriggered !== calculatedTriggered;
      
      const ruleCard = document.createElement('div');
      ruleCard.className = `border rounded-lg p-3 ${
        mismatch 
          ? 'border-orange-400 bg-orange-50' // Mismatch = orange warning
          : recordedTriggered 
            ? 'border-red-300 bg-red-50'     // Triggered correctly = red
            : 'border-[color:var(--border)] bg-white' // Passed = normal
      }`;
      
      ruleCard.innerHTML = `
        <div class="flex items-start justify-between mb-2">
          <div>
            <p class="font-medium text-[color:var(--foreground)]">${rule.id}</p>
            <p class="text-[color:var(--muted-foreground)] text-xs mt-0.5">${rule.description}</p>
          </div>
          <span class="text-xs font-mono font-semibold ${correctInRange < 5 ? 'text-red-700' : 'text-green-600'}">${correctInRange}/${totalInRange}</span>
        </div>
        
        <div class="grid grid-cols-2 gap-2 text-xs mt-2">
          <!-- Administrator's Record -->
          <div class="flex items-center gap-1.5 ${recordedTriggered ? 'text-red-600' : 'text-green-600'}">
            <i data-lucide="${recordedTriggered ? 'x-circle' : 'check-circle'}" class="w-3.5 h-3.5"></i>
            <span>Recorded: <strong>${recordedTriggered ? 'Terminated' : 'Passed'}</strong></span>
          </div>
          
          <!-- System Calculation -->
          <div class="flex items-center gap-1.5 ${calculatedTriggered ? 'text-red-600' : 'text-green-600'}">
            <i data-lucide="${calculatedTriggered ? 'x-circle' : 'check-circle'}" class="w-3.5 h-3.5"></i>
            <span>Calculated: <strong>${calculatedTriggered ? 'Should Terminate' : 'Should Pass'}</strong></span>
          </div>
        </div>
        
        ${mismatch 
          ? '<div class="mt-2 pt-2 border-t border-orange-300 flex items-center gap-1.5 text-xs text-orange-700 font-semibold"><i data-lucide="alert-triangle" class="w-4 h-4"></i>Mismatch detected - Please verify</div>' 
          : '<div class="mt-2 pt-2 border-t flex items-center gap-1.5 text-xs text-green-600"><i data-lucide="check" class="w-3.5 h-3.5"></i>Verified - Record matches calculation</div>'}
      `;
      
      rulesContainer.appendChild(ruleCard);
    }
    
    // Show the checklist
    checklistDiv.classList.remove('hidden');
    console.log(`[StudentPage] ✅ Termination checklist displayed for ${taskId} with ${rules.length} rules`);
    
    // Reinitialize Lucide icons for the new elements
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  /**
   * Apply question filter to all task tables
   */
  function applyQuestionFilter(filterValue) {
    const allRows = document.querySelectorAll('table tbody tr[data-state]');
    
    allRows.forEach(row => {
      const state = row.getAttribute('data-state');
      const missing = row.getAttribute('data-missing') === 'true';
      
      let shouldShow = true;
      
      switch (filterValue) {
        case 'completed':
          shouldShow = !missing;
          break;
        case 'correct':
          shouldShow = state === 'correct';
          break;
        case 'incorrect':
          shouldShow = state === 'incorrect';
          break;
        case 'missing':
          shouldShow = missing;
          break;
        case 'all':
        default:
          shouldShow = true;
      }
      
      row.style.display = shouldShow ? '' : 'none';
    });
    
    console.log(`[StudentPage] Applied filter: ${filterValue}, affected ${allRows.length} rows`);
  }

  /**
   * Get student data (for external access)
   */
  function getStudentData() {
    return {
      student: studentData,
      school: schoolData,
      class: classData
    };
  }

  /**
   * Clear only Jotform cache (not student/school/class cache)
   */
  function clearJotformCache() {
    console.log('[StudentPage] ========== CLEARING JOTFORM CACHE ==========');
    
    const urlParams = new URLSearchParams(window.location.search);
    const coreId = urlParams.get('coreId');
    
    if (!coreId) {
      console.warn('[StudentPage] No Core ID found in URL');
      return;
    }
    
    const cacheKey = `student_jotform_${coreId}`;
    const cached = sessionStorage.getItem(cacheKey);
    
    if (cached) {
      sessionStorage.removeItem(cacheKey);
      console.log(`[StudentPage] ✅ Cleared Jotform cache: ${cacheKey}`);
    } else {
      console.log('[StudentPage] ℹ️ No Jotform cache found to clear');
    }
    
    console.log('[StudentPage] ℹ️ Student/School/Class cache preserved');
    console.log('[StudentPage] ==========================================');
  }

  /**
   * Setup UI button handlers
   */
  function setupUIHandlers() {
    // Back button - navigate to previous page
    const backButton = document.getElementById('back-button');
    if (backButton) {
      backButton.addEventListener('click', () => {
        console.log('[StudentPage] Back button clicked - navigating to previous page');
        window.history.back();
      });
    }
    
    // Question view filter dropdown
    const questionFilter = document.getElementById('question-filter');
    if (questionFilter) {
      questionFilter.addEventListener('change', (e) => {
        const filterValue = e.target.value;
        console.log(`[StudentPage] Question filter changed to: ${filterValue}`);
        applyQuestionFilter(filterValue);
      });
    }
    
    // Task Config button - toggle visibility of certain UI elements
    const taskConfigButton = document.querySelector('button:has(i[data-lucide="sliders"])');
    if (taskConfigButton) {
      taskConfigButton.addEventListener('click', () => {
        console.log('[StudentPage] Task Config clicked');
        alert('Task configuration panel - Coming soon!\n\nThis will allow you to:\n- Configure termination rules\n- Adjust display settings\n- Export task data');
      });
    }

    // Refresh button - clear Jotform cache and re-fetch data dynamically
    const refreshButton = document.getElementById('refresh-jotform-button');
    if (refreshButton) {
      refreshButton.addEventListener('click', async () => {
        console.log('[StudentPage] Refresh button clicked');
        
        // Show loading state
        const icon = refreshButton.querySelector('i');
        const originalIcon = icon ? icon.getAttribute('data-lucide') : null;
        if (icon) {
          icon.classList.add('animate-spin');
        }
        refreshButton.disabled = true;
        
        try {
          // Clear only Jotform cache
          clearJotformCache();
          
          // Get Core ID from URL
          const urlParams = new URLSearchParams(window.location.search);
          const coreId = urlParams.get('coreId');
          
          if (!coreId) {
            throw new Error('No Core ID in URL');
          }
          
          // Re-run the entire sequence:
          // 1. Filter Core ID -> 2. Find exact matches -> 3. Merge data -> 4. Display
          console.log('[StudentPage] Re-fetching Jotform data dynamically...');
          await fetchAndPopulateJotformData(coreId);
          
          console.log('[StudentPage] ✅ Refresh complete!');
        } catch (error) {
          console.error('[StudentPage] ❌ Refresh failed:', error);
          showError(`Refresh failed: ${error.message}`);
        } finally {
          // Restore button state
          if (icon) {
            icon.classList.remove('animate-spin');
          }
          refreshButton.disabled = false;
        }
      });
    }
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
      setupUIHandlers();
    });
  } else {
    init();
    setupUIHandlers();
  }

  // Export to global scope
  window.CheckingSystemStudentPage = {
    init,
    getStudentData,
    clearJotformCache
  };
})();
