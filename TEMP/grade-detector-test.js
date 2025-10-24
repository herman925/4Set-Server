/**
 * TEST-SPECIFIC VERSION - Grade Detection Utility
 * 
 * This is a modified version for TEMP test files (e.g., test-pipeline-core-id.html)
 * DO NOT use this in the main checking system - use assets/js/grade-detector.js instead
 * 
 * Changes from original:
 * - Universal Module Definition (UMD) pattern for Node.js and browser compatibility
 * - Can be used in both test HTML files and Node.js test scripts
 * 
 * ---
 * 
 * Grade Detection Utility
 * 
 * Determines student grade level (K1/K2/K3) based on assessment dates.
 * School year runs from August to July:
 * - K1: 2023/24 (Aug 2023 - Jul 2024)
 * - K2: 2024/25 (Aug 2024 - Jul 2025)
 * - K3: 2025/26 (Aug 2025 - Jul 2026)
 */

(function(global) {
  'use strict';

  const GradeDetector = (() => {
    /**
     * Determines grade from recordedDate (Qualtrics format: ISO 8601)
     * @param {string} recordedDate - ISO 8601 date string (e.g., "2024-10-07T05:10:05.400Z")
     * @returns {string} Grade level: 'K1', 'K2', 'K3', or 'Unknown'
     */
    function determineGradeFromRecordedDate(recordedDate) {
      if (!recordedDate) return 'Unknown';
      
      try {
        const date = new Date(recordedDate);
        const year = date.getFullYear();
        const month = date.getMonth() + 1; // 1-12
        
        // School year starts in August (month 8)
        // If month is Aug-Dec, use current year for school year
        // If month is Jan-Jul, use previous year for school year
        const schoolYear = month >= 8 ? year : year - 1;
        
        // Map school year to grade
        if (schoolYear === 2023) return 'K1';
        if (schoolYear === 2024) return 'K2';
        if (schoolYear === 2025) return 'K3';
        
        return 'Unknown';
      } catch (e) {
        console.warn('[GradeDetector] Error parsing recordedDate:', recordedDate, e);
        return 'Unknown';
      }
    }

    /**
     * Determines grade from sessionkey (JotForm format: coreId_YYYYMMDD_HH_MM)
     * @param {string} sessionkey - Session key string (e.g., "10261_20251014_10_59")
     * @returns {string} Grade level: 'K1', 'K2', 'K3', or 'Unknown'
     */
    function determineGradeFromSessionKey(sessionkey) {
      if (!sessionkey) return 'Unknown';
      
      try {
        const parts = sessionkey.split('_');
        if (parts.length < 2) return 'Unknown';
        
        const datePart = parts[1]; // "20251014"
        if (datePart.length !== 8) return 'Unknown';
        
        const year = parseInt(datePart.substring(0, 4)); // 2025
        const month = parseInt(datePart.substring(4, 6)); // 10 (October)
        
        // School year starts in August
        const schoolYear = month >= 8 ? year : year - 1;
        
        // Map school year to grade
        if (schoolYear === 2023) return 'K1';
        if (schoolYear === 2024) return 'K2';
        if (schoolYear === 2025) return 'K3';
        
        return 'Unknown';
      } catch (e) {
        console.warn('[GradeDetector] Error parsing sessionkey:', sessionkey, e);
        return 'Unknown';
      }
    }

    /**
     * Hybrid approach: Try multiple sources to determine grade
     * Priority: recordedDate (Qualtrics) > sessionkey (JotForm)
     * @param {Object} data - Merged student data with recordedDate and/or sessionkey
     * @returns {string} Grade level: 'K1', 'K2', 'K3', or 'Unknown'
     */
    function determineGrade(data) {
      if (!data) return 'Unknown';
      
      // Try recordedDate first (Qualtrics)
      if (data.recordedDate || data['recordedDate']) {
        const grade = determineGradeFromRecordedDate(data.recordedDate || data['recordedDate']);
        if (grade !== 'Unknown') return grade;
      }
      
      // Fall back to sessionkey (JotForm)
      if (data.sessionkey || data['sessionkey']) {
        const sessionkeyValue = typeof data.sessionkey === 'object' ? data.sessionkey.answer : data.sessionkey;
        const grade = determineGradeFromSessionKey(sessionkeyValue);
        if (grade !== 'Unknown') return grade;
      }
      
      return 'Unknown';
    }

    /**
     * Helper function to get school year from a date
     * Used for determining which academic year a date falls into
     * @param {Date|string} dateInput - Date object or ISO 8601 string
     * @returns {number|null} School year (e.g., 2024 for 2024/25 school year) or null if invalid
     */
    function getSchoolYear(dateInput) {
      if (!dateInput) return null;
      
      try {
        const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
        const year = date.getFullYear();
        const month = date.getMonth() + 1; // 1-12
        
        // School year starts in August
        return month >= 8 ? year : year - 1;
      } catch (e) {
        console.warn('[GradeDetector] Error getting school year:', dateInput, e);
        return null;
      }
    }

    // Public API
    return {
      determineGrade,
      determineGradeFromRecordedDate,
      determineGradeFromSessionKey,
      getSchoolYear
    };
  })();

  // Export for both Node.js and browser environments
  if (typeof module !== 'undefined' && module.exports) {
    // Node.js
    module.exports = GradeDetector;
  } else if (typeof global !== 'undefined') {
    // Browser (attach to window or global)
    global.GradeDetector = GradeDetector;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
