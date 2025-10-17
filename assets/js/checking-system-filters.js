/**
 * Filter Management for Checking System Home Page
 * Handles dynamic filter rows, validation, and UI updates
 * 
 * FILTER HIERARCHY & INTERACTIONS:
 * 
 * Top Level (Independent):
 *   - District ← → Group (filter each other)
 * 
 * Middle Level:
 *   - School (filtered by District AND Group - intersection)
 * 
 * Lower Levels:
 *   - Class (filtered by School > District/Group)
 *   - Student (filtered by Class > School > District/Group)
 * 
 * INTERACTION RULES:
 * 1. District filters: Group, School, Class, Student
 * 2. Group filters: District, School, Class, Student
 * 3. School filters: Class, Student (and IS FILTERED BY District+Group)
 * 4. Class filters: Student (and IS FILTERED BY School OR District+Group)
 * 5. Student (filtered by Class OR School OR District+Group in priority order)
 */
(() => {
  let appData = null;
  let activeFilters = {};
  let filterCount = 0;

  const FILTER_TYPES = {
    DISTRICT: 'District',
    GROUP: 'Group',
    SCHOOL: 'School',
    CLASS: 'Class',
    STUDENT: 'Student'
  };

  /**
   * Initialize filter system with data
   * @param {Object} data - Loaded data from CheckingSystemData
   */
  function initialize(data) {
    appData = data;
    renderInitialFilter();
    setupEventListeners();
    updateStartButton();
  }

  /**
   * Render the initial filter row (now starts empty)
   */
  function renderInitialFilter() {
    const container = document.getElementById('filters-container');
    if (!container) return;

    container.innerHTML = '';
    // User must click "Add Filter" to create first row
  }

  /**
   * Add a new filter row
   */
  function addFilterRow() {
    filterCount++;
    const container = document.getElementById('filters-container');
    if (!container) return;

    const filterRow = document.createElement('div');
    filterRow.className = 'filter-row flex items-center gap-3 mb-3';
    filterRow.dataset.filterId = filterCount;

    filterRow.innerHTML = `
      <select class="filter-type-selector w-32 sm:w-48 border border-[color:var(--border)] rounded-lg shadow-sm text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--primary)]/30" 
              data-filter-id="${filterCount}">
        <option value="">Select type...</option>
        <option value="${FILTER_TYPES.DISTRICT}">District</option>
        <option value="${FILTER_TYPES.GROUP}">Group</option>
        <option value="${FILTER_TYPES.SCHOOL}">School</option>
        <option value="${FILTER_TYPES.CLASS}">Class</option>
        <option value="${FILTER_TYPES.STUDENT}">Student</option>
      </select>
      <div class="filter-value-container flex-grow"></div>
      <button class="remove-filter-btn p-2 text-[color:var(--muted-foreground)] hover:text-[color:var(--destructive)] transition-colors flex-shrink-0" 
              data-filter-id="${filterCount}"
              title="Remove filter">
        <i data-lucide="x-circle" class="w-5 h-5"></i>
      </button>
    `;

    container.appendChild(filterRow);
    lucide.createIcons();

    // Set up event listener for type selector
    const typeSelector = filterRow.querySelector('.filter-type-selector');
    typeSelector.addEventListener('change', (e) => handleFilterTypeChange(e.target));

    // Set up remove button
    const removeBtn = filterRow.querySelector('.remove-filter-btn');
    removeBtn.addEventListener('click', () => removeFilterRow(filterCount));

    // Update filter availability for the new row
    updateFilterAvailability();
  }

  /**
   * Handle filter type selection change
   * @param {HTMLElement} typeSelector - The type selector element
   */
  function handleFilterTypeChange(typeSelector) {
    const filterId = typeSelector.dataset.filterId;
    const filterType = typeSelector.value;
    const filterRow = typeSelector.closest('.filter-row');
    const valueContainer = filterRow.querySelector('.filter-value-container');

    if (!filterType) {
      valueContainer.innerHTML = '';
      delete activeFilters[filterId];
      updateChips();
      updateStartButton();
      updateFilterAvailability();
      return;
    }

    // Check if this filter type is allowed based on existing filters
    if (!isFilterTypeAllowed(filterType)) {
      const conflictMessage = getFilterConflictMessage(filterType);
      alert(conflictMessage);
      typeSelector.value = '';
      return;
    }

    // Render appropriate value selector
    renderValueSelector(valueContainer, filterType, filterId);
    updateStartButton();
    updateFilterAvailability();
  }

  /**
   * Render value selector based on filter type
   * @param {HTMLElement} container - Container element
   * @param {string} filterType - Type of filter
   * @param {string} filterId - Filter ID
   */
  function renderValueSelector(container, filterType, filterId) {
    switch (filterType) {
      case FILTER_TYPES.DISTRICT:
        renderDistrictSelector(container, filterId);
        break;
      case FILTER_TYPES.GROUP:
        renderGroupSelector(container, filterId);
        break;
      case FILTER_TYPES.SCHOOL:
        renderSchoolSelector(container, filterId);
        break;
      case FILTER_TYPES.CLASS:
        renderClassSelector(container, filterId);
        break;
      case FILTER_TYPES.STUDENT:
        renderStudentSelector(container, filterId);
        break;
    }
  }

  /**
   * Render district dropdown (filtered by Group if selected)
   */
  function renderDistrictSelector(container, filterId) {
    const select = document.createElement('select');
    select.className = 'w-full border border-[color:var(--border)] rounded-lg shadow-sm text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--primary)]/30';
    select.dataset.filterId = filterId;
    select.dataset.filterType = FILTER_TYPES.DISTRICT;

    // Check if Group is already selected
    const groupFilter = Object.values(activeFilters).find(f => f.type === FILTER_TYPES.GROUP);
    
    // Check if this filter already has a value
    const currentFilter = activeFilters[filterId];
    const currentValue = currentFilter?.type === FILTER_TYPES.DISTRICT ? currentFilter.value : '';
    
    let availableDistricts = appData.districts;
    if (groupFilter) {
      // Filter districts to only those that have schools in the selected group
      const districtsInGroup = new Set(
        appData.schools
          .filter(s => s.group === parseInt(groupFilter.value))
          .map(s => s.district)
      );
      availableDistricts = appData.districts.filter(d => districtsInGroup.has(d));
    }

    select.innerHTML = `
      <option value="">Choose district...</option>
      ${availableDistricts.map(d => `<option value="${d}" ${String(d) === String(currentValue) ? 'selected' : ''}>${d}</option>`).join('')}
    `;

    select.addEventListener('change', () => handleValueChange(filterId, FILTER_TYPES.DISTRICT, select.value));
    container.innerHTML = '';
    container.appendChild(select);
  }

  /**
   * Render group dropdown (filtered by District if selected)
   */
  function renderGroupSelector(container, filterId) {
    const select = document.createElement('select');
    select.className = 'w-full border border-[color:var(--border)] rounded-lg shadow-sm text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--primary)]/30';
    select.dataset.filterId = filterId;
    select.dataset.filterType = FILTER_TYPES.GROUP;

    // Check if District is already selected
    const districtFilter = Object.values(activeFilters).find(f => f.type === FILTER_TYPES.DISTRICT);
    
    // Check if this filter already has a value
    const currentFilter = activeFilters[filterId];
    const currentValue = currentFilter?.type === FILTER_TYPES.GROUP ? currentFilter.value : '';
    
    let availableGroups = appData.groups;
    if (districtFilter) {
      // Filter groups to only those that have schools in the selected district
      const groupsInDistrict = new Set(
        appData.schools
          .filter(s => s.district === districtFilter.value)
          .map(s => s.group)
      );
      availableGroups = appData.groups.filter(g => groupsInDistrict.has(g));
    }

    select.innerHTML = `
      <option value="">Choose group...</option>
      ${availableGroups.map(g => `<option value="${g}" ${String(g) === String(currentValue) ? 'selected' : ''}>${g}</option>`).join('')}
    `;

    select.addEventListener('change', () => handleValueChange(filterId, FILTER_TYPES.GROUP, select.value));
    container.innerHTML = '';
    container.appendChild(select);
  }

  /**
   * Render school searchable dropdown
   */
  function renderSchoolSelector(container, filterId) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search school by name or ID...';
    input.className = 'w-full border border-[color:var(--border)] rounded-lg shadow-sm text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--primary)]/30 font-noto';
    input.dataset.filterId = filterId;
    input.dataset.filterType = FILTER_TYPES.SCHOOL;
    input.autocomplete = 'off';

    // Check if this filter already has a value
    const currentFilter = activeFilters[filterId];
    if (currentFilter?.type === FILTER_TYPES.SCHOOL && currentFilter.value) {
      input.value = currentFilter.value.displayName || '';
    }

    const dropdown = document.createElement('div');
    dropdown.className = 'absolute z-10 mt-1 w-full bg-white border border-[color:var(--border)] rounded-lg shadow-lg max-h-60 overflow-y-auto hidden';
    dropdown.dataset.filterId = filterId;

    let selectedIndex = -1;
    
    input.addEventListener('input', () => {
      selectedIndex = -1;
      showSchoolDropdown(input, dropdown, filterId);
    });
    input.addEventListener('focus', () => showSchoolDropdown(input, dropdown, filterId));
    input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 200));
    
    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
      const options = dropdown.querySelectorAll('.school-option');
      if (options.length === 0) return;
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, options.length - 1);
        updateSelectedOption(options, selectedIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateSelectedOption(options, selectedIndex);
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        // Trigger mousedown event (not click) since handlers are on mousedown
        const mousedownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        options[selectedIndex].dispatchEvent(mousedownEvent);
      }
    });

    container.innerHTML = '';
    container.style.position = 'relative';
    container.appendChild(input);
    container.appendChild(dropdown);
  }

  /**
   * Helper function to update selected option styling for keyboard navigation
   */
  function updateSelectedOption(options, selectedIndex) {
    options.forEach((opt, idx) => {
      if (idx === selectedIndex) {
        opt.classList.add('bg-gray-200', 'keyboard-selected');
        opt.scrollIntoView({ block: 'nearest' });
      } else {
        opt.classList.remove('bg-gray-200', 'keyboard-selected');
      }
    });
  }

  /**
   * Show school dropdown with filtered results (respecting District/Group filters)
   * Only shows dropdown when user types at least 1 character
   */
  function showSchoolDropdown(input, dropdown, filterId) {
    const query = input.value.trim();
    
    // Don't show dropdown if no query entered
    if (!query) {
      dropdown.classList.add('hidden');
      return;
    }
    
    const queryLower = query.toLowerCase();
    
    // Get active District and Group filters
    const districtFilter = Object.values(activeFilters).find(f => f.type === FILTER_TYPES.DISTRICT);
    const groupFilter = Object.values(activeFilters).find(f => f.type === FILTER_TYPES.GROUP);
    
    // Start with all schools, then apply filters
    let availableSchools = appData.schools;
    
    // Filter by district if selected
    if (districtFilter) {
      availableSchools = availableSchools.filter(s => s.district === districtFilter.value);
    }
    
    // Filter by group if selected
    if (groupFilter) {
      availableSchools = availableSchools.filter(s => s.group === parseInt(groupFilter.value));
    }
    
    // Apply search query
    const filtered = availableSchools.filter(s => 
      s.schoolId.toLowerCase().includes(queryLower) ||
      s.schoolName.toLowerCase().includes(queryLower) ||
      s.schoolNameChinese.includes(query)
    ).slice(0, 50);

    if (filtered.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }

    dropdown.innerHTML = filtered.map(school => `
      <div class="px-3 py-2 cursor-pointer text-sm font-noto school-option" 
           data-school-id="${school.schoolId}"
           data-display-name="${school.displayName}"
           onmouseenter="this.classList.add('bg-gray-200')" 
           onmouseleave="if(!this.classList.contains('keyboard-selected')) this.classList.remove('bg-gray-200')">
        ${school.displayName}
      </div>
    `).join('');

    dropdown.querySelectorAll('.school-option').forEach(option => {
      // Use mousedown instead of click to fire before blur event
      option.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur from firing
        const schoolId = option.dataset.schoolId;
        const school = appData.schoolsMap.get(schoolId);
        input.value = option.dataset.displayName;
        dropdown.classList.add('hidden');
        handleValueChange(filterId, FILTER_TYPES.SCHOOL, school);
        input.blur();
      });
    });

    dropdown.classList.remove('hidden');
  }

  /**
   * Render class searchable input (filtered by ALL active higher-level filters)
   * Priority: School > District+Group (intersection)
   * Searchable by class ID and class name
   */
  function renderClassSelector(container, filterId) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search class by name or ID...';
    input.className = 'w-full border border-[color:var(--border)] rounded-lg shadow-sm text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--primary)]/30 font-noto';
    input.dataset.filterId = filterId;
    input.dataset.filterType = FILTER_TYPES.CLASS;
    input.autocomplete = 'off';

    // Check if this filter already has a value
    const currentFilter = activeFilters[filterId];
    if (currentFilter?.type === FILTER_TYPES.CLASS && currentFilter.value) {
      input.value = currentFilter.value.displayName || '';
    }

    const dropdown = document.createElement('div');
    dropdown.className = 'absolute z-10 mt-1 w-full bg-white border border-[color:var(--border)] rounded-lg shadow-lg max-h-60 overflow-y-auto hidden';
    dropdown.dataset.filterId = filterId;

    let selectedIndex = -1;
    
    input.addEventListener('input', () => {
      selectedIndex = -1;
      showClassDropdown(input, dropdown, filterId);
    });
    input.addEventListener('focus', () => showClassDropdown(input, dropdown, filterId));
    input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 200));
    
    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
      const options = dropdown.querySelectorAll('.class-option');
      if (options.length === 0) return;
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, options.length - 1);
        updateSelectedOption(options, selectedIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateSelectedOption(options, selectedIndex);
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        // Trigger mousedown event (not click) since handlers are on mousedown
        const mousedownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        options[selectedIndex].dispatchEvent(mousedownEvent);
      }
    });

    container.innerHTML = '';
    container.style.position = 'relative';
    container.appendChild(input);
    container.appendChild(dropdown);
  }

  /**
   * Show class dropdown with filtered results (respecting ALL active higher-level filters)
   * Priority: School > District+Group (intersection)
   * Search by class ID and class name
   */
  function showClassDropdown(input, dropdown, filterId) {
    const query = input.value.trim();
    
    // Don't show dropdown if no query entered
    if (!query) {
      dropdown.classList.add('hidden');
      return;
    }
    
    const queryLower = query.toLowerCase();
    
    // Get active filters
    const districtFilter = Object.values(activeFilters).find(f => f.type === FILTER_TYPES.DISTRICT);
    const groupFilter = Object.values(activeFilters).find(f => f.type === FILTER_TYPES.GROUP);
    const schoolFilter = Object.values(activeFilters).find(f => f.type === FILTER_TYPES.SCHOOL);

    // Get available classes based on filters
    let availableClasses = appData.classes;
    
    // Priority 1: If school is selected, only show classes from that school
    if (schoolFilter) {
      const schoolId = schoolFilter.value.schoolId || schoolFilter.value;
      availableClasses = availableClasses.filter(c => c.schoolId === schoolId);
    }
    // Priority 2: If no school, filter by District AND/OR Group (intersection)
    else {
      // Start with all schools, apply both filters
      let filteredSchools = appData.schools;
      
      if (districtFilter) {
        filteredSchools = filteredSchools.filter(s => s.district === districtFilter.value);
      }
      
      if (groupFilter) {
        filteredSchools = filteredSchools.filter(s => s.group === parseInt(groupFilter.value));
      }
      
      const schoolIds = new Set(filteredSchools.map(s => s.schoolId));
      availableClasses = availableClasses.filter(c => schoolIds.has(c.schoolId));
    }
    
    // Apply search query - search by class ID and class name
    const filtered = availableClasses.filter(c => 
      c.classId.toLowerCase().includes(queryLower) ||
      c.actualClassName.toLowerCase().includes(queryLower) ||
      c.displayName.toLowerCase().includes(queryLower)
    ).slice(0, 50);

    if (filtered.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }

    dropdown.innerHTML = filtered.map(classItem => `
      <div class="px-3 py-2 cursor-pointer text-sm font-noto class-option" 
           data-class-id="${classItem.classId}"
           data-display-name="${classItem.displayName}"
           onmouseenter="this.classList.add('bg-gray-200')" 
           onmouseleave="if(!this.classList.contains('keyboard-selected')) this.classList.remove('bg-gray-200')">
        <div class="font-medium">${classItem.actualClassName}</div>
        <div class="text-xs text-[color:var(--muted-foreground)]">Class ID: ${classItem.classId}</div>
      </div>
    `).join('');

    dropdown.querySelectorAll('.class-option').forEach(option => {
      // Use mousedown instead of click to fire before blur event
      option.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur from firing
        const classId = option.dataset.classId;
        const classData = appData.classesMap.get(classId);
        input.value = option.dataset.displayName;
        dropdown.classList.add('hidden');
        handleValueChange(filterId, FILTER_TYPES.CLASS, classData);
        input.blur();
      });
    });

    dropdown.classList.remove('hidden');
  }

  /**
   * Render student searchable input
   */
  function renderStudentSelector(container, filterId) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search by name, or C/St prefix for Core/Student ID...';
    input.className = 'w-full border border-[color:var(--border)] rounded-lg shadow-sm text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--primary)]/30 font-noto';
    input.dataset.filterId = filterId;
    input.dataset.filterType = FILTER_TYPES.STUDENT;
    input.autocomplete = 'off';

    // Check if this filter already has a value
    const currentFilter = activeFilters[filterId];
    if (currentFilter?.type === FILTER_TYPES.STUDENT && currentFilter.value) {
      input.value = currentFilter.value.displayName || '';
    }

    const dropdown = document.createElement('div');
    dropdown.className = 'absolute z-10 mt-1 w-full bg-white border border-[color:var(--border)] rounded-lg shadow-lg max-h-60 overflow-y-auto hidden';
    dropdown.dataset.filterId = filterId;

    let selectedIndex = -1;
    
    input.addEventListener('input', () => {
      selectedIndex = -1;
      showStudentDropdown(input, dropdown, filterId);
    });
    input.addEventListener('focus', () => showStudentDropdown(input, dropdown, filterId));
    input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 200));
    
    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
      const options = dropdown.querySelectorAll('.student-option');
      if (options.length === 0) return;
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, options.length - 1);
        updateSelectedOption(options, selectedIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateSelectedOption(options, selectedIndex);
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        // Trigger mousedown event (not click) since handlers are on mousedown
        const mousedownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        options[selectedIndex].dispatchEvent(mousedownEvent);
      }
    });

    container.innerHTML = '';
    container.style.position = 'relative';
    container.appendChild(input);
    container.appendChild(dropdown);
  }

  /**
   * Show student dropdown with filtered results (respecting ALL active filters)
   * Priority: Class > School > District+Group (intersection)
   * Smart search: "C" prefix = Core ID only, "St" prefix = Student ID only, otherwise search all
   */
  function showStudentDropdown(input, dropdown, filterId) {
    const query = input.value.trim();
    
    // Don't show dropdown if no query entered
    if (!query) {
      dropdown.classList.add('hidden');
      return;
    }
    
    const queryLower = query.toLowerCase();
    
    // Get ALL active filters
    const districtFilter = Object.values(activeFilters).find(f => f.type === FILTER_TYPES.DISTRICT);
    const groupFilter = Object.values(activeFilters).find(f => f.type === FILTER_TYPES.GROUP);
    const schoolFilter = Object.values(activeFilters).find(f => f.type === FILTER_TYPES.SCHOOL);
    const classFilter = Object.values(activeFilters).find(f => f.type === FILTER_TYPES.CLASS);
    
    // Start with all students, then apply filters hierarchically
    let availableStudents = appData.students;
    
    // Priority 1: Filter by class if selected (most specific)
    if (classFilter) {
      availableStudents = availableStudents.filter(s => s.classId === classFilter.value.classId);
    }
    // Priority 2: Filter by school if selected
    else if (schoolFilter) {
      availableStudents = availableStudents.filter(s => s.schoolId === schoolFilter.value.schoolId);
    }
    // Priority 3: Filter by District AND/OR Group (intersection if both selected)
    else if (districtFilter || groupFilter) {
      // Get schools that match BOTH filters (if both are selected)
      let filteredSchools = appData.schools;
      
      if (districtFilter) {
        filteredSchools = filteredSchools.filter(s => s.district === districtFilter.value);
      }
      
      if (groupFilter) {
        filteredSchools = filteredSchools.filter(s => s.group === parseInt(groupFilter.value));
      }
      
      const schoolIds = new Set(filteredSchools.map(s => s.schoolId));
      availableStudents = availableStudents.filter(s => schoolIds.has(s.schoolId));
    }
    
    // Apply smart search query
    let filtered;
    if (queryLower.startsWith('c') && queryLower.length > 1) {
      // Search Core ID only (e.g., "C10001")
      filtered = availableStudents.filter(s => s.coreId.toLowerCase().includes(queryLower));
    } else if (queryLower.startsWith('st') && queryLower.length > 2) {
      // Search Student ID only (e.g., "St10001")
      filtered = availableStudents.filter(s => s.studentId.toLowerCase().includes(queryLower));
    } else {
      // Search all fields (Student ID, Core ID, Name)
      filtered = availableStudents.filter(s => 
        s.studentId.toLowerCase().includes(queryLower) ||
        s.coreId.toLowerCase().includes(queryLower) ||
        s.studentName.toLowerCase().includes(queryLower)
      );
    }
    
    filtered = filtered.slice(0, 50);

    if (filtered.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }

    dropdown.innerHTML = filtered.map(student => `
      <div class="px-3 py-2 cursor-pointer text-sm font-noto student-option" 
           data-core-id="${student.coreId}"
           data-display-name="${student.displayName}"
           onmouseenter="this.classList.add('bg-gray-200')" 
           onmouseleave="if(!this.classList.contains('keyboard-selected')) this.classList.remove('bg-gray-200')">
        <div class="font-medium">${student.studentName}</div>
        <div class="text-xs text-[color:var(--muted-foreground)]">Core ID: ${student.coreId} · Student ID: ${student.studentId}</div>
      </div>
    `).join('');

    dropdown.querySelectorAll('.student-option').forEach(option => {
      // Use mousedown instead of click to fire before blur event
      option.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur from firing
        const coreId = option.dataset.coreId;
        const student = appData.coreIdMap.get(coreId);
        input.value = option.dataset.displayName;
        dropdown.classList.add('hidden');
        handleValueChange(filterId, FILTER_TYPES.STUDENT, student);
        input.blur();
      });
    });

    dropdown.classList.remove('hidden');
  }

  /**
   * Handle value selection for a filter
   */
  function handleValueChange(filterId, filterType, value) {
    if (!value) {
      delete activeFilters[filterId];
    } else {
      activeFilters[filterId] = { type: filterType, value };
    }

    updateChips();
    updateStartButton();
    updateFilterAvailability();
    
    // Refresh dependent filters when upstream filters change
    // District/Group affect each other and Schools
    // Schools affect Classes
    // School/Class affect Students
    if ([FILTER_TYPES.DISTRICT, FILTER_TYPES.GROUP, FILTER_TYPES.SCHOOL, FILTER_TYPES.CLASS].includes(filterType)) {
      refreshDependentFilters();
    }
  }

  /**
   * Check if a filter type is allowed based on hierarchy rules
   * 
   * Hierarchy (user-facing levels):
   * - Level 1: District OR Group (independent dimensions, can coexist)
   * - Level 2: School
   * - Level 3: Class
   * - Level 4: Student (most specific)
   * 
   * Once a more specific level is selected, less specific levels are not allowed
   * District and Group are independent and can both be selected together
   * @param {string} filterType - The filter type to check
   * @returns {boolean} - True if allowed
   */
  function isFilterTypeAllowed(filterType) {
    const filters = Object.values(activeFilters);
    
    // Internal comparison values (higher number = more specific)
    // Note: This is for comparison logic, NOT the user-facing "Level" numbers
    const hierarchyLevel = {
      [FILTER_TYPES.DISTRICT]: 1,  // Level 1 in UI (independent)
      [FILTER_TYPES.GROUP]: 1,     // Level 1 in UI (independent, can coexist)
      [FILTER_TYPES.SCHOOL]: 2,    // Level 2 in UI
      [FILTER_TYPES.CLASS]: 3,     // Level 3 in UI
      [FILTER_TYPES.STUDENT]: 4    // Level 4 in UI (most specific)
    };

    const newFilterLevel = hierarchyLevel[filterType];

    // Check if any existing filter is more specific (higher level)
    for (const filter of filters) {
      const existingLevel = hierarchyLevel[filter.type];
      
      // If existing filter is more specific, don't allow higher-level filters
      // BUT allow District and Group to coexist (both level 1)
      if (existingLevel > newFilterLevel) {
        return false;
      }
      
      // Don't allow duplicate filter types
      if (filter.type === filterType) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get user-friendly message about filter conflicts
   * @param {string} filterType - The filter type that's blocked
   * @returns {string} - Error message
   */
  function getFilterConflictMessage(filterType) {
    const filters = Object.values(activeFilters);
    
    // Find the blocking filter
    const blockingFilter = filters.find(f => {
      const hierarchyLevel = {
        [FILTER_TYPES.DISTRICT]: 1,  // Independent dimension
        [FILTER_TYPES.GROUP]: 1,     // Independent dimension
        [FILTER_TYPES.SCHOOL]: 2,
        [FILTER_TYPES.CLASS]: 3,
        [FILTER_TYPES.STUDENT]: 4
      };
      return hierarchyLevel[f.type] > hierarchyLevel[filterType];
    });

    if (blockingFilter) {
      return `Cannot add ${filterType} filter: A ${blockingFilter.type} is already selected. Remove the ${blockingFilter.type} filter first, as it is more specific.`;
    }

    // Check for duplicates
    const duplicate = filters.find(f => f.type === filterType);
    if (duplicate) {
      return `${filterType} filter is already selected. Remove it first if you want to change the selection.`;
    }

    return `Cannot add ${filterType} filter due to existing selection.`;
  }

  /**
   * Update filter type options based on current selections
   * Disable options that violate hierarchy rules
   */
  function updateFilterAvailability() {
    document.querySelectorAll('.filter-type-selector').forEach(selector => {
      const currentValue = selector.value;
      
      // Update each option's disabled state
      Array.from(selector.options).forEach(option => {
        if (!option.value) {
          option.disabled = false; // "Select type..." always enabled
          return;
        }

        // Check if this option would be allowed
        const wouldBeAllowed = isFilterTypeAllowed(option.value);
        option.disabled = !wouldBeAllowed && option.value !== currentValue;

        // Add visual hint for disabled options
        if (option.disabled) {
          option.textContent = option.value + ' (not available)';
        } else {
          option.textContent = option.value;
        }
      });
    });
  }

  /**
   * Refresh filters that depend on other selections
   * Cascading: District/Group affects Schools, School affects Classes, School/Class affects Students
   */
  function refreshDependentFilters() {
    document.querySelectorAll('.filter-type-selector').forEach(typeSelector => {
      const filterId = typeSelector.dataset.filterId;
      const filterRow = typeSelector.closest('.filter-row');
      const valueContainer = filterRow.querySelector('.filter-value-container');
      const filterType = typeSelector.value;
      
      // Re-render the value selector for dependent filter types
      switch (filterType) {
        case FILTER_TYPES.DISTRICT:
          renderDistrictSelector(valueContainer, filterId);
          break;
        case FILTER_TYPES.GROUP:
          renderGroupSelector(valueContainer, filterId);
          break;
        case FILTER_TYPES.SCHOOL:
          // School autocomplete needs to be re-initialized if District/Group changed
          renderSchoolSelector(valueContainer, filterId);
          break;
        case FILTER_TYPES.CLASS:
          renderClassSelector(valueContainer, filterId);
          break;
        case FILTER_TYPES.STUDENT:
          // Student autocomplete needs to be re-initialized if School/Class changed
          renderStudentSelector(valueContainer, filterId);
          break;
      }
    });
  }

  /**
   * Remove a filter row
   */
  function removeFilterRow(filterId) {
    delete activeFilters[filterId];
    
    // Find the actual filter row (not the chip button)
    const filterRow = document.querySelector(`.filter-row[data-filter-id="${filterId}"]`);
    if (filterRow) {
      filterRow.remove();
    }
    
    updateChips();
    updateStartButton();
    updateFilterAvailability();
    refreshDependentFilters();
  }

  /**
   * Update filter chips display
   */
  function updateChips() {
    const chipsContainer = document.getElementById('filter-chips');
    if (!chipsContainer) return;

    const filterArray = Object.entries(activeFilters);
    
    if (filterArray.length === 0) {
      chipsContainer.innerHTML = '<span class="text-xs text-[color:var(--muted-foreground)]">No filters applied</span>';
      document.getElementById('filter-count').textContent = '0 filters applied';
      return;
    }

    chipsContainer.innerHTML = filterArray.map(([filterId, filter]) => {
      const displayValue = getDisplayValue(filter);
      return `
        <button class="filter-chip inline-flex items-center gap-1.5 px-3 py-1.5 bg-[color:var(--primary)]/10 text-[color:var(--primary)] rounded-full text-xs font-medium hover:bg-[color:var(--primary)]/20 transition-colors"
                data-filter-id="${filterId}">
          <span>${filter.type}: ${displayValue}</span>
          <i data-lucide="x" class="w-3 h-3"></i>
        </button>
      `;
    }).join('');

    // Set up chip remove handlers
    chipsContainer.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const filterId = chip.dataset.filterId;
        removeFilterRow(filterId);
      });
    });

    document.getElementById('filter-count').textContent = `${filterArray.length} filter${filterArray.length > 1 ? 's' : ''} applied`;
    lucide.createIcons();
  }

  /**
   * Get display value for a filter
   */
  function getDisplayValue(filter) {
    if (typeof filter.value === 'string') return filter.value;
    if (filter.value.displayName) return filter.value.displayName;
    if (filter.value.schoolName) return filter.value.schoolName;
    if (filter.value.actualClassName) return filter.value.actualClassName;
    return 'Selected';
  }

  /**
   * Update start button state
   */
  function updateStartButton() {
    const startBtn = document.getElementById('start-checking-btn');
    if (!startBtn) return;

    const hasFilters = Object.keys(activeFilters).length > 0;
    startBtn.disabled = !hasFilters;
    
    if (hasFilters) {
      startBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
      startBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
  }

  /**
   * Setup event listeners
   */
  function setupEventListeners() {
    // Add filter button
    const addFilterBtn = document.getElementById('add-filter-btn');
    if (addFilterBtn) {
      addFilterBtn.addEventListener('click', addFilterRow);
    }

    // Clear all button
    const clearAllBtn = document.getElementById('clear-all-btn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        activeFilters = {};
        renderInitialFilter();
        updateChips();
        updateStartButton();
        updateFilterAvailability();
      });
    }

    // Start checking button
    const startBtn = document.getElementById('start-checking-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        if (Object.keys(activeFilters).length > 0) {
          window.CheckingSystemRouter.navigateTodrilldown(activeFilters);
        }
      });
    }
  }

  /**
   * Get current active filters
   */
  function getActiveFilters() {
    return activeFilters;
  }

  // Export to global scope
  window.CheckingSystemFilters = {
    initialize,
    getActiveFilters,
    FILTER_TYPES
  };
})();
