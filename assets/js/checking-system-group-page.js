/**
 * Checking System - Group Drilldown Page
 * Shows task progress for all schools in a group with collapsible sections and filters
 */

(() => {
  let groupData = null;
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
    const group = parseInt(urlParams.get('group'));
    const district = urlParams.get('district'); // Optional
    
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

    groupData = {
      group,
      district,
      schools,
      classes,
      students
    };

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
    document.getElementById('group-number').textContent = groupData.group;
    document.title = `Group ${groupData.group} Overview · 4Set Checking System`;

    // Update breadcrumb
    const groupName = document.getElementById('group-name');
    if (groupName) {
      groupName.textContent = `Group ${groupData.group}`;
    }

    if (groupData.district) {
      const districtLink = document.getElementById('district-name');
      if (districtLink) {
        districtLink.textContent = groupData.district;
        districtLink.href = `checking_system_1_district.html?district=${encodeURIComponent(groupData.district)}`;
      }
      document.getElementById('group-context').textContent = `Schools in Group ${groupData.group} within ${groupData.district} district`;
    } else {
      // Hide district breadcrumb if not filtering by district
      const breadcrumbNav = document.querySelector('.breadcrumb-nav');
      if (breadcrumbNav) {
        const districtElements = breadcrumbNav.querySelectorAll('.breadcrumb-district, .breadcrumb-nav > i');
        districtElements.forEach(el => {
          if (el.classList.contains('breadcrumb-district') || (el.previousElementSibling && el.previousElementSibling.classList.contains('breadcrumb-district'))) {
            el.style.display = 'none';
          }
        });
      }
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

      html += `
        <details class="group-section" data-group="${groupNum}">
          <summary class="flex items-center justify-between px-4 py-3 cursor-pointer bg-gradient-to-r from-blue-50 to-white border-b border-blue-200 hover:from-blue-100 hover:to-blue-50 transition-colors">
            <div class="flex items-center gap-3">
              <i data-lucide="chevron-right" class="w-4 h-4 text-blue-600 group-chevron"></i>
              <h3 class="text-sm font-semibold text-blue-900">Group ${groupNum}</h3>
              <span class="text-xs text-blue-600 font-mono">${groupSchools.length} schools</span>
            </div>
          </summary>
          <div class="pl-8 pr-4 py-2 space-y-2 bg-gradient-to-r from-blue-50/30 to-white">
            ${renderSchoolsList(groupSchools)}
          </div>
        </details>
      `;
    }

    container.innerHTML = html;

    // Add event listeners for chevron rotation
    container.querySelectorAll('details.group-section').forEach(details => {
      details.addEventListener('toggle', () => {
        const chevron = details.querySelector('.group-chevron');
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
      return '<div class="text-sm text-slate-500 italic py-2">No schools match the current filter</div>';
    }

    let html = '';
    for (const school of filteredSchools) {
      const schoolData = schoolMetrics.get(school.schoolId);
      if (!schoolData) continue;

      const eligibleClasses = schoolData.classes.length;
      const { complete, incomplete, notstarted } = calculateSchoolStatus(schoolData);

      html += `
        <div class="school-item border border-slate-200 rounded-lg p-3 bg-white hover:shadow-md transition-shadow" data-school-id="${school.schoolId}">
          <div class="flex items-center justify-between">
            <div class="flex-1">
              <h4 class="text-sm font-semibold text-slate-900 font-noto">${school.schoolNameChinese || school.schoolName}</h4>
              <p class="text-xs text-slate-600">${school.schoolName} · ${school.district}</p>
            </div>
            <div class="flex items-center gap-4">
              <div class="text-xs font-mono space-x-2">
                <span class="inline-flex items-center gap-1">
                  <span class="status-circle status-green"></span>
                  <span>${complete}</span>
                </span>
                <span class="inline-flex items-center gap-1">
                  <span class="status-circle status-yellow"></span>
                  <span>${incomplete}</span>
                </span>
                <span class="inline-flex items-center gap-1">
                  <span class="status-circle status-grey"></span>
                  <span>${notstarted}</span>
                </span>
                <span class="text-slate-500">/ ${eligibleClasses}</span>
              </div>
              <a href="checking_system_2_school.html?schoolId=${encodeURIComponent(school.schoolId)}" 
                 class="p-2 rounded-full hover:bg-blue-100 text-blue-600 transition-colors">
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
   * Extract grade category from grade string
   */
  function extractGrade(gradeStr) {
    if (!gradeStr) return 'Others';
    const grade = gradeStr.toString().toUpperCase();
    if (grade.includes('K1') || grade.includes('N1')) return 'K1';
    if (grade.includes('K2') || grade.includes('N2')) return 'K2';
    if (grade.includes('K3') || grade.includes('N3')) return 'K3';
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
              group: groupData.group,
              district: groupData.district
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
