/**
 * Student Detail Page Controller
 * Handles URL parameter parsing, data loading, and UI population
 */
(() => {
  let studentData = null;
  let schoolData = null;
  let classData = null;
  let selectedGrade = null; // Currently selected grade (K1/K2/K3)
  let availableGrades = []; // Grades available for this student
  let cachedDataGlobal = null; // Store cached data for grade switching
  let currentSubmission = null; // Store current student submission with metadata for provenance tooltips
  
  // System configuration (loaded from config/checking_system_config.json)
  let systemConfig = {
    ui: {
      loadingStatusDelayMs: 500
    },
    cache: {
      ttlHours: 0,
      sessionStorageKeyPrefix: "student_jotform_"
    },
    taskView: {
      defaultFilter: "all",
      defaultExpandState: false
    }
  };
  let taskRegistry = null; // Centralized task identifier mappings
  let taskDefinitionsCache = {}; // Cache for task JSON definitions (for options mapping)
  let systemPassword = null;

  // Shared tooltip state for revealing associated text answers
  let textAnswerTooltipElement = null;
  let activeTextAnswerTrigger = null;

  function escapeHtmlAttribute(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function ensureTextAnswerTooltipElement() {
    if (!textAnswerTooltipElement) {
      const tooltip = document.createElement('div');
      tooltip.id = 'text-answer-tooltip';
      tooltip.className = 'text-answer-tooltip';
      tooltip.setAttribute('role', 'status');
      tooltip.setAttribute('aria-live', 'polite');
      document.body.appendChild(tooltip);
      textAnswerTooltipElement = tooltip;
    }
    return textAnswerTooltipElement;
  }

  function getNormalizedTextAnswer(answers, fieldId) {
    if (!fieldId || !answers) {
      return '';
    }

    const entry = answers[fieldId];
    if (!entry) {
      return '';
    }

    const rawValue = entry.answer ?? entry.text ?? entry.value ?? '';
    if (rawValue === null || rawValue === undefined) {
      return '';
    }

    const stringValue = String(rawValue).trim();
    if (!stringValue) {
      return '';
    }

    // Qualtrics placeholder: unanswered text fields sometimes echo their own ID
    if (stringValue.toLowerCase() === String(fieldId).toLowerCase()) {
      return '';
    }

    return stringValue;
  }

  function hideTextAnswerTooltip(trigger = null) {
    if (trigger && trigger !== activeTextAnswerTrigger) {
      return;
    }
    if (!textAnswerTooltipElement) {
      return;
    }
    textAnswerTooltipElement.classList.remove('visible');
    textAnswerTooltipElement.textContent = '';
    if (activeTextAnswerTrigger) {
      activeTextAnswerTrigger.classList.remove('is-active-text-answer');
    }
    activeTextAnswerTrigger = null;
  }

  function positionTextAnswerTooltip(trigger) {
    const tooltip = ensureTextAnswerTooltipElement();
    const rect = trigger.getBoundingClientRect();
    let top = rect.top - 12;
    let translateY = '-100%';

    if (top < 12) {
      top = rect.bottom + 12;
      translateY = '0';
    }

    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.transform = `translate(-50%, ${translateY})`;
  }

  function showTextAnswerTooltip(trigger) {
    const encoded = trigger.getAttribute('data-text-answer');
    if (!encoded) {
      return;
    }

    let decoded;
    try {
      decoded = decodeURIComponent(encoded);
    } catch (error) {
      decoded = encoded;
    }

    if (!decoded || !decoded.trim()) {
      hideTextAnswerTooltip();
      return;
    }

    const tooltip = ensureTextAnswerTooltipElement();
    tooltip.textContent = decoded;
    positionTextAnswerTooltip(trigger);
    tooltip.classList.add('visible');

    if (activeTextAnswerTrigger && activeTextAnswerTrigger !== trigger) {
      activeTextAnswerTrigger.classList.remove('is-active-text-answer');
    }
    trigger.classList.add('is-active-text-answer');
    activeTextAnswerTrigger = trigger;
  }

  function attachTextAnswerInteraction(trigger) {
    if (!trigger || trigger.dataset.textAnswerAttached === 'true') {
      return;
    }

    const handleEnter = () => showTextAnswerTooltip(trigger);
    const handleLeave = () => hideTextAnswerTooltip(trigger);
    const handleClick = event => {
      event.preventDefault();
      event.stopPropagation();
      if (activeTextAnswerTrigger === trigger) {
        hideTextAnswerTooltip(trigger);
      } else {
        showTextAnswerTooltip(trigger);
      }
    };

    trigger.addEventListener('mouseenter', handleEnter);
    trigger.addEventListener('focus', handleEnter);
    trigger.addEventListener('mouseleave', handleLeave);
    trigger.addEventListener('blur', handleLeave);
    trigger.addEventListener('click', handleClick);

    trigger.dataset.textAnswerAttached = 'true';
  }

  window.addEventListener('scroll', () => hideTextAnswerTooltip(), true);
  window.addEventListener('resize', () => hideTextAnswerTooltip());
  document.addEventListener('click', event => {
    if (!activeTextAnswerTrigger) {
      return;
    }
    if (event.target.closest('[data-text-answer]') === activeTextAnswerTrigger) {
      return;
    }
    hideTextAnswerTooltip();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      hideTextAnswerTooltip();
    }
  });

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
      
    } catch (error) {
      console.warn('[Config] ⚠️ Failed to load config, using defaults:', error);
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
      
      // Parse URL parameters - coreId and optional year
      const urlParams = new URLSearchParams(window.location.search);
      const coreId = urlParams.get('coreId'); // Core ID (e.g., C10002)
      const yearParam = urlParams.get('year'); // Optional year (K1/K2/K3)

      if (!coreId) {
        showError('No Core ID provided in URL');
        return;
      }

      // Check if data is already decrypted and cached
      const cachedData = window.CheckingSystemData?.getCachedData();
      cachedDataGlobal = cachedData; // Store for grade switching
      
      if (cachedData && cachedData.credentials) {
        // Use cached data (includes credentials from home page)
        await loadStudentFromCache(coreId, cachedData, yearParam);
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
   * @param {string} coreId - Student's core ID
   * @param {Object} cachedData - Cached data from home page
   * @param {string} yearParam - Optional year parameter from URL (K1/K2/K3)
   */
  async function loadStudentFromCache(coreId, cachedData, yearParam = null) {
    // Find all student records with this Core ID (may have multiple grades)
    const studentRecords = cachedData.students.filter(s => s.coreId === coreId);
    
    if (studentRecords.length === 0) {
      console.error('[StudentPage] ❌ Student NOT FOUND in cache');
      showError(`Student with Core ID ${coreId} not found in cached data`);
      return;
    }

    // Get available grades for this student
    availableGrades = [...new Set(studentRecords.map(s => s.year))].filter(y => y).sort().reverse(); // K3, K2, K1

    // Determine which grade to display
    if (yearParam && availableGrades.includes(yearParam)) {
      selectedGrade = yearParam;
    } else if (window.CheckingSystemPreferences) {
      // Check for saved grade preference
      const savedGrade = window.CheckingSystemPreferences.getGradeSelection(coreId);
      if (savedGrade && availableGrades.includes(savedGrade)) {
        selectedGrade = savedGrade;
      } else if (availableGrades.length > 0) {
        // Default to K3 if available, otherwise the highest grade
        selectedGrade = availableGrades.includes('K3') ? 'K3' : availableGrades[0];
      } else {
        console.error('[StudentPage] ❌ No valid grade found for student');
        console.error('[StudentPage] Student records:', studentRecords);
        showError('No valid grade data found for this student. All records have undefined or empty year field.');
        return;
      }
    } else if (availableGrades.length > 0) {
      // Default to K3 if available, otherwise the highest grade
      selectedGrade = availableGrades.includes('K3') ? 'K3' : availableGrades[0];
    } else {
      console.error('[StudentPage] ❌ No valid grade found for student');
      console.error('[StudentPage] Student records:', studentRecords);
      showError('No valid grade data found for this student. All records have undefined or empty year field.');
      return;
    }

    // Get the student record for the selected grade
    studentData = studentRecords.find(s => s.year === selectedGrade);
    
    if (!studentData) {
      console.error('[StudentPage] ❌ Student data NOT FOUND for selected grade');
      showError(`Student data not found for grade ${selectedGrade}`);
      return;
    }

    // Update grade selector UI
    updateGradeSelector();

    // Look up related school and class
    if (studentData.schoolId) {
      schoolData = cachedData.schoolIdMap.get(studentData.schoolId);
    }
    
    if (studentData.classId) {
      classData = cachedData.classIdMap.get(studentData.classId);
    }

    // Populate student profile
    populateStudentProfile();
    
    // Update page title
    populatePageTitle();
    
    // Build dynamic Task Progress section (now that we have student gender)
    await buildTaskProgressSection();
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
    
    // Display the grade/year from student data
    if (studentData.year) {
      const yearLabel = studentData.year; // K1, K2, or K3
      const yearMapping = { 'K1': '23/24', 'K2': '24/25', 'K3': '25/26' };
      const academicYear = yearMapping[yearLabel] || yearLabel;
      updateTextContent('student-class-label', `Class (${academicYear} - ${yearLabel})`);
    }
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
      // CRITICAL: Include grade in cache key to prevent mixing data from different grades
      // This ensures K1, K2, K3 data is cached separately per student
      const cacheKey = `student_jotform_${coreId}_${selectedGrade || 'unknown'}`;
      const cached = sessionStorage.getItem(cacheKey);
      
      if (cached) {
        const cachedData = JSON.parse(cached);
        const ttlHours = Number(systemConfig?.cache?.ttlHours ?? 0);
        const hasExpiry = ttlHours > 0;
        const now = new Date();

        // HTKS VALUE MAPPING: No transformation needed here
        // JotFormCache already handles choice→score mapping (1→2, 2→1, 3→0) when building
        // the merged dataset. Applying the transformation again here causes double-mapping,
        // incorrectly downgrading fully correct answers (score 2) to partially correct (score 1).
        // All data in sessionStorage cache has already been normalized by the cache layer.

        if (!hasExpiry) {
          populateJotformData(cachedData);
          return;
        }

        const expiresAt = cachedData.expiresAt ? new Date(cachedData.expiresAt) : null;
        const timeRemaining = expiresAt ? Math.round((expiresAt - now) / 1000 / 60) : null; // minutes
        
        if (expiresAt && now < expiresAt) {
          populateJotformData(cachedData);
          return;
        } else {
          // Cache expired - continue to fetch fresh data
        }
      } // No cached data - continue to fetch

      // Load question mappings for sessionkey QID
      await updateLoadingStatus('Loading question mappings...');
      const questionsResponse = await fetch('assets/jotformquestions.json');
      const questionsData = await questionsResponse.json();
      
      // Get sessionkey QID (needed for submission processing)
      const sessionKeyQid = questionsData['sessionkey'] || '3'; // Default to QID 3

      // Try to get data from global cache (includes merged Qualtrics data)
      let submissions = [];
      
      if (window.JotFormCache && typeof window.JotFormCache.getStudentSubmissions === 'function') {
        try {
          // CRITICAL: Pass selectedGrade to filter merged data by grade
          // This ensures we only get submissions for the selected grade (K1/K2/K3)
          // DataMerger creates separate records per (coreId, grade) pair, so this filter
          // is essential to avoid mixing JotForm K3 with Qualtrics K2 data
          submissions = await window.JotFormCache.getStudentSubmissions(coreId, selectedGrade);
          
          if (submissions.length > 0) {
            // Store the first submission (merged record with metadata) for provenance tooltips
            currentSubmission = submissions[0];
            
            const qualtricsOnly = submissions.filter(s => s._orphaned || (s._sources && s._sources.length === 1 && s._sources[0] === 'qualtrics'));
          } else {
            // No submissions in cache
          }
        } catch (cacheError) {
          console.warn('[StudentPage] Error reading from global cache:', cacheError);
        }
      } else {
        // Global cache not available
      }

      // ✅ FALLBACK: If no cached data, fetch from API
      // BUT: Only fall back to API if no specific grade is selected
      // If a grade IS selected (K1/K2/K3) and no data exists, show "No Data" instead
      // This prevents showing K3 data when K1 is selected but has no data
      if (submissions.length === 0) {
        if (selectedGrade) {
          // Grade is selected but no data exists for this grade in cache
          // Do NOT fall back to API - it would return wrong grade's data
          // submissions stays empty, will trigger showNoDataMessage below
        } else {
          // No grade selected - safe to fetch all from API
          await updateLoadingStatus('Connecting to Jotform API with :matches filter...');
          
          // fetchStudentSubmissionsDirectly uses the working :matches operator
          // Returns only submissions where sessionkey contains the student ID
          submissions = await window.JotformAPI.fetchStudentSubmissionsDirectly(coreId, sessionKeyQid);
          
          await updateLoadingStatus(`Found ${submissions.length} matching submissions`);
        }
      }

      if (submissions.length === 0) {
        showNoDataMessage();
        return;
      }

      // Extract sessionkeys
      await updateLoadingStatus(`Processing ${submissions.length} submissions...`);
      
      const sessionKeys = submissions.map((sub, index) => {
        const sessionKeyQid = questionsData['sessionkey'];
        const sessionKey = sub.answers?.[sessionKeyQid]?.answer || sub.answers?.[sessionKeyQid]?.text || 'UNKNOWN';
        return sessionKey;
      });

      // Merge submissions (prefer earliest for overlaps, fill missing from later)
      await updateLoadingStatus(`Merging ${submissions.length} submissions...`);
      const mergedData = mergeSubmissions(submissions, questionsData);

      // Calculate completion metrics
      await updateLoadingStatus('Calculating completion metrics...');
      const metrics = calculateCompletionMetrics(mergedData, questionsData);

      // Cache the results (merged data only, not all 517 raw submissions!)
      const ttlHours = Number(systemConfig?.cache?.ttlHours ?? 0);
      const expiresAt = ttlHours > 0
        ? new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString()
        : null;

      const cacheData = {
        coreId,
        submissionCount: submissions.length,
        mergedAnswers: mergedData,
        metrics,
        timestamp: new Date().toISOString(),
        expiresAt,
        ttlHours
      };
      
      try {
        const cacheString = JSON.stringify(cacheData);
        sessionStorage.setItem(cacheKey, cacheString);
      } catch (e) {
        console.warn('[StudentPage] ❌ Failed to cache (quota exceeded):', e.message);
        // Continue without caching - not critical
      }

      // Set last sync timestamp in localStorage (global for this student)
      const syncKey = `jotform_last_sync_${coreId}`;
      try {
        localStorage.setItem(syncKey, new Date().toISOString());
      } catch (storageError) {
        console.warn('[StudentPage] Could not access localStorage:', storageError.message);
        // Continue without localStorage - functionality should still work
      }

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
    // Sort by created_at (earliest first)
    const sorted = submissions.sort((a, b) => 
      new Date(a.created_at) - new Date(b.created_at)
    );

    const sessionKeyQid = questionsData['sessionkey'];

    // Create reverse mapping: QID -> field name
    const qidToFieldName = {};
    for (const [fieldName, qid] of Object.entries(questionsData)) {
      qidToFieldName[qid] = fieldName;
    }

    const merged = {};

    // Merge answers - iterate through sorted (earliest first)
    // This ensures EARLIEST submission "wins" for any field
    for (let i = 0; i < sorted.length; i++) {
      const submission = sorted[i];

      for (const [qid, answer] of Object.entries(submission.answers || {})) {
        const fieldName = qidToFieldName[qid];
        
        if (!fieldName || !answer.answer) continue;

        // HTKS VALUE MAPPING: No transformation needed here
        // JotFormCache already handles choice→score mapping (1→2, 2→1, 3→0) during:
        // 1. Cache building (fixUntransformedSubmissions) - transforms legacy cache entries
        // 2. Data fetching (transformSubmissionsToRecords) - transforms fresh API data
        // 3. Student validation (validateStudent) - transforms during merge
        // Applying the transformation again here causes double-mapping, incorrectly downgrading
        // fully correct answers (score 2) to partially correct (score 1).
        // All submissions flowing through this merge function have already been normalized.

        if (!merged[fieldName]) {
          // NEW FIELD - fill missing data
          merged[fieldName] = answer;
        }
        // OVERLAP DETECTED - already have this field from earlier submission (keep oldest)
      }
    }

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
      
      if (!window.TaskValidator) {
        throw new Error('TaskValidator not loaded');
      }
      
      const taskValidation = await window.TaskValidator.validateAllTasks(data.mergedAnswers);
      
      // Store validation results globally for cache validator access
      window.StudentPage.currentValidation = taskValidation;
      
      // Populate task tables with real data
      populateTaskTables(taskValidation, data.mergedAnswers);
      
      // Update global sync timestamp in profile section
      updateGlobalSyncTimestamp();
      
      // Update "Last Updated" timestamp in header from actual submission data
      updateHeaderTimestamp(data);
      
      // Update task status overview
      updateTaskStatusOverview();
      
      // Re-render E-Prime section now that we have merged data
      await updateEPrimeSection(data.mergedAnswers);
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
   * Helper function to display error message in table
   */
  function showTableError(tbody, message, iconName = 'alert-triangle', iconColor = 'amber-500') {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="py-8 px-4 text-center">
          <i data-lucide="${iconName}" class="w-12 h-12 mx-auto text-${iconColor} mb-4"></i>
          <p class="text-[color:var(--foreground)] font-semibold mb-2">${message.title || 'Error'}</p>
          <p class="text-[color:var(--muted-foreground)] text-sm">${message.description || 'An error occurred while loading data.'}</p>
        </td>
      </tr>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  /**
   * Render TGMD results with grouped task display and trial breakdown
   * 
   * Displays TGMD assessment results grouped by motor task (hop, jump, slide, etc.)
   * with individual trial results and row scores for each performance criterion.
   * 
   * @param {HTMLElement} tbody - Table body element to populate
   * @param {Object} tgmdScoring - TGMD scoring data from task validator
   * @param {HTMLElement} taskElement - Task details element for styling
   */
  function renderTGMDResults(tbody, tgmdScoring, taskElement, validation) {
    
    // Validate tgmdScoring object
    if (!tgmdScoring || !tgmdScoring.byTask) {
      console.error('[StudentPage] ❌ Invalid tgmdScoring object:', tgmdScoring);
      showTableError(tbody, {
        title: 'TGMD Data Error',
        description: 'TGMD scoring data is invalid or missing. Please check the data source.'
      }, 'alert-circle', 'red-500');
      return;
    }
    
    // Update table headers for TGMD-specific columns
    const thead = taskElement.querySelector('table thead tr');
    if (thead) {
      thead.innerHTML = `
        <th class="text-left font-medium pb-2 px-2">Question</th>
        <th class="text-left font-medium pb-2 px-2">Student Answer</th>
        <th class="text-left font-medium pb-2 px-2 text-center">Score</th>
        <th class="text-left font-medium pb-2 px-2">Result</th>
      `;
    }
    
    // Check if we have any tasks to render
    const taskCount = Object.keys(tgmdScoring.byTask).length;
    if (taskCount === 0) {
      console.warn('[StudentPage] ⚠️ No TGMD tasks found in scoring data');
      showTableError(tbody, {
        title: 'No TGMD Data',
        description: 'No TGMD task data available for this student.'
      }, 'info', 'blue-500');
      return;
    }
    
    
    // First, display TGMD_Leg (preferred foot/hand) if available
    if (validation && validation.questions) {
      const tgmdLeg = validation.questions.find(q => q.id === 'TGMD_Leg');
      if (tgmdLeg) {
        const legRow = document.createElement('tr');
        legRow.className = 'bg-blue-50 border-b-2 border-blue-200';
        const legAnswer = tgmdLeg.studentAnswer || '—';
        const legAnswerDisplay = legAnswer === 'Left' ? '左腳' : 
                                 legAnswer === 'Right' ? '右腳' : 
                                 legAnswer === 'Undetermined' ? '未形成' : legAnswer;
        legRow.innerHTML = `
          <td colspan="4" class="py-3 px-2">
            <div class="flex items-center gap-2">
              <i data-lucide="footprints" class="w-4 h-4 text-blue-600"></i>
              <span class="font-semibold text-blue-900">慣用腳: ${legAnswerDisplay}</span>
            </div>
          </td>
        `;
        tbody.appendChild(legRow);
      }
    }
    
    // Iterate through each motor task (hop, long_jump, slide, etc.)
    for (const [taskName, taskData] of Object.entries(tgmdScoring.byTask)) {
      // Add task header row
      const headerRow = document.createElement('tr');
      headerRow.className = 'bg-[color:var(--muted)] font-semibold';
      headerRow.innerHTML = `
        <td colspan="4" class="py-3 px-2">
          <div class="flex items-center gap-2">
            <i data-lucide="activity" class="w-4 h-4 text-[color:var(--primary)]"></i>
            <span>${taskData.taskLabel || taskName}</span>
          </div>
        </td>
      `;
      tbody.appendChild(headerRow);
      
      // Add rows for each performance criterion
      for (const criterion of taskData.criteria) {
        const row = document.createElement('tr');
        row.className = 'hover:bg-[color:var(--muted)]/30';
        
        // Determine trial statuses and display
        // null/undefined = not answered (show dash)
        // 0 = not observed (show red X)
        // 1 = successful (show green check)
        const t1Display = criterion.trials.t1 === null || criterion.trials.t1 === undefined
          ? '<span class="text-gray-400">—</span>'
          : criterion.trials.t1 === 1
            ? '<i data-lucide="check" class="w-3 h-3 text-green-600"></i>'
            : '<i data-lucide="x" class="w-3 h-3 text-red-600"></i>';
        
        const t2Display = criterion.trials.t2 === null || criterion.trials.t2 === undefined
          ? '<span class="text-gray-400">—</span>'
          : criterion.trials.t2 === 1
            ? '<i data-lucide="check" class="w-3 h-3 text-green-600"></i>'
            : '<i data-lucide="x" class="w-3 h-3 text-red-600"></i>';
        
        // Determine result status based on row score and whether trials were answered
        let resultStatus, resultClass, resultIcon;
        
        // Check if trials were actually answered (not null/blank)
        const t1Answered = criterion.trials.t1 !== null && criterion.trials.t1 !== undefined;
        const t2Answered = criterion.trials.t2 !== null && criterion.trials.t2 !== undefined;
        const anyAnswered = t1Answered || t2Answered;
        
        if (!anyAnswered) {
          // Not answered at all
          resultStatus = 'Not Answered';
          resultClass = 'answer-pill';
          resultIcon = 'circle-help';
        } else if (criterion.rowScore > 0) {
          // Observed (at least one trial successful)
          resultStatus = 'Observed';
          resultClass = 'answer-pill correct';
          resultIcon = 'eye';
        } else {
          // Not observed (answered but score is 0)
          resultStatus = 'Not-Observed';
          resultClass = 'answer-pill incorrect';
          resultIcon = 'eye-off';
        }
        
        row.innerHTML = `
          <td class="py-2 px-2 text-[color:var(--foreground)]">
            <div class="text-xs text-[color:var(--muted-foreground)] font-mono question-id-badge" id="question-${escapeHtmlAttribute(criterion.id)}">${criterion.id}</div>
            <div class="text-sm mt-1">${criterion.description}</div>
          </td>
          <td class="py-2 px-2">
            <div class="flex items-center gap-3 text-xs text-[color:var(--foreground)]">
              <span class="inline-flex items-center gap-1">T1: ${t1Display}</span>
              <span class="inline-flex items-center gap-1">T2: ${t2Display}</span>
            </div>
          </td>
          <td class="py-2 px-2 text-center">
            <div class="text-sm font-semibold">
              ${criterion.rowScore}/${criterion.maxScore}
            </div>
          </td>
          <td class="py-2 px-2">
            <span class="${resultClass}">
              <i data-lucide="${resultIcon}" class="w-3 h-3"></i>${resultStatus}
            </span>
          </td>
        `;
        
        tbody.appendChild(row);
        
        // Attach provenance tooltip to TGMD question ID badge
        if (window.ProvenanceTooltip && currentSubmission) {
          const questionBadge = row.querySelector('.question-id-badge');
          if (questionBadge) {
            const provenance = window.ProvenanceTooltip.extractProvenance(currentSubmission, criterion.id);
            if (provenance) {
              window.ProvenanceTooltip.attachToElement(questionBadge, provenance);
            }
          }
        }
      }
    }
    
    // Note: Overall TGMD Score summary row removed per user request
  }

  /**
   * Helper: Transform CCM student answer (value) to Chinese character (label)
   */
  function transformCCMAnswer(questionId, studentAnswer, taskDef) {
    if (!studentAnswer || !taskDef || !taskDef.questions) return studentAnswer;
    
    // Find the question definition
    const questionDef = taskDef.questions.find(q => q.id === questionId);
    if (!questionDef || !questionDef.options) return studentAnswer;
    
    // Find the option that matches the student's answer value
    const option = questionDef.options.find(opt => opt.value === studentAnswer);
    return option ? option.label : studentAnswer;
  }

  /**
   * Helper: Get HTKS score display (x/2 format)
   */
  function getHTKSScoreDisplay(studentAnswer) {
    if (studentAnswer === null || studentAnswer === undefined) return '—';
    const score = parseInt(studentAnswer, 10) || 0;
    return `${score}/2`;
  }

  /**
   * Helper: Get HTKS result pill with proper names based on score
   */
  function getHTKSResultPill(studentAnswer, branchSuffix = '') {
    if (studentAnswer === null) {
      return `<span class="answer-pill incorrect"><i data-lucide="minus" class="w-3 h-3"></i>Not answered${branchSuffix}</span>`;
    }
    
    const score = parseInt(studentAnswer, 10) || 0;
    
    if (score === 2) {
      return `<span class="answer-pill correct"><i data-lucide="check" class="w-3 h-3"></i>Fully Correct${branchSuffix}</span>`;
    } else if (score === 1) {
      return `<span class="answer-pill" style="background: #fef3c7; color: #92400e; border-color: #fde68a;"><i data-lucide="alert-circle" class="w-3 h-3"></i>Partially Correct${branchSuffix}</span>`;
    } else {
      return `<span class="answer-pill incorrect"><i data-lucide="x" class="w-3 h-3"></i>Incorrect${branchSuffix}</span>`;
    }
  }

  /**
   * Helper: Get Fine Motor result pill (7-pill system with confidence tiers)
   */
  function getFMResultPill(studentAnswer, branchSuffix = '', hasIncompleteData = false, hasHierarchicalViolation = false, hasCrossSectionViolation = false, crossSectionConfidence = '') {
    // Priority 1: Cross-section violation with HIGH confidence → RED "Missing Data"
    if (hasCrossSectionViolation && crossSectionConfidence === 'high') {
      return `<span class="answer-pill incorrect"><i data-lucide="alert-triangle" class="w-3 h-3"></i>Missing Data${branchSuffix}</span>`;
    }
    
    // Priority 2: Cross-section violation with MEDIUM confidence → YELLOW "Possible Missing Data"
    if (hasCrossSectionViolation && crossSectionConfidence === 'medium') {
      return `<span class="answer-pill" style="background: #fef3c7; color: #92400e; border-color: #fde68a;"><i data-lucide="alert-triangle" class="w-3 h-3"></i>Possible Missing Data${branchSuffix}</span>`;
    }
    
    // Priority 3: Student answer is null → GRAY "Not answered"
    if (studentAnswer === null) {
      return `<span class="answer-pill incorrect"><i data-lucide="minus" class="w-3 h-3"></i>Not answered${branchSuffix}</span>`;
    }
    
    // Priority 4: Hierarchical violation → YELLOW "Illogical Score"
    if (hasHierarchicalViolation) {
      return `<span class="answer-pill" style="background: #fef3c7; color: #92400e; border-color: #fde68a;"><i data-lucide="alert-triangle" class="w-3 h-3"></i>Illogical Score${branchSuffix}</span>`;
    }
    
    const value = studentAnswer === '1' || studentAnswer === 1;
    
    // Priority 5: Value = 1 → GREEN "Successful"
    if (value) {
      return `<span class="answer-pill correct"><i data-lucide="check" class="w-3 h-3"></i>Successful${branchSuffix}</span>`;
    }
    
    // Priority 6: Incomplete data → YELLOW "Possible Wrong Input"
    if (hasIncompleteData) {
      return `<span class="answer-pill" style="background: #fef3c7; color: #92400e; border-color: #fde68a;"><i data-lucide="alert-triangle" class="w-3 h-3"></i>Possible Wrong Input${branchSuffix}</span>`;
    }
    
    // Priority 7: Default value = 0 → RED "Not Successful"
    return `<span class="answer-pill incorrect"><i data-lucide="x" class="w-3 h-3"></i>Not Successful${branchSuffix}</span>`;
  }

  /**
   * Populate task tables with validated question data
   */
  function populateTaskTables(taskValidation, mergedAnswers) {
    
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
        continue;
      }
      
      // Update task title if validation provides a merged title (e.g., "SYM / NONSYM")
      if (validation.title) {
        const titleElement = taskElement.querySelector('summary strong');
        if (titleElement) {
          titleElement.textContent = validation.title;
        }
      }
      
      // Find the table within this task
      const table = taskElement.querySelector('table');
      const tbody = table?.querySelector('tbody');
      if (!table || !tbody) {
        continue;
      }
      
      // Update table header based on task type
      const isHTKS = taskId === 'headtoekneeshoulder' || taskId === 'htks';
      const isFM = taskId === 'finemotor' || taskId === 'fm';
      
      const thead = table.querySelector('thead');
      if (thead) {
        if (isFM) {
          // Fine Motor: Remove "Correct Answer" column header
          thead.innerHTML = `
            <tr>
              <th class="text-left font-medium pb-2 px-2">Question</th>
              <th class="text-left font-medium pb-2 px-2">Student Answer</th>
              <th class="text-left font-medium pb-2 px-2" colspan="2">Result</th>
            </tr>
          `;
        } else if (isHTKS) {
          // HTKS: Change "Correct Answer" to "Score"
          thead.innerHTML = `
            <tr>
              <th class="text-left font-medium pb-2 px-2">Question</th>
              <th class="text-left font-medium pb-2 px-2">Student Answer</th>
              <th class="text-left font-medium pb-2 px-2">Score</th>
              <th class="text-left font-medium pb-2 px-2">Result</th>
            </tr>
          `;
        }
        // For other tasks, keep the default headers as-is
      }
      
      // Clear dummy data
      tbody.innerHTML = '';
      
      // Check if this is TGMD task with special scoring
      if (taskId === 'tgmd') {
        if (!validation.tgmdScoring) {
          console.warn('[StudentPage] ⚠️ TGMD task found but tgmdScoring is missing!');
          // Show error message in table using helper
          showTableError(tbody, {
            title: 'TGMD Data Not Available',
            description: 'TGMD scoring data could not be loaded. Please check if the student has completed this assessment.'
          });
          continue;
        }
        
        
        // Render TGMD with grouped task display
        renderTGMDResults(tbody, validation.tgmdScoring, taskElement, validation);
        
        // Update task summary with TGMD-specific stats
        updateTaskSummary(taskElement, taskId, {
          total: validation.totalQuestions,
          answered: validation.answeredQuestions,
          correct: validation.tgmdScoring.totalScore,
          scoredTotal: validation.tgmdScoring.maxScore,
          answeredPercent: validation.totalQuestions > 0 
            ? Math.round((validation.answeredQuestions / validation.totalQuestions) * 100) 
            : 0,
          correctPercent: validation.tgmdScoring.maxScore > 0
            ? Math.round((validation.tgmdScoring.totalScore / validation.tgmdScoring.maxScore) * 100)
            : 0,
          percentage: validation.completionPercentage
        });
        
        updateTaskLightingStatus(taskElement, {
          total: validation.totalQuestions,
          answered: validation.answeredQuestions,
          answeredPercent: validation.totalQuestions > 0 
            ? Math.round((validation.answeredQuestions / validation.totalQuestions) * 100) 
            : 0,
          correctPercent: validation.tgmdScoring.maxScore > 0
            ? Math.round((validation.tgmdScoring.totalScore / validation.tgmdScoring.maxScore) * 100)
            : 0,
          correct: validation.tgmdScoring.totalScore,
          scoredTotal: validation.tgmdScoring.maxScore,
          hasTerminated: false,
          hasPostTerminationAnswers: false,
          timedOut: false
        });
        
        
        // Skip standard rendering for TGMD
        continue;
      }
      
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
      
      // For Fine Motor: display FM_Hand as metadata (like TGMD_Leg)
      if ((taskId === 'finemotor' || taskId === 'fm') && validation && validation.questions) {
        const fmHand = validation.questions.find(q => q.id === 'FM_Hand');
        if (fmHand) {
          const handRow = document.createElement('tr');
          handRow.className = 'bg-blue-50 border-b-2 border-blue-200';
          const handAnswer = fmHand.studentAnswer || '—';
          const handAnswerDisplay = handAnswer === 'Left' ? '左手' : 
                                     handAnswer === 'Right' ? '右手' : 
                                     handAnswer === 'Undetermined' ? '未形成' : handAnswer;
          handRow.innerHTML = `
            <td colspan="3" class="py-3 px-2">
              <div class="flex items-center gap-2">
                <i data-lucide="hand" class="w-4 h-4 text-blue-600"></i>
                <span class="font-semibold text-blue-900">慣用手: ${handAnswerDisplay}</span>
              </div>
            </td>
          `;
          tbody.appendChild(handRow);
        }
      }
      
      // Populate with real questions (using reordered list)
      for (let i = 0; i < orderedQuestions.length; i++) {
        const question = orderedQuestions[i];
        
        // Skip FM_Hand since it's displayed as metadata
        if (question.id === 'FM_Hand') {
          continue;
        }
        
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
        
        let textAnswerPopover = '';
        if (question.isTextDisplay && question.textFieldStatus === 'answered') {
          const cleanTextAnswer = getNormalizedTextAnswer(mergedAnswers, question.id);

          if (cleanTextAnswer) {
            row.setAttribute('data-has-text-answer', 'true');
            const encoded = encodeURIComponent(cleanTextAnswer);
            let triggerTarget = row;

            if (!question.id.endsWith('_TEXT')) {
              textAnswerPopover = `
                <button type="button" class="text-answer-trigger" data-text-answer="${encoded}" aria-label="View typed answer" title="View typed answer">
                  <i data-lucide="copy"></i>
                </button>
              `;
              triggerTarget = null;
            }

            if (!triggerTarget) {
              row.dataset.textAnswer = encoded;
            } else {
              triggerTarget.setAttribute('data-text-answer', encoded);
            }
          }
        } else if (!question.isTextDisplay) {
          const textFieldId = question.id + '_TEXT';
          const cleanRadioText = getNormalizedTextAnswer(mergedAnswers, textFieldId);

          if (cleanRadioText) {
            row.setAttribute('data-has-text-answer', 'true');
            const encoded = encodeURIComponent(cleanRadioText);
            row.dataset.textAnswer = encoded;
            textAnswerPopover = `
              <button type="button" class="text-answer-trigger" data-text-answer="${encoded}" aria-label="View typed answer" title="View typed answer">
                <i data-lucide="copy"></i>
              </button>
            `;
          }
        }
        
        row.setAttribute('data-ignored', isIgnoredDueToTimeout ? 'true' : 'false'); // CRITICAL: Mark for calculation exclusion
        row.setAttribute('data-text-display', question.isTextDisplay ? 'true' : 'false'); // Mark _TEXT fields
        row.className = 'hover:bg-[color:var(--muted)]/30';
        
        // Determine branch information for this question (if any)
        const branchLabel = branchInfo[question.id] || '';
        let branchSuffix = '';
        if (branchLabel) {
          branchSuffix = ` (${branchLabel} Branch)`;
          row.setAttribute('data-branch', branchLabel);
        }

        const branchBadge = branchLabel ? `
          <span class="inline-flex items-center gap-1 text-[0.65rem] font-medium px-1.5 py-0.5 rounded-full border border-[color:var(--border)] bg-[color:var(--muted)]/15 text-[color:var(--primary)]" title="${branchLabel} Branch">
            <i data-lucide="git-branch" class="w-3 h-3"></i>
            <span>${branchLabel}</span>
          </span>
        ` : '';

        // Create question ID element with provenance tooltip support
        let questionIdElement = `<span class="font-mono question-id-badge" id="question-${escapeHtmlAttribute(question.id)}">${question.id}</span>`;
        
        const questionCellContent = branchBadge
          ? `<div class="flex items-center gap-2">${questionIdElement}${branchBadge}</div>`
          : questionIdElement;
        
        // Check if this is a special task that needs custom display logic
        const isHTKS = taskId === 'headtoekneeshoulder' || taskId === 'htks';
        const isFM = taskId === 'finemotor' || taskId === 'fm';
        const isCCM = taskId === 'ccm';
        
        // Determine status pill
        let statusPill;
        if (isIgnoredDueToTimeout) {
          statusPill = '<span class="answer-pill" style="background: #dbeafe; color: #1e40af; border-color: #93c5fd;"><i data-lucide="ban" class="w-3 h-3"></i>Ignored (Terminated)</span>';
        } else if (isHTKS && !question.isTextDisplay) {
          // HTKS: Use custom result pill based on score (0/1/2)
          statusPill = getHTKSResultPill(question.studentAnswer, branchSuffix);
        } else if (isFM && !question.isTextDisplay) {
          // Fine Motor: Use 7-pill system with confidence tiers
          statusPill = getFMResultPill(
            question.studentAnswer, 
            branchSuffix, 
            question.hasIncompleteData, 
            question.hasHierarchicalViolation, 
            question.hasCrossSectionViolation,
            question.crossSectionConfidence || ''
          );
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
        
        // Determine value for "Correct Answer" or "Score" column
        let correctAnswerDisplay;
        let correctAnswerColumnLabel = 'Correct Answer'; // Can be changed for special tasks
        
        if (question.isTextDisplay) {
          // _TEXT fields always show dash
          correctAnswerDisplay = '—';
        } else if (isHTKS) {
          // HTKS: Show score in x/2 format instead of correct answer
          correctAnswerDisplay = getHTKSScoreDisplay(question.studentAnswer);
        } else if (isFM) {
          // Fine Motor: No correct answer (remove column entirely - handled below)
          correctAnswerDisplay = '—';
        } else {
          // All other tasks: prefer displayCorrectAnswer → correctAnswer → fallback
          correctAnswerDisplay = question.displayCorrectAnswer ?? question.correctAnswer ?? '—';
        }
        
        // Handle special case for text-only attempts (radio blank, text filled)
        let displayStudentAnswer = question.studentAnswer === '[TEXT_ONLY_ATTEMPT]' 
          ? '—' 
          : (question.studentAnswer || '—');
        
        // CCM: Transform student answer value to Chinese character label
        if (isCCM && question.studentAnswer && !question.isTextDisplay) {
          const taskDef = taskDefinitionsCache['CCM'] || taskDefinitionsCache['ccm'];
          if (taskDef) {
            displayStudentAnswer = transformCCMAnswer(question.id, question.studentAnswer, taskDef);
          }
        }

        let studentAnswerCellHtml = `<span>${displayStudentAnswer}</span>`;
        if (textAnswerPopover) {
          studentAnswerCellHtml = `
            <div class="answer-with-peek">
              <span>${displayStudentAnswer}</span>
              ${textAnswerPopover}
            </div>
          `;
        }

        // Build row HTML based on task type
        if (isFM && !question.isTextDisplay) {
          // Fine Motor: Remove "Correct Answer" column entirely
          row.innerHTML = `
            <td class="py-2 px-2 text-[color:var(--foreground)]">${questionCellContent}</td>
            <td class="py-2 px-2 text-[color:var(--muted-foreground)]">${studentAnswerCellHtml}</td>
            <td class="py-2 px-2" colspan="2">${statusPill}</td>
          `;
        } else {
          // All other tasks: Standard 4-column layout
          row.innerHTML = `
            <td class="py-2 px-2 text-[color:var(--foreground)]">${questionCellContent}</td>
            <td class="py-2 px-2 text-[color:var(--muted-foreground)]">${studentAnswerCellHtml}</td>
            <td class="py-2 px-2 text-[color:var(--muted-foreground)]">${correctAnswerDisplay}</td>
            <td class="py-2 px-2">${statusPill}</td>
          `;
        }

        if (textAnswerPopover) {
          const triggerElement = row.querySelector('[data-text-answer]');
          if (triggerElement) {
            attachTextAnswerInteraction(triggerElement);
          }
        } else if (row.dataset.textAnswer) {
          attachTextAnswerInteraction(row);
        }

        // Attach provenance tooltip to question ID badge
        if (window.ProvenanceTooltip && currentSubmission) {
          const questionBadge = row.querySelector('.question-id-badge');
          if (questionBadge) {
            const provenance = window.ProvenanceTooltip.extractProvenance(currentSubmission, question.id);
            if (provenance) {
              window.ProvenanceTooltip.attachToElement(questionBadge, provenance);
            }
          }
        }

        tbody.appendChild(row);
      }
      
      // Calculate task statistics (excluding ignored questions)
      const taskStats = calculateTaskStatistics(validation, taskElement, taskId);
      
      // Update task summary with refined counters
      updateTaskSummary(taskElement, taskId, taskStats);
      
      // Update task lighting status
      updateTaskLightingStatus(taskElement, taskStats);
      
      // Populate termination checklist if task has termination points
      populateTerminationChecklist(taskElement, taskId, validation, mergedAnswers);
      
    }
    
    // Reinitialize Lucide icons
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  /**
   * Show "no data" message and hide task sections
   * UPDATED: Keep grade selector visible to allow switching between grades
   */
  function showNoDataMessage() {
    
    // Hide Task Status Overview section
    const taskOverview = Array.from(document.querySelectorAll('details')).find(el => 
      el.textContent.includes('Task Status Overview')
    );
    if (taskOverview) {
      taskOverview.style.display = 'none';
    }
    
    // Find Task Progress section - but DON'T hide it entirely
    const taskProgress = Array.from(document.querySelectorAll('section')).find(el => 
      el.textContent.includes('Task Progress')
    );
    
    if (taskProgress) {
      // Hide task control buttons (Expand All, Collapse All, Task Config, filter dropdown)
      const controlButtons = taskProgress.querySelectorAll('.hero-button, #task-filter');
      controlButtons.forEach(btn => {
        const parent = btn.closest('.flex');
        if (parent && !parent.querySelector('[role="group"]')) {
          // Only hide if not the grade selector container
          btn.style.display = 'none';
        }
      });
      
      // Hide the filter dropdown's parent container (but not grade selector)
      const taskFilterLabel = taskProgress.querySelector('label[for="task-filter"]');
      if (taskFilterLabel) {
        taskFilterLabel.closest('.flex.items-center.gap-2').style.display = 'none';
      }
      
      // Hide all control buttons except grade selector
      const buttons = taskProgress.querySelectorAll('button:not([id^="grade-btn"])');
      buttons.forEach(btn => {
        if (!btn.closest('[role="group"]')) {
          btn.style.display = 'none';
        }
      });
      
      // Find the task list container (div with divide-y class) and replace content
      const taskListContainer = taskProgress.querySelector('.divide-y');
      if (taskListContainer) {
        taskListContainer.innerHTML = `
          <div class="p-8 text-center">
            <i data-lucide="inbox" class="w-12 h-12 mx-auto text-[color:var(--muted-foreground)] mb-4"></i>
            <h3 class="text-lg font-semibold mb-2">No Submissions Found</h3>
            <p class="text-[color:var(--muted-foreground)]">This student hasn't submitted any assessment data for ${selectedGrade} yet. Try switching grades above.</p>
          </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
      
    }
  }

  /**
   * Build Task Progress section dynamically from survey-structure.json
   * Filters out hidden tasks from systemConfig.hiddenTasks
   */
  async function buildTaskProgressSection() {
    
    try {
      // Load survey structure
      const structureResponse = await fetch('assets/tasks/survey-structure.json');
      const surveyStructure = await structureResponse.json();
      
      // Get hidden tasks from config (case-insensitive)
      const hiddenTasks = (systemConfig?.hiddenTasks || []).map(t => t.toLowerCase());
      
      // Filter out hidden tasks from survey structure
      if (hiddenTasks.length > 0) {
        surveyStructure.sets = surveyStructure.sets.map(set => ({
          ...set,
          sections: set.sections.filter(section => {
            const taskName = section.file.replace('.json', '').toLowerCase();
            return !hiddenTasks.includes(taskName);
          })
        }));
      }
      
      // Sort sets by order
      const sortedSets = surveyStructure.sets.sort((a, b) => a.order - b.order);
      
      
      // Get student gender for conditional visibility (TEC_Male vs TEC_Female)
      // Normalize gender values: "M" / "m" / "Male" -> "male", "F" / "f" / "Female" -> "female"
      let studentGender = studentData?.gender?.toLowerCase() || null;
      if (studentGender === 'm') studentGender = 'male';
      if (studentGender === 'f') studentGender = 'female';
      
      
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
      
      
      // Clear existing hardcoded content (including "Set 1: 第一組" header)
      taskProgressContainer.innerHTML = '';
      
      // Create a NEW divide-y container for our dynamic content
      const dynamicContainer = document.createElement('div');
      dynamicContainer.className = 'divide-y divide-[color:var(--border)] bg-[color:var(--muted)]/20';
      taskProgressContainer.appendChild(dynamicContainer);
      
      // Build each set
      for (const set of sortedSets) {
        
        // Sort sections within set
        const sortedSections = set.sections.sort((a, b) => a.order - b.order);
        
        // Filter sections based on visibility conditions and merge NONSYM with SYM
        const visibleSections = [];
        const mergedTasks = new Set(); // Track tasks that have been merged
        
        for (const section of sortedSections) {
          // Check visibility conditions (e.g., gender-based)
          if (section.showIf) {
            if (section.showIf.gender && section.showIf.gender !== studentGender) {
              continue;
            }
          }
          
          // Load task metadata (title)
          const taskId = section.file.replace('.json', '');
          const taskMetadata = await loadTaskMetadata(taskId);
          
          // Check if this task should be merged with another (e.g., NONSYM with SYM)
          if (taskMetadata.displayWith) {
            // Skip this task as it will be merged with its parent
            mergedTasks.add(taskId);
            continue;
          }
          
          visibleSections.push({
            ...section,
            metadata: taskMetadata
          });
        }
        
        
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
      
      // Add E-Prime section (Set 5)
      await renderEPrimeSection(dynamicContainer);
      
      
      // Reinitialize Lucide icons
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
      
    } catch (error) {
      console.error('[StudentPage] Failed to build Task Progress:', error);
    }
  }

  /**
   * Render E-Prime section showing individual task completion status
   */
  async function renderEPrimeSection(container) {
    try {
      // Load E-Prime config from system config
      const configResponse = await fetch('config/checking_system_config.json');
      const config = await configResponse.json();
      const eprimeTasks = config?.eprime?.tasks || [];
      
      if (eprimeTasks.length === 0) {
        return;
      }
      
      // Load jotform questions for field mapping
      const questionsResponse = await fetch('assets/jotformquestions.json');
      const jotformQuestions = await questionsResponse.json();
      
      // Get merged answers from sessionStorage cache (where student page stores them)
      // The cache key format is: student_jotform_{coreId}
      const urlParams = new URLSearchParams(window.location.search);
      const coreId = urlParams.get('coreId');
      const cacheKey = `${systemConfig?.cache?.sessionStorageKeyPrefix || 'student_jotform_'}${coreId}`;
      let mergedAnswers = {};
      
      try {
        const cachedData = sessionStorage.getItem(cacheKey);
        if (cachedData) {
          const parsed = JSON.parse(cachedData);
          mergedAnswers = parsed.mergedAnswers || {};
        }
      } catch (e) {
        console.warn('[StudentPage] E-Prime: Failed to load from cache:', e);
      }
      
      // Calculate E-Prime status for each task
      let completedCount = 0;
      const taskStatuses = eprimeTasks.map(task => {
        const qid = jotformQuestions[task.doneField];
        // mergedAnswers stores objects: { name: "EPrime_NL_Done", answer: "1" }
        const answerObj = mergedAnswers[task.doneField] || (qid ? mergedAnswers[`q${qid}`] : null);
        const value = answerObj?.answer || answerObj; // Handle both object and raw value formats
        const done = value === '1' || value === 1 || value === true || value === 'true';
        if (done) completedCount++;
        return { ...task, done };
      });
      
      // Create E-Prime set container
      const setContainer = document.createElement('details');
      setContainer.className = 'set-group border-b border-[color:var(--border)]';
      setContainer.setAttribute('data-set-id', 'set5');
      
      // Determine status color
      let statusColor = 'status-grey';
      let statusText = 'Not Started';
      if (completedCount === eprimeTasks.length) {
        statusColor = 'status-green';
        statusText = 'Complete';
      } else if (completedCount > 0) {
        statusColor = 'status-red';
        statusText = 'Incomplete';
      }
      
      // Create set header - match Set 1-4 styling
      const setHeader = document.createElement('summary');
      setHeader.className = 'set-header px-4 py-3 bg-[color:var(--muted)]/40 cursor-pointer hover:bg-[color:var(--muted)]/60 transition-colors flex items-center justify-between';
      
      setHeader.innerHTML = `
        <div class="flex items-center gap-3">
          <i data-lucide="chevron-right" class="w-4 h-4 text-[color:var(--muted-foreground)] transition-transform set-chevron"></i>
          <h3 class="text-sm font-semibold text-[color:var(--foreground)]">E-Prime</h3>
          <span class="set-task-count text-xs text-[color:var(--muted-foreground)] font-mono">${completedCount}/${eprimeTasks.length} tasks</span>
        </div>
        <div class="flex items-center gap-2">
           <span class="status-circle ${statusColor}" title="${statusText}"></span>
        </div>
      `;
      setContainer.appendChild(setHeader);
      
      // Create tasks container
      const tasksContainer = document.createElement('div');
      tasksContainer.className = 'set-tasks divide-y divide-[color:var(--border)] bg-white';
      
      // Add each E-Prime task - MATCHING STANDARD TASK LAYOUT (Flex)
      for (const task of taskStatuses) {
        const taskElement = document.createElement('div');
        taskElement.className = 'eprime-task task-item px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors';
        
        const taskStatusColor = task.done ? 'status-green' : 'status-grey';
        const taskStatusText = task.done ? 'Complete' : 'Not Started';
        
        taskElement.innerHTML = `
          <div class="flex items-center gap-3">
            <span class="status-circle ${taskStatusColor}" title="${taskStatusText}"></span>
            <span class="text-sm font-medium text-[color:var(--foreground)]">${task.name}</span>
          </div>
          <div class="flex items-center gap-2">
             <span class="badge-pill ${task.done ? 'bg-emerald-100 text-emerald-700' : 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)]'}">${task.done ? '✓ Complete' : 'Not Started'}</span>
          </div>
        `;
        
        tasksContainer.appendChild(taskElement);
      }
      
      setContainer.appendChild(tasksContainer);
      container.appendChild(setContainer);
      
      // Add toggle listener for chevron
      setContainer.addEventListener('toggle', () => {
        const chevron = setHeader.querySelector('.set-chevron');
        if (chevron) {
          chevron.style.transform = setContainer.open ? 'rotate(90deg)' : 'rotate(0deg)';
        }
      });
      
    } catch (error) {
      console.error('[StudentPage] Failed to render E-Prime section:', error);
    }
  }

  /**
   * Update E-Prime section with actual merged data (called after JotForm data loads)
   */
  async function updateEPrimeSection(mergedAnswers) {
    try {
      // Load E-Prime config
      const configResponse = await fetch('config/checking_system_config.json');
      const config = await configResponse.json();
      const eprimeTasks = config?.eprime?.tasks || [];
      
      if (eprimeTasks.length === 0) return;
      
      // Load jotform questions for field mapping
      const questionsResponse = await fetch('assets/jotformquestions.json');
      const jotformQuestions = await questionsResponse.json();
      
      // Calculate completion status
      let completedCount = 0;
      const taskStatuses = eprimeTasks.map(task => {
        const qid = jotformQuestions[task.doneField];
        const answerObj = mergedAnswers[task.doneField] || (qid ? mergedAnswers[`q${qid}`] : null);
        const value = answerObj?.answer || answerObj;
        const done = value === '1' || value === 1 || value === true || value === 'true';
        if (done) completedCount++;
        return { ...task, done };
      });
      
      
      // Find existing E-Prime section
      const existingSection = document.querySelector('[data-set-id="set5"]');
      if (!existingSection) {
        console.warn('[StudentPage] E-Prime section not found for update');
        return;
      }
      
      // Determine set status color
      let statusColor = 'status-grey';
      let statusText = 'Not Started';
      if (completedCount === eprimeTasks.length) {
        statusColor = 'status-green';
        statusText = 'Complete';
      } else if (completedCount > 0) {
        statusColor = 'status-red';
        statusText = 'Incomplete';
      }

      // Update header status circle
      // The header HTML structure was updated in renderEPrimeSection to include a status circle div
      // We need to find it or recreate it if structure mismatches (though render and update should match)
      const headerStatusContainer = existingSection.querySelector('.set-header > div:last-child');
      if (headerStatusContainer) {
         const headerStatusCircle = headerStatusContainer.querySelector('.status-circle');
         if (headerStatusCircle) {
             headerStatusCircle.className = `status-circle ${statusColor}`;
             headerStatusCircle.title = statusText;
         }
      }

      // Update task count in header
      const taskCountSpan = existingSection.querySelector('.set-task-count');
      if (taskCountSpan) {
        taskCountSpan.textContent = `${completedCount}/${eprimeTasks.length} tasks`;
      }
      
      // Re-render task list completely to ensure structure match (simpler than DOM patching for structure change)
      const tasksContainer = existingSection.querySelector('.set-tasks');
      if (tasksContainer) {
          tasksContainer.innerHTML = ''; // Clear current tasks
          
          for (const task of taskStatuses) {
            const taskElement = document.createElement('div');
            // Match the Flex layout from renderEPrimeSection
            taskElement.className = 'eprime-task task-item px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors';
            
            const taskStatusColor = task.done ? 'status-green' : 'status-grey';
            const taskStatusText = task.done ? 'Complete' : 'Not Started';
            
            taskElement.innerHTML = `
              <div class="flex items-center gap-3">
                <span class="status-circle ${taskStatusColor}" title="${taskStatusText}"></span>
                <span class="text-sm font-medium text-[color:var(--foreground)]">${task.name}</span>
              </div>
              <div class="flex items-center gap-2">
                 <span class="badge-pill ${task.done ? 'bg-emerald-100 text-emerald-700' : 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)]'}">${task.done ? '✓ Complete' : 'Not Started'}</span>
              </div>
            `;
            
            tasksContainer.appendChild(taskElement);
          }
      }
      
    } catch (error) {
      console.error('[StudentPage] Failed to update E-Prime section:', error);
    }
  }
  
  /**
   * Load task metadata (title, etc.) from task JSON file
   * Also caches the full task definition for options mapping
   */
  async function loadTaskMetadata(taskId) {
    try {
      const response = await fetch(`assets/tasks/${taskId}.json`);
      const taskData = await response.json();
      
      // Cache the full task definition for later use
      taskDefinitionsCache[taskId] = taskData;
      taskDefinitionsCache[taskData.id || taskId.toLowerCase()] = taskData;
      
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
    
    // Special handling for SYM: show timeout status instead of termination rules
    if (taskId === 'sym') {
      const checklistDiv = taskElement.querySelector('.termination-checklist');
      const rulesContainer = taskElement.querySelector('.termination-rules');
      
      if (!checklistDiv || !rulesContainer) return;
      
      // Get detailed analysis
      const symAnalysis = validation.symAnalysis || {};
      const nonsymAnalysis = validation.nonsymAnalysis || {};
      
      
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
      if (typeof lucide !== 'undefined') lucide.createIcons(); // Re-render icons
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
      
      // CWR_10Incorrect is a LEGACY field that is NEVER recorded in JotForm
      // We SKIP mismatch detection and ONLY check for post-termination answers
      const calculatedTerminated = terminated; // validation.terminated already calculated this
      
      // Check for post-termination questions (the ONLY yellow/orange condition for CWR)
      let hasPostTerminationAnswers = false;
      if (calculatedTerminated) {
        for (let i = terminationIndex + 1; i < validation.questions.length; i++) {
          if (validation.questions[i].studentAnswer !== null) {
            hasPostTerminationAnswers = true;
            break;
          }
        }
      }
      
      // Card styling: ORANGE only for post-termination answers, GREEN otherwise
      // Note: Mis-termination (stopped early without 10 consecutive wrongs) is detected
      // by incomplete status (red circle) rather than termination card
      let statusClass;
      let statusColor;
      if (hasPostTerminationAnswers) {
        // Data quality issue: Answered questions AFTER termination point
        statusClass = 'border-orange-400 bg-orange-50';
        statusColor = 'text-orange-600';
      } else {
        // Proper termination (10 consecutive wrongs, no post-answers) OR no termination - GREEN
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
            <div class="flex items-center gap-1.5 ${hasPostTerminationAnswers ? 'text-orange-600' : 'text-green-600'}">
              <i data-lucide="${hasPostTerminationAnswers ? 'alert-triangle' : 'check-circle'}" class="w-3.5 h-3.5"></i>
              <span>${hasPostTerminationAnswers ? 'Data quality issue detected' : 'No data quality issues'}</span>
            </div>
          </div>
        </div>
      `;
      
      checklistDiv.classList.remove('hidden');
      if (typeof lucide !== 'undefined') lucide.createIcons(); // Re-render icons
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
      return; // No termination rules for this task
    }
    
    
    const checklistDiv = taskElement.querySelector('.termination-checklist');
    const rulesContainer = taskElement.querySelector('.termination-rules');
    
    if (!checklistDiv || !rulesContainer) {
      console.warn(`[StudentPage] Termination elements not found for ${taskId}:`, {
        checklistDiv: !!checklistDiv,
        rulesContainer: !!rulesContainer
      });
      return;
    }
    
    
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
    
    // Use hasPostTerminationAnswers from validation (calculated by task-validator.js)
    // This ensures consistency with class page and avoids redundant calculation
    const hasPostTerminationAnswers = validation?.hasPostTerminationAnswers || false;
    if (hasPostTerminationAnswers) {
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
      
    }
    
    if (ignoredQuestionIds.size > 0) {
      markQuestionsBeyondTermination(taskElement, ignoredQuestionIds);
      
      // CRITICAL: Recalculate statistics after marking questions as ignored
      const updatedStats = calculateTaskStatistics(validation, taskElement, taskId);
      updateTaskSummary(taskElement, taskId, updatedStats);
      updateTaskLightingStatus(taskElement, updatedStats);
    }
    
    // Show the checklist
    checklistDiv.classList.remove('hidden');
    
    // Reinitialize Lucide icons for the new elements
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  /**
   * Calculate task statistics excluding ignored questions
   * @param {Object} validation - Task validation result from TaskValidator
   * @param {HTMLElement} taskElement - Task DOM element
   * @param {string} taskId - Task ID
   * @returns {Object} Statistics including total, answered, correct, hasTerminated, timedOut, etc.
   * 
   * CRITICAL: Uses hasPostTerminationAnswers from validation object (task-validator.js) to ensure
   * consistency between student page and class page status indicators.
   * 
   * Special handling for HTKS: Uses scoring system (0/1/2) instead of binary correct/incorrect
   */
  function calculateTaskStatistics(validation, taskElement, taskId) {
    const tbody = taskElement.querySelector('table tbody');
    const rows = tbody ? tbody.querySelectorAll('tr[data-state]') : [];
    
    // Check if this is HTKS task (uses scoring system)
    const isHTKS = taskId === 'headtoekneeshoulder' || taskId === 'htks';
    
    let total = 0;
    let answered = 0;
    let correct = 0;
    let scoredTotal = 0; // Questions that have a correct answer (or max possible score for HTKS)
    let scoredAnswered = 0;
    let hasTerminated = false;
    
    rows.forEach(row => {
      const isIgnored = row.getAttribute('data-ignored') === 'true';
      const isTextDisplay = row.getAttribute('data-text-display') === 'true';
      
      if (isIgnored) {
        hasTerminated = true;
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
      
      // Special handling for HTKS: accumulate scores instead of binary correct/incorrect
      if (isHTKS) {
        // For HTKS, get the actual score value from the validation data
        // Find the question in validation.questions by extracting question ID from the row
        const questionIdCell = row.querySelector('td:first-child');
        if (questionIdCell) {
          const questionIdSpan = questionIdCell.querySelector('.font-mono') || questionIdCell.querySelector('span');
          const questionId = questionIdSpan ? questionIdSpan.textContent.trim() : null;
          
          if (questionId && validation && validation.questions) {
            const question = validation.questions.find(q => q.id === questionId);
            if (question && !isMissing) {
              // Get the score value (0, 1, or 2)
              const score = parseInt(question.studentAnswer, 10) || 0;
              correct += score; // Accumulate score
            }
          }
        }
        
        // For HTKS, scoredTotal is number of questions × 2 (max score per question)
        if (!isUnscored) {
          scoredTotal += 2; // Each HTKS question has max score of 2
          if (!isMissing) {
            scoredAnswered++;
          }
        }
      } else {
        // Standard binary correct/incorrect logic for other tasks
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
      }
    });
    
    // CRITICAL: Use hasPostTerminationAnswers and hasTerminationMismatch from validation object (calculated by task-validator.js)
    // This ensures consistency with class page which also uses task-validator.js results
    const hasPostTerminationAnswers = validation?.hasPostTerminationAnswers || false;
    const hasTerminationMismatch = validation?.hasTerminationMismatch || false;
    
    return {
      total,
      answered,
      correct,
      scoredTotal,
      scoredAnswered,
      hasTerminated,
      hasPostTerminationAnswers,
      hasTerminationMismatch,
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
    
  }

  /**
   * Update task lighting status (colored circle indicator)
   * 
   * NOTE: For TGMD matrix-radio questions, "0" (Not-Observed) is a COMPLETE answer.
   * It means the assessor observed the student and marked that they DIDN'T demonstrate
   * that specific criterion. This is different from null/empty which means "not assessed".
   * 
   * Status logic:
   * - Green: 100% answered (including 0 values for TGMD "Not-Observed"), OR properly terminated/timed out
   * - Yellow: Post-termination data detected OR termination mismatch (data quality issues)
   * - Red: Partially answered (some questions missing/unanswered)
   * - Grey: Not started (no answers at all)
   */
  function updateTaskLightingStatus(taskElement, stats) {
    const statusCircle = taskElement.querySelector('.status-circle');
    if (!statusCircle) return;
    
    // Get task ID for logging
    const taskId = taskElement.getAttribute('data-task-id');
    
    // Remove all status classes
    statusCircle.className = 'status-circle';
    
    // Determine status based on completion and termination
    if (stats.total === 0) {
      // No data yet
      statusCircle.classList.add('status-grey');
      statusCircle.title = 'Not started';
    } else if (stats.hasPostTerminationAnswers || stats.hasTerminationMismatch) {
      // Yellow: Post-termination data OR termination mismatch detected (data quality issue)
      // Yellow indicates EITHER post-termination activity OR termination mismatch
      statusCircle.classList.add('status-yellow');
      statusCircle.title = 'Post-termination data or termination mismatch detected';
    } else if ((stats.hasTerminated || stats.timedOut) && stats.answered > 0) {
      // Green: Properly terminated/timed out (NO post-termination answers)
      statusCircle.classList.add('status-green');
      statusCircle.title = stats.timedOut ? 'Timed out correctly' : 'Terminated correctly';
    } else if (stats.answeredPercent === 100 && !stats.hasTerminated && !stats.timedOut) {
      // Green: Complete - all questions answered, no termination/timeout
      // For TGMD: This includes questions answered with "0" (Not-Observed) - these are complete assessments
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
      try {
        const lastSyncTimestamp = localStorage.getItem(syncKey);
        
        if (lastSyncTimestamp) {
          const syncDate = new Date(lastSyncTimestamp);
          const formattedDate = syncDate.toLocaleString('en-HK', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
          syncElement.textContent = `Last Updated · ${formattedDate}`;
        }
      } catch (storageError) {
        console.warn('[StudentPage] Could not access localStorage for sync timestamp:', storageError.message);
        // Keep default text if storage is not accessible
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
          // Get student-id from answers using the constant from JotFormCache
          const studentIdAnswer = sub.answers?.[window.JotFormCache.STUDENT_ID_QID];
          const studentId = studentIdAnswer?.answer || studentIdAnswer?.text || '';
          
          // Match Core ID (remove "C" prefix if present)
          const numericCoreId = coreId.startsWith('C') ? coreId.substring(1) : coreId;
          return studentId === numericCoreId;
        });
        
        if (studentSubmissions.length === 0) {
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
    
  }
  
  /**
   * Update task counts for each Set based on visible tasks and hide empty Sets
   */
  function updateSetTaskCounts() {
    const allSets = document.querySelectorAll('.set-group');
    const taskFilter = document.getElementById('task-filter');
    const currentFilter = taskFilter ? taskFilter.value : 'all';
    
    allSets.forEach(setElement => {
      // Skip E-Prime section (set5) - it uses .task-item not .task-expand
      // and should always be visible
      const setId = setElement.getAttribute('data-set-id');
      if (setId === 'set5') {
        setElement.style.display = ''; // Always show E-Prime
        return;
      }
      
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
    } else {
    }
    
  }

  /**
   * Setup UI button handlers
   * Note: Called after init() completes, so all DOM elements (tasks, sets) are fully rendered
   */
  function setupUIHandlers() {
    // Extract coreId once at the beginning for all handlers
    const urlParams = new URLSearchParams(window.location.search);
    const coreId = urlParams.get('coreId');
    
    // Back button - navigate to previous page
    const backButton = document.getElementById('back-button');
    if (backButton) {
      backButton.addEventListener('click', () => {
        window.history.back();
      });
    }
    
    // Task view filter dropdown
    const taskFilter = document.getElementById('task-filter');
    if (taskFilter) {
      // Restore saved filter preference
      // Safe to call applyTaskFilter here since task DOM elements are already rendered
      if (window.CheckingSystemPreferences && coreId) {
        const savedFilter = window.CheckingSystemPreferences.getTaskFilter(coreId);
        if (savedFilter) {
          taskFilter.value = savedFilter;
          applyTaskFilter(savedFilter);
        }
      }
      
      taskFilter.addEventListener('change', (e) => {
        const filterValue = e.target.value;
        applyTaskFilter(filterValue);
        
        // Save filter preference
        if (window.CheckingSystemPreferences && coreId) {
          window.CheckingSystemPreferences.saveTaskFilter(coreId, filterValue);
        }
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
        } else if (anyTaskOpen) {
          // Smart: If any task is open, expand all tasks
          allTasks.forEach(task => task.open = true);
        } else {
          // Level 2: Expand all tasks (show questions)
          allTasks.forEach(task => task.open = true);
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
        } else if (anySetsOpen) {
          // Sets are open but tasks are closed - collapse sets
          allSets.forEach(set => set.open = false);
        } else {
          // Nothing is open - do nothing
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
        break;
      }
    }
    
    // Validate button - cache validation
    const validateBtn = document.getElementById('validate-button');
    if (validateBtn) {
      validateBtn.addEventListener('click', async () => {
        
        // Debug: Check if CacheValidator is available
        if (window.CacheValidator) {
        }
        
        // Get current grade from active button
        const activeGradeBtn = document.querySelector('.grade-selector-btn.active');
        let grade = activeGradeBtn ? activeGradeBtn.dataset.grade : null;
        
        // Debug: Show what we're getting for grade
        
        // Get coreId from multiple sources with debugging
        let coreId = window.StudentPage?.currentStudent?.coreId || 
                     window.CheckingSystemStudentPage?.getStudentData()?.student?.coreId;
        
        
        // Fallback: Get coreId from URL if still not found
        if (!coreId || typeof coreId !== 'string') {
          const urlParams = new URLSearchParams(window.location.search);
          coreId = urlParams.get('coreId');
        }
        
        // Ensure coreId is a string
        if (coreId && typeof coreId !== 'string') {
          coreId = String(coreId);
        }
        
        if (!grade) {
          // Last resort: try to extract from breadcrumb
          const breadcrumb = document.querySelector('.breadcrumb-class')?.textContent.trim();
          grade = breadcrumb?.match(/K[123]/)?.[0] || 'K3';
        }
        
        if (!coreId) {
          alert(`Missing coreId parameter.\n\nCurrent URL: ${window.location.href}\n\nExpected format: checking_system_4_student.html?coreId=C10993&year=K3`);
          return;
        }
        
        if (!grade) {
          alert(`Missing year parameter.\n\nCurrent URL: ${window.location.href}\n\nExpected format: checking_system_4_student.html?coreId=C10993&year=K3`);
          return;
        }
        
        
        try {
          validateBtn.disabled = true;
          validateBtn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 flex-shrink-0 animate-spin"></i><span>Validating...</span>';
          if (typeof lucide !== 'undefined') lucide.createIcons();
          
          // Check if CacheValidator is available
          if (typeof window.CacheValidator === 'undefined') {
            throw new Error('CacheValidator module not loaded. Please refresh the page and try again.');
          }
          
          const validator = window.CacheValidator.create('student', { coreId, grade });
          const results = await validator.validate();
          window.CacheValidator.showResults(results);
        } catch (error) {
          console.error('[StudentPage] Validation error:', error);
          alert('Validation failed: ' + error.message);
        } finally {
          validateBtn.disabled = false;
          validateBtn.innerHTML = '<i data-lucide="shield-check" class="w-3.5 h-3.5 flex-shrink-0"></i><span>Validate</span>';
          if (typeof lucide !== 'undefined') lucide.createIcons();
        }
      });
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
   * Exports ALL available grades' data for this student
   * Uses centralized ExportUtils.exportReport orchestrator
   */
  async function exportStudentCache() {
    if (!studentData) {
      alert('No student data to export');
      return;
    }
    
    // Get all student records for this Core ID across all grades
    const coreId = studentData.coreId;
    const allStudentRecords = cachedDataGlobal?.students.filter(s => s.coreId === coreId) || [studentData];
    
    await window.ExportUtils.exportReport({
      type: 'student',
      data: { 
        studentData,  // Current selected grade
        allStudentRecords,  // All grades for this student
        availableGrades,
        selectedGrade
      },
      loadValidationCache: () => window.JotFormCache.loadValidationCache()
    });
  }

  /**
   * Show loading overlay - DISABLED (no overlay in HTML)
   */
  function showLoadingOverlay(message = 'Loading...') {
  }

  /**
   * Update loading status - DISABLED (no overlay in HTML)
   */
  function updateLoadingStatus(message) {
  }

  /**
   * Update grade selector UI based on available and selected grades
   */
  function updateGradeSelector() {
    const grades = ['K1', 'K2', 'K3'];
    
    grades.forEach(grade => {
      const btn = document.getElementById(`grade-btn-${grade.toLowerCase()}`);
      if (!btn) return;
      
      // Remove all classes first
      btn.classList.remove('active', 'disabled');
      
      if (!availableGrades.includes(grade)) {
        // Grade not available for this student
        btn.classList.add('disabled');
        btn.disabled = true;
      } else {
        btn.disabled = false;
        if (grade === selectedGrade) {
          btn.classList.add('active');
        }
      }
    });
  }

  /**
   * Select a different grade for viewing
   * @param {string} grade - Grade to select (K1/K2/K3)
   */
  async function selectGrade(grade) {
    if (!availableGrades.includes(grade) || grade === selectedGrade) {
      return; // Grade not available or already selected
    }

    
    // Update URL parameter without reload
    const urlParams = new URLSearchParams(window.location.search);
    const coreId = urlParams.get('coreId');
    urlParams.set('year', grade);
    window.history.replaceState({}, '', `${window.location.pathname}?${urlParams}`);
    
    // Save grade preference
    if (window.CheckingSystemPreferences && coreId) {
      window.CheckingSystemPreferences.saveGradeSelection(coreId, grade);
    }
    
    // Reload student data for selected grade
    await loadStudentFromCache(coreId, cachedDataGlobal, grade);
    
    // Update breadcrumbs and profile
    updateBreadcrumbs();
    populateStudentProfile();
    
    // Reload JotForm data for this grade
    await fetchAndPopulateJotformData(coreId);
  }

  /**
   * Hide loading overlay - DISABLED (no overlay in HTML)
   */
  function hideLoadingOverlay() {
  }

  /**
   * Initialize with loading wrapper
   */
  async function initWithLoading() {
    try {
      // No loading overlay shown - cache should be ready
      await init();
      setupUIHandlers();
      
      // Initialize provenance tooltip handlers
      if (window.ProvenanceTooltip) {
        window.ProvenanceTooltip.initialize();
      }
      
      // Set up automatic section state tracking
      const urlParams = new URLSearchParams(window.location.search);
      const coreId = urlParams.get('coreId');
      if (window.CheckingSystemPreferences && coreId) {
        window.CheckingSystemPreferences.autoTrackSectionStates(coreId);
      }
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
  
  // Export grade selector for button onclick handlers
  window.StudentPage = {
    selectGrade
  };
})();
