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

    // Render classes table
    renderClassesTable();
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
            <th class="px-3 py-2 font-semibold text-[color:var(--foreground)] text-center">Outstanding</th>
          </tr>
        </thead>
        <tbody>
          ${classes.map(cls => {
            const metrics = classMetrics.get(cls.classId);
            const classStudents = metrics?.students || [];
            
            // Calculate outstanding sets for this class
            let outstandingSets = 0;
            const setStatuses = [];
            
            for (const setId of ['set1', 'set2', 'set3', 'set4']) {
              const setData = metrics?.setCompletion[setId];
              const complete = setData?.complete || 0;
              const incomplete = setData?.incomplete || 0;
              const total = setData?.total || 0;
              
              if (incomplete > 0 || complete < total) outstandingSets++;
              
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
                // None complete, but some in progress - Yellow
                statusClass = 'status-yellow';
              }
              
              const title = `${complete} complete, ${incomplete} in progress, ${total - complete - incomplete} not started`;
              setStatuses.push(`<span class="status-circle ${statusClass}" title="${title}"></span>`);
            }
            
            return `
              <tr class="border-b border-[color:var(--border)] hover:bg-[color:var(--muted)]/30 transition-colors" data-class-row data-grade="${String(cls.grade || 0)}" data-has-data="${classStudents.length > 0}" data-is-incomplete="${outstandingSets > 0}">
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
                <td class="px-3 py-3 text-center">
                  ${outstandingSets > 0 ? 
                    `<button onclick="window.showOutstandingClassesModal('${cls.classId}')" class="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium hover:bg-red-200 transition-colors cursor-pointer">${outstandingSets}</button>` :
                    `<span class="text-[color:var(--muted-foreground)] text-xs">—</span>`
                  }
                </td>
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
   * Setup view filter for classes table
   */
  function setupFilters() {
    const viewFilter = document.getElementById('class-view-filter');
    if (!viewFilter) return;

    viewFilter.addEventListener('change', () => {
      applyClassFilter(viewFilter.value);
    });

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
                  <span class="status-circle status-yellow" title="In Progress"></span>
                  <span class="text-[color:var(--muted-foreground)]">${incomplete} in progress</span>
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
