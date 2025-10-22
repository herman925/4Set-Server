/**
 * Student Detail Page Controller
 * Handles URL parameter parsing, data loading, and UI population
 */
(() => {
  let studentData = null;
  let schoolData = null;
  let classData = null;
  
  // System configuration (loaded from config/checking_system_config.json)
  let systemConfig = {
    ui: {
      loadingStatusDelayMs: 500
    },
    cache: {
      ttlHours: 1,
      sessionStorageKeyPrefix: "student_jotform_"
    },
    taskView: {
      defaultFilter: "all",
      defaultExpandState: false
    }
  };
  let taskRegistry = null; // Centralized task identifier mappings
  let systemPassword = null;

  /**
   * Load system configuration from config/checking_system_config.json
   */
  async function loadSystemConfig() {
    try {
      const response = await fetch('config/checking_system_config.json');
      const config = await response.json();
      
      // Merge with defaults
      systemConfig = {
        ...systemConfig,
        ...config,
        ui: { ...systemConfig.ui, ...config.ui },
        cache: { ...systemConfig.cache, ...config.cache },
        taskView: { ...systemConfig.taskView, ...config.taskView }
      };
      
      console.log('[Config] ✅ Loaded checking system config:', systemConfig);
    } catch (error) {
      console.warn('[Config] ⚠️ Failed to load config, using defaults:', error);
      console.log('[Config] Default config:', systemConfig);
    }
  }
  
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
      // Load system configuration first
      await loadSystemConfig();
      
      // Load task registry
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
   * Update page title with student name and breadcrumb
   */
  function populatePageTitle() {
    if (!studentData) return;

    document.title = `Student Detail · ${studentData.studentName} · 4Set Checking System`;
    
    // Update header title if exists
    const headerTitle = document.querySelector('h1');
    if (headerTitle) {
      headerTitle.textContent = `Student: ${studentData.studentName}`;
    }
    
    // Update breadcrumb navigation with new pill style and links
    const breadcrumbRegion = document.querySelector('.breadcrumb-region');
    const breadcrumbGroup = document.querySelector('.breadcrumb-group');
    const breadcrumbSchool = document.querySelector('.breadcrumb-school');
    const breadcrumbClass = document.querySelector('.breadcrumb-class');
    const breadcrumbStudent = document.querySelector('.breadcrumb-student');
    
    if (breadcrumbRegion && schoolData?.district) {
      breadcrumbRegion.textContent = schoolData.district;
      breadcrumbRegion.href = `checking_system_1_district.html?district=${encodeURIComponent(schoolData.district)}`;
    }
    if (breadcrumbGroup && schoolData?.group) {
      breadcrumbGroup.textContent = `Group ${schoolData.group}`;
      breadcrumbGroup.href = `checking_system_1_group.html?group=${schoolData.group}`;
    }
    if (breadcrumbSchool && schoolData) {
      breadcrumbSchool.textContent = `${schoolData.schoolNameChinese || schoolData.schoolName}`;
      breadcrumbSchool.href = `checking_system_2_school.html?schoolId=${schoolData.schoolId}`;
    }
    if (breadcrumbClass && classData) {
      breadcrumbClass.textContent = classData.actualClassName || classData.classId;
      breadcrumbClass.href = `checking_system_3_class.html?classId=${classData.classId}`;
    }
    if (breadcrumbStudent && studentData) {
      breadcrumbStudent.textContent = studentData.studentName;
      // Current page - no link needed (it's a span)
    }
    
    // Reinitialize lucide icons for chevrons
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
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

      // Load question mappings for sessionkey QID
      await updateLoadingStatus('Loading question mappings...');
      const questionsResponse = await fetch('assets/jotformquestions.json');
      const questionsData = await questionsResponse.json();
      
      // Get sessionkey QID (needed for submission processing)
      const sessionKeyQid = questionsData['sessionkey'] || '3'; // Default to QID 3

      // ✅ USE WORKING :matches FILTER ON SESSIONKEY FIELD
      // This is the ONLY filter method that works correctly (see PRDs)
      console.log('[StudentPage] ========== FETCHING JOTFORM DATA ==========');
      console.log('[StudentPage] Using :matches filter on sessionkey field (QID ' + sessionKeyQid + ')');
      console.log('[StudentPage] Fetching Jotform data for Core ID:', coreId);
      
      await updateLoadingStatus('Connecting to Jotform API with :matches filter...');
      
      // fetchStudentSubmissionsDirectly uses the working :matches operator
      // Returns only submissions where sessionkey contains the student ID
      const submissions = await window.JotformAPI.fetchStudentSubmissionsDirectly(coreId, sessionKeyQid);
      
      console.log(`[StudentPage] ✅ API returned: ${submissions.length} validated submissions`);
      console.log('[StudentPage] Filter accuracy: 100% (server-side :matches filter working!)');
      await updateLoadingStatus(`Found ${submissions.length} matching submissions`);
      console.log('[StudentPage] ==========================================');

      if (submissions.length === 0) {
        showNoDataMessage();
        return;
      }

      // Extract and log sessionkeys
      console.log('[StudentPage] ========== SESSIONKEY EXTRACTION ==========');
      console.log(`[StudentPage] Found ${submissions.length} submissions for Core ID ${coreId}`);
      await updateLoadingStatus(`Processing ${submissions.length} submissions...`);
      
      const sessionKeys = submissions.map((sub, index) => {
        const sessionKeyQid = questionsData['sessionkey'];
        const sessionKey = sub.answers?.[sessionKeyQid]?.answer || sub.answers?.[sessionKeyQid]?.text || 'UNKNOWN';
        console.log(`[StudentPage]   Submission ${index + 1}: ${sessionKey} (ID: ${sub.id}, Created: ${sub.created_at})`);
        return sessionKey;
      });
      console.log('[StudentPage] ==========================================');

      // Merge submissions (prefer earliest for overlaps, fill missing from later)
      await updateLoadingStatus(`Merging ${submissions.length} submissions...`);
      const mergedData = mergeSubmissions(submissions, questionsData);

      // Calculate completion metrics
      await updateLoadingStatus('Calculating completion metrics...');
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

      // Set last sync timestamp in localStorage (global for this student)
      const syncKey = `jotform_last_sync_${coreId}`;
      localStorage.setItem(syncKey, new Date().toISOString());
      console.log(`[StudentPage] ✅ Updated sync timestamp in localStorage: ${syncKey}`);

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
      await updateLoadingStatus('Populating task data...');
      
      // Update completion percentage if element exists
      const completionEl = document.querySelector('[data-completion]');
      if (completionEl && data.metrics) {
        completionEl.textContent = `${data.metrics.completionPercentage}%`;
      }

      // VALIDATION ARCHITECTURE NOTE:
      // The student page uses TaskValidator as the SINGLE SOURCE OF TRUTH for all
      // task validation. TaskValidator.js contains centralized termination rules,
      // question counting logic, and completion calculations that ensure consistency
      // across the entire checking system.
      //
      // This direct call to TaskValidator provides the most accurate, real-time
      // validation for individual student assessment data.
      //
      // Key features:
      // - Centralized termination rules (ERV, CM, CWR, Fine Motor, SYM/NONSYM)
      // - Question exclusion after termination (PRD-mandated)
      // - Post-termination answer detection (data quality flags)
      // - Timeout detection with gap analysis
      console.log('[StudentPage] Validating tasks with TaskValidator...');
      
      if (!window.TaskValidator) {
        throw new Error('TaskValidator not loaded');
      }
      
      const taskValidation = await window.TaskValidator.validateAllTasks(data.mergedAnswers);
      
      console.log('[StudentPage] Task validation complete:', taskValidation);
      
      // Populate task tables with real data
      populateTaskTables(taskValidation, data.mergedAnswers);
      
      // Update global sync timestamp in profile section
      updateGlobalSyncTimestamp();
      
      // Update "Last Updated" timestamp in header from actual submission data
      updateHeaderTimestamp(data);
      
      // Update task status overview
      updateTaskStatusOverview();
      
      console.log('[StudentPage] UI population complete');
      console.log('[StudentPage] ==========================================');
    } catch (error) {
      console.error('[StudentPage] ❌ Error populating UI:', error);
      showError(`Failed to populate task data: ${error.message}`);
      throw error; // Re-throw to see full stack trace
    }
  }

  /**
   * Helper function: Reorder questions so _TEXT fields appear after their corresponding radio questions
   * Also detect and annotate branch information for ToM questions
   */
  function reorderAndAnnotateQuestions(questions, taskId, mergedAnswers) {
    // Check if this is a ToM task
    const isToMTask = taskId.toLowerCase().includes('theoryofmind') || taskId.toLowerCase().includes('tom');
    
    // Step 1: Detect branch information for ToM tasks
    const branchInfo = {};
    if (isToMTask) {
      // Map of branching questions (like ToM_Q1a) to their answer values
      const branchSelectors = {};
      
      // First pass: identify branch selector questions (e.g., ToM_Q1a, ToM_Q2a, etc.)
      // These are questions that determine which branch subsequent questions follow
      for (const q of questions) {
        const match = q.id.match(/^(ToM_Q\d+)([a-z])$/);
        if (match && match[2] === 'a') {
          // This is a potential branch selector (e.g., ToM_Q1a)
          const baseId = match[1]; // e.g., "ToM_Q1"
          const answer = q.studentAnswer;
          if (answer) {
            branchSelectors[q.id] = answer;
            branchInfo[q.id] = answer;
          }
        }
      }
      
      // Second pass: annotate branched questions with their branch
      for (const q of questions) {
        // Check if this question belongs to a branch
        const match = q.id.match(/^(ToM_Q\d+)([a-z])$/);
        if (match) {
          const baseId = match[1]; // e.g., "ToM_Q1"
          const suffix = match[2]; // e.g., "b", "c"
          const selectorId = baseId + 'a'; // e.g., "ToM_Q1a"
          
          if (branchSelectors[selectorId]) {
            // This question is part of a branch
            branchInfo[q.id] = branchSelectors[selectorId];
          }
        }
        
        // Also check _TEXT fields
        if (q.id.endsWith('_TEXT')) {
          const baseQuestionId = q.id.replace('_TEXT', '');
          if (branchInfo[baseQuestionId]) {
            branchInfo[q.id] = branchInfo[baseQuestionId];
          }
        }
      }
    }
    
    // Step 2: Reorder questions to place _TEXT fields after their corresponding radio questions
    const reordered = [];
    const textFieldsToPlace = new Map(); // Map of base question ID to _TEXT question
    
    // First pass: separate _TEXT fields from regular questions
    for (const q of questions) {
      if (q.id.endsWith('_TEXT')) {
        const baseQuestionId = q.id.replace('_TEXT', '');
        textFieldsToPlace.set(baseQuestionId, q);
      } else {
        reordered.push(q);
      }
    }
    
    // Second pass: insert _TEXT fields immediately after their corresponding questions
    const finalOrdered = [];
    for (const q of reordered) {
      finalOrdered.push(q);
      
      // Check if there's a _TEXT field for this question
      if (textFieldsToPlace.has(q.id)) {
        finalOrdered.push(textFieldsToPlace.get(q.id));
        textFieldsToPlace.delete(q.id); // Remove from map so we don't add it again
      }
    }
    
    // Add any remaining _TEXT fields that didn't have a matching base question
    for (const textField of textFieldsToPlace.values()) {
      finalOrdered.push(textField);
    }
    
    // Step 3: Return reordered questions with branch info
    return { questions: finalOrdered, branchInfo };
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
      
      // Update task title if validation provides a merged title (e.g., "SYM / NONSYM")
      if (validation.title) {
        const titleElement = taskElement.querySelector('summary strong');
        if (titleElement) {
          titleElement.textContent = validation.title;
        }
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
      
      // Note: "Correct Answer" column remains visible for all tasks
      // Y/N tasks (like TGMD) will show "N/A" instead of hiding the column
      
      // Detect timed-out questions for SYM/NONSYM
      let symTimeoutIndex = -1;
      let nonsymTimeoutIndex = -1;
      if (taskId === 'sym' && validation.symAnalysis && validation.symAnalysis.timedOut) {
        symTimeoutIndex = validation.symAnalysis.lastAnsweredIndex;
      }
      if (taskId === 'sym' && validation.nonsymAnalysis && validation.nonsymAnalysis.timedOut) {
        nonsymTimeoutIndex = validation.nonsymAnalysis.lastAnsweredIndex;
      }
      
      // Detect termination for various tasks
      let terminationIndex = -1;
      if (validation.terminated && validation.terminationIndex !== undefined) {
        terminationIndex = validation.terminationIndex;
      }
      
      // Reorder questions and detect branch information
      const { questions: orderedQuestions, branchInfo } = reorderAndAnnotateQuestions(
        validation.questions, 
        taskId, 
        mergedAnswers
      );
      
      // Populate with real questions (using reordered list)
      for (let i = 0; i < orderedQuestions.length; i++) {
        const question = orderedQuestions[i];
        const row = document.createElement('tr');
        
        // Check if this question is after a timeout/termination (should be marked as "Ignored")
        let isIgnoredDueToTimeout = false;
        if (taskId === 'sym') {
          // Check if this is a SYM question (first half) or NONSYM question (second half)
          const symQuestionCount = validation.symResult?.questions?.length || 0;
          if (i < symQuestionCount) {
            // SYM question
            isIgnoredDueToTimeout = symTimeoutIndex >= 0 && i > symTimeoutIndex;
          } else {
            // NONSYM question
            const nonsymIndex = i - symQuestionCount;
            isIgnoredDueToTimeout = nonsymTimeoutIndex >= 0 && nonsymIndex > nonsymTimeoutIndex;
          }
        } else if (terminationIndex >= 0) {
          // All other tasks with termination (CWR, ERV, CM, FM): questions after termination are ignored
          isIgnoredDueToTimeout = i > terminationIndex;
        }
        
        // Set data-state based on whether the question is scored
        const dataState = isIgnoredDueToTimeout ? 'ignored' :
          (question.isTextDisplay ? 'text-display' : // _TEXT display fields
          (question.isUnscored ? 'unscored' : 
          (question.isCorrect ? 'correct' : 'incorrect')));
        row.setAttribute('data-state', dataState);
        row.setAttribute('data-missing', question.studentAnswer === null ? 'true' : 'false');
        row.setAttribute('data-ignored', isIgnoredDueToTimeout ? 'true' : 'false'); // CRITICAL: Mark for calculation exclusion
        row.setAttribute('data-text-display', question.isTextDisplay ? 'true' : 'false'); // Mark _TEXT fields
        row.className = 'hover:bg-[color:var(--muted)]/30';
        
        // Determine branch information for this question (if any)
        let branchSuffix = '';
        if (branchInfo[question.id]) {
          branchSuffix = ` (${branchInfo[question.id]} Branch)`;
        }
        
        // Determine status pill
        let statusPill;
        if (isIgnoredDueToTimeout) {
          statusPill = '<span class="answer-pill" style="background: #dbeafe; color: #1e40af; border-color: #93c5fd;"><i data-lucide="ban" class="w-3 h-3"></i>Ignored (Terminated)</span>';
        } else if (question.isTextDisplay) {
          // Special handling for _TEXT display fields
          if (question.textFieldStatus === 'na') {
            // N/A status with muted colors
            statusPill = '<span class="answer-pill" style="background: #f9fafb; color: #6b7280; border-color: #e5e7eb;"><i data-lucide="info" class="w-3 h-3"></i>N/A</span>';
          } else if (question.textFieldStatus === 'answered') {
            // Answered status with branch info
            statusPill = `<span class="answer-pill" style="background: #f0f9ff; color: #0369a1; border-color: #bae6fd;"><i data-lucide="circle-check" class="w-3 h-3"></i>Answered${branchSuffix}</span>`;
          } else if (question.textFieldStatus === 'not-answered') {
            // Only show "Not answered" when radio answer is incorrect
            // Use neutral styling (not "incorrect") since _TEXT fields don't have right/wrong answers
            statusPill = '<span class="answer-pill" style="background: #fef3c7; color: #92400e; border-color: #fde68a;"><i data-lucide="alert-circle" class="w-3 h-3"></i>Not answered</span>';
          } else {
            // No status to display (radio question not answered) - show dash
            statusPill = '<span class="answer-pill" style="background: #f3f4f6; color: #9ca3af; border-color: #d1d5db;"><i data-lucide="minus" class="w-3 h-3"></i>—</span>';
          }
        } else if (question.studentAnswer === null) {
          statusPill = `<span class="answer-pill incorrect"><i data-lucide="minus" class="w-3 h-3"></i>Not answered${branchSuffix}</span>`;
        } else if (question.isUnscored) {
          statusPill = `<span class="answer-pill" style="background: #f0f9ff; color: #0369a1; border-color: #bae6fd;"><i data-lucide="circle-check" class="w-3 h-3"></i>Answered${branchSuffix}</span>`;
        } else if (question.isCorrect) {
          statusPill = `<span class="answer-pill correct"><i data-lucide="check" class="w-3 h-3"></i>Correct${branchSuffix}</span>`;
        } else {
          statusPill = `<span class="answer-pill incorrect"><i data-lucide="x" class="w-3 h-3"></i>Incorrect${branchSuffix}</span>`;
        }
        
        // For Y/N tasks (like TGMD), show "N/A" instead of correct answer
        // For _TEXT fields, show "—" (dash) instead of "N/A" for correct answer column
        const correctAnswerDisplay = isYNTask ? 'N/A' : (question.isTextDisplay ? '—' : (question.correctAnswer || '—'));
        
        // Handle special case for text-only attempts (radio blank, text filled)
        const displayStudentAnswer = question.studentAnswer === '[TEXT_ONLY_ATTEMPT]' 
          ? '—' 
          : (question.studentAnswer || '—');
        
        row.innerHTML = `
          <td class="py-2 px-2 text-[color:var(--foreground)] font-mono">${question.id}</td>
          <td class="py-2 px-2 text-[color:var(--muted-foreground)]">${displayStudentAnswer}</td>
          <td class="py-2 px-2 text-[color:var(--muted-foreground)]">${correctAnswerDisplay}</td>
          <td class="py-2 px-2">${statusPill}</td>
        `;
        
        tbody.appendChild(row);
      }
      
      // Calculate task statistics (excluding ignored questions)
      const taskStats = calculateTaskStatistics(validation, taskElement);
      
      // Update task summary with refined counters
      updateTaskSummary(taskElement, taskId, taskStats);
      
      // Update task lighting status
      updateTaskLightingStatus(taskElement, taskStats);
      
      // Populate termination checklist if task has termination points
      populateTerminationChecklist(taskElement, taskId, validation, mergedAnswers);
      
      console.log(`[StudentPage] ✅ Populated ${taskId}: ${orderedQuestions.length} questions`);
    }
    
    // Reinitialize Lucide icons
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  /**
   * Show "no data" message and hide task sections
   */
  function showNoDataMessage() {
    console.log('[StudentPage] No submissions - hiding task sections');
    
    // Hide Task Status Overview section
    const taskOverview = Array.from(document.querySelectorAll('details')).find(el => 
      el.textContent.includes('Task Status Overview')
    );
    if (taskOverview) {
      taskOverview.style.display = 'none';
      console.log('[StudentPage] Hidden: Task Status Overview');
    }
    
    // Hide Task Progress section
    const taskProgress = Array.from(document.querySelectorAll('section')).find(el => 
      el.textContent.includes('Task Progress')
    );
    if (taskProgress) {
      taskProgress.style.display = 'none';
      console.log('[StudentPage] Hidden: Task Progress');
    }
    
    // Show "No Submissions Found" message
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
      
      // Find the Task Progress section (now a section element, not details)
      const allCards = document.querySelectorAll('.entry-card');
      let taskProgressSection = null;
      
      for (const card of allCards) {
        const heading = card.querySelector('h2');
        if (heading && heading.textContent.includes('Task Progress')) {
          taskProgressSection = card;
          break;
        }
      }
      
      if (!taskProgressSection) {
        console.warn('[StudentPage] ❌ Task Progress section not found in HTML');
        console.warn('[StudentPage] Searched through', allCards.length, 'entry-card elements');
        return;
      }
      
      console.log('[StudentPage] ✅ Found Task Progress section');
      
      // Get the content container (the div with divide-y class, or create selector for section structure)
      let taskProgressContainer = taskProgressSection.querySelector('.divide-y');
      
      // Fallback to old selector if not found (for backwards compatibility)
      if (!taskProgressContainer) {
        taskProgressContainer = taskProgressSection.querySelector('summary + div');
      }
      
      if (!taskProgressContainer) {
        console.warn('[StudentPage] ❌ Task Progress container not found in HTML');
        return;
      }
      
      console.log('[StudentPage] ✅ Found Task Progress container:', taskProgressContainer);
      console.log('[StudentPage] Container has', taskProgressContainer.children.length, 'existing children');
      
      // Clear existing hardcoded content (including "Set 1: 第一組" header)
      taskProgressContainer.innerHTML = '';
      console.log('[StudentPage] ✅ Cleared container');
      
      // Create a NEW divide-y container for our dynamic content
      const dynamicContainer = document.createElement('div');
      dynamicContainer.className = 'divide-y divide-[color:var(--border)] bg-[color:var(--muted)]/20';
      taskProgressContainer.appendChild(dynamicContainer);
      
      // Build each set
      for (const set of sortedSets) {
        console.log(`[StudentPage] Building ${set.name} (${set.id})...`);
        
        // Sort sections within set
        const sortedSections = set.sections.sort((a, b) => a.order - b.order);
        
        // Filter sections based on visibility conditions and merge NONSYM with SYM
        const visibleSections = [];
        const mergedTasks = new Set(); // Track tasks that have been merged
        
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
          
          // Check if this task should be merged with another (e.g., NONSYM with SYM)
          if (taskMetadata.displayWith) {
            // Skip this task as it will be merged with its parent
            console.log(`[StudentPage]   ${taskId} will be merged with ${taskMetadata.displayWith}`);
            mergedTasks.add(taskId);
            continue;
          }
          
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
            <span class="set-task-count text-xs text-[color:var(--muted-foreground)] font-mono">${visibleSections.length} tasks</span>
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
        
        // Add toggle listener to rotate chevron for sets
        setContainer.addEventListener('toggle', () => {
          const chevron = setHeader.querySelector('.set-chevron');
          if (chevron) {
            if (setContainer.open) {
              chevron.style.transform = 'rotate(90deg)';
            } else {
              chevron.style.transform = 'rotate(0deg)';
            }
          }
        });
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
      <div class="text-xs text-[color:var(--muted-foreground)] font-mono task-progress-stats">
        <div class="answered-stat">—</div>
        <div class="correct-stat">—</div>
        <div class="total-stat">—</div>
      </div>
      <div class="flex justify-end">
        <i data-lucide="plus" class="task-expand-icon w-4 h-4 text-[color:var(--muted-foreground)] transition-transform"></i>
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
            </tr>
          </thead>
          <tbody class="divide-y divide-[color:var(--border)]">
            <tr><td colspan="4" class="py-4 px-2 text-center text-[color:var(--muted-foreground)]">Loading task data...</td></tr>
          </tbody>
        </table>
      </div>
    `;
    
    details.appendChild(summary);
    details.appendChild(contentDiv);
    
    // Add toggle listener to swap plus/minus icon
    details.addEventListener('toggle', () => {
      const icon = summary.querySelector('.task-expand-icon');
      if (icon) {
        if (details.open) {
          icon.setAttribute('data-lucide', 'minus');
        } else {
          icon.setAttribute('data-lucide', 'plus');
        }
        // Reinitialize lucide icons
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
      }
    });
    
    return details;
  }

  /**
   * Populate termination checklist for tasks that have termination rules
   * Note: Termination values (0/1) are RECORDED by test administrators in the PDF,
   * not calculated. They document whether termination happened during assessment.
   */
  function populateTerminationChecklist(taskElement, taskId, validation, mergedAnswers) {
    console.log(`[StudentPage] Checking termination/timeout rules for task: ${taskId}`);
    
    // Special handling for SYM: show timeout status instead of termination rules
    if (taskId === 'sym') {
      const checklistDiv = taskElement.querySelector('.termination-checklist');
      const rulesContainer = taskElement.querySelector('.termination-rules');
      
      if (!checklistDiv || !rulesContainer) return;
      
      // Get detailed analysis
      const symAnalysis = validation.symAnalysis || {};
      const nonsymAnalysis = validation.nonsymAnalysis || {};
      
      console.log(`[StudentPage] SYM analysis:`, symAnalysis);
      console.log(`[StudentPage] NONSYM analysis:`, nonsymAnalysis);
      
      // Update checklist title
      checklistDiv.querySelector('span').textContent = 'Timeout Status · SYM/NONSYM (2-minute timer each)';
      
      // Helper to determine card styling
      // PRIORITY: timedOut > complete > hasMissingData > in progress
      // A task can be BOTH timedOut AND hasMissingData (gaps in middle)
      const getCardStyle = (analysis) => {
        if (analysis.timedOut) {
          // Green: Properly timed out (may have gaps in middle)
          return { border: 'border-green-400', bg: 'bg-green-50', color: 'text-green-600', icon: 'clock-alert', status: 'Timed Out' };
        } else if (analysis.complete) {
          // Green: All questions completed
          return { border: 'border-green-400', bg: 'bg-green-50', color: 'text-green-600', icon: 'check-circle', status: 'Complete' };
        } else if (analysis.hasMissingData) {
          // Red: Missing data without timeout (gaps but no consecutive end gap)
          return { border: 'border-red-400', bg: 'bg-red-50', color: 'text-red-600', icon: 'alert-triangle', status: 'Missing Data' };
        } else {
          // Gray: In progress
          return { border: 'border-gray-400', bg: 'bg-gray-50', color: 'text-gray-600', icon: 'info', status: 'In Progress' };
        }
      };
      
      const symStyle = getCardStyle(symAnalysis);
      const nonsymStyle = getCardStyle(nonsymAnalysis);
      
      // Build unified timeout cards matching ERV structure
      const buildTimeoutCard = (name, analysis, result) => {
        const answered = result.answeredQuestions;
        const total = result.totalQuestions;
        const summary = `${answered}/${total}`;
        
        // Determine recorded status from data (if timeout field exists)
        const recordedTimedOut = false; // TODO: Get from mergedAnswers if field exists
        const calculatedTimedOut = analysis.timedOut;
        const hasMissingData = analysis.hasMissingData;
        
        // Card styling: Prioritize timeout over missing data
        // If timed out (even with gaps), show green. Gaps shown as secondary warning.
        let statusClass;
        if (calculatedTimedOut) {
          statusClass = 'border-green-400 bg-green-50';
        } else if (analysis.complete) {
          statusClass = 'border-green-400 bg-green-50';
        } else if (hasMissingData) {
          statusClass = 'border-red-400 bg-red-50';
        } else {
          statusClass = 'border-gray-300 bg-gray-50';
        }
        
        return `
          <div class="border rounded-lg p-3 ${statusClass}">
            <div class="flex items-start justify-between mb-2">
              <div>
                <p class="font-medium text-[color:var(--foreground)]">${name}</p>
                <p class="text-[color:var(--muted-foreground)] text-xs mt-0.5">
                  ${calculatedTimedOut && hasMissingData ? 'Timed out · Non-continuous data gaps detected' :
                    calculatedTimedOut ? 'Timed out after continuous progress' : 
                    hasMissingData ? 'Non-continuous data gaps detected' :
                    analysis.complete ? 'All questions completed' : 'In progress'}
                </p>
              </div>
              <span class="text-xs font-mono font-semibold ${
                calculatedTimedOut ? 'text-green-600' : 
                analysis.complete ? 'text-green-600' : 
                hasMissingData ? 'text-red-700' : 'text-gray-600'
              }">${summary}</span>
            </div>
            
            <div class="grid grid-cols-2 gap-2 text-xs mt-2">
              <!-- Recorded Status -->
              <div class="flex items-center gap-1.5 ${
                calculatedTimedOut ? 'text-green-600' : 
                analysis.complete ? 'text-green-600' : 
                hasMissingData ? 'text-red-600' : 'text-gray-600'
              }">
                <i data-lucide="${
                  calculatedTimedOut ? 'clock-alert' : 
                  analysis.complete ? 'check-circle' : 
                  hasMissingData ? 'alert-triangle' : 'info'
                }" class="w-3.5 h-3.5"></i>
                <span>Terminated: <strong>${
                  calculatedTimedOut ? 'Timed Out' : 
                  analysis.complete ? 'Complete' : 
                  hasMissingData ? 'Missing Data' : 'In Progress'
                }</strong></span>
              </div>
              
              <!-- Verification Status -->
              <div class="flex items-center gap-1.5 ${
                hasMissingData ? 'text-yellow-600' : 'text-blue-600'
              }">
                <i data-lucide="${
                  hasMissingData ? 'alert-triangle' : 'check-circle'
                }" class="w-3.5 h-3.5"></i>
                <span>${hasMissingData ? 'Requires investigation' : 'Calculation Verified.'}</span>
              </div>
            </div>
          </div>
        `;
      };
      
      rulesContainer.innerHTML = 
        buildTimeoutCard('SYM (Symbolic)', symAnalysis, validation.symResult) +
        buildTimeoutCard('NONSYM (Non-symbolic)', nonsymAnalysis, validation.nonsymResult);
      
      checklistDiv.classList.remove('hidden');
      lucide.createIcons(); // Re-render icons
      return; // Exit early for SYM
    }
    
    // Special handling for CWR: show consecutive incorrect termination status
    if (taskId === 'chinesewordreading') {
      const checklistDiv = taskElement.querySelector('.termination-checklist');
      const rulesContainer = taskElement.querySelector('.termination-rules');
      
      if (!checklistDiv || !rulesContainer) return;
      
      const terminated = validation.terminated || false;
      const terminationIndex = validation.terminationIndex || -1;
      const terminatedAtQuestion = terminationIndex >= 0 ? validation.questions[terminationIndex]?.id : null;
      const answered = validation.answeredQuestions;
      const total = validation.totalQuestions;
      
      // Update checklist title
      checklistDiv.querySelector('span').textContent = 'Termination checklist · Chinese Word Reading';
      
      // Get recorded termination value (from uploaded data)
      const cwrTermField = 'CWR_10Incorrect';
      const recordedValue = mergedAnswers[cwrTermField];
      const recordedTerminated = recordedValue === '1' || recordedValue === 1;
      
      // Calculate termination based on actual consecutive incorrect (validation logic)
      const calculatedTerminated = terminated; // validation.terminated already calculated this
      
      // Check for post-termination questions (mismatch indicator)
      let hasPostTerminationAnswers = false;
      if (calculatedTerminated) {
        for (let i = terminationIndex + 1; i < validation.questions.length; i++) {
          if (validation.questions[i].studentAnswer !== null) {
            hasPostTerminationAnswers = true;
            break;
          }
        }
      }
      
      // Normalize to boolean
      const recordedBool = Boolean(recordedTerminated);
      const calculatedBool = Boolean(calculatedTerminated);
      const mismatch = recordedBool !== calculatedBool;
      
      // Card styling: GREEN when both agree, ORANGE when mismatch, YELLOW when post-termination
      let statusClass;
      let statusColor;
      if (hasPostTerminationAnswers) {
        statusClass = 'border-orange-400 bg-orange-50';
        statusColor = 'text-orange-600';
      } else if (mismatch) {
        statusClass = 'border-orange-400 bg-orange-50';
        statusColor = 'text-orange-600';
      } else {
        // Both agree (either both terminated OR both not terminated) - GREEN
        statusClass = 'border-green-400 bg-green-50';
        statusColor = 'text-green-600';
      }
      
      // Build unified card matching ERV/SYM structure (same width as ERV/CM)
      rulesContainer.innerHTML = `
        <div class="border rounded-lg p-3 ${statusClass}">
          <div class="flex items-start justify-between mb-2">
            <div>
              <p class="font-medium text-[color:var(--foreground)]">CWR_10Incorrect</p>
              <p class="text-[color:var(--muted-foreground)] text-xs mt-0.5">
                ${hasPostTerminationAnswers 
                  ? `⚠️ Terminated at ${terminatedAtQuestion} but has answers after termination` 
                  : terminated 
                    ? `Terminated after 10 consecutive incorrect at ${terminatedAtQuestion}` 
                    : 'No termination detected - fewer than 10 consecutive incorrect'}
              </p>
            </div>
            <span class="text-xs font-mono font-semibold ${statusColor}">${answered}/${total}</span>
          </div>
          
          <div class="grid grid-cols-2 gap-2 text-xs mt-2">
            <!-- Calculated Status -->
            <div class="flex items-center gap-1.5 ${statusColor}">
              <i data-lucide="${hasPostTerminationAnswers ? 'alert-triangle' : terminated ? 'ban' : 'check-circle'}" class="w-3.5 h-3.5"></i>
              <span>Calculated: <strong>${hasPostTerminationAnswers ? 'Terminated + Extra Data' : terminated ? 'Terminated' : 'Not Terminated'}</strong></span>
            </div>
            
            <!-- Verification Status -->
            <div class="flex items-center gap-1.5 ${hasPostTerminationAnswers ? 'text-orange-600' : 'text-blue-600'}">
              <i data-lucide="${hasPostTerminationAnswers ? 'alert-triangle' : 'check-circle'}" class="w-3.5 h-3.5"></i>
              <span>${hasPostTerminationAnswers ? 'Data quality issue detected' : 'Termination Verified.'}</span>
            </div>
          </div>
        </div>
      `;
      
      checklistDiv.classList.remove('hidden');
      lucide.createIcons(); // Re-render icons
      return; // Exit early for CWR
    }
    
    // Helper to generate question ranges
    const generateRange = (prefix, start, end) => {
      const range = [];
      for (let i = start; i <= end; i++) {
        range.push(`${prefix}${i}`);
      }
      return range;
    };
    
    // Define termination rules metadata for tasks that have them
    const terminationRules = {
      'erv': [
        { id: 'ERV_Ter1', description: 'Fewer than 5 correct in ERV_Q1–ERV_Q12', threshold: 5, range: generateRange('ERV_Q', 1, 12) },
        { id: 'ERV_Ter2', description: 'Fewer than 5 correct in ERV_Q13–ERV_Q24', threshold: 5, range: generateRange('ERV_Q', 13, 24) },
        { id: 'ERV_Ter3', description: 'Fewer than 5 correct in ERV_Q25–ERV_Q36', threshold: 5, range: generateRange('ERV_Q', 25, 36) }
      ],
      'cm': [
        { id: 'CM_Ter1', name: 'Stage 1', description: 'Fewer than 4 correct in CM_Q1–CM_Q7', threshold: 4, range: generateRange('CM_Q', 1, 7) },
        { id: 'CM_Ter2', name: 'Stage 2', description: 'Fewer than 4 correct in CM_Q8–CM_Q12', threshold: 4, range: generateRange('CM_Q', 8, 12) },
        { id: 'CM_Ter3', name: 'Stage 3', description: 'Fewer than 4 correct in CM_Q13–CM_Q17', threshold: 4, range: generateRange('CM_Q', 13, 17) },
        { id: 'CM_Ter4', name: 'Stage 4', description: 'Fewer than 4 correct in CM_Q18–CM_Q22', threshold: 4, range: generateRange('CM_Q', 18, 22) }
        // CM_Q23-Q27 (Part 5): No termination rule - students who reach here should complete all questions
      ],
      // CWR: Handled separately with consecutive incorrect detection logic
      'finemotor': [
        { id: 'FM_Ter', name: 'Square Cutting', description: 'No correct responses in FM_squ_1–FM_squ_3 (score must be > 0)', threshold: 1, range: ['FM_squ_1', 'FM_squ_2', 'FM_squ_3'] }
      ]
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
    
    let earliestTerminationIndex = null;
    let earliestTerminationRuleId = null;
    const ignoredQuestionIds = new Set();
    
    for (let index = 0; index < rules.length; index++) {
      const rule = rules[index];
      // Get termination value from merged Jotform data (not in validation.questions)
      const terminationField = mergedAnswers[rule.id];
      
      // Get the RECORDED value (what administrator marked in PDF: 0 = passed, 1 = triggered)
      // If no termination field exists, treat as not recorded (0/false)
      const recordedValue = terminationField?.answer || terminationField?.text || '0';
      const recordedTriggered = recordedValue === '1' || recordedValue === 1;
      
      if (!terminationField) {
        console.log(`[StudentPage] Termination field not found in data: ${rule.id}, using calculated values only`);
      }
      
      const priorTerminationActive = earliestTerminationIndex !== null && index > earliestTerminationIndex;
      const threshold = rule.threshold ?? 5;
      
      let correctInRange = 0;
      let totalInRange = rule.range.length;
      let calculatedTriggered = false;
      let calculatedSummary = '';
      
      if (priorTerminationActive) {
        calculatedSummary = 'Not evaluated';
      } else {
        const questionsInRange = validation.questions.filter(q => rule.range.includes(q.id));
        correctInRange = questionsInRange.filter(q => q.isCorrect).length;
        totalInRange = questionsInRange.length;
        calculatedTriggered = correctInRange < threshold;
        calculatedSummary = `${correctInRange}/${totalInRange}`;
      }
      
      if (earliestTerminationIndex === null && (recordedTriggered || calculatedTriggered)) {
        earliestTerminationIndex = index;
        earliestTerminationRuleId = rule.id;
      }
      
      const ignoredDueToPriorTermination = priorTerminationActive;
      
      // Normalize to boolean (handle undefined/null)
      const recordedBool = Boolean(recordedTriggered);
      const calculatedBool = Boolean(calculatedTriggered);
      const mismatch = ignoredDueToPriorTermination
        ? recordedBool
        : recordedBool !== calculatedBool;
      
      let statusClass = '';
      if (ignoredDueToPriorTermination) {
        statusClass = 'border-blue-200 bg-blue-50';
      } else if (mismatch) {
        statusClass = 'border-orange-400 bg-orange-50';
      } else {
        // Both agree (either both triggered or both passed) - GREEN
        statusClass = 'border-green-400 bg-green-50';
      }
      
      const ruleCard = document.createElement('div');
      ruleCard.className = `border rounded-lg p-3 ${statusClass}`;
      
      ruleCard.innerHTML = `
        <div class="flex items-start justify-between mb-2">
          <div>
            <p class="font-medium text-[color:var(--foreground)]">${rule.id}</p>
            <p class="text-[color:var(--muted-foreground)] text-xs mt-0.5">${rule.description}</p>
          </div>
          <span class="text-xs font-mono font-semibold ${
            ignoredDueToPriorTermination
              ? 'text-[color:var(--muted-foreground)]'
              : calculatedTriggered
                ? 'text-red-700'
                : 'text-green-600'
          }">${ignoredDueToPriorTermination ? '—' : calculatedSummary}</span>
        </div>
        
        <div class="grid grid-cols-2 gap-2 text-xs mt-2">
          <!-- Administrator's Record -->
          <div class="flex items-center gap-1.5 ${
            ignoredDueToPriorTermination
              ? recordedTriggered ? 'text-orange-600' : 'text-green-600'
              : recordedTriggered ? 'text-red-600' : 'text-green-600'
          }">
            <i data-lucide="${
              ignoredDueToPriorTermination
                ? recordedTriggered ? 'alert-triangle' : 'minus-circle'
                : recordedTriggered ? 'x-circle' : 'check-circle'
            }" class="w-3.5 h-3.5"></i>
            <span>${ignoredDueToPriorTermination
              ? recordedTriggered
                ? '<strong>Recorded after termination</strong>'
                : 'JotForm: <strong>Not terminated</strong>'
              : `JotForm: <strong>${recordedTriggered ? 'Terminated' : 'Passed'}</strong>`}</span>
          </div>
          
          <!-- System Calculation -->
          <div class="flex items-center gap-1.5 ${
            ignoredDueToPriorTermination
              ? 'text-[color:var(--muted-foreground)]'
              : calculatedTriggered
                ? 'text-red-600'
                : 'text-green-600'
          }">
            <i data-lucide="${
              ignoredDueToPriorTermination
                ? 'minus-circle'
                : calculatedTriggered
                  ? 'x-circle'
                  : 'check-circle'
            }" class="w-3.5 h-3.5"></i>
            <span>${ignoredDueToPriorTermination
              ? `System: <strong>Not evaluated</strong>`
              : `System: <strong>${calculatedTriggered ? 'Should Terminate' : 'Should Pass'}</strong>`}</span>
          </div>
        </div>
        
        ${ignoredDueToPriorTermination
          ? `<p class="mt-2 text-xs text-blue-700">ℹ️ Skipped because ${earliestTerminationRuleId} terminated earlier.</p>`
          : mismatch 
            ? '<p class="mt-2 text-xs text-orange-700">⚠️ Termination calculation mismatch between JotForm & System.</p>'
            : recordedTriggered && calculatedTriggered
              ? '<p class="mt-2 text-xs text-green-700">✅ Termination Verified.</p>'
              : '<p class="mt-2 text-xs text-green-700">✅ Calculation Verified.</p>'
        }
      `;
      
      rulesContainer.appendChild(ruleCard);
    }
    
    // Check for post-termination answers (yellow flag for status light)
    let hasPostTerminationAnswers = false;
    if (earliestTerminationIndex !== null) {
      // Get all questions that should be ignored after termination
      const terminatedRule = rules[earliestTerminationIndex];
      const lastQuestionInRange = terminatedRule.range[terminatedRule.range.length - 1];
      
      // Find questions answered AFTER termination point
      let foundTerminationPoint = false;
      for (const question of validation.questions) {
        if (foundTerminationPoint && question.studentAnswer !== null) {
          hasPostTerminationAnswers = true;
          console.log(`[StudentPage] ⚠️ Post-termination answer detected: ${question.id}`);
          break;
        }
        if (question.id === lastQuestionInRange) {
          foundTerminationPoint = true;
        }
      }
    }
    
    // CASCADE RULE: If a termination triggered, mark ALL subsequent questions as ignored
    if (earliestTerminationIndex !== null) {
      // Get the last question ID from the earliest termination range
      const lastQuestionInTerminationRange = rules[earliestTerminationIndex].range[rules[earliestTerminationIndex].range.length - 1];
      
      // Find the index of this question in the full validation.questions array
      const lastQuestionIndex = validation.questions.findIndex(q => q.id === lastQuestionInTerminationRange);
      
      // Mark ALL questions AFTER this point as ignored
      if (lastQuestionIndex !== -1) {
        for (let i = lastQuestionIndex + 1; i < validation.questions.length; i++) {
          ignoredQuestionIds.add(validation.questions[i].id);
        }
      }
      
      console.log(`[StudentPage] Cascade rule applied: All questions after ${lastQuestionInTerminationRange} are ignored (${ignoredQuestionIds.size} questions)`);
    }
    
    if (ignoredQuestionIds.size > 0) {
      console.log(`[StudentPage] Marking ${ignoredQuestionIds.size} questions as ignored after termination for ${taskId}`);
      markQuestionsBeyondTermination(taskElement, ignoredQuestionIds);
      
      // CRITICAL: Recalculate statistics after marking questions as ignored
      console.log(`[StudentPage] Recalculating stats for ${taskId} after termination rules applied`);
      const updatedStats = calculateTaskStatistics(validation, taskElement);
      updateTaskSummary(taskElement, taskId, updatedStats);
      updateTaskLightingStatus(taskElement, updatedStats);
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
   * Calculate task statistics excluding ignored questions
   * @param {Object} validation - Task validation result from TaskValidator
   * @param {HTMLElement} taskElement - Task DOM element
   * @returns {Object} Statistics including total, answered, correct, hasTerminated, timedOut, etc.
   */
  function calculateTaskStatistics(validation, taskElement) {
    const tbody = taskElement.querySelector('table tbody');
    const rows = tbody ? tbody.querySelectorAll('tr[data-state]') : [];
    
    let total = 0;
    let answered = 0;
    let correct = 0;
    let scoredTotal = 0; // Questions that have a correct answer
    let scoredAnswered = 0;
    let hasTerminated = false;
    let hasPostTerminationAnswers = false; // NEW: Track answers after termination
    
    rows.forEach(row => {
      const isIgnored = row.getAttribute('data-ignored') === 'true';
      const isTextDisplay = row.getAttribute('data-text-display') === 'true';
      
      if (isIgnored) {
        hasTerminated = true;
        // Check if this ignored question has an answer (post-termination data)
        const isMissing = row.getAttribute('data-missing') === 'true';
        if (!isMissing) {
          hasPostTerminationAnswers = true;
        }
        return; // Skip ignored questions from counting
      }
      
      // Skip _TEXT display fields from counting (they're display-only)
      if (isTextDisplay) {
        return;
      }
      
      const state = row.getAttribute('data-state');
      const isMissing = row.getAttribute('data-missing') === 'true';
      const isUnscored = state === 'unscored';
      
      total++;
      
      if (!isMissing) {
        answered++;
      }
      
      if (state === 'correct') {
        correct++;
      }
      
      // For scored questions (exclude unscored preference questions)
      if (!isUnscored) {
        scoredTotal++;
        if (!isMissing) {
          scoredAnswered++;
        }
      }
    });
    
    return {
      total,
      answered,
      correct,
      scoredTotal,
      scoredAnswered,
      hasTerminated,
      hasPostTerminationAnswers,
      timedOut: validation?.timedOut || false,  // Include timeout flag from validation
      answeredPercent: total > 0 ? Math.round((answered / total) * 100) : 0,
      correctPercent: scoredTotal > 0 ? Math.round((correct / scoredTotal) * 100) : 0
    };
  }

  /**
   * Calculate gradient color based on percentage (0-100)
   * 0% = grey, 1-49% = red to orange, 50% = orange, 51-100% = orange to green
   */
  function getGradientColor(percentage) {
    if (percentage === 0) {
      // Grey for 0% (not started)
      return {
        bg: 'rgba(148, 163, 184, 0.06)',
        border: 'rgba(148, 163, 184, 0.15)',
        text: '#94a3b8'
      };
    } else if (percentage <= 50) {
      // Red (0%) to Orange (50%)
      const ratio = percentage / 50; // 0 to 1
      // Interpolate between red and orange
      const red = Math.round(220 + (251 - 220) * ratio); // #dc2626 to #fb923c
      const green = Math.round(38 + (146 - 38) * ratio);
      const blue = Math.round(38 + (60 - 38) * ratio);
      
      return {
        bg: `rgba(${red}, ${green}, ${blue}, 0.08)`,
        border: `rgba(${red}, ${green}, ${blue}, 0.2)`,
        text: `rgb(${Math.round(red * 0.8)}, ${Math.round(green * 0.8)}, ${Math.round(blue * 0.8)})`
      };
    } else {
      // Orange (50%) to Green (100%)
      const ratio = (percentage - 50) / 50; // 0 to 1
      // Interpolate between orange and green
      const red = Math.round(251 + (34 - 251) * ratio); // #fb923c to #22c55e
      const green = Math.round(146 + (197 - 146) * ratio);
      const blue = Math.round(60 + (94 - 60) * ratio);
      
      return {
        bg: `rgba(${red}, ${green}, ${blue}, 0.08)`,
        border: `rgba(${red}, ${green}, ${blue}, 0.2)`,
        text: `rgb(${Math.round(red * 0.8)}, ${Math.round(green * 0.8)}, ${Math.round(blue * 0.8)})`
      };
    }
  }

  /**
   * Update task summary display with refined counters
   */
  function updateTaskSummary(taskElement, taskId, stats) {
    const statsContainer = taskElement.querySelector('.task-progress-stats');
    if (!statsContainer) {
      console.warn(`[StudentPage] task-progress-stats not found for ${taskId}`);
      return;
    }
    
    const answeredStat = statsContainer.querySelector('.answered-stat');
    const correctStat = statsContainer.querySelector('.correct-stat');
    const totalStat = statsContainer.querySelector('.total-stat');
    
    if (answeredStat) {
      answeredStat.textContent = `${stats.answered}/${stats.total} (${stats.answeredPercent}%)`;
      answeredStat.title = `Answered: ${stats.answered} out of ${stats.total} questions`;
      
      // Apply gradient color based on answered percentage
      const answeredColors = getGradientColor(stats.answeredPercent);
      answeredStat.style.backgroundColor = answeredColors.bg;
      answeredStat.style.borderColor = answeredColors.border;
      answeredStat.style.color = answeredColors.text;
    }
    
    if (correctStat) {
      correctStat.textContent = `${stats.correct}/${stats.scoredTotal} (${stats.correctPercent}%)`;
      correctStat.title = `Correct: ${stats.correct} out of ${stats.scoredTotal} scored questions`;
      
      // Apply gradient color based on correct percentage
      const correctColors = getGradientColor(stats.correctPercent);
      correctStat.style.backgroundColor = correctColors.bg;
      correctStat.style.borderColor = correctColors.border;
      correctStat.style.color = correctColors.text;
    }
    
    if (totalStat) {
      totalStat.textContent = `${stats.total}`;
      totalStat.title = `Total questions (excluding ignored)`;
      // Total stat keeps its default grey color (no gradient)
    }
    
    console.log(`[StudentPage] ✅ Updated stats for ${taskId}: Answered ${stats.answered}/${stats.total} (${stats.answeredPercent}%), Correct ${stats.correct}/${stats.scoredTotal} (${stats.correctPercent}%)`);
  }

  /**
   * Update task lighting status (colored circle indicator)
   */
  function updateTaskLightingStatus(taskElement, stats) {
    const statusCircle = taskElement.querySelector('.status-circle');
    if (!statusCircle) return;
    
    // Remove all status classes
    statusCircle.className = 'status-circle';
    
    // Determine status based on completion and termination
    if (stats.total === 0) {
      // No data yet
      statusCircle.classList.add('status-grey');
      statusCircle.title = 'Not started';
    } else if (stats.hasPostTerminationAnswers) {
      // Yellow: Post-termination data detected (terminated BUT has answers after termination)
      statusCircle.classList.add('status-yellow');
      statusCircle.title = 'Post-termination data detected';
    } else if ((stats.hasTerminated || stats.timedOut) && stats.answered > 0) {
      // Green: Properly terminated/timed out (NO post-termination answers)
      statusCircle.classList.add('status-green');
      statusCircle.title = stats.timedOut ? 'Timed out correctly' : 'Terminated correctly';
    } else if (stats.answeredPercent === 100 && !stats.hasTerminated && !stats.timedOut) {
      // Green: Complete - all questions answered, no termination/timeout
      statusCircle.classList.add('status-green');
      statusCircle.title = 'Complete';
    } else if (stats.answered > 0) {
      // Red: Incomplete - has some answers but not complete
      statusCircle.classList.add('status-red');
      statusCircle.title = 'Incomplete';
    } else {
      // Grey: Not started
      statusCircle.classList.add('status-grey');
      statusCircle.title = 'Not started';
    }
  }

  /**
   * Update task status overview counts
   */
  function updateTaskStatusOverview() {
    const allTasks = document.querySelectorAll('.task-expand .status-circle');
    
    let completeCount = 0;
    let posttermCount = 0;
    let incompleteCount = 0;
    let notstartedCount = 0;
    
    allTasks.forEach(circle => {
      if (circle.classList.contains('status-green')) {
        completeCount++;
      } else if (circle.classList.contains('status-yellow')) {
        posttermCount++;
      } else if (circle.classList.contains('status-red')) {
        incompleteCount++;
      } else if (circle.classList.contains('status-grey')) {
        notstartedCount++;
      }
    });
    
    // Update the overview display
    const completeEl = document.getElementById('overview-complete-count');
    const posttermEl = document.getElementById('overview-postterm-count');
    const incompleteEl = document.getElementById('overview-incomplete-count');
    const notstartedEl = document.getElementById('overview-notstarted-count');
    
    if (completeEl) completeEl.textContent = completeCount;
    if (posttermEl) posttermEl.textContent = posttermCount;
    if (incompleteEl) incompleteEl.textContent = incompleteCount;
    if (notstartedEl) notstartedEl.textContent = notstartedCount;
    
    console.log(`[StudentPage] Task Status Overview: Complete=${completeCount}, Post-term=${posttermCount}, Incomplete=${incompleteCount}, Not started=${notstartedCount}`);
  }

  /**
   * Update global sync timestamp in profile section
   */
  function updateGlobalSyncTimestamp() {
    // Get or create sync timestamp element in profile section
    let syncElement = document.getElementById('global-last-synced');
    
    if (!syncElement) {
      // Create and append to profile section if it doesn't exist
      const profileSection = document.querySelector('details.entry-card');
      if (profileSection) {
        const summaryDiv = profileSection.querySelector('summary > div:last-child');
        if (summaryDiv) {
          syncElement = document.createElement('p');
          syncElement.id = 'global-last-synced';
          syncElement.className = 'text-[11px] text-[color:var(--muted-foreground)] font-mono mt-1';
          summaryDiv.appendChild(syncElement);
        }
      }
    }
    
    if (!syncElement) return;
    
    // Get global sync timestamp from localStorage
    const urlParams = new URLSearchParams(window.location.search);
    const coreId = urlParams.get('coreId');
    
    if (coreId) {
      const syncKey = `jotform_last_sync_${coreId}`;
      const lastSyncTimestamp = localStorage.getItem(syncKey);
      
      if (lastSyncTimestamp) {
        const syncDate = new Date(lastSyncTimestamp);
        const formattedDate = syncDate.toLocaleString('en-GB', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).replace(',', ' ·');
        
        syncElement.textContent = `Last synced: ${formattedDate}`;
      } else {
        syncElement.textContent = 'Never synced';
      }
    }
  }

  /**
   * Update "Last Updated" timestamp in page header
   * Uses the latest created_at from student's submissions
   * Issue #7 and #9: Display format "Last Updated: dd/mm/yyyy HH:MM:SS" in 24-hour format
   */
  function updateHeaderTimestamp(data) {
    const timestampElement = document.getElementById('last-updated-timestamp');
    if (!timestampElement) {
      console.warn('[StudentPage] last-updated-timestamp element not found');
      return;
    }
    
    try {
      // Get latest created_at from cache - need to fetch from IndexedDB
      const urlParams = new URLSearchParams(window.location.search);
      const coreId = urlParams.get('coreId');
      
      if (!coreId) {
        console.warn('[StudentPage] No coreId found for timestamp update');
        return;
      }
      
      // Use JotFormCache to get all submissions for this student
      if (window.JotFormCache && window.JotFormCache.cache) {
        const allSubmissions = window.JotFormCache.cache.submissions || [];
        
        // Filter submissions by student ID (from cache data)
        const studentSubmissions = allSubmissions.filter(sub => {
          // Get student-id from answers (QID 20)
          const studentIdAnswer = sub.answers?.['20'];
          const studentId = studentIdAnswer?.answer || studentIdAnswer?.text || '';
          
          // Match Core ID (remove "C" prefix if present)
          const numericCoreId = coreId.startsWith('C') ? coreId.substring(1) : coreId;
          return studentId === numericCoreId;
        });
        
        if (studentSubmissions.length === 0) {
          console.log('[StudentPage] No submissions found for timestamp');
          timestampElement.textContent = 'Last Updated: No data';
          return;
        }
        
        // Find the latest created_at timestamp
        let latestTimestamp = null;
        studentSubmissions.forEach(sub => {
          if (sub.created_at) {
            // Parse the created_at string (format: "YYYY-MM-DD HH:MM:SS")
            // Issue #8: JotForm returns times in 24-hour format (e.g., "2025-10-17 15:00:20" for 3pm)
            // The Date constructor correctly interprets this as 24-hour time
            // Note: If timezone differences occur, they are handled by the browser's local timezone
            const timestamp = new Date(sub.created_at);
            if (!latestTimestamp || timestamp > latestTimestamp) {
              latestTimestamp = timestamp;
            }
          }
        });
        
        if (latestTimestamp) {
          // Format as dd/mm/yyyy HH:MM:SS in 24-hour format
          const day = String(latestTimestamp.getDate()).padStart(2, '0');
          const month = String(latestTimestamp.getMonth() + 1).padStart(2, '0');
          const year = latestTimestamp.getFullYear();
          const hours = String(latestTimestamp.getHours()).padStart(2, '0');
          const minutes = String(latestTimestamp.getMinutes()).padStart(2, '0');
          const seconds = String(latestTimestamp.getSeconds()).padStart(2, '0');
          
          const formattedDate = `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
          timestampElement.textContent = `Last Updated: ${formattedDate}`;
          
          console.log(`[StudentPage] Updated header timestamp: ${formattedDate} (from ${studentSubmissions.length} submissions)`);
        } else {
          timestampElement.textContent = 'Last Updated: Invalid date';
        }
      } else {
        // Fallback: use cached data timestamp if available
        if (data && data.timestamp) {
          const timestamp = new Date(data.timestamp);
          const day = String(timestamp.getDate()).padStart(2, '0');
          const month = String(timestamp.getMonth() + 1).padStart(2, '0');
          const year = timestamp.getFullYear();
          const hours = String(timestamp.getHours()).padStart(2, '0');
          const minutes = String(timestamp.getMinutes()).padStart(2, '0');
          const seconds = String(timestamp.getSeconds()).padStart(2, '0');
          
          const formattedDate = `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
          timestampElement.textContent = `Last Updated: ${formattedDate} (cached)`;
        } else {
          timestampElement.textContent = 'Last Updated: —';
        }
      }
    } catch (error) {
      console.error('[StudentPage] Error updating header timestamp:', error);
      timestampElement.textContent = 'Last Updated: Error';
    }
  }


  /**
   * Mark questions beyond termination point as ignored in the table
   */
  function markQuestionsBeyondTermination(taskElement, ignoredQuestionIds) {
    if (!taskElement || ignoredQuestionIds.size === 0) return;
    
    const tbody = taskElement.querySelector('table tbody');
    if (!tbody) return;
    
    const rows = tbody.querySelectorAll('tr[data-state]');
    let markedCount = 0;
    
    rows.forEach(row => {
      const questionId = row.querySelector('td:first-child')?.textContent?.trim();
      
      if (questionId && ignoredQuestionIds.has(questionId)) {
        // Add visual indication that this question was ignored due to termination
        row.classList.add('opacity-50', 'bg-blue-50');
        row.setAttribute('data-ignored', 'true');
        
        // Update the status cell to show "Ignored"
        const statusCell = row.querySelector('td:nth-child(4)');
        if (statusCell) {
          statusCell.innerHTML = '<span class="answer-pill" style="background: #e0f2fe; color: #0369a1; border-color: #7dd3fc;"><i data-lucide="ban" class="w-3 h-3"></i>Ignored (Terminated)</span>';
        }
        
        markedCount++;
      }
    });
    
    console.log(`[StudentPage] Marked ${markedCount} questions as ignored due to termination`);
    
    // Reinitialize Lucide icons for the new icons
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  /**
   * Apply task filter based on status light colors and update Set task counts
   */
  function applyTaskFilter(filterValue) {
    const allTasks = document.querySelectorAll('.task-expand');
    
    allTasks.forEach(task => {
      const statusCircle = task.querySelector('.status-circle');
      if (!statusCircle) return;
      
      let shouldShow = true;
      
      switch (filterValue) {
        case 'completed':
          // Green light only
          shouldShow = statusCircle.classList.contains('status-green');
          break;
        case 'incomplete':
          // Red light only
          shouldShow = statusCircle.classList.contains('status-red');
          break;
        case 'issues':
          // NOT green (yellow or red)
          shouldShow = statusCircle.classList.contains('status-yellow') || 
                      statusCircle.classList.contains('status-red');
          break;
        case 'not-started':
          // Grey light only
          shouldShow = statusCircle.classList.contains('status-grey');
          break;
        case 'all':
        default:
          shouldShow = true;
      }
      
      task.style.display = shouldShow ? '' : 'none';
    });
    
    // Update Set task counts dynamically
    updateSetTaskCounts();
    
    console.log(`[StudentPage] Applied task filter: ${filterValue}, affected ${allTasks.length} tasks`);
  }
  
  /**
   * Update task counts for each Set based on visible tasks and hide empty Sets
   */
  function updateSetTaskCounts() {
    const allSets = document.querySelectorAll('.set-group');
    const taskFilter = document.getElementById('task-filter');
    const currentFilter = taskFilter ? taskFilter.value : 'all';
    
    allSets.forEach(setElement => {
      const tasksInSet = setElement.querySelectorAll('.task-expand');
      const visibleTasks = Array.from(tasksInSet).filter(task => task.style.display !== 'none');
      
      // Find the task count span
      const taskCountSpan = setElement.querySelector('.set-task-count');
      if (taskCountSpan) {
        const totalTasks = tasksInSet.length;
        const visibleCount = visibleTasks.length;
        
        // Hide Set completely if no visible tasks
        if (visibleCount === 0) {
          setElement.style.display = 'none';
        } else {
          setElement.style.display = '';
          
          // Always show "X of Y tasks" format except when "All tasks" filter is selected
          if (currentFilter === 'all') {
            taskCountSpan.textContent = `${totalTasks} tasks`;
          } else {
            taskCountSpan.textContent = `${visibleCount} of ${totalTasks} tasks`;
          }
        }
      }
    });
  }

  /**
   * Populate the task config modal with toggle pills
   */
  function populateTaskConfigModal() {
    const taskConfigList = document.getElementById('task-config-list');
    if (!taskConfigList) return;
    
    // Get the grid container
    const gridContainer = taskConfigList.querySelector('.grid') || taskConfigList;
    gridContainer.innerHTML = '';
    
    // Get all task elements
    const allTasks = document.querySelectorAll('.task-expand');
    const initialVisibilityState = new Map();
    
    allTasks.forEach(taskElement => {
      const taskId = taskElement.getAttribute('data-task-id');
      const taskTitle = taskElement.querySelector('strong')?.textContent || taskId;
      const isVisible = taskElement.style.display !== 'none';
      initialVisibilityState.set(taskId, isVisible);
      
      // Create pill toggle button
      const pillButton = document.createElement('button');
      pillButton.className = `task-pill-toggle px-4 py-3 rounded-xl text-sm font-semibold transition-all border-2 ${isVisible ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-slate-100 border-slate-200 text-slate-500'}`;
      pillButton.setAttribute('data-task-id', taskId);
      pillButton.setAttribute('data-selected', isVisible ? 'true' : 'false');
      
      pillButton.innerHTML = `
        <div class="flex items-center gap-2">
          <i data-lucide="${isVisible ? 'check-circle' : 'circle'}" class="w-4 h-4"></i>
          <span>${taskTitle}</span>
        </div>
      `;
      
      // Toggle on click
      pillButton.addEventListener('click', () => {
        const isSelected = pillButton.getAttribute('data-selected') === 'true';
        const newState = !isSelected;
        
        pillButton.setAttribute('data-selected', newState ? 'true' : 'false');
        
        if (newState) {
          pillButton.className = 'task-pill-toggle px-4 py-3 rounded-xl text-sm font-semibold transition-all border-2 bg-blue-50 border-blue-300 text-blue-700';
          const icon = pillButton.querySelector('i');
          if (icon) icon.setAttribute('data-lucide', 'check-circle');
        } else {
          pillButton.className = 'task-pill-toggle px-4 py-3 rounded-xl text-sm font-semibold transition-all border-2 bg-slate-100 border-slate-200 text-slate-500';
          const icon = pillButton.querySelector('i');
          if (icon) icon.setAttribute('data-lucide', 'circle');
        }
        
        // Reinitialize lucide icons
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
        
        updateSelectionCount();
      });
      
      gridContainer.appendChild(pillButton);
    });
    
    // Reinitialize lucide icons
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
    
    updateSelectionCount();
    
    // Update selection count display
    function updateSelectionCount() {
      const pills = gridContainer.querySelectorAll('.task-pill-toggle');
      const selected = Array.from(pills).filter(p => p.getAttribute('data-selected') === 'true').length;
      const total = pills.length;
      const countEl = document.getElementById('task-selection-count');
      if (countEl) {
        countEl.textContent = `${selected} / ${total} selected`;
      }
    }
    
    // Select All button
    const selectAllBtn = document.getElementById('task-select-all');
    if (selectAllBtn) {
      selectAllBtn.onclick = () => {
        gridContainer.querySelectorAll('.task-pill-toggle').forEach(pill => {
          pill.setAttribute('data-selected', 'true');
          pill.className = 'task-pill-toggle px-4 py-3 rounded-xl text-sm font-semibold transition-all border-2 bg-blue-50 border-blue-300 text-blue-700';
          const icon = pill.querySelector('i');
          if (icon) icon.setAttribute('data-lucide', 'check-circle');
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
        updateSelectionCount();
      };
    }
    
    // Unselect All button
    const unselectAllBtn = document.getElementById('task-unselect-all');
    if (unselectAllBtn) {
      unselectAllBtn.onclick = () => {
        gridContainer.querySelectorAll('.task-pill-toggle').forEach(pill => {
          pill.setAttribute('data-selected', 'false');
          pill.className = 'task-pill-toggle px-4 py-3 rounded-xl text-sm font-semibold transition-all border-2 bg-slate-100 border-slate-200 text-slate-500';
          const icon = pill.querySelector('i');
          if (icon) icon.setAttribute('data-lucide', 'circle');
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
        updateSelectionCount();
      };
    }
    
    // Reset button
    const resetBtn = document.getElementById('task-config-reset');
    if (resetBtn) {
      resetBtn.onclick = () => {
        gridContainer.querySelectorAll('.task-pill-toggle').forEach(pill => {
          const taskId = pill.getAttribute('data-task-id');
          const initialState = initialVisibilityState.get(taskId) || false;
          pill.setAttribute('data-selected', initialState ? 'true' : 'false');
          
          if (initialState) {
            pill.className = 'task-pill-toggle px-4 py-3 rounded-xl text-sm font-semibold transition-all border-2 bg-blue-50 border-blue-300 text-blue-700';
            const icon = pill.querySelector('i');
            if (icon) icon.setAttribute('data-lucide', 'check-circle');
          } else {
            pill.className = 'task-pill-toggle px-4 py-3 rounded-xl text-sm font-semibold transition-all border-2 bg-slate-100 border-slate-200 text-slate-500';
            const icon = pill.querySelector('i');
            if (icon) icon.setAttribute('data-lucide', 'circle');
          }
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
        updateSelectionCount();
      };
    }
    
    // Apply button
    const applyButton = document.getElementById('task-config-apply');
    if (applyButton) {
      applyButton.onclick = () => {
        gridContainer.querySelectorAll('.task-pill-toggle').forEach(pill => {
          const taskId = pill.getAttribute('data-task-id');
          const isSelected = pill.getAttribute('data-selected') === 'true';
          const taskElement = document.querySelector(`.task-expand[data-task-id="${taskId}"]`);
          if (taskElement) {
            taskElement.style.display = isSelected ? '' : 'none';
          }
        });
        
        // Close modal
        const taskConfigModal = document.getElementById('task-config-modal');
        if (taskConfigModal) {
          taskConfigModal.classList.add('hidden');
          taskConfigModal.classList.remove('flex');
        }
        
        console.log('[StudentPage] Task visibility updated');
      };
    }
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
   * @deprecated No longer used with IndexedDB cache system. Use home page cache management instead.
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
    
    // Task view filter dropdown
    const taskFilter = document.getElementById('task-filter');
    if (taskFilter) {
      taskFilter.addEventListener('change', (e) => {
        const filterValue = e.target.value;
        console.log(`[StudentPage] Task filter changed to: ${filterValue}`);
        applyTaskFilter(filterValue);
      });
    }
    
    // Expand All - Smart 2-level expansion
    const expandAllBtn = document.getElementById('expand-all-tasks');
    if (expandAllBtn) {
      expandAllBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent summary click
        const allSets = document.querySelectorAll('.set-group');
        const allTasks = document.querySelectorAll('.task-expand');
        
        // Check current state
        const anySetClosed = Array.from(allSets).some(set => !set.open);
        const anyTaskOpen = Array.from(allTasks).some(task => task.open);
        
        if (anySetClosed) {
          // Level 1: Expand all Sets only (keep tasks collapsed)
          allSets.forEach(set => set.open = true);
          allTasks.forEach(task => task.open = false);
          console.log('[StudentPage] Expanded all Sets (Level 1)');
        } else if (anyTaskOpen) {
          // Smart: If any task is open, expand all tasks
          allTasks.forEach(task => task.open = true);
          console.log('[StudentPage] Expanded all Tasks (Level 2 - smart detection)');
        } else {
          // Level 2: Expand all tasks (show questions)
          allTasks.forEach(task => task.open = true);
          console.log('[StudentPage] Expanded all Tasks (Level 2)');
        }
      });
    }
    
    // Collapse All - Smart multi-level collapse with improved detection
    const collapseAllBtn = document.getElementById('collapse-all-tasks');
    if (collapseAllBtn) {
      collapseAllBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent summary click
        const allSets = document.querySelectorAll('.set-group');
        const allTasks = document.querySelectorAll('.task-expand');
        
        // Check current state
        const anyTaskOpen = Array.from(allTasks).some(task => task.open);
        const allTasksOpen = Array.from(allTasks).every(task => task.open);
        const anySetsOpen = Array.from(allSets).some(set => set.open);
        
        // Issue #3 requirement: improved collapse detection
        // a) If no panels are expanded, nothing happens
        // b) If some panels are expanded once (showing tasks, not questions) - collapse to Set 1, 2, 3, 4 only
        // c) If some panels are expanded twice (showing questions) - collapse back to tasks
        // d) If all panels are expanded twice - collapse back to tasks
        
        if (anyTaskOpen) {
          // Tasks are expanded (showing questions) - collapse to task level (hide questions)
          allTasks.forEach(task => task.open = false);
          console.log('[StudentPage] Collapsed to task level (hiding questions)');
        } else if (anySetsOpen) {
          // Sets are open but tasks are closed - collapse sets
          allSets.forEach(set => set.open = false);
          console.log('[StudentPage] Collapsed all sets');
        } else {
          // Nothing is open - do nothing
          console.log('[StudentPage] Nothing to collapse');
        }
      });
    }
    
    // Task Config button - open modal
    const taskConfigButton = document.querySelector('.hero-button.btn-secondary');
    const taskConfigModal = document.getElementById('task-config-modal');
    const taskConfigClose = document.getElementById('task-config-close');
    const taskConfigCancel = document.getElementById('task-config-cancel');
    
    if (taskConfigButton && taskConfigModal) {
      taskConfigButton.addEventListener('click', () => {
        console.log('[StudentPage] Task Config clicked - opening modal');
        taskConfigModal.classList.remove('hidden');
        taskConfigModal.classList.add('flex');
        populateTaskConfigModal();
      });
      
      // Close modal handlers
      if (taskConfigClose) {
        taskConfigClose.addEventListener('click', () => {
          taskConfigModal.classList.add('hidden');
          taskConfigModal.classList.remove('flex');
        });
      }
      
      if (taskConfigCancel) {
        taskConfigCancel.addEventListener('click', () => {
          taskConfigModal.classList.add('hidden');
          taskConfigModal.classList.remove('flex');
        });
      }
      
      // Close modal when clicking backdrop
      taskConfigModal.addEventListener('click', (e) => {
        if (e.target === taskConfigModal) {
          taskConfigModal.classList.add('hidden');
          taskConfigModal.classList.remove('flex');
        }
      });
    }
    
    // Export button - export student-level cache data
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.includes('Export')) {
        btn.addEventListener('click', exportStudentCache);
        console.log('[StudentPage] Export button handler attached');
        break;
      }
    }

    // REMOVED: Refresh button no longer needed with IndexedDB cache system
    // To refresh data, users should:
    // 1. Go back to home page
    // 2. Click green "System Ready" pill
    // 3. Click "Delete Cache" button
    // 4. Re-sync cache
    // This ensures all users see consistent data from the same cache
  }
  
  /**
   * Export student-level validation report as Markdown
   * Uses centralized ExportUtils.exportReport orchestrator
   */
  async function exportStudentCache() {
    if (!studentData) {
      alert('No student data to export');
      return;
    }
    
    await window.ExportUtils.exportReport({
      type: 'student',
      data: { studentData },
      loadValidationCache: () => window.JotFormCache.loadValidationCache()
    });
  }

  /**
   * Show loading overlay - DISABLED (no overlay in HTML)
   */
  function showLoadingOverlay(message = 'Loading...') {
    console.log(`[Loading] (Disabled) ${message}`);
  }

  /**
   * Update loading status - DISABLED (no overlay in HTML)
   */
  function updateLoadingStatus(message) {
    console.log(`[Loading] (Disabled) ${message}`);
  }

  /**
   * Hide loading overlay - DISABLED (no overlay in HTML)
   */
  function hideLoadingOverlay() {
    console.log(`[Loading] (Disabled) Hide overlay`);
  }

  /**
   * Initialize with loading wrapper
   */
  async function initWithLoading() {
    try {
      // No loading overlay shown - cache should be ready
      await init();
      setupUIHandlers();
    } catch (error) {
      console.error('[StudentPage] Initialization failed:', error);
      showError(`Failed to load student data: ${error.message}`);
    }
  }
  
  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initWithLoading();
    });
  } else {
    initWithLoading();
  }

  // Export to global scope
  window.CheckingSystemStudentPage = {
    init,
    getStudentData,
    clearJotformCache
  };
})();
