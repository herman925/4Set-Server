/**
 * Checking System User Preferences Manager
 * Centralized storage and retrieval of user UI preferences across drilldown pages
 * Uses localStorage for persistence between page navigations
 */

(() => {
  const STORAGE_PREFIX = 'checking_system_prefs_';
  
  /**
   * Storage keys for different preference types
   */
  const KEYS = {
    SECTION_STATES: 'section_states',      // Details element open/closed states
    VIEW_MODE: 'view_mode',                // Class page: 'set' or 'task'
    GRADE_SELECTION: 'grade_selection',    // Student page: 'K1', 'K2', or 'K3'
    TASK_FILTER: 'task_filter'             // Student page: task filter dropdown value
  };
  
  /**
   * Get a preference value from localStorage
   * @param {string} key - The preference key
   * @param {string} pageId - Optional page-specific identifier (e.g., 'class', 'student', classId, coreId)
   * @param {*} defaultValue - Default value if not found
   * @returns {*} The stored value or default
   */
  function getPreference(key, pageId = null, defaultValue = null) {
    try {
      const storageKey = pageId ? `${STORAGE_PREFIX}${pageId}_${key}` : `${STORAGE_PREFIX}${key}`;
      const stored = localStorage.getItem(storageKey);
      
      if (stored === null) {
        return defaultValue;
      }
      
      // Try to parse as JSON, fallback to raw string
      try {
        return JSON.parse(stored);
      } catch (e) {
        return stored;
      }
    } catch (error) {
      console.warn('[Preferences] Failed to get preference:', error);
      return defaultValue;
    }
  }
  
  /**
   * Set a preference value in localStorage
   * @param {string} key - The preference key
   * @param {*} value - The value to store
   * @param {string} pageId - Optional page-specific identifier
   */
  function setPreference(key, value, pageId = null) {
    try {
      const storageKey = pageId ? `${STORAGE_PREFIX}${pageId}_${key}` : `${STORAGE_PREFIX}${key}`;
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      localStorage.setItem(storageKey, stringValue);
    } catch (error) {
      console.warn('[Preferences] Failed to set preference:', error);
    }
  }
  
  /**
   * Clear all preferences or specific page preferences
   * @param {string} pageId - Optional page-specific identifier
   */
  function clearPreferences(pageId = null) {
    try {
      if (pageId) {
        // Clear only preferences for specific page
        const prefix = `${STORAGE_PREFIX}${pageId}_`;
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith(prefix)) {
            localStorage.removeItem(key);
          }
        });
      } else {
        // Clear all checking system preferences
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith(STORAGE_PREFIX)) {
            localStorage.removeItem(key);
          }
        });
      }
    } catch (error) {
      console.warn('[Preferences] Failed to clear preferences:', error);
    }
  }
  
  /**
   * Save section states (details elements open/closed) for a page
   * @param {string} pageId - Page identifier
   * @param {Object} states - Map of section IDs to boolean open states
   */
  function saveSectionStates(pageId, states) {
    setPreference(KEYS.SECTION_STATES, states, pageId);
  }
  
  /**
   * Get saved section states for a page
   * @param {string} pageId - Page identifier
   * @returns {Object} Map of section IDs to boolean open states
   */
  function getSectionStates(pageId) {
    return getPreference(KEYS.SECTION_STATES, pageId, {});
  }
  
  /**
   * Save view mode preference (class page)
   * @param {string} pageId - Page identifier (e.g., classId)
   * @param {string} mode - 'set' or 'task'
   */
  function saveViewMode(pageId, mode) {
    setPreference(KEYS.VIEW_MODE, mode, pageId);
  }
  
  /**
   * Get saved view mode preference (class page)
   * @param {string} pageId - Page identifier (e.g., classId)
   * @returns {string} 'set' or 'task', defaults to 'set'
   */
  function getViewMode(pageId) {
    return getPreference(KEYS.VIEW_MODE, pageId, 'set');
  }
  
  /**
   * Save grade selection preference (student page)
   * @param {string} coreId - Student core ID
   * @param {string} grade - 'K1', 'K2', or 'K3'
   */
  function saveGradeSelection(coreId, grade) {
    setPreference(KEYS.GRADE_SELECTION, grade, coreId);
  }
  
  /**
   * Get saved grade selection preference (student page)
   * @param {string} coreId - Student core ID
   * @returns {string|null} 'K1', 'K2', 'K3', or null if not set
   */
  function getGradeSelection(coreId) {
    return getPreference(KEYS.GRADE_SELECTION, coreId, null);
  }
  
  /**
   * Save task filter preference (student page)
   * @param {string} coreId - Student core ID
   * @param {string} filterValue - Filter dropdown value (e.g., 'all', 'missing', 'complete')
   */
  function saveTaskFilter(coreId, filterValue) {
    setPreference(KEYS.TASK_FILTER, filterValue, coreId);
  }
  
  /**
   * Get saved task filter preference (student page)
   * @param {string} coreId - Student core ID
   * @returns {string} Filter value, defaults to 'all'
   */
  function getTaskFilter(coreId) {
    return getPreference(KEYS.TASK_FILTER, coreId, 'all');
  }
  
  /**
   * Automatically track and save section states for a page
   * @param {string} pageId - Page identifier
   * @param {string} selector - CSS selector for details elements (default: 'details')
   */
  function autoTrackSectionStates(pageId, selector = 'details') {
    const details = document.querySelectorAll(selector);
    
    // Load and restore saved states
    const savedStates = getSectionStates(pageId);
    details.forEach((detail, index) => {
      const detailId = detail.id || `detail_${index}`;
      if (savedStates[detailId] !== undefined) {
        detail.open = savedStates[detailId];
      }
    });
    
    // Set up listeners to save state changes
    details.forEach((detail, index) => {
      const detailId = detail.id || `detail_${index}`;
      
      detail.addEventListener('toggle', () => {
        const currentStates = {};
        document.querySelectorAll(selector).forEach((d, i) => {
          const id = d.id || `detail_${i}`;
          currentStates[id] = d.open;
        });
        saveSectionStates(pageId, currentStates);
      });
    });
  }
  
  // Export to global scope
  window.CheckingSystemPreferences = {
    // Generic methods
    getPreference,
    setPreference,
    clearPreferences,
    
    // Section states
    saveSectionStates,
    getSectionStates,
    autoTrackSectionStates,
    
    // View mode (class page)
    saveViewMode,
    getViewMode,
    
    // Grade selection (student page)
    saveGradeSelection,
    getGradeSelection,
    
    // Task filter (student page)
    saveTaskFilter,
    getTaskFilter,
    
    // Constants
    KEYS
  };
  
  console.log('[Preferences] User preferences manager initialized');
})();
