/**
 * Jotform API Utility Module
 * Shared functions for calling Jotform API across all pages
 * 
 * CRITICAL: For student lookups, MUST use fetchStudentSubmissionsDirectly() which
 * uses the :matches operator on sessionkey field (QID 3). This is the ONLY working
 * filter for student data. See PRDs/checking_system_pipeline_prd.md for details.
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
      
      // Common filters: {"20:eq":"10001"}, {"q3:matches":"10261"}
      if (filter && typeof filter === 'object') {
        for (const [key, value] of Object.entries(filter)) {
          // Parse key: "20:eq" → qid=20, operator=eq
          // Parse key: "q3:matches" → qid=3, operator=matches (strip 'q' prefix if present)
          const [qidPart, operator] = key.split(':');
          const qid = qidPart.startsWith('q') ? qidPart.substring(1) : qidPart;
          
          filteredSubmissions = filteredSubmissions.filter(submission => {
            const answer = submission.answers?.[qid];
            const answerValue = answer?.answer || answer?.text || null;
            
            if (operator === 'eq') {
              return answerValue === value;
            } else if (operator === 'contains' || operator === 'matches') {
              // Both :contains and :matches do substring matching
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
   * ⚠️ DEPRECATED: Uses client-side filtering from global cache.
   * For new code, use fetchStudentSubmissionsDirectly() instead.
   * @param {string} coreId - Student Core ID (e.g., "C10261")
   * @param {string} [studentIdQid=window.JotFormCache.STUDENT_ID_QID] - QID for student-id field
   * @param {boolean} [verbose=true] - Enable detailed logging
   * @returns {Promise<Array>} - Array of submissions
   */
  async function fetchStudentSubmissions(coreId, studentIdQid = window.JotFormCache.STUDENT_ID_QID, verbose = true) {
    // Strip "C" prefix from Core ID for Jotform query
    const coreIdNumeric = coreId.startsWith('C') ? coreId.substring(1) : coreId;

    if (verbose) {
      console.log('[JotformAPI] ⚠️ Using deprecated client-side filtering method');
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
   * Fetch submissions for a specific student using WORKING :matches filter
   * ✅ RECOMMENDED: Uses server-side filtering with :matches operator on sessionkey field
   * This is the ONLY method that properly filters student data at the API level.
   * 
   * @param {string} coreId - Student Core ID (e.g., "C10261")
   * @param {string} [sessionKeyQid='3'] - QID for sessionkey field (default: 3)
   * @param {boolean} [verbose=true] - Enable detailed logging
   * @returns {Promise<Array>} - Array of submissions (already filtered by API)
   */
  async function fetchStudentSubmissionsDirectly(coreId, sessionKeyQid = '3', verbose = true) {
    try {
      // Get credentials
      const cachedData = window.CheckingSystemData?.getCachedData();
      if (!cachedData || !cachedData.credentials) {
        throw new Error('Credentials not available. Please return to home page.');
      }

      const credentials = cachedData.credentials;
      const apiKey = credentials.jotformApiKey || credentials.apiKey;
      const formId = credentials.jotformFormId || credentials.formId;

      if (!apiKey || !formId) {
        throw new Error('Jotform credentials missing apiKey or formId');
      }

      // Strip "C" prefix from Core ID
      const studentIdNumeric = coreId.startsWith('C') ? coreId.substring(1) : coreId;

      if (verbose) {
        console.log('[JotformAPI] ========== DIRECT API CALL (SERVER-SIDE FILTER) ==========');
        console.log('[JotformAPI] Student Core ID:', coreId, '(numeric:', studentIdNumeric + ')');
        console.log('[JotformAPI] Form ID:', formId);
      }

      // Use :matches operator on sessionkey field (QID 3)
      // This is the ONLY filter that works correctly for student lookups
      const filter = {
        [`q${sessionKeyQid}:matches`]: studentIdNumeric
      };

      const filterEncoded = encodeURIComponent(JSON.stringify(filter));
      const url = `${JOTFORM_BASE_URL}/form/${formId}/submissions?` +
                  `apiKey=${apiKey}` +
                  `&filter=${filterEncoded}` +
                  `&limit=1000` +
                  `&orderby=created_at` +
                  `&direction=ASC`;

      if (verbose) {
        console.log('[JotformAPI] Filter (server-side :matches):', filter);
        console.log('[JotformAPI] Encoded filter:', filterEncoded);
        console.log('[JotformAPI] Complete URL:', url);
      }

      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Rate limited by JotForm API. Please try again later.');
        }
        throw new Error(`JotForm API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      const submissions = result.content || [];

      if (verbose) {
        console.log('[JotformAPI] ✅ API Response:', {
          responseCode: result.responseCode,
          message: result.message,
          totalReturned: submissions.length
        });
      }

      // Validate submissions (verify sessionkey contains student ID)
      const validated = [];
      for (const submission of submissions) {
        const sessionKey = submission.answers?.[sessionKeyQid]?.answer || 
                          submission.answers?.[sessionKeyQid]?.text;
        const studentId = submission.answers?.[window.JotFormCache.STUDENT_ID_QID]?.answer || 
                         submission.answers?.[window.JotFormCache.STUDENT_ID_QID]?.text;

        // Primary check: sessionkey contains the pattern
        if (sessionKey && sessionKey.includes(studentIdNumeric)) {
          validated.push(submission);
          
          if (verbose && studentId?.trim() !== studentIdNumeric) {
            console.warn('[JotformAPI] ⚠️ SessionKey matches but student ID mismatch:', {
              sessionKey,
              expected: studentIdNumeric,
              actual: studentId
            });
          }
        } else if (verbose) {
          console.warn('[JotformAPI] ⚠️ Filter returned submission without matching sessionkey:', {
            submissionId: submission.id,
            sessionKey
          });
        }
      }

      if (verbose) {
        console.log('[JotformAPI] Validation: ' + validated.length + '/' + submissions.length + ' submissions matched');
        if (validated.length === submissions.length && validated.length > 0) {
          console.log('[JotformAPI] ✅ 100% match rate - filter working perfectly!');
        }
        console.log('[JotformAPI] =======================================================');
      }

      return validated;

    } catch (error) {
      console.error('[JotformAPI] Failed to fetch student submissions:', error);
      throw error;
    }
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
    fetchStudentSubmissions, // Deprecated - uses client-side filtering
    fetchStudentSubmissionsDirectly, // ✅ RECOMMENDED - uses working :matches filter
    fetchSchoolSubmissions,
    fetchClassSubmissions,
    fetchSubmissionsWithFilters
  };
  
  console.log('[JotformAPI] Module loaded. Use fetchStudentSubmissionsDirectly() for student lookups.');
})();
