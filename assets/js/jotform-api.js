/**
 * Jotform API Utility Module
 * Shared functions for calling Jotform API across all pages
 */
(() => {
  const JOTFORM_BASE_URL = 'https://api.jotform.com';

  /**
   * Fetch submissions from Jotform API with filter
   * NOW USES GLOBAL CACHE - filters client-side instead of API-side
   * @param {Object} params - API call parameters
   * @param {string} params.filter - Filter object (will be applied client-side)
   * @param {number} [params.limit=1000] - Max submissions to return (ignored, uses all cached)
   * @param {string} [params.orderby='created_at'] - Field to order by
   * @param {string} [params.direction='ASC'] - Sort direction
   * @param {boolean} [params.verbose=true] - Enable detailed logging
   * @returns {Promise<Array>} - Array of submissions
   */
  async function fetchSubmissions({ filter, limit = 1000, orderby = 'created_at', direction = 'ASC', verbose = true }) {
    try {
      // Get credentials from cached data (already decrypted on home page)
      const cachedData = window.CheckingSystemData?.getCachedData();
      if (!cachedData || !cachedData.credentials) {
        throw new Error('Credentials not available. Please return to home page and re-enter password.');
      }

      const credentials = cachedData.credentials;

      // Credentials use jotformApiKey and jotformFormId (not apiKey/formId)
      const apiKey = credentials.jotformApiKey || credentials.apiKey;
      const formId = credentials.jotformFormId || credentials.formId;

      if (!apiKey || !formId) {
        throw new Error('Jotform credentials missing apiKey or formId');
      }

      if (verbose) {
        console.log('[JotformAPI] ========== FETCH (GLOBAL CACHE) ==========');
        console.log('[JotformAPI] Form ID:', formId);
        console.log('[JotformAPI] Filter (will be applied client-side):', filter);
      }

      // Use global cache manager
      if (!window.JotFormCache) {
        throw new Error('JotFormCache not initialized - include jotform-cache.js before this script');
      }

      // Get all submissions from cache or API
      const allSubmissions = await window.JotFormCache.getAllSubmissions({
        formId: formId,
        apiKey: apiKey
      });

      if (verbose) {
        console.log('[JotformAPI] Total submissions in cache:', allSubmissions.length);
      }

      // Apply filter client-side
      let filteredSubmissions = allSubmissions;
      
      // Common filter: {"20:eq":"10001"} - student ID exact match
      if (filter && typeof filter === 'object') {
        for (const [key, value] of Object.entries(filter)) {
          // Parse key: "20:eq" → qid=20, operator=eq
          const [qid, operator] = key.split(':');
          
          filteredSubmissions = filteredSubmissions.filter(submission => {
            const answer = submission.answers?.[qid];
            const answerValue = answer?.answer || answer?.text || null;
            
            if (operator === 'eq') {
              return answerValue === value;
            } else if (operator === 'contains') {
              return answerValue && answerValue.includes(value);
            } else if (operator === 'startswith') {
              return answerValue && answerValue.startsWith(value);
            } else {
              // No operator, direct match
              return answerValue === value;
            }
          });
        }
      }

      if (verbose) {
        console.log('[JotformAPI] Filtered submissions:', filteredSubmissions.length);
        
        if (filteredSubmissions.length > 0) {
          console.log('[JotformAPI] First submission:', {
            id: filteredSubmissions[0].id,
            created_at: filteredSubmissions[0].created_at,
            answerCount: Object.keys(filteredSubmissions[0].answers || {}).length
          });
        } else {
          console.warn('[JotformAPI] ⚠️ No submissions matched filter');
        }
        console.log('[JotformAPI] =========================================');
      }

      return filteredSubmissions;

    } catch (error) {
      console.error('[JotformAPI] Failed to fetch submissions:', error);
      throw error;
    }
  }

  /**
   * Fetch submissions for a specific student by Core ID
   * @param {string} coreId - Student Core ID (e.g., "C10261")
   * @param {string} [studentIdQid='20'] - QID for student-id field
   * @param {boolean} [verbose=true] - Enable detailed logging
   * @returns {Promise<Array>} - Array of submissions
   */
  async function fetchStudentSubmissions(coreId, studentIdQid = '20', verbose = true) {
    // Strip "C" prefix from Core ID for Jotform query
    const coreIdNumeric = coreId.startsWith('C') ? coreId.substring(1) : coreId;

    if (verbose) {
      console.log('[JotformAPI] Fetching for student:', coreId, '(numeric:', coreIdNumeric + ')');
    }

    // MUST use QID for client-side filtering (answers indexed by QID, not field name)
    const filter = {
      [`${studentIdQid}:eq`]: coreIdNumeric
    };

    if (verbose) {
      console.log('[JotformAPI] Using QID filter for client-side filtering:', filter);
    }

    return fetchSubmissions({ filter, verbose });
  }

  /**
   * Fetch submissions for a specific school by School ID
   * @param {string} schoolId - School ID (e.g., "S001")
   * @param {string} [schoolIdQid='22'] - QID for school-id field
   * @param {boolean} [verbose=true] - Enable detailed logging
   * @returns {Promise<Array>} - Array of submissions
   */
  async function fetchSchoolSubmissions(schoolId, schoolIdQid = '22', verbose = true) {
    if (verbose) {
      console.log('[JotformAPI] Fetching for school:', schoolId);
    }

    const filter = {
      [`${schoolIdQid}:eq`]: schoolId
    };

    return fetchSubmissions({ filter, verbose });
  }

  /**
   * Fetch submissions for a specific class by Class ID
   * @param {string} classId - Class ID (e.g., "C-001-01")
   * @param {string} [classIdQid='24'] - QID for class-id field
   * @param {boolean} [verbose=true] - Enable detailed logging
   * @returns {Promise<Array>} - Array of submissions
   */
  async function fetchClassSubmissions(classId, classIdQid = '24', verbose = true) {
    if (verbose) {
      console.log('[JotformAPI] Fetching for class:', classId);
    }

    const filter = {
      [`${classIdQid}:eq`]: classId
    };

    return fetchSubmissions({ filter, verbose });
  }

  /**
   * Fetch submissions matching multiple filters (AND logic)
   * @param {Object} filters - Key-value pairs where key is "qid:operator" (e.g., {"22:eq": "S001", "24:eq": "C-001-01"})
   * @param {boolean} [verbose=true] - Enable detailed logging
   * @returns {Promise<Array>} - Array of submissions
   */
  async function fetchSubmissionsWithFilters(filters, verbose = true) {
    return fetchSubmissions({ filter: filters, verbose });
  }

  // Export to global scope
  window.JotformAPI = {
    fetchSubmissions,
    fetchStudentSubmissions,
    fetchSchoolSubmissions,
    fetchClassSubmissions,
    fetchSubmissionsWithFilters
  };
})();
