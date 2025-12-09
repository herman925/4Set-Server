/**
 * Checking System - Class Drilldown Page
 * Shows all students in a class with their 4Set task completion status
 */

(() => {
  let cachedData = null;
  let classData = null;
  let schoolData = null;
  let students = [];
  let studentSubmissionData = new Map(); // coreId -> { submissions: [], setStatus: {}, outstanding: 0 }
  let surveyStructure = null; // Task-to-set mapping
  let taskToSetMap = new Map(); // taskKey -> setId
  let currentViewMode = 'set'; // 'set' or 'task'
  let systemConfig = null; // Checking system config for column names
  let jotformQuestions = null; // JotForm field name -> QID mapping for E-Prime detection

  /**
   * Initialize the page
   */
  async function init() {
    // Get classId from URL
    const urlParams = new URLSearchParams(window.location.search);
    const classId = urlParams.get('classId');
    
    if (!classId) {
      alert('No class specified');
      window.location.href = 'checking_system_home.html';
      return;
    }

    // Load saved view mode preference
    if (window.CheckingSystemPreferences) {
      const savedViewMode = window.CheckingSystemPreferences.getViewMode(classId);
      if (savedViewMode) {
        currentViewMode = savedViewMode;
      }
    }

    // Load system config and JotForm questions mapping
    await loadSystemConfig();
    await loadJotformQuestions();
    
    // Load cached data
    cachedData = window.CheckingSystemData?.getCachedData();
    if (!cachedData) {
      alert('Please go through home page first');
      window.location.href = 'checking_system_home.html';
      return;
    }

    // Get class data
    classData = cachedData.classIdMap.get(classId);
    if (!classData) {
      alert('Class not found');
      return;
    }

    // Get school data
    schoolData = cachedData.schoolIdMap.get(classData.schoolId);

    // Get all students in this class
    students = cachedData.students.filter(s => s.classId === classId);

    // Filter students: Only those with Core IDs
    students = students.filter(s => s.coreId && s.coreId.trim() !== '');

    // GRADE-AWARE FILTERING: Filter students by grade to match class grade
    // Class has numeric grade (1=K1, 2=K2, 3=K3), students have year label (K1/K2/K3)
    const classGradeLabel = getGradeLabel(classData.grade);
    const studentsBeforeGradeFilter = students.length;
    students = students.filter(s => s.year === classGradeLabel);

    // Load survey structure for task-to-set mapping
    await loadSurveyStructure();

    // Fetch submission data for all students from IndexedDB cache
    await fetchStudentSubmissions();

    // Render the page
    renderPage();

    // Setup export button
    setupExportButton();

    // Setup filters
    setupFilters();

    // Set up automatic section state tracking
    if (window.CheckingSystemPreferences) {
      window.CheckingSystemPreferences.autoTrackSectionStates(classId);
    }

    lucide.createIcons();
  }

  /**
   * Load system configuration
   */
  async function loadSystemConfig() {
    if (systemConfig) return systemConfig;
    
    try {
      const response = await fetch('config/checking_system_config.json');
      systemConfig = await response.json();
      return systemConfig;
    } catch (error) {
      console.error('[ClassPage] Failed to load system config:', error);
      systemConfig = { classPageTaskView: { taskColumnNames: {}, equalWidthColumns: false } };
      return systemConfig;
    }
  }

  /**
   * Load JotForm questions mapping (field name -> QID)
   */
  async function loadJotformQuestions() {
    if (jotformQuestions) return jotformQuestions;
    
    try {
      const response = await fetch('assets/jotformquestions.json');
      jotformQuestions = await response.json();
      return jotformQuestions;
    } catch (error) {
      console.error('[ClassPage] Failed to load JotForm questions:', error);
      jotformQuestions = {};
      return jotformQuestions;
    }
  }

  /**
   * Get E-Prime completion status for a student
   * Returns { completed: number, total: number, tasks: Array<{id, name, done}> }
   */
  function getEPrimeStatus(studentData) {
    const eprimeTasks = systemConfig?.eprime?.tasks || [];
    const total = eprimeTasks.length;
    
    if (!studentData?.validationCache?.mergedAnswers || !jotformQuestions) {
      return { completed: 0, total, tasks: eprimeTasks.map(t => ({ ...t, done: false })) };
    }
    
    const mergedAnswers = studentData.validationCache.mergedAnswers;
    let completed = 0;
    const tasks = [];
    
    for (const task of eprimeTasks) {
      const qid = jotformQuestions[task.doneField];
      // mergedAnswers stores objects: { name: "EPrime_NL_Done", answer: "1" }
      const answerObj = mergedAnswers[task.doneField] || (qid ? mergedAnswers[`q${qid}`] : null);
      const value = answerObj?.answer || answerObj; // Handle both object and raw value formats
      const done = value === '1' || value === 1 || value === true || value === 'true';
      
      if (done) completed++;
      tasks.push({ ...task, done });
    }
    
    return { completed, total, tasks };
  }

  /**
   * Get E-Prime status color based on completion
   * Green = all done, Red = some done, Grey = none done
   */
  function getEPrimeStatusColor(eprimeStatus) {
    if (!eprimeStatus || eprimeStatus.total === 0) return 'grey';
    if (eprimeStatus.completed === eprimeStatus.total) return 'green';
    if (eprimeStatus.completed > 0) return 'red';
    return 'grey';
  }

  /**
   * Load survey structure from tasks/survey-structure.json
   * Builds a map of task IDs to set IDs
   * Filters out hidden tasks from systemConfig.hiddenTasks
   */
  async function loadSurveyStructure() {
    try {
      const response = await fetch('assets/tasks/survey-structure.json');
      surveyStructure = await response.json();
      
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
      
      // Build task-to-set mapping
      surveyStructure.sets.forEach(set => {
        set.sections.forEach(section => {
          // Extract task name from filename (e.g., "ERV.json" -> "ERV")
          const taskName = section.file.replace('.json', '');
          const taskKey = taskName.toLowerCase();
          taskToSetMap.set(taskKey, set.id);
          
          // Also map aliases if available
          const metadata = surveyStructure.taskMetadata[taskName];
          if (metadata && metadata.aliases) {
            metadata.aliases.forEach(alias => {
              taskToSetMap.set(alias.toLowerCase(), set.id);
            });
          }
        });
      });
      
      // Map special merged tasks (e.g., NONSYM is displayed with SYM but needs to be in the map)
      // Map to set1 but will be ignored in counting since SYM already represents both
      taskToSetMap.set('nonsym', 'set1');
    } catch (error) {
      console.error('[ClassPage] Failed to load survey structure:', error);
      throw error; // Stop execution if structure can't load
    }
  }

  /**
   * Fetch and analyze submissions for all students from IndexedDB cache
   * Uses validation cache for accurate completion status
   */
  async function fetchStudentSubmissions() {
    if (!window.JotFormCache) {
      console.warn('[ClassPage] JotForm cache not available');
      return;
    }

    try {
      // VALIDATION ARCHITECTURE NOTE:
      // The class page uses JotFormCache.buildStudentValidationCache() which internally
      // calls TaskValidator.validateAllTasks() for each student. This ensures that
      // class-level aggregation uses the SAME validation logic as the student page.
      //
      // The validation cache:
      // 1. Merges submissions for each student (earliest wins)
      // 2. Calls TaskValidator for accurate validation
      // 3. Calculates set completion status
      // 4. Handles gender-conditional tasks (TEC_Male vs TEC_Female)
      // 5. Caches results in IndexedDB for performance
      //
      // Result: Class-level metrics are aggregated from individual student validations
      // using the exact same rules as the student drilldown page.
      const validationCache = await window.JotFormCache.buildStudentValidationCache(
        students,
        surveyStructure,
        {
          formId: cachedData.credentials?.jotformFormId,
          apiKey: cachedData.credentials?.jotformApiKey
        }
      );
      
      // Convert validation cache to studentSubmissionData format
      // Cache uses composite keys like "C1234_K3" (coreId_grade).
      // Store with the SAME composite key so lookups match.
      for (const [cacheKey, cache] of validationCache.entries()) {
        if (cache.error) {
          console.warn(`[ClassPage] Validation error for ${cacheKey}:`, cache.error);
          continue;
        }
        
        studentSubmissionData.set(cacheKey, {
          submissions: cache.submissions,
          setStatus: convertSetStatus(cache.setStatus),
          outstanding: calculateOutstanding(cache.setStatus),
          validationCache: cache  // Store full cache for future use
        });
      }
    } catch (error) {
      console.error('[ClassPage] Error building validation cache:', error);
    }
  }

  /**
   * Convert validation cache set status to class page format
   * By Set view: green (complete), red (incomplete), grey (not started) - NO yellow
   */
  function convertSetStatus(setStatus) {
    const result = {};
    for (const setId in setStatus) {
      const set = setStatus[setId];
      // Map status to color codes
      if (set.status === 'complete') {
        result[setId] = 'green';
      } else if (set.status === 'incomplete') {
        result[setId] = 'red';  // Changed from orange to red - no yellow in By Set view
      } else {
        result[setId] = 'grey';
      }
    }
    return result;
  }

  /**
   * Calculate outstanding task count from set status
   */
  function calculateOutstanding(setStatus) {
    if (!setStatus) return 0;
    
    let count = 0;
    ['set1', 'set2', 'set3', 'set4', 'set5'].forEach(setId => {
      if (setStatus[setId]?.status === 'incomplete') {
        count += setStatus[setId].outstandingTasks?.length || 0;
      }
    });
    
    return count;
  }

  /**
   * Render the complete page
   */
  function renderPage() {
    // Update title
    document.title = `${classData.actualClassName} · 4Set Checking System`;

    // Render breadcrumbs
    renderBreadcrumbs();

    // Render class profile
    renderClassProfile();

    // Render class metrics
    renderClassMetrics();

    // Render legend (dynamic based on view mode)
    renderLegend();

    // Render student table
    renderStudentTable();
  }

  /**
   * Render breadcrumbs (Universal pill style)
   */
  function renderBreadcrumbs() {
    const districtEl = document.querySelector('.breadcrumb-district');
    const groupEl = document.querySelector('.breadcrumb-group');
    const schoolEl = document.querySelector('.breadcrumb-school');
    const classEl = document.querySelector('.breadcrumb-class');
    
    if (schoolData) {
      if (schoolData.district && districtEl) {
        districtEl.textContent = schoolData.district;
        districtEl.href = `checking_system_1_district.html?district=${encodeURIComponent(schoolData.district)}`;
      }
      
      if (schoolData.group && groupEl) {
        groupEl.textContent = `Group ${schoolData.group}`;
        groupEl.href = `checking_system_1_group.html?group=${schoolData.group}`;
      }
      
      if (schoolEl) {
        schoolEl.textContent = schoolData.schoolNameChinese;
        schoolEl.href = `checking_system_2_school.html?schoolId=${schoolData.schoolId}`;
      }
    }
    
    if (classEl) {
      classEl.textContent = classData.actualClassName;
    }
  }

  /**
   * Get display label for grade number
   */
  function getGradeLabel(gradeNumber) {
    if (gradeNumber === 1) return 'K1';
    if (gradeNumber === 2) return 'K2';
    if (gradeNumber === 3) return 'K3';
    if (gradeNumber === 0) return 'Other';
    return 'N/A';
  }

  /**
   * Render class profile section
   */
  function renderClassProfile() {
    // Add class ID in brackets next to class name
    document.getElementById('class-name').textContent = `${classData.actualClassName} (${classData.classId})`;
    document.getElementById('school-name').textContent = schoolData ? 
      `${schoolData.schoolNameChinese} · ${schoolData.schoolName}` : '';
    
    document.getElementById('class-grade').textContent = getGradeLabel(classData.grade);
    document.getElementById('teacher-name').textContent = classData.teacherNames || 'N/A';
    document.getElementById('district-name').textContent = schoolData?.district || 'N/A';
    document.getElementById('group-number').textContent = schoolData?.group || 'N/A';
  }

  /**
   * Calculate class-level set completion metrics
   */
  function calculateClassMetrics() {
    const metrics = {
      set1: { complete: 0, total: 0 },
      set2: { complete: 0, total: 0 },
      set3: { complete: 0, total: 0 },
      set4: { complete: 0, total: 0 },
      set5: { complete: 0, total: 0 }
    };

    // Aggregate completion status from student submission data
    for (const student of students) {
      const cacheKey = `${student.coreId}_${student.year || 'Unknown'}`;
      const data = studentSubmissionData.get(cacheKey);
      if (!data || data.validationCache?.error) continue;

      // Count set completion for each student
      for (const setId of ['set1', 'set2', 'set3', 'set4', 'set5']) {
        metrics[setId].total++;
        const setStatus = data.validationCache?.setStatus[setId];
        if (setStatus && setStatus.status === 'complete') {
          metrics[setId].complete++;
        }
      }
    }

    return metrics;
  }

  /**
   * Render class metrics - both set-level and additional statistics
   */
  function renderClassMetrics() {
    const totalStudents = students.length;
    const studentsWithData = studentSubmissionData.size;
    const studentsWithoutData = totalStudents - studentsWithData;

    // Render additional statistics
    document.getElementById('total-students').textContent = totalStudents;
    document.getElementById('students-with-data').textContent = studentsWithData;
    document.getElementById('students-without-data').textContent = studentsWithoutData;
    
    // Calculate data coverage percentage
    const dataPercentage = totalStudents > 0 ? 
      Math.round((studentsWithData / totalStudents) * 100) : 0;
    document.getElementById('data-percentage').textContent = `${dataPercentage}%`;

    // Calculate and display set-level completion metrics
    const classMetrics = calculateClassMetrics();
    for (const setId of ['set1', 'set2', 'set3', 'set4']) {
      const metric = classMetrics[setId];
      const percentage = metric.total > 0 ? Math.round((metric.complete / metric.total) * 100) : 0;
      document.getElementById(`${setId}-completion`).textContent = `${percentage}%`;
      document.getElementById(`${setId}-count`).textContent = `${metric.complete}/${metric.total}`;
    }
    
    // Calculate and display E-Prime completion metrics
    const eprimeMetrics = calculateEPrimeClassMetrics();
    const eprimePercentage = eprimeMetrics.total > 0 ? Math.round((eprimeMetrics.complete / eprimeMetrics.total) * 100) : 0;
    const eprimeCompletionEl = document.getElementById('eprime-completion');
    const eprimeCountEl = document.getElementById('eprime-count');
    if (eprimeCompletionEl) eprimeCompletionEl.textContent = `${eprimePercentage}%`;
    if (eprimeCountEl) eprimeCountEl.textContent = `${eprimeMetrics.complete}/${eprimeMetrics.total}`;
  }
  
  /**
   * Calculate E-Prime completion metrics for the class
   * @returns {{ complete: number, total: number }} Number of students with all E-Prime tasks complete
   */
  function calculateEPrimeClassMetrics() {
    let complete = 0;
    let total = 0;
    
    for (const student of students) {
      // Use composite key matching studentSubmissionData format (coreId_year)
      const cacheKey = `${student.coreId}_${student.year || 'Unknown'}`;
      const data = studentSubmissionData.get(cacheKey);
      if (!data) continue;
      
      total++;
      const eprimeStatus = getEPrimeStatus(data);
      if (eprimeStatus.completed === eprimeStatus.total && eprimeStatus.total > 0) {
        complete++;
      }
    }
    
    return { complete, total };
  }

  /**
   * Setup filter functionality
   */
  function setupFilters() {
    const filterSelect = document.getElementById('student-view-filter');
    if (filterSelect) {
      filterSelect.addEventListener('change', () => {
        renderStudentTable();
      });
    }
    
    // Setup view mode toggle buttons
    const viewBySetBtn = document.getElementById('view-by-set-btn');
    const viewByTaskBtn = document.getElementById('view-by-task-btn');
    const viewByMissingBtn = document.getElementById('view-by-missing-btn');
    
    if (viewBySetBtn && viewByTaskBtn) {
      // Extract classId once for both event handlers
      const urlParams = new URLSearchParams(window.location.search);
      const classId = urlParams.get('classId');
      
      viewBySetBtn.addEventListener('click', () => {
        currentViewMode = 'set';
        updateViewModeButtons();
        renderStudentTable();
        
        // Save preference
        if (window.CheckingSystemPreferences && classId) {
          window.CheckingSystemPreferences.saveViewMode(classId, 'set');
        }
      });
      
      viewByTaskBtn.addEventListener('click', () => {
        currentViewMode = 'task';
        updateViewModeButtons();
        renderStudentTable();
        
        // Save preference
        if (window.CheckingSystemPreferences && classId) {
          window.CheckingSystemPreferences.saveViewMode(classId, 'task');
        }
      });

      if (viewByMissingBtn && filterSelect) {
        viewByMissingBtn.addEventListener('click', () => {
            // Toggle 'incomplete' filter
            const isCurrentlyMissing = filterSelect.value === 'incomplete';
            filterSelect.value = isCurrentlyMissing ? 'all' : 'incomplete';
            
            // Trigger change event manually to update table
            filterSelect.dispatchEvent(new Event('change'));
            updateViewModeButtons();
        });
      }
    }
    
    // Apply initial button styles based on restored view mode
    updateViewModeButtons();
  }
  
  /**
   * Update view mode button styles
   */
  function updateViewModeButtons() {
    const viewBySetBtn = document.getElementById('view-by-set-btn');
    const viewByTaskBtn = document.getElementById('view-by-task-btn');
    const missingViewToggle = document.getElementById('missing-view-toggle');
    const viewByMissingBtn = document.getElementById('view-by-missing-btn');
    const filterSelect = document.getElementById('student-view-filter');
    
    if (!viewBySetBtn || !viewByTaskBtn) return;
    
    if (currentViewMode === 'set') {
      // By Set active - blue (primary)
      viewBySetBtn.classList.add('bg-[color:var(--primary)]', 'text-white', 'shadow-sm');
      viewBySetBtn.classList.remove('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--secondary)]', 'hover:text-[color:var(--secondary-foreground)]');
      
      // By Task inactive - grey with orange hover
      viewByTaskBtn.classList.remove('bg-[color:var(--primary)]', 'text-white', 'shadow-sm', 'bg-[color:var(--secondary)]', 'text-[color:var(--secondary-foreground)]');
      viewByTaskBtn.classList.add('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--secondary)]', 'hover:text-[color:var(--secondary-foreground)]');
      
      // Hide missing view toggle
      if (missingViewToggle) missingViewToggle.style.display = 'none';
    } else {
      // By Task active - orange (secondary)
      viewByTaskBtn.classList.add('bg-[color:var(--secondary)]', 'text-[color:var(--secondary-foreground)]', 'shadow-sm');
      viewByTaskBtn.classList.remove('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--secondary)]', 'hover:text-[color:var(--secondary-foreground)]');
      
      // By Set inactive - grey with blue hover
      viewBySetBtn.classList.remove('bg-[color:var(--primary)]', 'text-white', 'shadow-sm', 'bg-[color:var(--secondary)]', 'text-[color:var(--secondary-foreground)]');
      viewBySetBtn.classList.add('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--primary)]', 'hover:text-white');
      
      // Show missing view toggle
      if (missingViewToggle) missingViewToggle.style.display = 'inline-flex';
      
      // Update By Missing button style based on filter state
      if (viewByMissingBtn && filterSelect) {
          const isMissingActive = filterSelect.value === 'incomplete';
          if (isMissingActive) {
              viewByMissingBtn.classList.add('bg-amber-100', 'text-amber-700', 'border-amber-200');
              viewByMissingBtn.classList.remove('text-[color:var(--muted-foreground)]');
          } else {
              viewByMissingBtn.classList.remove('bg-amber-100', 'text-amber-700', 'border-amber-200');
              viewByMissingBtn.classList.add('text-[color:var(--muted-foreground)]');
          }
      }
    }
    
    // Update legend after button styles
    renderLegend();
  }

  /**
   * Render dynamic legend based on current view mode
   */
  function renderLegend() {
    const legendContainer = document.getElementById('legend-container');
    if (!legendContainer) return;
    
    let legendHtml = '';
    
    if (currentViewMode === 'set') {
      // By Set view: 3 colors (no yellow/warning)
      legendHtml += `
        <span class="inline-flex items-center gap-1.5">
          <span class="status-circle status-green"></span>
          <span>Complete</span>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="status-circle status-red"></span>
          <span>Incomplete</span>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="status-circle status-grey"></span>
          <span>Not Started</span>
        </span>
      `;
    } else {
      // By Task view: 4 colors (includes yellow for Warning)
      legendHtml += `
        <span class="inline-flex items-center gap-1.5">
          <span class="status-circle status-green"></span>
          <span>Complete</span>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="status-circle status-yellow"></span>
          <span>Warning</span>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="status-circle status-red"></span>
          <span>Incomplete</span>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="status-circle status-grey"></span>
          <span>Not Started</span>
        </span>
      `;
    }
    
    legendContainer.innerHTML = legendHtml;
  }

  /**
   * Calculate outstanding task count from setStatus
   */
  function calculateOutstandingCount(setStatus) {
    if (!setStatus) return 0;
    
    let count = 0;
    ['set1', 'set2', 'set3', 'set4', 'set5'].forEach(setId => {
      if (setStatus[setId]?.status === 'incomplete') {
        count += setStatus[setId].outstandingTasks?.length || 0;
      }
    });
    
    return count;
  }

  /**
   * Get filtered students based on current filter selection
   */
  function getFilteredStudents() {
    const filterSelect = document.getElementById('student-view-filter');
    const filterValue = filterSelect ? filterSelect.value : 'all';
    
    let filteredStudents = [...students];
    
    switch (filterValue) {
      case 'with-data':
        // Only show students with submission data
        filteredStudents = filteredStudents.filter(s => {
          const cacheKey = `${s.coreId}_${s.year || 'Unknown'}`;
          return studentSubmissionData.has(cacheKey);
        });
        break;
      case 'incomplete':
        // Show ALL students that don't have Complete status across all 5 sets (1-4 + E-Prime)
        // This includes: students without data (not started) AND students with incomplete data
        filteredStudents = filteredStudents.filter(s => {
          const cacheKey = `${s.coreId}_${s.year || 'Unknown'}`;
          const data = studentSubmissionData.get(cacheKey);
          
          // No data = incomplete (not started = incomplete)
          if (!data) return true;
          
          // Has data - check if all 5 sets are complete
          const setStatus = data.validationCache?.setStatus;
          if (!setStatus) return true;
          
          // All sets (1-5) must be complete for student to NOT be shown
          const allSetsComplete = ['set1', 'set2', 'set3', 'set4', 'set5'].every(setId => 
            setStatus[setId] && setStatus[setId].status === 'complete'
          );
          
          // Show if NOT all complete (i.e., at least one set is incomplete or not started)
          return !allSetsComplete;
        });
        break;
      case 'all':
      default:
        // Show all students (no filtering)
        break;
    }
    
    return filteredStudents;
  }

  /**
   * Render student table with set status columns
   */
  function renderStudentTable() {
    const container = document.getElementById('students-table-container');
    
    if (!container) return;
    
    // Get filtered students based on current filter
    const filteredStudents = getFilteredStudents();
    
    if (students.length === 0) {
      container.innerHTML = `
        <div class="px-4 py-8 text-center text-[color:var(--muted-foreground)]">
          <i data-lucide="inbox" class="w-12 h-12 mx-auto mb-2 text-[color:var(--muted-foreground)]"></i>
          <p>No students with Core IDs found in this class</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }
    
    if (currentViewMode === 'set') {
      renderStudentTableBySet(container, filteredStudents);
    } else {
      renderStudentTableByTask(container, filteredStudents);
    }
    
    lucide.createIcons();
  }
  
  /**
   * Render student table in Set-by-Set view
   */
  function renderStudentTableBySet(container, filteredStudents) {
    let html = `
      <table class="min-w-full text-sm">
        <thead class="bg-[color:var(--muted)]/30 text-xs text-[color:var(--muted-foreground)]">
          <tr>
            <th class="px-4 py-3 text-left font-medium">Student Name</th>
            <th class="px-4 py-3 text-left font-medium">Student ID</th>
            <th class="px-4 py-3 text-left font-medium">Core ID</th>
            <th class="px-4 py-3 text-left font-medium">Set 1</th>
            <th class="px-4 py-3 text-left font-medium">Set 2</th>
            <th class="px-4 py-3 text-left font-medium">Set 3</th>
            <th class="px-4 py-3 text-left font-medium">Set 4</th>
            <th class="px-4 py-3 text-left font-medium">E-Prime</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[color:var(--border)]">
    `;
    
    if (filteredStudents.length === 0) {
      html += `
        <tr>
          <td colspan="8" class="px-4 py-8 text-center text-[color:var(--muted-foreground)]">
            <p>No students match the current filter</p>
          </td>
        </tr>
      `;
    } else {
      filteredStudents.forEach(student => {
        const cacheKey = `${student.coreId}_${student.year || 'Unknown'}`;
        const data = studentSubmissionData.get(cacheKey);
        const setStatus = data?.validationCache?.setStatus;
        
        // Use E-Prime specific detection (reads EPrime_*_Done fields)
        const eprimeStatus = getEPrimeStatus(data);
        const eprimeColor = getEPrimeStatusColor(eprimeStatus);
        const eprimeTooltip = eprimeStatus.tasks.map(t => `${t.name}: ${t.done ? '✓' : '✗'}`).join('\\n');
        
        html += `
          <tr class="hover:bg-[color:var(--muted)]/20 transition-colors">
            <td class="px-4 py-3">
              <a href="checking_system_4_student.html?coreId=${encodeURIComponent(student.coreId)}&year=${encodeURIComponent(student.year || student.grade || 'K3')}" 
                 class="font-medium text-[color:var(--primary)] hover:underline font-noto">
                ${student.studentName}
              </a>
            </td>
            <td class="px-4 py-3 text-xs font-mono text-[color:var(--muted-foreground)]">${student.studentId || '—'}</td>
            <td class="px-4 py-3 text-xs font-mono text-[color:var(--muted-foreground)]">${student.coreId}</td>
            ${renderSetStatus(getSetStatusColor(setStatus, 'set1'))}
            ${renderSetStatus(getSetStatusColor(setStatus, 'set2'))}
            ${renderSetStatus(getSetStatusColor(setStatus, 'set3'))}
            ${renderSetStatus(getSetStatusColor(setStatus, 'set4'))}
            <td class="px-4 py-3">
              <span class="inline-flex items-center gap-2 text-xs" title="${eprimeTooltip}">
                <span class="status-circle status-${eprimeColor}"></span>
                <span class="font-mono">${eprimeStatus.completed}/${eprimeStatus.total}</span>
              </span>
            </td>
          </tr>
        `;
      });
    }
    
    html += `
        </tbody>
      </table>
    `;
    
    container.innerHTML = html;
  }
  
  /**
   * Render student table in Task-by-Task view
   */
  function renderStudentTableByTask(container, filteredStudents) {
    // Get all tasks from survey structure in order
    // NOTE: Gender-conditional tasks (TEC_Male, TEC_Female) are merged into single "TEC" column
    const allTasks = [];
    const genderTasksProcessed = new Set();
    
    if (surveyStructure && surveyStructure.sets) {
      surveyStructure.sets.forEach(set => {
        set.sections.forEach(section => {
          const taskName = section.file.replace('.json', '');
          
          // Handle gender-conditional tasks (TEC_Male, TEC_Female)
          if (section.showIf && section.showIf.gender) {
            // Use generic name "TEC" for both male and female versions
            const baseTaskName = taskName.replace(/_Male|_Female/i, '');
            
            // Only add once (avoid duplicate TEC columns)
            if (!genderTasksProcessed.has(baseTaskName)) {
              genderTasksProcessed.add(baseTaskName);
              allTasks.push({
                name: baseTaskName,
                originalNames: [taskName], // Track original for lookup
                setId: set.id,
                order: section.order,
                isGenderConditional: true
              });
            } else {
              // Add to existing entry's originalNames
              const existing = allTasks.find(t => t.name === baseTaskName);
              if (existing && !existing.originalNames.includes(taskName)) {
                existing.originalNames.push(taskName);
              }
            }
            return;
          }
          
          // Regular tasks
          allTasks.push({
            name: taskName,
            originalNames: [taskName],
            setId: set.id,
            order: section.order,
            isGenderConditional: false
          });
        });
      });
    }

    // Add E-Prime tasks if configured
    if (systemConfig && systemConfig.eprime && systemConfig.eprime.tasks) {
      const eprimeSetId = systemConfig.eprime.setId || 'set5';
      systemConfig.eprime.tasks.forEach((task, index) => {
        allTasks.push({
          // Use task.id as the internal key; this is what taskColumnNames should map
          name: task.id,
          originalNames: [task.id],
          // Keep full name for tooltip; header label will come from taskColumnNames if provided
          displayName: task.name,
          setId: eprimeSetId,
          order: 1000 + index, // High order to put at end
          isGenderConditional: false,
          isEPrime: true
        });
      });
    }
    
    // Get column width settings from config
    const taskColumnWidth = systemConfig?.classPageTaskView?.taskColumnWidth || '120px';
    const studentNameColumnWidth = systemConfig?.classPageTaskView?.studentNameColumnWidth || '200px';
    const coreIdColumnWidth = systemConfig?.classPageTaskView?.coreIdColumnWidth || '120px';
    const useEqualWidth = systemConfig?.classPageTaskView?.equalWidthColumns !== false;
    // Prefer centralized taskLabels; fall back to legacy per-page map for backward compatibility
    const columnNames = systemConfig?.taskLabels || systemConfig?.classPageTaskView?.taskColumnNames || {};
    
    // Group tasks by set for the set header row
    const setGroups = {};
    allTasks.forEach(task => {
      if (!setGroups[task.setId]) {
        setGroups[task.setId] = [];
      }
      setGroups[task.setId].push(task);
    });
    
    // Define light background colors for each set (using permitted theme colors)
    const setColors = {
      'set1': 'rgba(43, 57, 144, 0.06)',      // Light blue (primary)
      'set2': 'rgba(141, 190, 80, 0.08)',     // Light green (success)
      'set3': 'rgba(147, 51, 234, 0.06)',     // Light purple
      'set4': 'rgba(249, 157, 51, 0.08)',     // Light orange (secondary)
      'set5': 'rgba(236, 72, 153, 0.08)'      // Light pink (E-Prime)
    };
    
    let html = `
      <table class="min-w-full text-sm">
        <thead class="bg-[color:var(--muted)]/30 text-xs text-[color:var(--muted-foreground)]">
          <!-- Set grouping row -->
          <tr class="border-b border-[color:var(--border)]">
            <th rowspan="2" class="px-4 py-3 text-left font-medium sticky left-0 bg-white z-20" style="width: ${studentNameColumnWidth}; min-width: ${studentNameColumnWidth}; max-width: ${studentNameColumnWidth};">Student Name</th>
            <th rowspan="2" class="px-4 py-3 text-left font-medium" style="width: ${coreIdColumnWidth}; min-width: ${coreIdColumnWidth}; max-width: ${coreIdColumnWidth};">Core ID</th>
    `;
    
    // Add set headers with merged cells and background colors
    ['set1', 'set2', 'set3', 'set4', 'set5'].forEach(setId => {
      const tasksInSet = setGroups[setId] || [];
      if (tasksInSet.length > 0) {
        // For Set 5 (E-Prime), use configured column name when available
        const isEPrimeSet = setId === (systemConfig.eprime?.setId || 'set5');
        const setLabel = isEPrimeSet
          ? (systemConfig.eprime?.columnName || 'E-Prime')
          : setId.replace('set', 'Set ');
        const bgColor = setColors[setId];
        html += `<th colspan="${tasksInSet.length}" class="px-2 py-2 text-center font-semibold text-[color:var(--foreground)]" style="background-color: ${bgColor};">${setLabel}</th>`;
      }
    });
    
    html += `
          </tr>
          <!-- Task name row -->
          <tr>
    `;
    
    // Add column headers for each task with set background colors
    allTasks.forEach(task => {
      // Prefer custom label from config; fall back to task.name
      const displayName = columnNames[task.name] || task.name;
      const bgColor = setColors[task.setId];
      const widthStyle = useEqualWidth ? `width: ${taskColumnWidth}; min-width: ${taskColumnWidth}; max-width: ${taskColumnWidth}; ` : '';
      html += `<th class="px-4 py-3 text-center font-medium" style="${widthStyle}background-color: ${bgColor};" title="${task.name}">${displayName}</th>`;
    });
    
    html += `
          </tr>
        </thead>
        <tbody class="divide-y divide-[color:var(--border)]">
    `;
    
    if (filteredStudents.length === 0) {
      html += `
        <tr>
          <td colspan="${allTasks.length + 2}" class="px-4 py-8 text-center text-[color:var(--muted-foreground)]">
            <p>No students match the current filter</p>
          </td>
        </tr>
      `;
    } else {
      filteredStudents.forEach(student => {
        const cacheKey = `${student.coreId}_${student.year || 'Unknown'}`;
        const data = studentSubmissionData.get(cacheKey);
        const setStatus = data?.validationCache?.setStatus;
        
        html += `
          <tr class="hover:bg-[color:var(--muted)]/20 transition-colors">
            <td class="px-4 py-3 sticky left-0 bg-white z-20">
              <a href="checking_system_4_student.html?coreId=${encodeURIComponent(student.coreId)}&year=${encodeURIComponent(student.year || student.grade || 'K3')}" 
                 class="font-medium text-[color:var(--primary)] hover:underline font-noto">
                ${student.studentName}
              </a>
            </td>
            <td class="px-4 py-3 text-xs font-mono text-[color:var(--muted-foreground)]">${student.coreId}</td>
        `;
        
        // Add status for each task with set background colors
        allTasks.forEach(task => {
          const taskStatus = getTaskStatus(setStatus, task, student, data);
          const bgColor = setColors[task.setId];
          html += `
            <td class="px-4 py-3 text-center" style="background-color: ${bgColor};">
              <span class="status-circle ${taskStatus}" title="${task.name}"></span>
            </td>
          `;
        });
        
        html += `
          </tr>
        `;
      });
    }
    
    html += `
        </tbody>
      </table>
    `;
    
    container.innerHTML = html;
  }
  
  /**
   * Get task status for a specific task
   * Handles gender-conditional tasks (TEC) by checking student gender
   * Handles E-Prime tasks by reading EPrime_*_Done fields from mergedAnswers
   * @param {Object} setStatus - The status object
   * @param {Object} task - The task object
   * @param {Object} student - The student object
   * @param {Object} studentData - The student data object
   * @returns {string} The task status
   */
  function getTaskStatus(setStatus, task, student, studentData) {
    // Handle E-Prime tasks specially - they use EPrime_*_Done fields, not setStatus.tasks
    if (task.isEPrime) {
      // Find the E-Prime task config to get the doneField
      const eprimeTaskConfig = systemConfig?.eprime?.tasks?.find(t => t.id === task.name);
      if (!eprimeTaskConfig) return 'status-grey';
      
      const mergedAnswers = studentData?.validationCache?.mergedAnswers;
      if (!mergedAnswers || !jotformQuestions) return 'status-grey';
      
      const qid = jotformQuestions[eprimeTaskConfig.doneField];
      const answerObj = mergedAnswers[eprimeTaskConfig.doneField] || (qid ? mergedAnswers[`q${qid}`] : null);
      const value = answerObj?.answer || answerObj;
      const done = value === '1' || value === 1 || value === true || value === 'true';
      
      return done ? 'status-green' : 'status-grey';
    }
    
    if (!setStatus) return 'status-grey';
    
    // For gender-conditional tasks, determine which version to look for based on student gender
    let searchTaskIds = [];
    
    if (task.isGenderConditional && task.originalNames) {
      // Normalize student gender
      let studentGender = (student.gender || '').toLowerCase();
      if (studentGender === 'm') studentGender = 'male';
      if (studentGender === 'f') studentGender = 'female';
      
      // Find the appropriate task based on gender
      const appropriateTask = task.originalNames.find(name => {
        const nameLower = name.toLowerCase();
        if (studentGender === 'male' && nameLower.includes('male') && !nameLower.includes('female')) return true;
        if (studentGender === 'female' && nameLower.includes('female')) return true;
        return false;
      });
      
      searchTaskIds = appropriateTask ? [appropriateTask.toLowerCase()] : task.originalNames.map(n => n.toLowerCase());
    } else {
      searchTaskIds = task.originalNames.map(n => n.toLowerCase());
    }
    
    // Search through all sets for this task
    for (const setId of ['set1', 'set2', 'set3', 'set4', 'set5']) {
      const set = setStatus[setId];
      if (!set || !set.tasks) continue;
      
      for (const searchId of searchTaskIds) {
        const foundTask = set.tasks.find(t => {
          // Exact match first
          if (t.taskId === searchId) return true;
          
          // Fuzzy match: only if one is a complete substring at word boundaries
          // This prevents "cm" from matching "ccm" or "tgmd"
          const taskIdLower = t.taskId.toLowerCase();
          const searchIdLower = searchId.toLowerCase();
          
          // Allow match if searchId is the entire taskId or vice versa
          if (taskIdLower === searchIdLower) return true;
          
          // Don't use includes() to avoid false positives like cm→ccm
          return false;
        });
        
        if (foundTask) {
          if (foundTask.ignoredForIncompleteChecks) return 'status-grey';
          
          // Warning detection (yellow): Post-termination data OR termination mismatch
          if (foundTask.hasPostTerminationAnswers || foundTask.hasTerminationMismatch) return 'status-yellow';
          
          // Complete (green): All questions answered or properly terminated
          if (foundTask.complete) return 'status-green';
          
          // Incomplete (red): Started but not complete
          if (foundTask.answered > 0) return 'status-red';
          
          // Not started (grey): No answers yet
          return 'status-grey';
        }
      }
    }
    
    return 'status-grey';
  }

  /**
   * Get set status color based on validation cache
   */
  function getSetStatusColor(setStatus, setId) {
    if (!setStatus || !setStatus[setId]) return 'grey';
    
    const set = setStatus[setId];
    
    // Determine color based on set status
    if (set.status === 'complete') return 'green';
    if (set.status === 'incomplete') return 'red';
    if (set.status === 'in-progress') return 'yellow';
    
    return 'grey';
  }

  /**
   * Export class-level validation report as Markdown
   * Uses centralized ExportUtils.exportReport orchestrator
   */
  async function exportClassCache() {
    if (!classData || students.length === 0) {
      alert('No class data to export');
      return;
    }
    
    await window.ExportUtils.exportReport({
      type: 'class',
      data: { classData, schoolData, students },
      loadValidationCache: () => window.JotFormCache.loadValidationCache()
    });
  }

  /**
   * Setup export button
   */
  function setupExportButton() {
    const exportButton = document.getElementById('export-button');
    if (exportButton) {
      exportButton.addEventListener('click', exportClassCache);
    }
    
    // Setup validate button
    const validateButton = document.getElementById('validate-button');
    if (validateButton) {
      validateButton.addEventListener('click', async () => {
        // Show student selector modal
        if (!students || students.length === 0) {
          alert('No students loaded. Please refresh the page.');
          return;
        }
        
        // Get current grade from page
        const gradeElement = document.getElementById('class-grade');
        const currentGrade = gradeElement?.textContent.trim() || 'K3';
        
        // Create student selector modal
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
        modal.innerHTML = `
          <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div class="p-6">
              <h3 class="text-lg font-semibold mb-4">Select Student to Validate</h3>
              <select id="student-selector" class="w-full p-2 border rounded mb-4">
                <option value="">-- Select a student --</option>
                ${students.map(student => `
                  <option value="${student.coreId}" data-name="${student.studentName || 'Unknown'}">
                    ${student.coreId} - ${student.studentName || 'Unknown'}
                  </option>
                `).join('')}
              </select>
              <div class="flex gap-2 justify-end">
                <button id="cancel-validate" class="px-4 py-2 border rounded hover:bg-gray-100">Cancel</button>
                <button id="confirm-validate" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50" disabled>
                  <i data-lucide="shield-check" class="w-4 h-4 inline-block mr-1"></i>
                  Validate
                </button>
              </div>
            </div>
          </div>
        `;
        
        document.body.appendChild(modal);
        lucide.createIcons();
        
        const selector = document.getElementById('student-selector');
        const confirmBtn = document.getElementById('confirm-validate');
        const cancelBtn = document.getElementById('cancel-validate');
        
        // Enable confirm button when student is selected
        selector.addEventListener('change', () => {
          confirmBtn.disabled = !selector.value;
        });
        
        // Cancel button
        cancelBtn.addEventListener('click', () => {
          document.body.removeChild(modal);
        });
        
        // Confirm button - run validation
        confirmBtn.addEventListener('click', async () => {
          const coreId = selector.value;
          if (!coreId) return;
          
          try {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 inline-block mr-1 animate-spin"></i>Validating...';
            lucide.createIcons();
            
            const validator = CacheValidator.create('student', {
              coreId: coreId,
              grade: currentGrade,
              useDom: false  // Cache-only validation for class page
            });
            const results = await validator.validate();
            
            // Close selector modal
            document.body.removeChild(modal);
            
            // Show results
            CacheValidator.showResults(results);
          } catch (error) {
            console.error('[ClassPage] Validation error:', error);
            alert('Validation failed: ' + error.message);
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i data-lucide="shield-check" class="w-4 h-4 inline-block mr-1"></i>Validate';
            lucide.createIcons();
          }
        });
        
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            document.body.removeChild(modal);
          }
        });
      });
    }
  }

  /**
   * Render set status indicator (By Set view only - no yellow/warning)
   */
  function renderSetStatus(status, label) {
    const statusConfig = {
      green: { class: 'status-green', textClass: 'text-emerald-600', text: 'Complete' },
      red: { class: 'status-red', textClass: 'text-red-600', text: 'Incomplete' },
      grey: { class: 'status-grey', textClass: 'text-[color:var(--muted-foreground)]', text: 'Not Started' }
    };
    
    const config = statusConfig[status] || statusConfig.grey;
    
    return `
      <td class="px-4 py-3">
        <span class="inline-flex items-center gap-2 text-xs ${config.textClass}">
          <span class="status-circle ${config.class}" title="${config.text}"></span>
          <span class="hidden sm:inline">${config.text}</span>
        </span>
      </td>
    `;
  }

  /**
   * Show modal with outstanding tasks for a student
   */
  function showOutstandingModal(coreId) {
    const data = studentSubmissionData.get(coreId);
    if (!data) return;
    
    const student = students.find(s => s.coreId === coreId);
    if (!student) return;
    
    const modal = document.getElementById('outstanding-modal');
    const studentNameEl = document.getElementById('modal-student-name');
    const tasksListEl = document.getElementById('modal-tasks-list');
    
    if (!modal || !studentNameEl || !tasksListEl) return;
    
    // Set student name
    studentNameEl.textContent = `Student: ${student.studentName} (${coreId})`;
    
    // Build tasks list by set
    const setStatus = data.validationCache?.setStatus;
    if (!setStatus) {
      tasksListEl.innerHTML = '<p class="text-sm text-[color:var(--muted-foreground)]">No task data available</p>';
      modal.classList.remove('hidden');
      lucide.createIcons();
      return;
    }
    
    let html = '';
    
    // Iterate through sets in order
    for (const setId of ['set1', 'set2', 'set3', 'set4']) {
      const set = setStatus[setId];
      if (!set || !set.tasks || set.tasks.length === 0) continue;
      
      // Get incomplete tasks in this set
      const incompleteTasks = set.tasks.filter(t => !t.complete && !t.ignoredForIncompleteChecks);
      
      if (incompleteTasks.length === 0) continue;
      
      // Get set name from survey structure
      const setInfo = surveyStructure?.sets.find(s => s.id === setId);
      const setName = setInfo ? `${setInfo.name} (Set ${setId.replace('set', '')})` : setId;
      
      html += `
        <div class="mb-4">
          <h4 class="text-sm font-semibold text-[color:var(--foreground)] mb-2">${setName}</h4>
          <ul class="space-y-1 ml-4">
      `;
      
      for (const task of incompleteTasks) {
        const taskName = getTaskDisplayName(task.taskId);
        const progress = task.total > 0 ? `${task.answered}/${task.total} questions` : 'Not started';
        html += `
          <li class="text-sm text-[color:var(--muted-foreground)]">
            <span class="font-medium text-[color:var(--foreground)]">${taskName}</span>
            <span class="text-xs"> — ${progress}</span>
          </li>
        `;
      }
      
      html += `
          </ul>
        </div>
      `;
    }
    
    if (html === '') {
      html = '<p class="text-sm text-[color:var(--muted-foreground)]">All tasks completed!</p>';
    }
    
    tasksListEl.innerHTML = html;
    modal.classList.remove('hidden');
    lucide.createIcons();
  }
  
  /**
   * Close the outstanding tasks modal
   */
  function closeOutstandingModal() {
    const modal = document.getElementById('outstanding-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }
  
  /**
   * Get display name for a task ID
   */
  function getTaskDisplayName(taskId) {
    if (!surveyStructure || !surveyStructure.taskMetadata) return taskId.toUpperCase();
    
    // Find task in metadata
    for (const [filename, metadata] of Object.entries(surveyStructure.taskMetadata)) {
      if (metadata.id === taskId || metadata.aliases?.includes(taskId)) {
        // Return the filename without .json as display name
        return filename;
      }
    }
    
    return taskId.toUpperCase();
  }

  // Expose functions
  window.CheckingSystemClassPage = {
    init
  };
  
  // Expose modal functions globally
  window.showOutstandingModal = showOutstandingModal;
  window.closeOutstandingModal = closeOutstandingModal;
})();