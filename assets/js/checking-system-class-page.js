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
      
      // Build validation cache using TaskValidator
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
   */
  function convertSetStatus(setStatus) {
    const result = {};
    for (const setId in setStatus) {
      const set = setStatus[setId];
      // Map status to color codes
      if (set.status === 'complete') {
        result[setId] = 'green';
      } else if (set.status === 'incomplete') {
        result[setId] = 'orange';
      } else {
        result[setId] = 'grey';
      }
    }
    return result;
  }

  /**
   * Calculate outstanding count from set status
   */
  function calculateOutstanding(setStatus) {
    let outstanding = 0;
    for (const setId in setStatus) {
      if (setStatus[setId].status === 'incomplete') {
        outstanding++;
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
   * Render class profile section
   */
  function renderClassProfile() {
    document.getElementById('class-name').textContent = classData.actualClassName;
    document.getElementById('school-name').textContent = schoolData ? 
      `${schoolData.schoolNameChinese} · ${schoolData.schoolName}` : '';
    
    // School name detail in the collapsible section
    const schoolNameDetail = document.getElementById('school-name-detail');
    if (schoolNameDetail && schoolData) {
      schoolNameDetail.textContent = `${schoolData.schoolNameChinese} (${schoolData.schoolName})`;
      schoolNameDetail.title = `${schoolData.schoolNameChinese} ${schoolData.schoolName}`;
    }
    
    document.getElementById('teacher-name').textContent = classData.teacherNames || 'N/A';
    document.getElementById('class-id').textContent = classData.classId;
    document.getElementById('district-name').textContent = schoolData?.district || 'N/A';
    document.getElementById('group-number').textContent = schoolData?.group || 'N/A';
  }

  /**
   * Render class metrics
   */
  function renderClassMetrics() {
    const totalStudents = students.length;
    const studentsWithData = studentSubmissionData.size;
    const studentsWithoutData = totalStudents - studentsWithData;

    document.getElementById('total-students').textContent = totalStudents;
    document.getElementById('students-with-data').textContent = studentsWithData;
    document.getElementById('students-without-data').textContent = studentsWithoutData;
    
    // Calculate percentage
    const dataPercentage = totalStudents > 0 ? 
      Math.round((studentsWithData / totalStudents) * 100) : 0;
    document.getElementById('data-percentage').textContent = `${dataPercentage}%`;
  }

  /**
   * Render student table with set status columns
   */
  function renderStudentTable() {
    const tbody = document.getElementById('students-tbody');
    
    if (students.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="px-4 py-8 text-center text-[color:var(--muted-foreground)]">
            <i data-lucide="inbox" class="w-12 h-12 mx-auto mb-2 text-[color:var(--muted-foreground)]"></i>
            <p>No students with Core IDs found in this class</p>
          </td>
        </tr>
      `;
      return;
    }

    // Sort students: with data first, then alphabetically
    const sortedStudents = [...students].sort((a, b) => {
      const aHasData = studentSubmissionData.has(a.coreId);
      const bHasData = studentSubmissionData.has(b.coreId);
      
      if (aHasData && !bHasData) return -1;
      if (!aHasData && bHasData) return 1;
      
      return a.studentName.localeCompare(b.studentName, 'zh-HK');
    });

    tbody.innerHTML = sortedStudents.map(student => {
      const data = studentSubmissionData.get(student.coreId);
      const hasData = !!data;
      const setStatus = data?.setStatus || { set1: 'grey', set2: 'grey', set3: 'grey', set4: 'grey' };
      const outstanding = data?.outstanding || 0;
      const submissionCount = data?.submissions.length || 0;
      
      return `
        <tr class="hover:bg-[color:var(--muted)]/30 transition-colors">
          <td class="px-4 py-3">
            <a href="checking_system_4_student.html?coreId=${encodeURIComponent(student.coreId)}" 
               class="text-[color:var(--primary)] hover:underline font-medium font-noto">
              ${student.studentName}
            </a>
          </td>
          <td class="px-4 py-3 text-xs text-[color:var(--muted-foreground)] font-mono">
            ${student.studentId}
          </td>
          <td class="px-4 py-3 text-xs text-[color:var(--muted-foreground)] font-mono">
            ${student.coreId}
          </td>
          ${renderSetStatus(setStatus.set1, 'Set 1')}
          ${renderSetStatus(setStatus.set2, 'Set 2')}
          ${renderSetStatus(setStatus.set3, 'Set 3')}
          ${renderSetStatus(setStatus.set4, 'Set 4')}
          <td class="px-4 py-3 text-sm font-medium ${outstanding > 0 ? 'text-amber-600' : 'text-[color:var(--muted-foreground)]'}">
            ${outstanding > 0 ? outstanding : '—'}
          </td>
          <td class="px-4 py-3 text-center">
            <a href="checking_system_4_student.html?coreId=${encodeURIComponent(student.coreId)}" 
               class="inline-flex items-center gap-1 text-xs text-[color:var(--primary)] hover:underline">
              View Details
              <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
            </a>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  }

  /**
   * Render set status indicator
   */
  function renderSetStatus(status, label) {
    const statusConfig = {
      green: { class: 'status-green', textClass: 'text-emerald-600', text: 'Complete' },
      yellow: { class: 'status-yellow', textClass: 'text-amber-600', text: 'Post-term' },
      red: { class: 'status-red', textClass: 'text-red-600', text: 'Incomplete' },
      grey: { class: 'status-grey', textClass: 'text-[color:var(--muted-foreground)]', text: 'Not started' }
    };
    
    const config = statusConfig[status] || statusConfig.grey;
    
    return `
      <td class="px-4 py-3">
        <span class="inline-flex items-center gap-2 text-xs ${config.textClass}">
          <span class="status-circle ${config.class}"></span>
          ${config.text}
        </span>
      </td>
    `;
  }

  // Expose init function
  window.CheckingSystemClassPage = {
    init
  };
})();
