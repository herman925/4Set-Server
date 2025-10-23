/**
 * Checking System - Class Drilldown Page
 * Shows all students in a class with their 4Set task completion status
 */

(() => {
  let classData = null;
  let schoolData = null;
  let students = [];
  let studentSubmissionData = new Map(); // coreId -> { submissions: [], setStatus: {}, outstanding: 0 }
  let surveyStructure = null; // Task-to-set mapping
  let taskToSetMap = new Map(); // taskKey -> setId
  let currentViewMode = 'set'; // 'set' or 'task'
  let systemConfig = null; // Checking system config for column names

  /**
   * Initialize the page
   */
  async function init() {
    console.log('[ClassPage] Initializing...');
    
    // Get classId from URL
    const urlParams = new URLSearchParams(window.location.search);
    const classId = urlParams.get('classId');
    
    if (!classId) {
      alert('No class specified');
      window.location.href = 'checking_system_home.html';
      return;
    }

    // Load system config
    await loadSystemConfig();
    
    // Load cached data
    const cachedData = window.CheckingSystemData?.getCachedData();
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

    console.log(`[ClassPage] Found ${students.length} students with Core IDs`);
    console.log(`[ClassPage] First 5 students in this class:`, students.slice(0, 5).map(s => ({
      name: s.studentName,
      coreId: s.coreId,
      numericCoreId: s.coreId.startsWith('C') ? s.coreId.substring(1) : s.coreId
    })));

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
      console.log('[ClassPage] System config loaded');
      return systemConfig;
    } catch (error) {
      console.error('[ClassPage] Failed to load system config:', error);
      systemConfig = { classPageTaskView: { taskColumnNames: {}, equalWidthColumns: false } };
      return systemConfig;
    }
  }

  /**
   * Load survey structure from tasks/survey-structure.json
   * Builds a map of task IDs to set IDs
   */
  async function loadSurveyStructure() {
    try {
      const response = await fetch('assets/tasks/survey-structure.json');
      surveyStructure = await response.json();
      
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
      
      console.log('[ClassPage] Task-to-set mapping loaded:', taskToSetMap.size, 'tasks');
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
      console.log('[ClassPage] Building student validation cache...');
      
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
        surveyStructure
      );
      
      console.log(`[ClassPage] Validation cache built for ${validationCache.size} students`);
      
      // Convert validation cache to studentSubmissionData format
      for (const [coreId, cache] of validationCache.entries()) {
        if (cache.error) {
          console.warn(`[ClassPage] Validation error for ${coreId}:`, cache.error);
          continue;
        }
        
        studentSubmissionData.set(coreId, {
          submissions: cache.submissions,
          setStatus: convertSetStatus(cache.setStatus),
          outstanding: calculateOutstanding(cache.setStatus),
          validationCache: cache  // Store full cache for future use
        });
      }

      console.log(`[ClassPage] Loaded ${studentSubmissionData.size} students with validation data`);
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
   * Calculate outstanding count from set status
   * Returns the number of incomplete TASKS, not sets
   */
  function calculateOutstanding(setStatus) {
    let outstanding = 0;
    for (const setId in setStatus) {
      const set = setStatus[setId];
      // Count incomplete tasks in each set
      if (set.tasksTotal > 0) {
        outstanding += (set.tasksTotal - set.tasksComplete);
      }
    }
    return outstanding;
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
      set4: { complete: 0, total: 0 }
    };

    // Aggregate completion status from student submission data
    for (const student of students) {
      const data = studentSubmissionData.get(student.coreId);
      if (!data || data.validationCache?.error) continue;

      // Count set completion for each student
      for (const setId of ['set1', 'set2', 'set3', 'set4']) {
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
    
    if (viewBySetBtn && viewByTaskBtn) {
      viewBySetBtn.addEventListener('click', () => {
        currentViewMode = 'set';
        updateViewModeButtons();
        renderStudentTable();
      });
      
      viewByTaskBtn.addEventListener('click', () => {
        currentViewMode = 'task';
        updateViewModeButtons();
        renderStudentTable();
      });
    }
  }
  
  /**
   * Render dynamic legend based on current view mode
   */
  function renderLegend() {
    const legendContainer = document.getElementById('legend-container');
    if (!legendContainer) return;
    
    let legendHtml = '';
    
    if (currentViewMode === 'set') {
      // By Set view: 3 colors (no yellow/post-term)
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
      // By Task view: 4 colors (includes yellow for Post-Term)
      legendHtml += `
        <span class="inline-flex items-center gap-1.5">
          <span class="status-circle status-green"></span>
          <span>Complete</span>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="status-circle status-yellow"></span>
          <span>Post-Term</span>
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
   * Update view mode button styles
   */
  function updateViewModeButtons() {
    const viewBySetBtn = document.getElementById('view-by-set-btn');
    const viewByTaskBtn = document.getElementById('view-by-task-btn');
    
    if (!viewBySetBtn || !viewByTaskBtn) return;
    
    if (currentViewMode === 'set') {
      // By Set active - blue (primary)
      viewBySetBtn.classList.add('bg-[color:var(--primary)]', 'text-white', 'shadow-sm');
      viewBySetBtn.classList.remove('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--secondary)]', 'hover:text-[color:var(--secondary-foreground)]');
      
      // By Task inactive - grey with orange hover
      viewByTaskBtn.classList.remove('bg-[color:var(--primary)]', 'text-white', 'shadow-sm', 'bg-[color:var(--secondary)]', 'text-[color:var(--secondary-foreground)]');
      viewByTaskBtn.classList.add('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--secondary)]', 'hover:text-[color:var(--secondary-foreground)]');
    } else {
      // By Task active - orange (secondary)
      viewByTaskBtn.classList.add('bg-[color:var(--secondary)]', 'text-[color:var(--secondary-foreground)]', 'shadow-sm');
      viewByTaskBtn.classList.remove('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--secondary)]', 'hover:text-[color:var(--secondary-foreground)]');
      
      // By Set inactive - grey with blue hover
      viewBySetBtn.classList.remove('bg-[color:var(--primary)]', 'text-white', 'shadow-sm', 'bg-[color:var(--secondary)]', 'text-[color:var(--secondary-foreground)]');
      viewBySetBtn.classList.add('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--primary)]', 'hover:text-white');
    }
    
    // Update legend after button styles
    renderLegend();
  }

  /**
   * Calculate outstanding task count from setStatus
   */
  function calculateOutstandingCount(setStatus) {
    if (!setStatus) return 0;
    
    let count = 0;
    ['set1', 'set2', 'set3', 'set4'].forEach(setId => {
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
        filteredStudents = filteredStudents.filter(s => studentSubmissionData.has(s.coreId));
        break;
      case 'incomplete':
        // Show ALL students that don't have Complete status across all 4 sets
        // This includes: students without data (not started) AND students with incomplete data
        filteredStudents = filteredStudents.filter(s => {
          const data = studentSubmissionData.get(s.coreId);
          
          // No data = incomplete (not started = incomplete)
          if (!data) return true;
          
          // Has data - check if all 4 sets are complete
          const setStatus = data.validationCache?.setStatus;
          if (!setStatus) return true;
          
          // All 4 sets must be complete for student to NOT be shown
          const allSetsComplete = ['set1', 'set2', 'set3', 'set4'].every(setId => 
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
          </tr>
        </thead>
        <tbody class="divide-y divide-[color:var(--border)]">
    `;
    
    if (filteredStudents.length === 0) {
      html += `
        <tr>
          <td colspan="7" class="px-4 py-8 text-center text-[color:var(--muted-foreground)]">
            <p>No students match the current filter</p>
          </td>
        </tr>
      `;
    } else {
      filteredStudents.forEach(student => {
        const data = studentSubmissionData.get(student.coreId);
        const setStatus = data?.validationCache?.setStatus;
        
        html += `
          <tr class="hover:bg-[color:var(--muted)]/20 transition-colors">
            <td class="px-4 py-3">
              <a href="checking_system_4_student.html?coreId=${encodeURIComponent(student.coreId)}" 
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
    
    // Get column width settings from config
    const taskColumnWidth = systemConfig?.classPageTaskView?.taskColumnWidth || '120px';
    const studentNameColumnWidth = systemConfig?.classPageTaskView?.studentNameColumnWidth || '200px';
    const coreIdColumnWidth = systemConfig?.classPageTaskView?.coreIdColumnWidth || '120px';
    const useEqualWidth = systemConfig?.classPageTaskView?.equalWidthColumns !== false;
    const columnNames = systemConfig?.classPageTaskView?.taskColumnNames || {};
    
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
      'set4': 'rgba(249, 157, 51, 0.08)'      // Light orange (secondary)
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
    ['set1', 'set2', 'set3', 'set4'].forEach(setId => {
      const tasksInSet = setGroups[setId] || [];
      if (tasksInSet.length > 0) {
        const setLabel = setId.replace('set', 'Set ');
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
        const data = studentSubmissionData.get(student.coreId);
        const setStatus = data?.validationCache?.setStatus;
        
        html += `
          <tr class="hover:bg-[color:var(--muted)]/20 transition-colors">
            <td class="px-4 py-3 sticky left-0 bg-white z-20">
              <a href="checking_system_4_student.html?coreId=${encodeURIComponent(student.coreId)}" 
                 class="font-medium text-[color:var(--primary)] hover:underline font-noto">
                ${student.studentName}
              </a>
            </td>
            <td class="px-4 py-3 text-xs font-mono text-[color:var(--muted-foreground)]">${student.coreId}</td>
        `;
        
        // Add status for each task with set background colors
        allTasks.forEach(task => {
          const taskStatus = getTaskStatus(setStatus, task, student);
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
   */
  function getTaskStatus(setStatus, task, student) {
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
    for (const setId of ['set1', 'set2', 'set3', 'set4']) {
      const set = setStatus[setId];
      if (!set || !set.tasks) continue;
      
      for (const searchId of searchTaskIds) {
        const foundTask = set.tasks.find(t => 
          t.taskId === searchId || 
          t.taskId.includes(searchId) || 
          searchId.includes(t.taskId)
        );
        
        if (foundTask) {
          
          // Post-term detection (yellow): Task has answers after termination
          if (foundTask.hasPostTerminationAnswers) return 'status-yellow';
          
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
  }

  /**
   * Render set status indicator (By Set view only - no yellow/post-term)
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
      const incompleteTasks = set.tasks.filter(t => !t.complete);
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
