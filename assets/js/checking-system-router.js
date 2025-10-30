/**
 * Routing Logic for Checking System
 * Determines drilldown level and constructs URLs
 */
(() => {
  const FILTER_TYPES = {
    DISTRICT: 'District',
    GROUP: 'Group',
    SCHOOL: 'School',
    CLASS: 'Class',
    STUDENT: 'Student'
  };

  /**
   * Determine the appropriate drilldown level based on active filters
   * Note: District and Group are independent dimensions (can both be selected)
   * @param {Object} activeFilters - Active filters object
   * @returns {Object} - Route information { level, url, displayLabel }
   */
  function determineRoute(activeFilters) {
    const filters = Object.values(activeFilters);
    
    // Extract filter values by type
    const district = filters.find(f => f.type === FILTER_TYPES.DISTRICT)?.value;
    const group = filters.find(f => f.type === FILTER_TYPES.GROUP)?.value;
    const school = filters.find(f => f.type === FILTER_TYPES.SCHOOL)?.value;
    const classData = filters.find(f => f.type === FILTER_TYPES.CLASS)?.value;
    const student = filters.find(f => f.type === FILTER_TYPES.STUDENT)?.value;

    // Resolve school ID from school object
    const resolvedSchoolId = school?.schoolId || null;
    const resolvedSchoolData = school || null;

    // Determine level based on most specific filter (lowest level wins)
    // District and Group can coexist as they're independent dimensions
    let level, url, displayLabel;

    if (student) {
      // Level 4: Student Drilldown (most specific)
      // Only pass coreId - page can derive all parent context from data
      level = 4;
      url = `checking_system_4_student.html?coreId=${encodeURIComponent(student.coreId)}&year=${encodeURIComponent(student.year || student.grade || 'K3')}`;
      displayLabel = student.displayName;

    } else if (classData) {
      // Level 3: Class Drilldown
      // Only pass classId - page can derive school, district, group from class data
      // No school selection required - class data contains all parent context
      level = 3;
      url = `checking_system_3_class.html?classId=${encodeURIComponent(classData.classId)}`;
      // Display class name with school if available, otherwise just class
      displayLabel = resolvedSchoolData 
        ? `${classData.displayName} · ${resolvedSchoolData.schoolNameChinese || resolvedSchoolData.schoolName}`
        : classData.displayName;

    } else if (resolvedSchoolData) {
      // Level 2: School Drilldown
      // Only pass schoolId - page can derive district and group from school data
      level = 2;
      url = `checking_system_2_school.html?schoolId=${encodeURIComponent(resolvedSchoolId)}`;
      displayLabel = resolvedSchoolData?.displayName || resolvedSchoolId;

    } else if (group) {
      // Level 1: Group Drilldown (independent dimension)
      // Pass group, optionally district if both selected (they're independent)
      level = 1;
      url = `checking_system_1_group.html?group=${encodeURIComponent(group)}`;
      if (district) url += `&district=${encodeURIComponent(district)}`;
      displayLabel = `Group ${group}${district ? ' · ' + district : ''}`;

    } else if (district) {
      // Level 1: District Drilldown (independent dimension)
      // Pass district, optionally group if both selected (they're independent)
      level = 1;
      url = `checking_system_1_district.html?district=${encodeURIComponent(district)}`;
      if (group) url += `&group=${encodeURIComponent(group)}`;
      displayLabel = district;

    } else {
      throw new Error('Please select at least one filter.');
    }

    return {
      level,
      url,
      displayLabel,
      filters: {
        district,
        group,
        schoolId: resolvedSchoolId,
        classId: classData?.classId,
        studentId: student?.coreId
      }
    };
  }

  /**
   * Navigate to the determined drilldown page
   * @param {Object} activeFilters - Active filters object
   */
  function navigateTodrilldown(activeFilters) {
    try {
      const route = determineRoute(activeFilters);
      
      // Save to recent checks
      saveToRecentChecks(route);
      
      // Navigate
      window.location.href = route.url;
    } catch (error) {
      alert(error.message);
      console.error('Navigation error:', error);
    }
  }

  /**
   * Save route to recent checks in localStorage
   * @param {Object} route - Route information
   */
  function saveToRecentChecks(route) {
    try {
      const recentChecks = getRecentChecks();
      
      // Add to beginning of array
      recentChecks.unshift({
        timestamp: new Date().toISOString(),
        level: route.level,
        displayLabel: route.displayLabel,
        url: route.url,
        filters: route.filters
      });

      // Keep only last 10
      const trimmed = recentChecks.slice(0, 10);
      
      localStorage.setItem('checking_recent_checks', JSON.stringify(trimmed));
    } catch (error) {
      console.warn('Failed to save to recent checks:', error);
    }
  }

  /**
   * Get recent checks from localStorage
   * @returns {Array} - Array of recent check objects
   */
  function getRecentChecks() {
    try {
      const stored = localStorage.getItem('checking_recent_checks');
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.warn('Failed to load recent checks:', error);
      return [];
    }
  }

  /**
   * Render recent checks as pill buttons
   */
  function renderRecentChecks() {
    const container = document.getElementById('recent-checks-container');
    if (!container) return;

    const recentChecks = getRecentChecks();
    
    if (recentChecks.length === 0) {
      container.innerHTML = '<p class="text-xs text-[color:var(--muted-foreground)]">No recent checks</p>';
      return;
    }

    const levelIcons = {
      1: 'user',
      2: 'users',
      3: 'school',
      4: 'git-branch',
      5: 'map-pin'
    };

    container.innerHTML = recentChecks.slice(0, 5).map((check, index) => `
      <button class="pill-btn ${index === 0 ? 'pill-btn-active' : ''} text-xs font-semibold rounded-full px-4 py-2 border ${index === 0 ? '' : 'border-[color:var(--border)] bg-white hover:border-[color:var(--primary)]/30'}"
              data-url="${check.url}"
              title="${check.displayLabel}">
        <i data-lucide="${levelIcons[check.level]}" class="w-3 h-3 inline-block mr-1"></i>
        ${truncateLabel(check.displayLabel, 20)}
      </button>
    `).join('');

    // Add click handlers with cache check
    container.querySelectorAll('.pill-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        // Check if cache is ready before navigating
        if (window.CacheManagerUI && typeof window.CacheManagerUI.isCacheReady === 'function') {
          const cacheReady = await window.CacheManagerUI.isCacheReady();
          if (!cacheReady) {
            // Show blocking modal
            if (typeof window.CacheManagerUI.showBlockingModal === 'function') {
              window.CacheManagerUI.showBlockingModal();
            } else {
              alert('Please build the system cache first by clicking the red status pill above.');
            }
            return;
          }
        }
        
        // Cache is ready, navigate
        window.location.href = btn.dataset.url;
      });
    });

    lucide.createIcons();
  }

  /**
   * Truncate label to max length
   * @param {string} label - Label text
   * @param {number} maxLength - Maximum length
   * @returns {string} - Truncated label
   */
  function truncateLabel(label, maxLength) {
    if (label.length <= maxLength) return label;
    return label.substring(0, maxLength - 3) + '...';
  }

  /**
   * Generate display label from filters
   * @param {Object} filters - Filters object
   * @returns {string} - Display label
   */
  function generateDisplayLabel(filters) {
    const filterArray = Object.values(filters);
    
    const student = filterArray.find(f => f.type === FILTER_TYPES.STUDENT);
    if (student) return student.value.displayName;
    
    const classData = filterArray.find(f => f.type === FILTER_TYPES.CLASS);
    if (classData) return classData.value.displayName;
    
    const school = filterArray.find(f => f.type === FILTER_TYPES.SCHOOL);
    if (school) return school.value.displayName || school.value.schoolName;
    
    const group = filterArray.find(f => f.type === FILTER_TYPES.GROUP);
    if (group) return `Group ${group.value}`;
    
    const district = filterArray.find(f => f.type === FILTER_TYPES.DISTRICT);
    if (district) return district.value;
    
    return 'Unknown';
  }

  // Export to global scope
  window.CheckingSystemRouter = {
    determineRoute,
    navigateTodrilldown,
    getRecentChecks,
    renderRecentChecks,
    generateDisplayLabel
  };
})();
