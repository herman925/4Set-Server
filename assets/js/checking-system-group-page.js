/**
 * Checking System - Group Drilldown Page
 * Shows task progress for all schools in a group with collapsible sections and filters
 */

(() => {
  let group = null;
  let district = null;
  let schools = [];
  let classes = [];
  let students = [];
  let schoolMetrics = new Map(); // schoolId -> { classes: [], completion: {...} }
  let surveyStructure = null;
  let taskToSetMap = new Map();
  let currentFilter = 'all'; // 'all', 'complete', 'incomplete', 'notstarted'
  let currentGradeFilter = []; // ['K1', 'K2', 'K3', 'Others']

  /**
   * Initialize the page
   */
  async function init() {
    console.log('[GroupPage] Initializing...');
    
    // Get group from URL
    const urlParams = new URLSearchParams(window.location.search);
    group = parseInt(urlParams.get('group'));
    district = urlParams.get('district'); // Optional
    
    if (!group) {
      alert('No group specified');
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

    // Get schools in this group
    schools = cachedData.schools.filter(s => s.group === group);
    if (district) {
      schools = schools.filter(s => s.district === district);
    }
    
    // Get all classes and students in these schools
    const schoolIds = new Set(schools.map(s => s.schoolId));
    classes = cachedData.classes.filter(c => schoolIds.has(c.schoolId));
    students = cachedData.students.filter(s => schoolIds.has(s.schoolId) && s.coreId && s.coreId.trim() !== '');

    console.log(`[GroupPage] Group ${group}: ${schools.length} schools, ${classes.length} classes, ${students.length} students`);

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
      
      console.log('[GroupPage] Task-to-set mapping loaded:', taskToSetMap.size, 'tasks');
    } catch (error) {
      console.error('[GroupPage] Failed to load survey structure:', error);
      throw error;
    }
  }

  /**
   * Fetch and aggregate submission data for all students
   */
  async function fetchAndAggregateData() {
    if (!window.JotFormCache) {
      console.warn('[GroupPage] JotForm cache not available');
      return;
    }

    try {
      console.log('[GroupPage] Building validation cache for all students...');
      
      const validationCache = await window.JotFormCache.buildStudentValidationCache(
        students,
        surveyStructure
      );
      
      console.log(`[GroupPage] Validation cache built for ${validationCache.size} students`);
      
      // Aggregate by school
      for (const school of schools) {
        const schoolClasses = classes.filter(c => c.schoolId === school.schoolId);
        const schoolStudents = students.filter(s => s.schoolId === school.schoolId);
        
        const schoolData = {
          school,
          classes: schoolClasses,
          students: schoolStudents,
          classMetrics: new Map(), // classId -> metrics
          setCompletion: {
            set1: { complete: 0, incomplete: 0, notstarted: 0, total: 0 },
            set2: { complete: 0, incomplete: 0, notstarted: 0, total: 0 },
            set3: { complete: 0, incomplete: 0, notstarted: 0, total: 0 },
            set4: { complete: 0, incomplete: 0, notstarted: 0, total: 0 }
          }
        };

        // Aggregate by class within school
        for (const cls of schoolClasses) {
          const classStudents = schoolStudents.filter(s => s.classId === cls.classId);
          const classMetric = {
            class: cls,
            students: classStudents,
            setCompletion: {
              set1: { complete: 0, incomplete: 0, notstarted: 0, total: 0 },
              set2: { complete: 0, incomplete: 0, notstarted: 0, total: 0 },
              set3: { complete: 0, incomplete: 0, notstarted: 0, total: 0 },
              set4: { complete: 0, incomplete: 0, notstarted: 0, total: 0 }
            }
          };

          // Aggregate completion status from validation cache
          for (const student of classStudents) {
            const cache = validationCache.get(student.coreId);
            
            // Count all students in total
            for (const setId of ['set1', 'set2', 'set3', 'set4']) {
              classMetric.setCompletion[setId].total++;
              schoolData.setCompletion[setId].total++;
              
              // Only count complete/incomplete if student has cache
              if (cache && !cache.error) {
                const setStatus = cache.setStatus[setId];
                if (setStatus) {
                  const status = setStatus.status;
                  if (status === 'complete') {
                    classMetric.setCompletion[setId].complete++;
                    schoolData.setCompletion[setId].complete++;
                  } else if (status === 'incomplete') {
                    classMetric.setCompletion[setId].incomplete++;
                    schoolData.setCompletion[setId].incomplete++;
                  } else if (status === 'notstarted') {
                    classMetric.setCompletion[setId].notstarted++;
                    schoolData.setCompletion[setId].notstarted++;
                  }
                }
              } else {
                // No cache = not started
                classMetric.setCompletion[setId].notstarted++;
                schoolData.setCompletion[setId].notstarted++;
              }
            }
          }

          schoolData.classMetrics.set(cls.classId, classMetric);
        }

        schoolMetrics.set(school.schoolId, schoolData);
      }

      console.log('[GroupPage] Aggregated data for', schools.length, 'schools');
    } catch (error) {
      console.error('[GroupPage] Failed to fetch and aggregate data:', error);
    }
  }

  /**
   * Calculate group-wide completion metrics
   */
  function calculateGroupMetrics() {
    const metrics = {
      set1: { complete: 0, incomplete: 0, notstarted: 0, total: 0 },
      set2: { complete: 0, incomplete: 0, notstarted: 0, total: 0 },
      set3: { complete: 0, incomplete: 0, notstarted: 0, total: 0 },
      set4: { complete: 0, incomplete: 0, notstarted: 0, total: 0 }
    };

    for (const [schoolId, schoolData] of schoolMetrics.entries()) {
      for (const setId of ['set1', 'set2', 'set3', 'set4']) {
        metrics[setId].complete += schoolData.setCompletion[setId].complete;
        metrics[setId].incomplete += schoolData.setCompletion[setId].incomplete;
        metrics[setId].notstarted += schoolData.setCompletion[setId].notstarted;
        metrics[setId].total += schoolData.setCompletion[setId].total;
      }
    }

    return metrics;
  }

  /**
   * Render the page
   */
  function renderPage() {
    // Update header
    document.getElementById('group-number').textContent = group;
    document.title = `Group ${group} Overview · 4Set Checking System`;

    // Update breadcrumb - just show group name
    const groupName = document.getElementById('group-name');
    if (groupName) {
      groupName.textContent = `Group ${group}`;
    }

    // Update context message if district filter applied
    if (district) {
      document.getElementById('group-context').textContent = `Schools in Group ${group} within ${district} district`;
    }

    // Update summary metrics
    const districts = [...new Set(schools.map(s => s.district))].sort();
    document.getElementById('total-schools').textContent = schools.length;
    document.getElementById('total-students').textContent = students.length;
    document.getElementById('group-districts').textContent = districts.join(', ');

    // Calculate average completion across all students
    const groupMetrics = calculateGroupMetrics();
    let totalCompletion = 0;
    let totalSets = 0;
    for (const setId of ['set1', 'set2', 'set3', 'set4']) {
      if (groupMetrics[setId].total > 0) {
        totalCompletion += (groupMetrics[setId].complete / groupMetrics[setId].total) * 100;
        totalSets++;
      }
    }
    const avgCompletion = totalSets > 0 ? Math.round(totalCompletion / totalSets) : 0;
    document.getElementById('avg-completion').textContent = avgCompletion + '%';

    // Render schools grouped by group
    renderSchoolsByGroup();
  }

  /**
   * Render schools grouped by group (collapsible sections)
   */
  function renderSchoolsByGroup() {
    const container = document.getElementById('schools-by-group-container');
    if (!container) return;

    // Store the current open/closed state of each details element
    const openStates = new Map();
    container.querySelectorAll('details.group-section').forEach(details => {
      const groupNum = details.getAttribute('data-group');
      openStates.set(groupNum, details.open);
    });

    // Group schools by group (even though we're in a single group page, maintain structure)
    const groups = new Map();
    for (const school of schools) {
      if (!groups.has(school.group)) {
        groups.set(school.group, []);
      }
      groups.get(school.group).push(school);
    }

    // Sort groups numerically
    const sortedGroups = Array.from(groups.keys()).sort((a, b) => a - b);

    let html = '';
    for (const groupNum of sortedGroups) {
      const groupSchools = groups.get(groupNum);
      // Sort schools by schoolId
      groupSchools.sort((a, b) => a.schoolId.localeCompare(b.schoolId));

      // Restore previous open state if it exists
      const wasOpen = openStates.get(groupNum.toString());
      const openAttr = wasOpen ? ' open' : '';

      html += `
        <details class="group-section border-b border-[color:var(--border)]" data-group="${groupNum}"${openAttr}>
          <summary class="px-4 py-3 bg-[color:var(--muted)]/40 cursor-pointer hover:bg-[color:var(--muted)]/60 transition-colors flex items-center justify-between">
            <div class="flex items-center gap-3">
              <i data-lucide="chevron-right" class="w-4 h-4 text-[color:var(--muted-foreground)] transition-transform group-chevron"></i>
              <h3 class="text-sm font-semibold text-[color:var(--foreground)]">Group ${groupNum}</h3>
              <span class="text-xs text-[color:var(--muted-foreground)] font-mono">${groupSchools.length} schools</span>
            </div>
          </summary>
          <div class="divide-y divide-[color:var(--border)] bg-white">
            ${renderSchoolsList(groupSchools)}
          </div>
        </details>
      `;
    }

    container.innerHTML = html;

    // Add event listeners for chevron rotation and sync rotation state
    container.querySelectorAll('details.group-section').forEach(details => {
      const chevron = details.querySelector('.group-chevron');
      // Set initial chevron rotation based on whether details is open
      if (chevron && details.open) {
        chevron.style.transform = 'rotate(90deg)';
      }
      
      details.addEventListener('toggle', () => {
        if (chevron) {
          if (details.open) {
            chevron.style.transform = 'rotate(90deg)';
          } else {
            chevron.style.transform = 'rotate(0deg)';
          }
        }
      });
    });
  }

  /**
   * Render list of schools with task progress
   */
  function renderSchoolsList(schoolsList) {
    const filteredSchools = filterSchools(schoolsList);
    
    if (filteredSchools.length === 0) {
      return '<div class="px-4 py-6 text-center text-sm text-[color:var(--muted-foreground)] italic">No schools match the current filter</div>';
    }

    let html = '';
    for (const school of filteredSchools) {
      const schoolData = schoolMetrics.get(school.schoolId);
      if (!schoolData) continue;

      const eligibleClasses = schoolData.classes.length;
      const { complete, incomplete, notstarted } = calculateSchoolStatus(schoolData);

      html += `
        <div class="school-item px-4 py-3 hover:bg-[color:var(--muted)]/20 transition-colors" data-school-id="${school.schoolId}">
          <div class="flex items-center justify-between">
            <div class="flex-1">
              <a href="checking_system_2_school.html?schoolId=${encodeURIComponent(school.schoolId)}" 
                 class="text-sm font-semibold text-[color:var(--foreground)] hover:text-[color:var(--primary)] font-noto transition-colors">
                ${school.schoolNameChinese || school.schoolName}
              </a>
              <p class="text-xs text-[color:var(--muted-foreground)] mt-0.5">
                <span class="font-mono">${school.schoolId}</span> · ${school.schoolName} · ${school.district}
              </p>
            </div>
            <div class="flex items-center gap-4">
              <div class="text-xs font-mono space-x-2">
                <span class="inline-flex items-center gap-1">
                  <span class="status-circle status-green"></span>
                  <span>${complete}</span>
                </span>
                <span class="inline-flex items-center gap-1">
                  <span class="status-circle status-red"></span>
                  <span>${incomplete}</span>
                </span>
                <span class="inline-flex items-center gap-1">
                  <span class="status-circle status-grey"></span>
                  <span>${notstarted}</span>
                </span>
                <span class="text-[color:var(--muted-foreground)]">/ ${eligibleClasses}</span>
              </div>
              <a href="checking_system_2_school.html?schoolId=${encodeURIComponent(school.schoolId)}" 
                 class="p-2 rounded-full hover:bg-[color:var(--muted)] text-[color:var(--muted-foreground)] hover:text-[color:var(--primary)] transition-colors">
                <i data-lucide="chevron-right" class="w-4 h-4"></i>
              </a>
            </div>
          </div>
        </div>
      `;
    }

    return html;
  }

  /**
   * Calculate school status (how many classes are complete/incomplete/notstarted)
   */
  function calculateSchoolStatus(schoolData) {
    let complete = 0;
    let incomplete = 0;
    let notstarted = 0;

    for (const [classId, classMetric] of schoolData.classMetrics.entries()) {
      // A class is considered:
      // - Complete: if all 4 sets are complete
      // - Incomplete: if some sets are complete/incomplete but not all complete
      // - Not started: if all 4 sets are not started

      const sets = ['set1', 'set2', 'set3', 'set4'];
      let allComplete = true;
      let allNotStarted = true;

      for (const setId of sets) {
        const completion = classMetric.setCompletion[setId];
        const setComplete = completion.complete === completion.total;
        const setNotStarted = completion.notstarted === completion.total;

        if (!setComplete) allComplete = false;
        if (!setNotStarted) allNotStarted = false;
      }

      if (allComplete) {
        complete++;
      } else if (allNotStarted) {
        notstarted++;
      } else {
        incomplete++;
      }
    }

    return { complete, incomplete, notstarted };
  }

  /**
   * Filter schools based on current filters
   */
  function filterSchools(schoolsList) {
    let filtered = schoolsList;

    // Apply view filter
    if (currentFilter !== 'all') {
      filtered = filtered.filter(school => {
        const schoolData = schoolMetrics.get(school.schoolId);
        if (!schoolData) return false;

        const { complete, incomplete, notstarted } = calculateSchoolStatus(schoolData);

        switch (currentFilter) {
          case 'complete':
            return complete > 0;
          case 'incomplete':
            return incomplete > 0;
          case 'notstarted':
            return notstarted > 0;
          default:
            return true;
        }
      });
    }

    // Apply grade filter
    if (currentGradeFilter.length > 0) {
      filtered = filtered.filter(school => {
        const schoolData = schoolMetrics.get(school.schoolId);
        if (!schoolData) return false;

        // Check if any class in this school matches the grade filter
        for (const cls of schoolData.classes) {
          const grade = extractGrade(cls.grade);
          if (currentGradeFilter.includes(grade)) {
            return true;
          }
        }
        return false;
      });
    }

    return filtered;
  }

  /**
   * Extract grade category from numeric grade value
   * Grades are stored as: 1=K1, 2=K2, 3=K3, 0=Others
   */
  function extractGrade(gradeNum) {
    const grade = parseInt(gradeNum) || 0;
    if (grade === 1) return 'K1';
    if (grade === 2) return 'K2';
    if (grade === 3) return 'K3';
    return 'Others';
  }

  /**
   * Setup export button
   */
  function setupExportButton() {
    const exportButton = document.getElementById('export-button');
    if (!exportButton) return;

    exportButton.addEventListener('click', async () => {
      try {
        await ExportUtils.exportReport({
          type: 'group',
          data: {
            groupData: {
              group: group,
              district: district
            },
            schools: schools,
            classes: classes,
            students: students
          },
          loadValidationCache: async () => {
            // Return validation cache for all students in group
            return await window.JotFormCache.buildStudentValidationCache(
              students,
              surveyStructure
            );
          }
        });
      } catch (error) {
        console.error('[GroupPage] Export failed:', error);
        alert('Export failed: ' + error.message);
      }
    });
  }

  /**
   * Setup filters
   */
  function setupFilters() {
    // View filter dropdown
    const viewFilter = document.getElementById('view-filter');
    if (viewFilter) {
      viewFilter.addEventListener('change', (e) => {
        currentFilter = e.target.value;
        renderSchoolsByGroup();
        lucide.createIcons();
      });
    }

    // Grade filter modal
    const filterButton = document.getElementById('filter-button');
    const filterModal = document.getElementById('filter-modal');
    const filterClose = document.getElementById('filter-close');
    const filterApply = document.getElementById('filter-apply');
    const filterReset = document.getElementById('filter-reset');

    if (filterButton && filterModal) {
      filterButton.addEventListener('click', () => {
        filterModal.classList.remove('hidden');
        filterModal.classList.add('flex');
      });
    }

    if (filterClose && filterModal) {
      filterClose.addEventListener('click', () => {
        filterModal.classList.add('hidden');
        filterModal.classList.remove('flex');
      });
    }

    if (filterApply && filterModal) {
      filterApply.addEventListener('click', () => {
        // Get selected grades
        const checkboxes = filterModal.querySelectorAll('input[type="checkbox"]:checked');
        currentGradeFilter = Array.from(checkboxes).map(cb => cb.value);
        
        // Update filter button badge
        updateFilterBadge();
        
        // Re-render
        renderSchoolsByGroup();
        lucide.createIcons();
        
        // Close modal
        filterModal.classList.add('hidden');
        filterModal.classList.remove('flex');
      });
    }

    if (filterReset) {
      filterReset.addEventListener('click', () => {
        // Uncheck all checkboxes
        const checkboxes = filterModal.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = false);
        currentGradeFilter = [];
        updateFilterBadge();
      });
    }
  }

  /**
   * Update filter badge
   */
  function updateFilterBadge() {
    const filterBadge = document.getElementById('filter-badge');
    if (!filterBadge) return;

    if (currentGradeFilter.length > 0) {
      filterBadge.textContent = currentGradeFilter.length;
      filterBadge.classList.remove('hidden');
    } else {
      filterBadge.classList.add('hidden');
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
