/**
 * Global JotForm Cache System (using IndexedDB via localForage)
 * 
 * Purpose: Cache the ENTIRE JotForm submissions response to avoid redundant API calls
 * 
 * Why: JotForm's API returns the full dataset regardless of filter parameters.
 * Even with filter={"20:eq":"10001"}, the API downloads all submissions before filtering.
 * 
 * Solution: Fetch ALL submissions once, cache in IndexedDB, then filter client-side.
 * 
 * Benefits:
 * - 1 API call instead of N calls (one per student)
 * - Instant filtering from cache
 * - Reduced rate limiting risk
 * - Faster user experience
 * - Large storage capacity (hundreds of MB vs localStorage's 5-10 MB)
 */

(() => {
  const CACHE_KEY = 'jotform_global_cache';
  const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
  
  // Initialize localForage (uses IndexedDB, falls back to WebSQL/localStorage)
  if (typeof localforage === 'undefined') {
    console.error('[JotFormCache] localForage not loaded! Include <script src="https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js"></script>');
  }
  
  const storage = typeof localforage !== 'undefined' ? localforage.createInstance({
    name: 'JotFormCacheDB',
    storeName: 'cache'
  }) : null;
  
  // Create separate storage for validation cache
  const validationStorage = typeof localforage !== 'undefined' ? localforage.createInstance({
    name: 'JotFormCacheDB',
    storeName: 'student_validation'
  }) : null;

  /**
   * Global JotForm Cache Manager
   */
  class JotFormCache {
    constructor() {
      this.cache = null;
      this.isLoading = false;
      this.loadPromise = null;
      this.progressCallback = null; // For UI progress updates
      this.storage = storage; // Expose storage instance for debugging
    }
    
    /**
     * Set progress callback for UI updates
     * @param {Function} callback - Called with (message, progress) where progress is 0-100
     */
    setProgressCallback(callback) {
      this.progressCallback = callback;
    }
    
    /**
     * Emit progress update
     * @param {string} message - Progress message
     * @param {number} progress - Progress percentage (0-100)
     */
    emitProgress(message, progress) {
      if (this.progressCallback) {
        this.progressCallback(message, progress);
      }
    }

    /**
     * Get all submissions (from cache or API)
     * @param {Object} credentials - { formId, apiKey }
     * @returns {Promise<Array>} - All submissions
     */
    async getAllSubmissions(credentials) {
      // Return cached data if valid
      const cached = await this.loadFromCache();
      if (cached && this.isCacheValid(cached)) {
        console.log('[JotFormCache] Using cached data (valid)');
        return cached.submissions;
      }

      // If already loading, wait for existing promise
      if (this.isLoading && this.loadPromise) {
        console.log('[JotFormCache] Waiting for existing load operation...');
        return this.loadPromise;
      }

      // Fetch fresh data
      this.isLoading = true;
      console.log('[JotFormCache] Starting fresh fetch...');
      this.loadPromise = this.fetchAllSubmissions(credentials)
        .then(async submissions => {
          console.log('[JotFormCache] Fetch complete, saving', submissions.length, 'submissions');
          await this.saveToCache(submissions); // WAIT for IndexedDB write to complete
          this.cache = submissions;
          this.isLoading = false;
          this.loadPromise = null;
          console.log('[JotFormCache] getAllSubmissions complete - cache committed');
          return submissions;
        })
        .catch(error => {
          this.isLoading = false;
          this.loadPromise = null;
          throw error;
        });

      return this.loadPromise;
    }

    /**
     * Fetch ALL submissions from JotForm API
     * @param {Object} credentials - { formId, apiKey }
     * @returns {Promise<Array>} - All submissions
     */
    async fetchAllSubmissions(credentials) {
      console.log('[JotFormCache] ========== FETCHING ALL SUBMISSIONS ==========');
      console.log('[JotFormCache] Form ID:', credentials.formId);

      this.emitProgress('Connecting to Jotform API...', 5);

      const allSubmissions = [];
      let offset = 0;
      const limit = 1000; // Max per page
      let hasMore = true;
      let pageNum = 1;

      try {
        while (hasMore) {
          const url = `https://api.jotform.com/form/${credentials.formId}/submissions?` +
                      `apiKey=${credentials.apiKey}` +
                      `&limit=${limit}` +
                      `&offset=${offset}` +
                      `&orderby=created_at` +
                      `&direction=ASC`;

          console.log(`[JotFormCache] Fetching page ${pageNum} (offset ${offset})`);
          this.emitProgress(`Fetching page ${pageNum} of submissions...`, 10 + (pageNum * 5));
          
          const response = await fetch(url);
          
          if (!response.ok) {
            if (response.status === 429) {
              throw new Error('Rate limited by JotForm API. Please try again later.');
            }
            throw new Error(`JotForm API error: ${response.status}`);
          }

          const result = await response.json();
          
          if (!result.content || result.content.length === 0) {
            hasMore = false;
            break;
          }

          allSubmissions.push(...result.content);
          console.log(`[JotFormCache] Retrieved ${result.content.length} submissions (total: ${allSubmissions.length})`);
          this.emitProgress(`Downloaded ${allSubmissions.length} submissions`, 10 + (pageNum * 5));

          // Check if we got less than limit (last page)
          if (result.content.length < limit) {
            hasMore = false;
          } else {
            offset += limit;
            pageNum++;
          }

          // Rate limiting: small delay between pages
          if (hasMore) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        this.emitProgress('Saving to local cache...', 90);
        console.log(`[JotFormCache] ========== FETCH COMPLETE ==========`);
        console.log(`[JotFormCache] Total submissions: ${allSubmissions.length}`);
        
        this.emitProgress('Cache ready! System is now operational.', 100);
        return allSubmissions;

      } catch (error) {
        console.error('[JotFormCache] Failed to fetch submissions:', error);
        throw error;
      }
    }

    /**
     * Filter submissions by CoreID
     * @param {Array} submissions - All submissions
     * @param {string} coreId - CoreID to filter by (e.g., "C10001")
     * @param {string} studentIdQid - QID for student-id field (e.g., "20")
     * @returns {Array} - Filtered submissions
     */
    filterByCoreId(submissions, coreId, studentIdQid = '20') {
      // Strip "C" prefix from Core ID for matching
      const coreIdNumeric = coreId.startsWith('C') ? coreId.substring(1) : coreId;

      return submissions.filter(submission => {
        // Try to get student-id from answers
        const studentIdAnswer = submission.answers?.[studentIdQid];
        let studentId = null;

        if (studentIdAnswer) {
          studentId = studentIdAnswer.answer || studentIdAnswer.text || null;
        }

        // Match against numeric CoreID
        return studentId === coreIdNumeric;
      });
    }

    /**
     * Save submissions to IndexedDB cache (via localForage)
     * @param {Array} submissions - All submissions
     */
    async saveToCache(submissions) {
      if (!storage) {
        console.error('[JotFormCache] Storage not initialized');
        return;
      }
      
      try {
        console.log('[JotFormCache] saveToCache called with', submissions.length, 'submissions');
        
        const cacheEntry = {
          submissions: submissions,
          timestamp: Date.now(),
          count: submissions.length
        };

        const jsonString = JSON.stringify(cacheEntry);
        console.log('[JotFormCache] Cache data size:', Math.round(jsonString.length / 1024), 'KB');
        
        await storage.setItem(CACHE_KEY, cacheEntry);
        console.log('[JotFormCache] Cached', submissions.length, 'submissions to IndexedDB');
        
        // Verify it was saved
        const verification = await storage.getItem(CACHE_KEY);
        console.log('[JotFormCache] Verification:', verification ? 'SUCCESS' : 'FAILED');
      } catch (error) {
        console.error('[JotFormCache] Failed to save cache:', error);
      }
    }

    /**
     * Load submissions from IndexedDB cache (via localForage)
     * @returns {Promise<Object|null>} - Cache entry or null
     */
    async loadFromCache() {
      if (!storage) {
        console.warn('[JotFormCache] Storage not initialized');
        return null;
      }
      
      try {
        const cacheEntry = await storage.getItem(CACHE_KEY);
        return cacheEntry;
      } catch (error) {
        console.error('[JotFormCache] Failed to load cache:', error);
        return null;
      }
    }

    /**
     * Check if cache is still valid
     * @param {Object} cacheEntry - Cache entry
     * @returns {boolean} - True if valid
     */
    isCacheValid(cacheEntry) {
      if (!cacheEntry || !cacheEntry.timestamp) return false;
      return (Date.now() - cacheEntry.timestamp) < CACHE_DURATION_MS;
    }

    /**
     * Clear cache (force refresh)
     */
    async clearCache() {
      if (storage) {
        await storage.removeItem(CACHE_KEY);
      }
      this.cache = null;
      console.log('[JotFormCache] Submissions cache cleared');
      
      // Also clear validation cache
      await this.clearValidationCache();
    }

    /**
     * Validate cache data structure
     * @param {Object} cached - Cache entry
     * @returns {boolean} - True if structure is valid
     */
    validateCacheStructure(cached) {
      if (!cached) return false;
      
      // Check required fields
      if (!cached.submissions || !Array.isArray(cached.submissions)) {
        console.warn('[JotFormCache] Invalid: submissions is not an array');
        return false;
      }
      
      if (cached.submissions.length === 0) {
        console.warn('[JotFormCache] Invalid: submissions array is empty');
        return false;
      }
      
      if (!cached.timestamp || typeof cached.timestamp !== 'number') {
        console.warn('[JotFormCache] Invalid: timestamp missing or invalid');
        return false;
      }
      
      if (!cached.count || cached.count !== cached.submissions.length) {
        console.warn('[JotFormCache] Invalid: count mismatch (count:', cached.count, 'actual:', cached.submissions.length, ')');
        return false;
      }
      
      // Validate first submission structure
      const firstSubmission = cached.submissions[0];
      if (!firstSubmission.id || !firstSubmission.answers) {
        console.warn('[JotFormCache] Invalid: submission missing required fields (id, answers)');
        return false;
      }
      
      console.log('[JotFormCache] ✅ Cache structure is valid');
      return true;
    }

    /**
     * Get cache statistics with structure validation
     * @returns {Promise<Object>} - Cache stats
     */
    async getCacheStats() {
      console.log('[JotFormCache] getCacheStats called');
      const cached = await this.loadFromCache();
      console.log('[JotFormCache] loadFromCache returned:', cached ? `object with ${cached?.count} submissions` : 'null');
      
      if (!cached) {
        console.log('[JotFormCache] Cache does not exist, returning false');
        return {
          exists: false,
          count: 0,
          age: 0,
          valid: false,
          structureValid: false
        };
      }

      // Validate structure
      const structureValid = this.validateCacheStructure(cached);
      
      const ageMinutes = Math.round((Date.now() - cached.timestamp) / 1000 / 60);
      const timeValid = this.isCacheValid(cached);
      const isValid = timeValid && structureValid; // Both must be true
      
      console.log('[JotFormCache] Cache check: count=', cached.count, 'age=', ageMinutes, 'min, timeValid=', timeValid, 'structureValid=', structureValid, 'VALID=', isValid);
      
      return {
        exists: true,
        count: cached.count,
        age: ageMinutes,
        valid: isValid,
        structureValid: structureValid
      };
    }

    /**
     * Build student validation cache (Level 1)
     * Checks IndexedDB first, validates if needed, then saves
     * @param {Array} students - Array of student objects from coreid.csv
     * @param {Object} surveyStructure - Survey structure for task-to-set mapping
     * @param {boolean} forceRebuild - Force rebuild even if cache exists
     * @returns {Promise<Map>} - Map of coreId -> validation cache
     */
    async buildStudentValidationCache(students, surveyStructure, forceRebuild = false) {
      console.log('[JotFormCache] Building student validation cache...');
      
      if (!window.TaskValidator) {
        throw new Error('TaskValidator not loaded');
      }
      
      // Check if validation cache exists and is valid
      if (!forceRebuild) {
        const cachedValidation = await this.loadValidationCache();
        if (cachedValidation && cachedValidation.size > 0) {
          console.log(`[JotFormCache] ✅ Loaded validation cache from IndexedDB: ${cachedValidation.size} students`);
          
          // Filter cache to only include students in the provided list
          const studentCoreIds = new Set(students.map(s => s.coreId));
          const filteredCache = new Map();
          for (const [coreId, data] of cachedValidation.entries()) {
            if (studentCoreIds.has(coreId)) {
              filteredCache.set(coreId, data);
            }
          }
          
          console.log(`[JotFormCache] Filtered to ${filteredCache.size} students matching provided list`);
          return filteredCache;
        }
      }
      
      console.log('[JotFormCache] Building fresh validation cache...');
      const validationCache = new Map();
      const submissions = await this.getAllSubmissions();
      
      if (!submissions || submissions.length === 0) {
        console.warn('[JotFormCache] No submissions to validate');
        return validationCache;
      }
      
      // Group submissions by student
      const studentSubmissions = new Map();
      for (const submission of submissions) {
        const studentIdAnswer = submission.answers?.['20'];
        const studentId = studentIdAnswer?.answer || studentIdAnswer?.text;
        if (!studentId) continue;
        
        // Find student by Core ID
        const student = students.find(s => {
          const numericCoreId = s.coreId.startsWith('C') ? s.coreId.substring(1) : s.coreId;
          return numericCoreId === studentId;
        });
        
        if (student) {
          if (!studentSubmissions.has(student.coreId)) {
            studentSubmissions.set(student.coreId, {
              student,
              submissions: []
            });
          }
          studentSubmissions.get(student.coreId).submissions.push(submission);
        }
      }
      
      console.log(`[JotFormCache] Validating ${studentSubmissions.size} students...`);
      
      // Validate each student
      let processed = 0;
      const totalStudents = studentSubmissions.size;
      
      for (const [coreId, data] of studentSubmissions.entries()) {
        try {
          const cache = await this.validateStudent(data.student, data.submissions, surveyStructure);
          validationCache.set(coreId, cache);
          
          processed++;
          
          // Report progress (75% to 95% = 20% range for validation)
          const validationProgress = 75 + Math.round((processed / totalStudents) * 20);
          this.emitProgress(`Validating students (${processed}/${totalStudents})`, validationProgress);
          
          if (processed % 10 === 0) {
            console.log(`[JotFormCache] Validated ${processed}/${totalStudents} students`);
          }
        } catch (error) {
          console.error(`[JotFormCache] Failed to validate ${coreId}:`, error);
          validationCache.set(coreId, {
            coreId,
            error: error.message,
            lastValidated: Date.now()
          });
          processed++;
        }
      }
      
      console.log(`[JotFormCache] ✅ Student validation complete: ${validationCache.size} students`);
      
      // Save to IndexedDB
      await this.saveValidationCache(validationCache);
      
      return validationCache;
    }
    
    /**
     * Save validation cache to IndexedDB
     * @param {Map} validationCache - Map of coreId -> validation data
     */
    async saveValidationCache(validationCache) {
      if (!validationStorage) {
        console.error('[JotFormCache] Validation storage not initialized');
        return;
      }
      
      try {
        console.log('[JotFormCache] Saving validation cache to IndexedDB...');
        
        // Convert Map to object for storage
        const cacheObject = {};
        for (const [coreId, data] of validationCache.entries()) {
          cacheObject[coreId] = data;
        }
        
        const cacheEntry = {
          validations: cacheObject,
          timestamp: Date.now(),
          count: validationCache.size,
          version: "1.0"
        };
        
        await validationStorage.setItem('validation_cache', cacheEntry);
        console.log(`[JotFormCache] ✅ Saved validation cache: ${validationCache.size} students`);
        
        // Verify
        const verification = await validationStorage.getItem('validation_cache');
        console.log('[JotFormCache] Validation cache verification:', verification ? 'SUCCESS' : 'FAILED');
      } catch (error) {
        console.error('[JotFormCache] Failed to save validation cache:', error);
      }
    }
    
    /**
     * Load validation cache from IndexedDB
     * @returns {Promise<Map|null>} - Map of coreId -> validation data or null
     */
    async loadValidationCache() {
      if (!validationStorage) {
        console.warn('[JotFormCache] Validation storage not initialized');
        return null;
      }
      
      try {
        const cacheEntry = await validationStorage.getItem('validation_cache');
        
        if (!cacheEntry || !cacheEntry.validations) {
          console.log('[JotFormCache] No validation cache found');
          return null;
        }
        
        // Check if cache is stale (older than submissions cache)
        const submissionsCache = await this.loadFromCache();
        if (submissionsCache && cacheEntry.timestamp < submissionsCache.timestamp) {
          console.log('[JotFormCache] Validation cache is stale, will rebuild');
          return null;
        }
        
        // Validate cache data structure
        const sampleKey = Object.keys(cacheEntry.validations)[0];
        if (sampleKey) {
          const sampleData = cacheEntry.validations[sampleKey];
          if (!sampleData.taskValidation || !sampleData.setStatus) {
            console.warn('[JotFormCache] Validation cache has invalid structure (missing taskValidation or setStatus), will rebuild');
            return null;
          }
          
          // Check if all sets are "notstarted" which indicates bad data
          const allNotStarted = Object.values(sampleData.setStatus || {}).every(set => set.status === 'notstarted');
          if (allNotStarted && sampleData.submissions && sampleData.submissions.length > 0) {
            console.warn('[JotFormCache] Validation cache shows all sets as notstarted despite having submissions, will rebuild');
            return null;
          }
        }
        
        // Convert object back to Map
        const validationCache = new Map();
        for (const [coreId, data] of Object.entries(cacheEntry.validations)) {
          validationCache.set(coreId, data);
        }
        
        console.log(`[JotFormCache] Loaded validation cache: ${validationCache.size} students, age: ${Math.round((Date.now() - cacheEntry.timestamp) / 1000 / 60)} min`);
        return validationCache;
      } catch (error) {
        console.error('[JotFormCache] Failed to load validation cache:', error);
        return null;
      }
    }
    
    /**
     * Clear validation cache from IndexedDB
     */
    async clearValidationCache() {
      if (validationStorage) {
        await validationStorage.removeItem('validation_cache');
        console.log('[JotFormCache] Validation cache cleared');
      }
    }

    /**
     * Validate a single student using TaskValidator
     * @param {Object} student - Student object
     * @param {Array} submissions - Student's submissions
     * @param {Object} surveyStructure - Survey structure
     * @returns {Promise<Object>} - Validation cache entry
     */
    async validateStudent(student, submissions, surveyStructure) {
      // Merge all submission answers BY FIELD NAME (not QID)
      // JotForm stores answers with QID as key, but each answer has a 'name' field
      // TaskValidator looks up answers by field name (e.g., "ERV_P1")
      const mergedAnswers = {};
      for (const submission of submissions) {
        if (submission.answers) {
          // Convert from QID-keyed to name-keyed
          for (const [qid, answerObj] of Object.entries(submission.answers)) {
            if (answerObj.name) {
              mergedAnswers[answerObj.name] = answerObj;
            }
          }
        }
      }
      
      // Run TaskValidator
      const taskValidation = await window.TaskValidator.validateAllTasks(mergedAnswers);
      
      // Build task-to-set mapping
      const taskToSetMap = new Map();
      for (const set of surveyStructure.sets) {
        for (const section of set.sections) {
          const taskName = section.file.replace('.json', '');
          const taskKey = taskName.toLowerCase();
          taskToSetMap.set(taskKey, set.id);
          
          const metadata = surveyStructure.taskMetadata[taskName];
          if (metadata?.aliases) {
            metadata.aliases.forEach(alias => {
              taskToSetMap.set(alias.toLowerCase(), set.id);
            });
          }
        }
      }
      
      // Calculate set status
      const setStatus = {
        set1: { status: 'notstarted', tasksComplete: 0, tasksTotal: 0, tasks: [] },
        set2: { status: 'notstarted', tasksComplete: 0, tasksTotal: 0, tasks: [] },
        set3: { status: 'notstarted', tasksComplete: 0, tasksTotal: 0, tasks: [] },
        set4: { status: 'notstarted', tasksComplete: 0, tasksTotal: 0, tasks: [] }
      };
      
      // Analyze each task and build task lists per set
      let totalTasks = 0;
      let completeTasks = 0;
      const terminationTasks = [];
      let hasPostTerminationData = false;
      
      for (const [taskId, validation] of Object.entries(taskValidation)) {
        if (validation.error) {
          console.warn(`[JotFormCache] Task ${taskId} has error: ${validation.error}`);
          continue;
        }
        if (taskId === 'nonsym') continue;
        
        totalTasks++;
        const setId = taskToSetMap.get(taskId);
        if (!setId) {
          console.warn(`[JotFormCache] Task ${taskId} not found in taskToSetMap`);
          continue;
        }
        
        // TaskValidator returns answeredQuestions/totalQuestions, not totals.answered/total
        const answered = validation.answeredQuestions || 0;
        const total = validation.totalQuestions || 0;
        
        const isComplete = answered === total && total > 0;
        
        if (isComplete) {
          completeTasks++;
          setStatus[setId].tasksComplete++;
        }
        
        // Increment tasksTotal for this set (only count tasks that actually exist for this student)
        setStatus[setId].tasksTotal++;
        
        if (validation.terminated) {
          terminationTasks.push(taskId);
        }
        
        if (validation.hasPostTerminationAnswers) {
          hasPostTerminationData = true;
        }
        
        setStatus[setId].tasks.push({
          taskId,
          complete: isComplete,
          answered,
          total
        });
      }
      
      // Log summary for debugging
      if (completeTasks > 0) {
        console.log(`[JotFormCache] Student ${student.coreId}: ${completeTasks}/${totalTasks} tasks complete`);
      }
      
      // Calculate set status based on ACTUAL task counts (not section counts)
      for (const setId in setStatus) {
        const set = setStatus[setId];
        if (set.tasksTotal === 0) {
          set.status = 'notstarted';
          continue;
        }
        
        const completionRate = set.tasksComplete / set.tasksTotal;
        if (completionRate === 1) {
          set.status = 'complete';
        } else if (completionRate > 0) {
          set.status = 'incomplete';
        } else {
          set.status = 'notstarted';
        }
      }
      
      // Calculate overall status
      const completeSets = Object.values(setStatus).filter(s => s.status === 'complete').length;
      let overallStatus = 'notstarted';
      if (completeSets === 4) {
        overallStatus = 'complete';
      } else if (completeSets > 0 || completeTasks > 0) {
        overallStatus = 'incomplete';
      }
      
      return {
        coreId: student.coreId,
        studentId: student.studentId,
        studentName: student.studentName,
        classId: student.classId,
        schoolId: student.schoolId,
        group: student.group,
        district: student.district || 'Unknown',
        gender: student.gender,
        
        submissions,
        mergedAnswers,
        taskValidation,
        setStatus,
        
        overallStatus,
        completionPercentage: totalTasks > 0 ? (completeTasks / totalTasks) * 100 : 0,
        totalTasks,
        completeTasks,
        incompleteTasks: totalTasks - completeTasks,
        
        hasTerminations: terminationTasks.length > 0,
        terminationCount: terminationTasks.length,
        terminationTasks,
        hasPostTerminationData,
        
        lastValidated: Date.now(),
        validationVersion: "1.0"
      };
    }
  }

  // Export global instance
  window.JotFormCache = new JotFormCache();
  console.log('[JotFormCache] Global cache manager initialized');
})();
