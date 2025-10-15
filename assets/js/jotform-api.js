/**
 * Jotform API Utility Module
 * Shared functions for calling Jotform API across all pages
 */
(() => {
  const JOTFORM_BASE_URL = 'https://api.jotform.com';

  /**
   * Fetch submissions from Jotform API with filter
   * @param {Object} params - API call parameters
   * @param {string} params.filter - Filter object (will be JSON stringified)
   * @param {number} [params.limit=1000] - Max submissions to return
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

      // Build URL
      const filterEncoded = encodeURIComponent(JSON.stringify(filter));
      const url = `${JOTFORM_BASE_URL}/form/${formId}/submissions?` +
                  `filter=${filterEncoded}` +
                  `&limit=${limit}` +
                  `&orderby=${orderby}` +
                  `&direction=${direction}` +
                  `&apiKey=${apiKey}`;

      if (verbose) {
        console.log('[JotformAPI] ========== API CALL ==========');
        console.log('[JotformAPI] Form ID:', formId);
        console.log('[JotformAPI] Filter:', filter);
        console.log('[JotformAPI] Filter (encoded):', filterEncoded);
        console.log('[JotformAPI] Full URL:', url.replace(apiKey, 'API_KEY_HIDDEN'));
      }

      // Make request
      const response = await fetch(url);

      if (verbose) {
        console.log('[JotformAPI] Response:', response.status, response.statusText);
      }

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Rate limited by Jotform API. Please try again later.');
        }
        throw new Error(`Jotform API error: ${response.status} ${response.statusText}`);
      }

      // Parse response
      const result = await response.json();
      const submissions = result.content || [];

      if (verbose) {
        console.log('[JotformAPI] Response structure:', {
          responseCode: result.responseCode,
          message: result.message,
          submissionCount: submissions.length
        });

        if (submissions.length > 0) {
          console.log('[JotformAPI] First submission:', {
            id: submissions[0].id,
            created_at: submissions[0].created_at,
            answerCount: Object.keys(submissions[0].answers || {}).length,
            studentIdField: submissions[0].answers?.['20']?.answer || submissions[0].answers?.['20']?.text || 'NOT FOUND'
          });
          console.log('[JotformAPI] ⚠️ WARNING: Got', submissions.length, 'submissions - filter may not be working!');
          if (submissions.length > 10) {
            console.log('[JotformAPI] Sample student IDs from first 5 submissions:');
            submissions.slice(0, 5).forEach((sub, idx) => {
              console.log(`  [${idx}] ID:`, sub.answers?.['20']?.answer || sub.answers?.['20']?.text || 'MISSING');
            });
          }
        } else {
          console.warn('[JotformAPI] ⚠️ No submissions found');
        }
        console.log('[JotformAPI] =========================================');
      }

      return submissions;

    } catch (error) {
      console.error('[JotformAPI] Failed to fetch submissions:', error);
      throw error;
    }
  }

  /**
   * Fetch submissions for a specific student by Core ID
   * @param {string} coreId - Student Core ID (e.g., "C10261")
   * @param {string} [studentIdQid='20'] - QID for student-id field (optional, uses field name by default)
   * @param {boolean} [verbose=true] - Enable detailed logging
   * @returns {Promise<Array>} - Array of submissions
   */
  async function fetchStudentSubmissions(coreId, studentIdQid = '20', verbose = true) {
    // Strip "C" prefix from Core ID for Jotform query
    const coreIdNumeric = coreId.startsWith('C') ? coreId.substring(1) : coreId;

    if (verbose) {
      console.log('[JotformAPI] Fetching for student:', coreId, '(numeric:', coreIdNumeric + ')');
    }

    // Try FIELD NAME first (Jotform recommends this over QID)
    const filter = {
      "student-id:eq": coreIdNumeric
    };

    if (verbose) {
      console.log('[JotformAPI] Using field name filter instead of QID');
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
