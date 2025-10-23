/**
 * Checking System - School Drilldown Page
 * Shows all classes in a school with aggregated completion metrics
 */

(() => {
  let schoolData = null;
  let classes = [];
  let students = [];
  let classMetrics = new Map(); // classId -> { students: [], completion: {...} }
  let surveyStructure = null;
  let taskToSetMap = new Map();
  let currentViewMode = 'class'; // 'class' or 'student'
  let currentStudentViewMode = 'set'; // 'set' or 'task' (only used when currentViewMode is 'student')
  let systemConfig = null; // Checking system config for column names
  let studentSubmissionData = new Map(); // coreId -> { submissions: [], setStatus: {}, outstanding: 0 }

  /**
   * Load system configuration
   */
  async function loadSystemConfig() {
    if (systemConfig) return systemConfig;
    
    try {
      const response = await fetch('config/checking_system_config.json');
      systemConfig = await response.json();
      console.log('[SchoolPage] System config loaded');
      return systemConfig;
    } catch (error) {
      console.error('[SchoolPage] Failed to load system config:', error);
      systemConfig = { taskView: { taskColumnNames: {}, equalWidthColumns: false } };
      return systemConfig;
    }
  }

  /**
   * Initialize the page
   */
  async function init() {
    console.log('[SchoolPage] Initializing...');
    
    // Get schoolId from URL
    const urlParams = new URLSearchParams(window.location.search);
    const schoolId = urlParams.get('schoolId');
    
    if (!schoolId) {
      alert('No school specified');
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

    // Get school data
    schoolData = cachedData.schoolIdMap.get(schoolId);
    if (!schoolData) {
      alert('School not found');
      return;
    }

    // Get all classes and students in this school
    classes = cachedData.classes.filter(c => c.schoolId === schoolId);
    students = cachedData.students.filter(s => s.schoolId === schoolId && s.coreId && s.coreId.trim() !== '');

    console.log(`[SchoolPage] Found ${classes.length} classes, ${students.length} students with Core IDs`);

    // Load survey structure
    await loadSurveyStructure();

    // Fetch and aggregate submission data
    await fetchAndAggregateData();

    // Render the page
    renderPage();

    // Setup export button
    setupExportButton();

    // Setup filters
    setupFilters();

    lucide.createIcons();
  }

  /**
   * Load survey structure and build task-to-set mapping
   */
  async function loadSurveyStructure() {
    try {
      const response = await fetch('assets/tasks/survey-structure.json');
      surveyStructure = await response.json();
      
      // Build task-to-set mapping
      surveyStructure.sets.forEach(set => {
        set.sections.forEach(section => {
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
      
      taskToSetMap.set('nonsym', 'set1');
      
      console.log('[SchoolPage] Task-to-set mapping loaded:', taskToSetMap.size, 'tasks');
    } catch (error) {
      console.error('[SchoolPage] Failed to load survey structure:', error);
      throw error;
    }
  }

  /**
   * Fetch and aggregate submission data for all students
   */
  async function fetchAndAggregateData() {
    if (!window.JotFormCache) {
      console.warn('[SchoolPage] JotForm cache not available');
      return;
    }

    try {
      console.log('[SchoolPage] Building validation cache for all students...');
      
      // VALIDATION ARCHITECTURE NOTE:
      // The school page uses JotFormCache.buildStudentValidationCache() which internally
      // calls TaskValidator.validateAllTasks() for each student. This ensures that
      // school-level aggregation uses the SAME validation logic as the student page.
      //
      // The validation cache:
      // 1. Merges submissions for each student (earliest wins)
      // 2. Calls TaskValidator for accurate validation
      // 3. Calculates set completion status
      // 4. Handles gender-conditional tasks (TEC_Male vs TEC_Female)
      // 5. Caches results in IndexedDB for performance
      //
      // School-level metrics are then aggregated by class from these individual
      // student validations, ensuring consistency across all hierarchical levels.
      const validationCache = await window.JotFormCache.buildStudentValidationCache(
        students,
        surveyStructure
      );
      
      console.log(`[SchoolPage] Validation cache built for ${validationCache.size} students`);
      
      // Store student submission data for By Student view
      for (const [coreId, cache] of validationCache.entries()) {
        if (cache.error) {
          console.warn(`[SchoolPage] Validation error for ${coreId}:`, cache.error);
          continue;
        }
        
        studentSubmissionData.set(coreId, {
          submissions: cache.submissions,
          setStatus: convertSetStatus(cache.setStatus),
          outstanding: calculateOutstanding(cache.setStatus),
          validationCache: cache  // Store full cache for future use
        });
      }
      
      // Aggregate by class
      for (const cls of classes) {
        const classStudents = students.filter(s => s.classId === cls.classId);
        const classData = {
          students: classStudents,
          setCompletion: {
            set1: { complete: 0, incomplete: 0, total: 0 },
            set2: { complete: 0, incomplete: 0, total: 0 },
            set3: { complete: 0, incomplete: 0, total: 0 },
            set4: { complete: 0, incomplete: 0, total: 0 }
          }
        };

        // Aggregate completion status from validation cache
        for (const student of classStudents) {
          const cache = validationCache.get(student.coreId);
          
          // Count all students in total, regardless of whether they have data
          for (const setId of ['set1', 'set2', 'set3', 'set4']) {
            classData.setCompletion[setId].total++;
            
            // Only count complete/incomplete if student has cache
            if (cache && !cache.error) {
              const setStatus = cache.setStatus[setId];
              if (setStatus) {
                if (setStatus.status === 'complete') {
                  classData.setCompletion[setId].complete++;
                } else if (setStatus.status === 'incomplete') {
                  classData.setCompletion[setId].incomplete++;
                }
                // notstarted status means neither complete nor incomplete
              }
            }
          }
        }

        classMetrics.set(cls.classId, classData);
      }

      console.log('[SchoolPage] Aggregated data for', classes.length, 'classes');
    } catch (error) {
      console.error('[SchoolPage] Failed to fetch and aggregate data:', error);
    }
  }

  /**
   * Convert validation cache set status to school page format
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
   * Calculate school-wide completion metrics
   */
  function calculateSchoolMetrics() {
    const metrics = {
      set1: { complete: 0, total: 0 },
      set2: { complete: 0, total: 0 },
      set3: { complete: 0, total: 0 },
      set4: { complete: 0, total: 0 }
    };

    for (const [classId, classData] of classMetrics.entries()) {
      for (const setId of ['set1', 'set2', 'set3', 'set4']) {
        metrics[setId].complete += classData.setCompletion[setId].complete;
        metrics[setId].total += classData.setCompletion[setId].total;
      }
    }

    return metrics;
  }

  /**
   * Render the page
   */
  function renderPage() {
    // Update school profile
    document.getElementById('school-name-chinese').textContent = schoolData.schoolNameChinese;
    document.getElementById('school-name-english').textContent = schoolData.schoolName;
    document.getElementById('school-id').textContent = schoolData.schoolId;
    document.getElementById('school-district').textContent = schoolData.district || '—';
    document.getElementById('school-group').textContent = schoolData.group || '—';
    document.getElementById('total-classes').textContent = classes.length;
    document.getElementById('total-students').textContent = students.length;
    document.getElementById('class-count').textContent = `${classes.length} ${classes.length === 1 ? 'class' : 'classes'}`;
    document.title = `${schoolData.schoolNameChinese} · 4Set Checking System`;

    // Build breadcrumbs matching class page style
    const breadcrumbDistrict = document.querySelector('.breadcrumb-district');
    const breadcrumbGroup = document.querySelector('.breadcrumb-group');
    const breadcrumbSchool = document.querySelector('.breadcrumb-school');
    
    if (schoolData.district) {
      breadcrumbDistrict.textContent = schoolData.district;
      breadcrumbDistrict.href = `checking_system_1_district.html?district=${encodeURIComponent(schoolData.district)}`;
    }
    if (schoolData.group) {
      breadcrumbGroup.textContent = `Group ${schoolData.group}`;
      breadcrumbGroup.href = `checking_system_1_group.html?group=${schoolData.group}`;
    }
    breadcrumbSchool.textContent = schoolData.schoolNameChinese;

    // Calculate and display school-wide completion metrics
    const schoolMetrics = calculateSchoolMetrics();
    for (const setId of ['set1', 'set2', 'set3', 'set4']) {
      const metric = schoolMetrics[setId];
      const percentage = metric.total > 0 ? Math.round((metric.complete / metric.total) * 100) : 0;
      document.getElementById(`${setId}-completion`).textContent = `${percentage}%`;
      document.getElementById(`${setId}-count`).textContent = `${metric.complete}/${metric.total}`;
    }

    // Initialize view mode buttons
    updateMainViewMode();
    
    // Render main view (classes or students based on currentViewMode)
    renderMainView();
  }

  /**
   * Get display label for grade number
   */
  function getGradeLabel(gradeNumber) {
    if (gradeNumber === 1) return 'K1';
    if (gradeNumber === 2) return 'K2';
    if (gradeNumber === 3) return 'K3';
    if (gradeNumber === 0) return 'Other';
    return '—';
  }

  /**
   * Render classes table with status lights (PRD-compliant)
   */
  function renderClassesTable() {
    const tableContainer = document.getElementById('classes-table');
    
    if (classes.length === 0) {
      tableContainer.innerHTML = '<p class="text-[color:var(--muted-foreground)] text-sm">No classes found</p>';
      return;
    }

    // Create table header
    const table = document.createElement('div');
    table.className = 'overflow-x-auto';
    
    table.innerHTML = `
      <table class="w-full text-sm">
        <thead class="border-b border-[color:var(--border)]">
          <tr class="text-left">
            <th class="px-3 py-2 font-semibold text-[color:var(--foreground)]">Class</th>
            <th class="px-3 py-2 font-semibold text-[color:var(--foreground)]">Class ID</th>
            <th class="px-3 py-2 font-semibold text-[color:var(--foreground)]">Grade</th>
            <th class="px-3 py-2 font-semibold text-[color:var(--foreground)]">Students</th>
            <th class="px-3 py-2 font-semibold text-[color:var(--foreground)] text-center">Set 1</th>
            <th class="px-3 py-2 font-semibold text-[color:var(--foreground)] text-center">Set 2</th>
            <th class="px-3 py-2 font-semibold text-[color:var(--foreground)] text-center">Set 3</th>
            <th class="px-3 py-2 font-semibold text-[color:var(--foreground)] text-center">Set 4</th>
          </tr>
        </thead>
        <tbody>
          ${classes.map(cls => {
            const metrics = classMetrics.get(cls.classId);
            const classStudents = metrics?.students || [];
            
            const setStatuses = [];
            
            for (const setId of ['set1', 'set2', 'set3', 'set4']) {
              const setData = metrics?.setCompletion[setId];
              const complete = setData?.complete || 0;
              const incomplete = setData?.incomplete || 0;
              const total = setData?.total || 0;
              
              // Determine status light color per actual student data
              // Green = all complete, Yellow = some in progress (incomplete), Red = mix of complete and incomplete, Grey = not started
              let statusClass = 'status-grey';
              if (complete === total && total > 0) {
                statusClass = 'status-green';
              } else if (complete > 0 && incomplete > 0) {
                // Some complete, some incomplete - Red
                statusClass = 'status-red';
              } else if (complete > 0 && incomplete === 0) {
                // Some complete, rest not started - Red
                statusClass = 'status-red';
              } else if (incomplete > 0 && complete === 0) {
                // None complete, but some in progress - Red (incomplete)
                statusClass = 'status-red';
              }
              
              const title = `${complete} complete, ${incomplete} in progress, ${total - complete - incomplete} not started`;
              setStatuses.push(`<span class="status-circle ${statusClass}" title="${title}"></span>`);
            }
            
            return `
              <tr class="border-b border-[color:var(--border)] hover:bg-[color:var(--muted)]/30 transition-colors" data-class-row data-grade="${String(cls.grade || 0)}" data-has-data="${classStudents.length > 0}">
                <td class="px-3 py-3">
                  <a href="checking_system_3_class.html?classId=${encodeURIComponent(cls.classId)}" class="font-semibold font-noto text-[color:var(--foreground)] hover:text-[color:var(--primary)]">
                    ${cls.actualClassName}
                  </a>
                  ${cls.teacherNames ? `<p class="text-xs text-[color:var(--muted-foreground)] mt-0.5">${cls.teacherNames}</p>` : ''}
                </td>
                <td class="px-3 py-3 text-xs font-mono text-[color:var(--muted-foreground)]">
                  ${cls.classId}
                </td>
                <td class="px-3 py-3 text-[color:var(--muted-foreground)]">
                  ${getGradeLabel(cls.grade)}
                </td>
                <td class="px-3 py-3">
                  <button onclick="window.openStudentListModal('${cls.classId}')" class="text-[color:var(--primary)] hover:underline font-medium">
                    ${classStudents.length}
                  </button>
                </td>
                <td class="px-3 py-3 text-center">${setStatuses[0]}</td>
                <td class="px-3 py-3 text-center">${setStatuses[1]}</td>
                <td class="px-3 py-3 text-center">${setStatuses[2]}</td>
                <td class="px-3 py-3 text-center">${setStatuses[3]}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    
    tableContainer.innerHTML = '';
    tableContainer.appendChild(table);
  }

  /**
   * Render students table (By Student view)
   * Shows unique students aggregated from all classes in the school
   */
  function renderStudentsTable() {
    const container = document.getElementById('students-table');
    if (!container) return;
    
    // Get unique students (by coreId) from all classes in the school
    const uniqueStudents = students;
    
    if (uniqueStudents.length === 0) {
      container.innerHTML = `
        <div class="px-4 py-8 text-center text-[color:var(--muted-foreground)]">
          <i data-lucide="inbox" class="w-12 h-12 mx-auto mb-2 text-[color:var(--muted-foreground)]"></i>
          <p>No students with Core IDs found in this school</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }
    
    if (currentStudentViewMode === 'set') {
      renderStudentsTableBySet(container, uniqueStudents);
    } else {
      renderStudentsTableByTask(container, uniqueStudents);
    }
    
    lucide.createIcons();
  }

  /**
   * Render students table in Set-by-Set view
   */
  function renderStudentsTableBySet(container, filteredStudents) {
    let html = `
      <table class="min-w-full text-sm">
        <thead class="bg-[color:var(--muted)]/30 text-xs text-[color:var(--muted-foreground)]">
          <tr>
            <th class="px-4 py-3 text-left font-medium">Student Name</th>
            <th class="px-4 py-3 text-left font-medium">Core ID</th>
            <th class="px-4 py-3 text-left font-medium">Class</th>
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
        const classInfo = classes.find(c => c.classId === student.classId);
        
        html += `
          <tr class="hover:bg-[color:var(--muted)]/20 transition-colors">
            <td class="px-4 py-3">
              <a href="checking_system_4_student.html?coreId=${encodeURIComponent(student.coreId)}" 
                 class="font-medium text-[color:var(--primary)] hover:underline font-noto">
                ${student.studentName}
              </a>
            </td>
            <td class="px-4 py-3 text-xs font-mono text-[color:var(--muted-foreground)]">${student.coreId}</td>
            <td class="px-4 py-3 text-xs text-[color:var(--muted-foreground)]">${classInfo?.actualClassName || '—'}</td>
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
   * Render students table in Task-by-Task view
   * Similar to class page task view but for school-level aggregation
   */
  function renderStudentsTableByTask(container, filteredStudents) {
    // Get all tasks from survey structure in order
    const allTasks = [];
    const genderTasksProcessed = new Set();
    
    if (surveyStructure && surveyStructure.sets) {
      surveyStructure.sets.forEach(set => {
        set.sections.forEach(section => {
          const taskName = section.file.replace('.json', '');
          
          // Handle gender-conditional tasks (TEC_Male, TEC_Female)
          if (section.showIf && section.showIf.gender) {
            const baseTaskName = taskName.replace(/_Male|_Female/i, '');
            
            if (!genderTasksProcessed.has(baseTaskName)) {
              genderTasksProcessed.add(baseTaskName);
              allTasks.push({
                name: baseTaskName,
                originalNames: [taskName],
                setId: set.id,
                order: section.order,
                isGenderConditional: true
              });
            } else {
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
    const taskColumnWidth = systemConfig?.taskView?.taskColumnWidth || '120px';
    const studentNameColumnWidth = systemConfig?.taskView?.studentNameColumnWidth || '200px';
    const coreIdColumnWidth = systemConfig?.taskView?.coreIdColumnWidth || '120px';
    const classColumnWidth = systemConfig?.taskView?.classColumnWidth || '150px';
    const useEqualWidth = systemConfig?.taskView?.equalWidthColumns !== false;
    const columnNames = systemConfig?.taskView?.taskColumnNames || {};
    
    // Group tasks by set for the set header row
    const setGroups = {};
    allTasks.forEach(task => {
      if (!setGroups[task.setId]) {
        setGroups[task.setId] = [];
      }
      setGroups[task.setId].push(task);
    });
    
    // Define light background colors for each set
    const setColors = {
      'set1': 'rgba(43, 57, 144, 0.06)',
      'set2': 'rgba(141, 190, 80, 0.08)',
      'set3': 'rgba(147, 51, 234, 0.06)',
      'set4': 'rgba(249, 157, 51, 0.08)'
    };
    
    let html = `
      <table class="min-w-full text-sm">
        <thead class="bg-[color:var(--muted)]/30 text-xs text-[color:var(--muted-foreground)]">
          <!-- Set grouping row -->
          <tr class="border-b border-[color:var(--border)]">
            <th rowspan="2" class="px-4 py-3 text-left font-medium sticky left-0 bg-white z-20" style="width: ${studentNameColumnWidth}; min-width: ${studentNameColumnWidth}; max-width: ${studentNameColumnWidth};">Student Name</th>
            <th rowspan="2" class="px-4 py-3 text-left font-medium" style="width: ${coreIdColumnWidth}; min-width: ${coreIdColumnWidth}; max-width: ${coreIdColumnWidth};">Core ID</th>
            <th rowspan="2" class="px-4 py-3 text-left font-medium" style="width: ${classColumnWidth}; min-width: ${classColumnWidth}; max-width: ${classColumnWidth};">Class</th>
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
          <td colspan="${allTasks.length + 3}" class="px-4 py-8 text-center text-[color:var(--muted-foreground)]">
            <p>No students match the current filter</p>
          </td>
        </tr>
      `;
    } else {
      filteredStudents.forEach(student => {
        const data = studentSubmissionData.get(student.coreId);
        const setStatus = data?.validationCache?.setStatus;
        const classInfo = classes.find(c => c.classId === student.classId);
        
        html += `
          <tr class="hover:bg-[color:var(--muted)]/20 transition-colors">
            <td class="px-4 py-3 sticky left-0 bg-white z-20">
              <a href="checking_system_4_student.html?coreId=${encodeURIComponent(student.coreId)}" 
                 class="font-medium text-[color:var(--primary)] hover:underline font-noto">
                ${student.studentName}
              </a>
            </td>
            <td class="px-4 py-3 text-xs font-mono text-[color:var(--muted-foreground)]">${student.coreId}</td>
            <td class="px-4 py-3 text-xs text-[color:var(--muted-foreground)]">${classInfo?.actualClassName || '—'}</td>
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
   * Setup export button - exports Markdown validation report
   * Uses centralized ExportUtils.exportReport orchestrator
   */
  function setupExportButton() {
    const exportButton = document.getElementById('export-button');
    if (!exportButton) return;

    exportButton.addEventListener('click', async () => {
      await window.ExportUtils.exportReport({
        type: 'school',
        data: { schoolData, classes, students },
        loadValidationCache: () => window.JotFormCache.loadValidationCache()
      });
    });
  }

  /**
   * Setup view filters and mode toggles
   */
  function setupFilters() {
    // Setup main view mode toggle (By Class / By Student)
    const viewByClassBtn = document.getElementById('view-by-class-btn');
    const viewByStudentBtn = document.getElementById('view-by-student-btn');
    
    if (viewByClassBtn && viewByStudentBtn) {
      viewByClassBtn.addEventListener('click', () => {
        currentViewMode = 'class';
        updateMainViewMode();
        renderMainView();
      });
      
      viewByStudentBtn.addEventListener('click', () => {
        currentViewMode = 'student';
        updateMainViewMode();
        renderMainView();
      });
    }

    // Setup student view mode toggle (By Set / By Task)
    const studentViewBySetBtn = document.getElementById('student-view-by-set-btn');
    const studentViewByTaskBtn = document.getElementById('student-view-by-task-btn');
    
    if (studentViewBySetBtn && studentViewByTaskBtn) {
      studentViewBySetBtn.addEventListener('click', () => {
        currentStudentViewMode = 'set';
        updateStudentViewMode();
        renderMainView();
      });
      
      studentViewByTaskBtn.addEventListener('click', () => {
        currentStudentViewMode = 'task';
        updateStudentViewMode();
        renderMainView();
      });
    }

    // Setup data filter
    const dataFilter = document.getElementById('data-view-filter');
    if (dataFilter) {
      dataFilter.addEventListener('change', () => {
        renderMainView();
      });
    }

    // Setup grade filter button
    const gradeFilterButton = document.getElementById('grade-filter-button');
    if (gradeFilterButton) {
      gradeFilterButton.addEventListener('click', () => {
        openGradeFilterModal();
      });
    }

    // Setup grade pills
    document.querySelectorAll('.grade-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        const grade = e.currentTarget.getAttribute('data-grade');
        applyGradeFilter(grade);
        
        // Update active state
        document.querySelectorAll('.grade-pill').forEach(p => {
          p.classList.remove('border-[color:var(--primary)]', 'bg-blue-50', 'text-[color:var(--primary)]');
          p.classList.add('border-[color:var(--border)]', 'bg-white');
        });
        e.currentTarget.classList.remove('border-[color:var(--border)]', 'bg-white');
        e.currentTarget.classList.add('border-[color:var(--primary)]', 'bg-blue-50', 'text-[color:var(--primary)]');
      });
    });
  }

  /**
   * Update main view mode buttons and UI
   */
  function updateMainViewMode() {
    const viewByClassBtn = document.getElementById('view-by-class-btn');
    const viewByStudentBtn = document.getElementById('view-by-student-btn');
    const studentViewModeToggle = document.getElementById('student-view-mode-toggle');
    const mainViewTitle = document.getElementById('main-view-title');
    const mainViewSubtitle = document.getElementById('main-view-subtitle');
    
    if (!viewByClassBtn || !viewByStudentBtn) return;
    
    if (currentViewMode === 'class') {
      // By Class active - blue (primary)
      viewByClassBtn.classList.add('bg-[color:var(--primary)]', 'text-white', 'shadow-sm');
      viewByClassBtn.classList.remove('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--secondary)]', 'hover:text-[color:var(--secondary-foreground)]');
      
      // By Student inactive - grey
      viewByStudentBtn.classList.remove('bg-[color:var(--primary)]', 'text-white', 'shadow-sm');
      viewByStudentBtn.classList.add('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--secondary)]', 'hover:text-[color:var(--secondary-foreground)]');
      
      // Hide student view mode toggle
      if (studentViewModeToggle) {
        studentViewModeToggle.style.display = 'none';
      }
      
      // Update title
      if (mainViewTitle) mainViewTitle.textContent = 'Classes in this School';
      if (mainViewSubtitle) mainViewSubtitle.textContent = 'Click to expand/collapse class list';
    } else {
      // By Student active - blue (primary)
      viewByStudentBtn.classList.add('bg-[color:var(--primary)]', 'text-white', 'shadow-sm');
      viewByStudentBtn.classList.remove('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--secondary)]', 'hover:text-[color:var(--secondary-foreground)]');
      
      // By Class inactive - grey
      viewByClassBtn.classList.remove('bg-[color:var(--primary)]', 'text-white', 'shadow-sm');
      viewByClassBtn.classList.add('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--secondary)]', 'hover:text-[color:var(--secondary-foreground)]');
      
      // Show student view mode toggle
      if (studentViewModeToggle) {
        studentViewModeToggle.style.display = 'inline-flex';
      }
      
      // Update title
      if (mainViewTitle) mainViewTitle.textContent = 'Students in this School';
      if (mainViewSubtitle) mainViewSubtitle.textContent = 'Click student name to view detailed assessment data';
    }
    
    // Update legend
    renderLegend();
  }

  /**
   * Update student view mode buttons
   */
  function updateStudentViewMode() {
    const studentViewBySetBtn = document.getElementById('student-view-by-set-btn');
    const studentViewByTaskBtn = document.getElementById('student-view-by-task-btn');
    
    if (!studentViewBySetBtn || !studentViewByTaskBtn) return;
    
    if (currentStudentViewMode === 'set') {
      // By Set active - blue (primary)
      studentViewBySetBtn.classList.add('bg-[color:var(--primary)]', 'text-white', 'shadow-sm');
      studentViewBySetBtn.classList.remove('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--secondary)]', 'hover:text-[color:var(--secondary-foreground)]');
      
      // By Task inactive - grey
      studentViewByTaskBtn.classList.remove('bg-[color:var(--primary)]', 'text-white', 'shadow-sm', 'bg-[color:var(--secondary)]', 'text-[color:var(--secondary-foreground)]');
      studentViewByTaskBtn.classList.add('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--secondary)]', 'hover:text-[color:var(--secondary-foreground)]');
    } else {
      // By Task active - orange (secondary)
      studentViewByTaskBtn.classList.add('bg-[color:var(--secondary)]', 'text-[color:var(--secondary-foreground)]', 'shadow-sm');
      studentViewByTaskBtn.classList.remove('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--secondary)]', 'hover:text-[color:var(--secondary-foreground)]');
      
      // By Set inactive - grey
      studentViewBySetBtn.classList.remove('bg-[color:var(--primary)]', 'text-white', 'shadow-sm');
      studentViewBySetBtn.classList.add('text-[color:var(--muted-foreground)]', 'hover:bg-[color:var(--primary)]', 'hover:text-white');
    }
    
    // Update legend
    renderLegend();
  }

  /**
   * Render dynamic legend based on current view mode
   */
  function renderLegend() {
    const legendContainer = document.getElementById('legend-container');
    if (!legendContainer) return;
    
    let legendHtml = '';
    
    if (currentViewMode === 'class' || currentStudentViewMode === 'set') {
      // By Class or By Set view: 3 colors (no yellow/post-term)
      legendHtml = `
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
      legendHtml = `
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
   * Render main view (either classes or students)
   */
  function renderMainView() {
    const classesTable = document.getElementById('classes-table');
    const studentsTable = document.getElementById('students-table');
    
    if (currentViewMode === 'class') {
      // Show classes table, hide students table
      if (classesTable) classesTable.style.display = '';
      if (studentsTable) studentsTable.style.display = 'none';
      renderClassesTable();
    } else {
      // Show students table, hide classes table
      if (classesTable) classesTable.style.display = 'none';
      if (studentsTable) studentsTable.style.display = '';
      renderStudentsTable();
    }
  }

  /**
   * Apply view filter to classes table
   */
  function applyClassFilter(filterValue) {
    const rows = document.querySelectorAll('[data-class-row]');
    let visibleCount = 0;

    rows.forEach(row => {
      const hasData = row.getAttribute('data-has-data') === 'true';
      const isIncomplete = row.getAttribute('data-is-incomplete') === 'true';
      
      let shouldShow = true;
      
      switch (filterValue) {
        case 'with-data':
          shouldShow = hasData;
          break;
        case 'incomplete':
          shouldShow = isIncomplete;
          break;
        case 'all':
        default:
          shouldShow = true;
          break;
      }
      
      row.style.display = shouldShow ? '' : 'none';
      if (shouldShow) visibleCount++;
    });

    // Update class count display
    const classCountEl = document.getElementById('class-count');
    if (classCountEl) {
      classCountEl.textContent = `${visibleCount} ${visibleCount === 1 ? 'class' : 'classes'}${visibleCount !== classes.length ? ` (of ${classes.length} total)` : ''}`;
    }
  }

  /**
   * Apply grade filter to classes table
   * Now uses numeric grades: 1 (K1), 2 (K2), 3 (K3), 0 (Other)
   */
  function applyGradeFilter(grade) {
    const rows = document.querySelectorAll('[data-class-row]');
    let visibleCount = 0;

    rows.forEach(row => {
      const rowGrade = row.getAttribute('data-grade');
      let shouldShow = false;
      
      if (grade === 'all') {
        shouldShow = true;
      } else if (grade === '1' || grade === '2' || grade === '3') {
        // Filter by specific grade number (numeric comparison)
        shouldShow = String(rowGrade) === grade;
      } else if (grade === '0') {
        // Filter by "Other" grade (numeric 0)
        shouldShow = String(rowGrade) === '0';
      }
      
      if (shouldShow) {
        row.style.removeProperty('display');
        visibleCount++;
      } else {
        row.style.display = 'none';
      }
    });

    // Update class count display
    const classCountEl = document.getElementById('class-count');
    if (classCountEl) {
      const gradeLabel = grade === 'all' ? '' : 
                         grade === '1' ? ' (K1 only)' :
                         grade === '2' ? ' (K2 only)' :
                         grade === '3' ? ' (K3 only)' :
                         ' (Others only)';
      classCountEl.textContent = `${visibleCount} ${visibleCount === 1 ? 'class' : 'classes'}${gradeLabel}`;
    }
  }

  /**
   * Open grade filter modal
   */
  function openGradeFilterModal() {
    const modal = document.getElementById('grade-filter-modal');
    if (modal) {
      modal.classList.remove('hidden');
      lucide.createIcons();
    }
  }

  /**
   * Close grade filter modal
   */
  function closeGradeFilterModal() {
    const modal = document.getElementById('grade-filter-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  /**
   * Open student list modal for a specific class
   */
  function openStudentListModal(classId) {
    const cls = classes.find(c => c.classId === classId);
    if (!cls) return;

    const metrics = classMetrics.get(classId);
    const classStudents = metrics?.students || [];

    // Update modal title
    const modalClassName = document.getElementById('modal-class-name');
    if (modalClassName) {
      modalClassName.textContent = `${cls.actualClassName} (${cls.classId})`;
    }

    // Render student list
    const modalStudentsList = document.getElementById('modal-students-list');
    if (modalStudentsList) {
      if (classStudents.length === 0) {
        modalStudentsList.innerHTML = '<p class="text-[color:var(--muted-foreground)] text-sm">No students with Core IDs found in this class.</p>';
      } else {
        modalStudentsList.innerHTML = classStudents.map((student, index) => `
          <div class="flex items-center justify-between p-3 rounded-md border border-[color:var(--border)] hover:bg-[color:var(--muted)]/30 transition-colors">
            <div class="flex items-center gap-3">
              <span class="text-xs font-mono text-[color:var(--muted-foreground)] w-8">${index + 1}</span>
              <div>
                <p class="font-medium font-noto text-[color:var(--foreground)]">${student.studentName}</p>
                <p class="text-xs text-[color:var(--muted-foreground)]">Core ID: ${student.coreId}</p>
              </div>
            </div>
            <a href="checking_system_4_student.html?coreId=${encodeURIComponent(student.coreId)}" 
               class="text-xs text-[color:var(--primary)] hover:underline">
              View Details →
            </a>
          </div>
        `).join('');
      }
    }

    // Show modal
    const modal = document.getElementById('student-list-modal');
    if (modal) {
      modal.classList.remove('hidden');
      lucide.createIcons();
    }
  }

  /**
   * Close student list modal
   */
  function closeStudentListModal() {
    const modal = document.getElementById('student-list-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  /**
   * Show outstanding classes modal for a specific class
   */
  function showOutstandingClassesModal(classId) {
    const cls = classes.find(c => c.classId === classId);
    if (!cls) return;

    const metrics = classMetrics.get(classId);
    if (!metrics) return;

    // Update modal title
    const modalClassName = document.getElementById('modal-outstanding-class-name');
    if (modalClassName) {
      modalClassName.textContent = `${cls.actualClassName} (${cls.classId})`;
    }

    // Build outstanding sets list
    const modalOutstandingList = document.getElementById('modal-outstanding-list');
    if (modalOutstandingList) {
      let html = '';
      
      for (const setId of ['set1', 'set2', 'set3', 'set4']) {
        const setData = metrics.setCompletion[setId];
        const complete = setData?.complete || 0;
        const incomplete = setData?.incomplete || 0;
        const total = setData?.total || 0;
        const notStarted = total - complete - incomplete;
        
        // Only show if there are incomplete or not started
        if (incomplete > 0 || notStarted > 0 || complete < total) {
          const setName = `Set ${setId.replace('set', '')}`;
          const completionPercent = total > 0 ? Math.round((complete / total) * 100) : 0;
          
          html += `
            <div class="border border-[color:var(--border)] rounded-md p-3 bg-[color:var(--muted)]/10">
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-sm font-semibold text-[color:var(--foreground)]">${setName}</h4>
                <span class="text-xs font-mono text-[color:var(--muted-foreground)]">${completionPercent}% complete</span>
              </div>
              <div class="grid grid-cols-3 gap-2 text-xs">
                <div class="flex items-center gap-1.5">
                  <span class="status-circle status-green" title="Complete"></span>
                  <span class="text-[color:var(--muted-foreground)]">${complete} complete</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="status-circle status-red" title="Incomplete"></span>
                  <span class="text-[color:var(--muted-foreground)]">${incomplete} incomplete</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="status-circle status-grey" title="Not Started"></span>
                  <span class="text-[color:var(--muted-foreground)]">${notStarted} not started</span>
                </div>
              </div>
            </div>
          `;
        }
      }
      
      if (html === '') {
        html = '<p class="text-sm text-[color:var(--muted-foreground)]">All sets are complete!</p>';
      }
      
      modalOutstandingList.innerHTML = html;
    }

    // Show modal
    const modal = document.getElementById('outstanding-classes-modal');
    if (modal) {
      modal.classList.remove('hidden');
      lucide.createIcons();
    }
  }

  /**
   * Close outstanding classes modal
   */
  function closeOutstandingClassesModal() {
    const modal = document.getElementById('outstanding-classes-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  // Expose modal functions globally
  window.openGradeFilterModal = openGradeFilterModal;
  window.closeGradeFilterModal = closeGradeFilterModal;
  window.openStudentListModal = openStudentListModal;
  window.closeStudentListModal = closeStudentListModal;
  window.showOutstandingClassesModal = showOutstandingClassesModal;
  window.closeOutstandingClassesModal = closeOutstandingClassesModal;

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
