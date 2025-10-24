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
  
  // JotForm question IDs - these are hardcoded based on current form structure
  // CRITICAL: If the JotForm structure changes, these QIDs must be updated
  // The student-id field (QID 20) is used throughout the system to identify students
  const STUDENT_ID_QID = '20';
  
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
      
      // Auto-detect API endpoint based on environment
      // Local dev (localhost/127.0.0.1) → Use proxy server to bypass CORS
      // Production (GitHub Pages) → Direct API call (no CORS issues)
      this.apiBaseUrl = this.detectApiBaseUrl();
      console.log(`[JotFormCache] Using API endpoint: ${this.apiBaseUrl}`);
      
      // Adaptive batch sizing state (like processor_agent.ps1)
      this.config = null; // Will be loaded from config/jotform_config.json
      this.lastSuccessfulBatchSize = null;
      this.consecutiveSuccesses = 0;
      this.reductionIndex = 0; // Index into batchSizeReductions array
    }
    
    /**
     * Detect whether to use proxy server or direct API
     */
    detectApiBaseUrl() {
      const hostname = window.location.hostname;
      const isLocal = hostname === 'localhost' || 
                      hostname === '127.0.0.1' || 
                      hostname === '0.0.0.0' ||
                      hostname.startsWith('192.168.') ||
                      hostname.startsWith('10.0.');
      
      if (isLocal) {
        // Running locally - use Flask proxy server on port 3000
        return 'http://localhost:3000/api/jotform';
      } else {
        // Running on GitHub Pages or production - use direct API
        return 'https://api.jotform.com';
      }
    }
    
    /**
     * Load configuration from config/jotform_config.json
     * @returns {Promise<Object>} Configuration object
     */
    async loadConfig() {
      if (this.config) {
        return this.config; // Already loaded
      }
      
      try {
        const response = await fetch('/config/jotform_config.json');
        const config = await response.json();
        this.config = config.webFetch || {
          initialBatchSize: 100,
          minBatchSize: 10,
          maxBatchSize: 500,
          batchSizeReductions: [1.0, 0.5, 0.3, 0.2, 0.1],
          consecutiveSuccessesForIncrease: 2,
          timeoutSeconds: 60
        };
        console.log(`[JotFormCache] Config loaded: batch ${this.config.initialBatchSize}, reductions ${this.config.batchSizeReductions.length} levels`);
        return this.config;
      } catch (error) {
        console.warn('[JotFormCache] Failed to load config, using defaults:', error);
        this.config = {
          initialBatchSize: 100,
          minBatchSize: 10,
          maxBatchSize: 500,
          batchSizeReductions: [1.0, 0.5, 0.3, 0.2, 0.1],
          consecutiveSuccessesForIncrease: 2,
          timeoutSeconds: 60
        };
        return this.config;
      }
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
     * Fetch ALL submissions from JotForm API with adaptive batch sizing
     * Mimics processor_agent.ps1 adaptive chunk sizing pattern
     * @param {Object} credentials - { formId, apiKey }
     * @returns {Promise<Array>} - All submissions
     */
    async fetchAllSubmissions(credentials) {
      console.log('[JotFormCache] ========== FETCHING ALL SUBMISSIONS ==========');
      console.log('[JotFormCache] Form ID:', credentials.formId);

      // Load configuration
      await this.loadConfig();
      
      this.emitProgress('Connecting to Jotform API...', 5);

      const allSubmissions = [];
      let offset = 0;
      let hasMore = true;
      let pageNum = 1;
      
      // Adaptive batch sizing (like processor_agent.ps1)
      const baseBatchSize = this.config.initialBatchSize;
      let currentBatchSize = baseBatchSize;

      try {
        while (hasMore) {
          // Calculate current batch size based on reduction index
          if (this.reductionIndex > 0) {
            currentBatchSize = Math.max(
              this.config.minBatchSize,
              Math.floor(baseBatchSize * this.config.batchSizeReductions[this.reductionIndex])
            );
            console.log(`[JotFormCache] Using reduced batch size: ${currentBatchSize} (${Math.round(this.config.batchSizeReductions[this.reductionIndex] * 100)}% of ${baseBatchSize})`);
          }
          
          const url = `${this.apiBaseUrl}/form/${credentials.formId}/submissions?` +
                      `apiKey=${credentials.apiKey}` +
                      `&limit=${currentBatchSize}` +
                      `&offset=${offset}` +
                      `&orderby=created_at` +
                      `&direction=ASC`;

          // Progress: 0-50% for fetching (phase 1) - leave 50-70% for Qualtrics if enabled
          // Intelligent progress: estimate based on typical batch patterns
          // Assume we're roughly halfway done if we're fetching full batches
          // This provides better UX than fixed 2% per page
          let fetchProgress;
          if (pageNum === 1) {
            fetchProgress = 5; // Starting
          } else {
            // Logarithmic curve: slower growth as we fetch more pages
            // Cap at 48% to leave room for Qualtrics (50-70%)
            fetchProgress = Math.min(48, 5 + Math.log(pageNum) * 12);
          }
          this.emitProgress(`Fetching page ${pageNum} (batch: ${currentBatchSize})...`, Math.round(fetchProgress));
          
          let response;
          let result;
          let fetchSuccess = false;
          
          try {
            response = await fetch(url);
            
            if (!response.ok) {
              if (response.status === 429) {
                throw new Error('Rate limited by JotForm API. Please try again later.');
              }
              if (response.status === 504) {
                throw new Error('Gateway timeout - batch too large');
              }
              throw new Error(`JotForm API error: ${response.status}`);
            }

            // Try to parse JSON
            const text = await response.text();
            result = JSON.parse(text);
            
            // Verify we got valid content
            if (!result.content) {
              throw new Error('Response missing content field');
            }
            
            fetchSuccess = true;
            
          } catch (parseError) {
            // JSON parse error or timeout - reduce batch size
            console.error(`[JotFormCache] Fetch failed: ${parseError.message}`);
            
            // Adaptive response to errors (like processor_agent.ps1)
            if (parseError.message.includes('timeout') || parseError.message.includes('Unexpected end of JSON')) {
              this.consecutiveSuccesses = 0; // Reset on failure
              
              if (this.reductionIndex < this.config.batchSizeReductions.length - 1) {
                this.reductionIndex++;
                const newSize = Math.floor(baseBatchSize * this.config.batchSizeReductions[this.reductionIndex]);
                console.warn(`[JotFormCache] Error detected - reducing batch size to ${newSize} (${Math.round(this.config.batchSizeReductions[this.reductionIndex] * 100)}%)`);
                
                // Retry this page with smaller batch
                continue;
              } else {
                throw new Error(`Failed even at minimum batch size (${this.config.minBatchSize}): ${parseError.message}`);
              }
            } else {
              throw parseError;
            }
          }
          
          // Success! Process the results
          if (fetchSuccess) {
            // Track consecutive successes for gradual increase (like processor_agent.ps1)
            this.consecutiveSuccesses++;
            this.lastSuccessfulBatchSize = currentBatchSize;
            
            if (!result.content || result.content.length === 0) {
              hasMore = false;
              break;
            }

            allSubmissions.push(...result.content);
            
            // Progress: 0-50% for fetching (phase 1) - leave 50-70% for Qualtrics if enabled
            // Smart progress: if we got less than batch size, we're near the end!
            let downloadProgress;
            if (result.content.length < currentBatchSize) {
              // Last page - cap at 50% to allow Qualtrics sync (50-70%)
              downloadProgress = 50;
            } else {
              // Still fetching - use logarithmic curve, capped at 48%
              downloadProgress = Math.min(48, 5 + Math.log(pageNum) * 12);
            }
            this.emitProgress(`Downloaded ${allSubmissions.length} submissions...`, Math.round(downloadProgress));

            // Gradually increase batch size if we're below baseline and have multiple consecutive successes
            if (this.reductionIndex > 0 && this.consecutiveSuccesses >= this.config.consecutiveSuccessesForIncrease) {
              const oldSize = currentBatchSize;
              this.reductionIndex = Math.max(0, this.reductionIndex - 1);
              const newSize = this.reductionIndex === 0 ? baseBatchSize : Math.floor(baseBatchSize * this.config.batchSizeReductions[this.reductionIndex]);
              this.consecutiveSuccesses = 0; // Reset counter after increase
              currentBatchSize = newSize; // Apply the increase immediately
              console.log(`[JotFormCache] ✓ After ${this.config.consecutiveSuccessesForIncrease} successes, increased batch size: ${oldSize} → ${newSize}`);
            }
            
            // Check if we got less than current batch size (last page)
            if (result.content.length < currentBatchSize) {
              hasMore = false;
            } else {
              offset += currentBatchSize; // Use current batch size, not hardcoded limit
              pageNum++;
            }

            // Rate limiting: small delay between pages
            if (hasMore) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
        }

        // Progress: Phase 1 complete, moving to phase 2
        this.emitProgress('Saving to local cache...', 50);
        console.log(`[JotFormCache] ========== FETCH COMPLETE ==========`);
        console.log(`[JotFormCache] Total submissions: ${allSubmissions.length}`);
        
        // Don't emit 100% yet - validation (phase 2) still needs to run
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
        
        // Validate that submissions have the expected structure
        if (submissions.length > 0) {
          const sampleSubmission = submissions[0];
          if (!sampleSubmission.answers) {
            console.warn('[JotFormCache] WARNING: First submission is missing "answers" field. Structure:', Object.keys(sampleSubmission));
          } else {
            console.log('[JotFormCache] First submission has', Object.keys(sampleSubmission.answers).length, 'answer fields');
          }
        }
        
        const cacheEntry = {
          submissions: submissions,
          timestamp: Date.now(),
          count: submissions.length
        };

        const jsonString = JSON.stringify(cacheEntry);
        console.log('[JotFormCache] Cache data size:', Math.round(jsonString.length / 1024), 'KB');
        
        await storage.setItem(CACHE_KEY, cacheEntry);
        console.log('[JotFormCache] ✅ Cached', submissions.length, 'submissions to IndexedDB');
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
     * 
     * COMPREHENSIVE CACHE DELETION:
     * This method performs a complete purge of ALL cached data in IndexedDB:
     * 1. Submissions cache (jotform_global_cache) - All JotForm form submissions
     * 2. Validation cache (student_validation) - Pre-computed task validation results  
     * 3. Qualtrics cache (qualtrics_responses) - TGMD survey data (via clearValidationCache)
     * 
     * After calling this method, the system requires a full re-sync (60-90 seconds)
     * before it can be used again. This is the recommended way to force a fresh
     * data fetch when suspecting stale or incorrect cached data.
     * 
     * Related: See CACHE_SYSTEM_STATUS.md for implementation details
     */
    async clearCache() {
      if (storage) {
        await storage.removeItem(CACHE_KEY);
      }
      this.cache = null;
      console.log('[JotFormCache] Submissions cache cleared');
      
      // Also clear validation cache (which includes Qualtrics cache)
      await this.clearValidationCache();
      
      // Clear Qualtrics cache separately for completeness
      await this.clearQualtricsCache();
      
      console.log('[JotFormCache] ✅ COMPREHENSIVE CACHE PURGE COMPLETE - All 3 stores cleared');
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
      const cached = await this.loadFromCache();
      
      if (!cached) {
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
          
          // Report progress (70% to 100% = 30% range for validation, phase 2)
          const validationProgress = 70 + Math.round((processed / totalStudents) * 30);
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
     * 
     * Part of comprehensive cache deletion system.
     * Removes pre-computed student validation results that are built from submissions.
     * This cache is automatically rebuilt when navigating to class/school pages.
     */
    async clearValidationCache() {
      if (validationStorage) {
        await validationStorage.removeItem('validation_cache');
        console.log('[JotFormCache] Validation cache cleared');
      }
    }

    /**
     * Validate a single student using TaskValidator
     * 
     * VALIDATION ARCHITECTURE:
     * This function is the bridge between class/school aggregation and the
     * TaskValidator single source of truth. It:
     * 
     * 1. Merges multiple submissions (earliest non-empty value wins)
     * 2. Calls TaskValidator.validateAllTasks() for accurate validation
     * 3. Builds task-to-set mapping from survey structure
     * 4. Handles gender-conditional tasks (TEC_Male vs TEC_Female)
     * 5. Calculates set completion status
     * 6. Returns comprehensive validation cache entry
     * 
     * This ensures that class and school pages use the SAME validation rules
     * as the student drilldown page, maintaining consistency across all
     * hierarchical levels of the checking system.
     * 
     * @param {Object} student - Student object
     * @param {Array} submissions - Student's submissions
     * @param {Object} surveyStructure - Survey structure
     * @returns {Promise<Object>} - Validation cache entry
     */
    async validateStudent(student, submissions, surveyStructure) {
      // Merge all submission answers BY FIELD NAME (not QID)
      // JotForm stores answers with QID as key, but each answer has a 'name' field
      // TaskValidator looks up answers by field name (e.g., "ERV_P1")
      // Merge strategy: Sort by created_at (earliest first), only process non-empty values, first wins
      
      // Sort submissions by created_at (earliest first)
      const sortedSubmissions = submissions.sort((a, b) => 
        new Date(a.created_at) - new Date(b.created_at)
      );
      
      const mergedAnswers = {};
      for (const submission of sortedSubmissions) {
        if (submission.answers) {
          // Convert from QID-keyed to name-keyed
          for (const [qid, answerObj] of Object.entries(submission.answers)) {
            // Skip if no field name or no actual value (match student page logic)
            if (!answerObj.name || !answerObj.answer) continue;
            
            // Only set if not already present (earliest non-empty value wins)
            if (!mergedAnswers[answerObj.name]) {
              mergedAnswers[answerObj.name] = answerObj;
            }
          }
        }
      }
      
      // Run task validation
      const taskValidation = await window.TaskValidator.validateAllTasks(mergedAnswers);
      
      // Build task-to-set mapping
      const taskToSetMap = new Map();
      for (const set of surveyStructure.sets) {
        for (const section of set.sections) {
          const taskName = section.file.replace('.json', '');
          const metadata = surveyStructure.taskMetadata[taskName];
          if (metadata) {
            taskToSetMap.set(metadata.id, set.id);
            
            if (metadata.aliases) {
              metadata.aliases.forEach(alias => {
                taskToSetMap.set(alias.toLowerCase(), set.id);
              });
            }
          }
        }
      }
      
      /**
       * Helper function to check if a task is applicable to a student
       * (handles gender-conditional tasks like TEC_Male vs TEC_Female)
       * 
       * CRITICAL: Gender normalization required!
       * - Student data may use single-letter codes: "M", "F"
       * - Survey-structure.json uses full words: "male", "female"
       * - Must normalize M→male, F→female before comparison
       */
      function isTaskApplicableToStudent(taskId, student, surveyStructure) {
        // Find the section for this task in survey structure
        for (const set of surveyStructure.sets) {
          const section = set.sections.find(s => {
            const fileName = s.file.replace('.json', '');
            const metadata = surveyStructure.taskMetadata[fileName];
            return metadata && metadata.id === taskId;
          });
          
          if (section) {
            // Check showIf conditions
            if (!section.showIf) return true; // No condition = always applicable
            
            if (section.showIf.gender) {
              // Normalize gender: convert single letters (M/F) to full words
              let studentGender = (student.gender || '').toLowerCase();
              if (studentGender === 'm' || studentGender === 'male') studentGender = 'male';
              if (studentGender === 'f' || studentGender === 'female') studentGender = 'female';
              
              const requiredGender = section.showIf.gender.toLowerCase();
              return studentGender === requiredGender;
            }
            
            return true; // No matching condition = applicable
          }
        }
        
        return true; // Task not found in structure = assume applicable
      }
      
      // Calculate set status
      const setStatus = {
        set1: { status: 'notstarted', tasksComplete: 0, tasksTotal: 0, tasks: [] },
        set2: { status: 'notstarted', tasksComplete: 0, tasksTotal: 0, tasks: [] },
        set3: { status: 'notstarted', tasksComplete: 0, tasksTotal: 0, tasks: [] },
        set4: { status: 'notstarted', tasksComplete: 0, tasksTotal: 0, tasks: [] }
      };
      
      // Count tasks per set (accounting for gender-conditional tasks like TEC)
      for (const set of surveyStructure.sets) {
        const applicableSections = set.sections.filter(section => {
          // Check if section has showIf conditions
          if (!section.showIf) return true; // No condition = always applicable
          
          // Check gender condition
          if (section.showIf.gender) {
            // Normalize gender: convert single letters (M/F) to full words
            let studentGender = (student.gender || '').toLowerCase();
            if (studentGender === 'm' || studentGender === 'male') studentGender = 'male';
            if (studentGender === 'f' || studentGender === 'female') studentGender = 'female';
            
            const requiredGender = section.showIf.gender.toLowerCase();
            const matches = studentGender === requiredGender;
            return matches;
          }
          
          return true; // No matching condition = applicable by default
        });
        
        setStatus[set.id].tasksTotal = applicableSections.length;
      }
      
      // Analyze each task
      let totalTasks = 0;
      let completeTasks = 0;
      const terminationTasks = [];
      let hasPostTerminationData = false;
      
      for (const [taskId, validation] of Object.entries(taskValidation)) {
        if (validation.error || taskId === 'nonsym') continue;
        
        const setId = taskToSetMap.get(taskId);
        if (!setId) continue;
        
        // Check if this task is applicable to this student (gender-conditional tasks)
        const taskApplicable = isTaskApplicableToStudent(taskId, student, surveyStructure);
        if (!taskApplicable) {
          console.log(`[JotFormCache] Skipping ${taskId} - not applicable for ${student.gender} student`);
          continue; // Skip gender-inappropriate tasks
        }
        
        // Only count tasks that are applicable to this student
        totalTasks++;
        
        // TaskValidator returns answeredQuestions/totalQuestions, not totals.answered/total
        const answered = validation.answeredQuestions || 0;
        const total = validation.totalQuestions || 0;
        
        // A task is complete if:
        // 1. All questions are answered (answered === total), OR
        // 2. It's properly terminated/timed out without post-termination issues AND has at least 1 answer
        // CRITICAL: Must check answered > 0 to match student page logic (see checking-system-student-page.js Line 1831-1838)
        const isComplete = (answered === total && total > 0) || 
                           (validation.terminated && !validation.hasPostTerminationAnswers && answered > 0) ||
                           (validation.timedOut && !validation.hasPostTerminationAnswers && answered > 0);
        
        if (isComplete) {
          completeTasks++;
          setStatus[setId].tasksComplete++;
        }
        
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
          total,
          hasPostTerminationAnswers: validation.hasPostTerminationAnswers || false
        });
      }
      
      // Calculate set status
      for (const setId in setStatus) {
        const set = setStatus[setId];
        if (set.tasksTotal === 0) continue;
        
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

    // ========== QUALTRICS INTEGRATION ==========

    /**
     * Create separate storage for Qualtrics cache
     * @returns {Object} localforage instance for Qualtrics cache
     */
    getQualtricsStorage() {
      if (!this.qualtricsStorage) {
        this.qualtricsStorage = typeof localforage !== 'undefined' ? localforage.createInstance({
          name: 'JotFormCacheDB',
          storeName: 'qualtrics_cache'
        }) : null;
      }
      return this.qualtricsStorage;
    }

    /**
     * Ensure coreId has "C" prefix
     * @param {string} studentId - Student ID (may or may not have "C" prefix)
     * @returns {string} CoreId with "C" prefix
     */
    ensureCoreIdPrefix(studentId) {
      return studentId.startsWith('C') ? studentId : `C${studentId}`;
    }

    /**
     * Transform JotForm submissions to records format expected by data-merger
     * Converts from submission format (with answers object) to flat record format
     * 
     * IMPORTANT: This method assumes student ID is in answers[STUDENT_ID_QID].
     * If JotForm's question structure changes, the STUDENT_ID_QID constant must be updated.
     * 
     * @param {Array} submissions - Raw JotForm submissions
     * @returns {Array} Transformed records with coreId at root level
     */
    transformSubmissionsToRecords(submissions) {
      console.log('[JotFormCache] Transforming submissions to records format...');
      const records = [];
      
      for (const submission of submissions) {
        try {
          // Extract student ID from answers using configured QID
          const studentIdAnswer = submission.answers?.[STUDENT_ID_QID];
          const studentId = studentIdAnswer?.answer || studentIdAnswer?.text;
          
          if (!studentId) {
            console.warn('[JotFormCache] Submission missing student ID, skipping:', submission.id);
            continue;
          }
          
          // Create coreId with "C" prefix
          const coreId = this.ensureCoreIdPrefix(studentId);
          
          // Build flat record with all answer fields
          const record = {
            coreId: coreId,
            'student-id': studentId,
            _meta: {
              source: 'jotform',
              submissionId: submission.id,
              created_at: submission.created_at,
              updated_at: submission.updated_at
            }
          };
          
          // Flatten answers object to record fields
          if (submission.answers) {
            for (const [qid, answerObj] of Object.entries(submission.answers)) {
              // Use the field name if available, otherwise use QID
              const fieldName = answerObj.name || `q${qid}`;
              const value = answerObj.answer || answerObj.text || '';
              
              // Skip empty values and the student-id we already processed
              if (value && qid !== STUDENT_ID_QID) {
                record[fieldName] = value;
              }
            }
          }
          
          records.push(record);
        } catch (error) {
          console.error('[JotFormCache] Failed to transform submission:', submission.id, error);
        }
      }
      
      console.log(`[JotFormCache] Transformed ${records.length} submissions to records (${submissions.length - records.length} skipped)`);
      return records;
    }

    /**
     * Transform merged records back to submission format for caching
     * Converts from flat record format back to JotForm submission structure
     * 
     * IMPORTANT: This method assumes student ID is in answers[STUDENT_ID_QID].
     * If JotForm's question structure changes, the STUDENT_ID_QID constant must be updated.
     * 
     * PERFORMANCE OPTIMIZATION:
     * This method uses a reverse lookup map (fieldName → qid) to avoid O(n²) complexity.
     * Without this optimization, updating each field would require searching through all answers,
     * resulting in O(records × fields × answers) complexity. With the reverse map, we achieve
     * O(records × (answers + fields)) complexity - a significant improvement for large datasets.
     * 
     * Example: For 100 records with 50 fields each and 100 answers per submission:
     * - Without optimization: 100 × 50 × 100 = 500,000 operations
     * - With optimization: 100 × (100 + 50) = 15,000 operations (33x faster!)
     * 
     * @param {Array} records - Merged records with flat structure
     * @param {Array} originalSubmissions - Original JotForm submissions for structure reference
     * @returns {Array} Submissions in JotForm format
     */
    transformRecordsToSubmissions(records, originalSubmissions) {
      console.log('[JotFormCache] Converting records back to submission format...');
      
      // Create a map of original submissions by coreId for easy lookup
      const submissionMap = new Map();
      for (const submission of originalSubmissions) {
        const studentIdAnswer = submission.answers?.[STUDENT_ID_QID];
        const studentId = studentIdAnswer?.answer || studentIdAnswer?.text;
        if (studentId) {
          const coreId = this.ensureCoreIdPrefix(studentId);
          submissionMap.set(coreId, submission);
        }
      }
      
      const submissions = [];
      
      for (const record of records) {
        try {
          // Get original submission structure
          const originalSubmission = submissionMap.get(record.coreId);
          
          if (!originalSubmission) {
            console.warn('[JotFormCache] No original submission found for coreId:', record.coreId);
            continue;
          }
          
          // Clone the original submission
          const submission = JSON.parse(JSON.stringify(originalSubmission));
          
          // Update answers with merged data
          // Merge TGMD fields and any other updated fields from Qualtrics
          if (submission.answers) {
            // PERFORMANCE OPTIMIZATION: Build reverse lookup map (fieldName → qid) for O(1) lookups
            // This prevents O(n²) nested loop when updating multiple fields.
            // We build the map once per submission and reuse it for all field updates.
            const fieldNameToQid = {};
            for (const [qid, answerObj] of Object.entries(submission.answers)) {
              if (answerObj.name) {
                fieldNameToQid[answerObj.name] = qid;
              }
            }
            
            // Update fields from merged record
            // Each field lookup is now O(1) instead of O(n) thanks to the reverse map above
            for (const [fieldName, value] of Object.entries(record)) {
              // Skip metadata and already-handled fields
              if (fieldName === 'coreId' || 
                  fieldName === 'student-id' || 
                  fieldName === '_meta' || 
                  fieldName === '_sources' ||
                  fieldName === '_orphaned') {
                continue;
              }
              
              // Look up QID using reverse map (O(1) instead of O(n))
              const qidToUpdate = fieldNameToQid[fieldName];
              
              // Update the answer if we found the QID
              if (qidToUpdate && submission.answers[qidToUpdate]) {
                submission.answers[qidToUpdate].answer = value;
                if (submission.answers[qidToUpdate].text !== undefined) {
                  submission.answers[qidToUpdate].text = value;
                }
              }
            }
          }
          
          submissions.push(submission);
        } catch (error) {
          console.error('[JotFormCache] Failed to convert record to submission:', record.coreId, error);
        }
      }
      
      console.log(`[JotFormCache] Converted ${submissions.length} records to submissions`);
      return submissions;
    }

    /**
     * Fetch Qualtrics data and merge with JotForm
     * @param {Object} credentials - Must include Qualtrics credentials
     * @returns {Promise<Object>} Merge statistics
     */
    async refreshWithQualtrics(credentials) {
      console.log('[JotFormCache] ========== STARTING QUALTRICS REFRESH ==========');
      
      // Validate required modules
      if (typeof window.QualtricsAPI === 'undefined') {
        throw new Error('QualtricsAPI module not loaded. Include qualtrics-api.js');
      }
      if (typeof window.QualtricsTransformer === 'undefined') {
        throw new Error('QualtricsTransformer module not loaded. Include qualtrics-transformer.js');
      }
      if (typeof window.DataMerger === 'undefined') {
        throw new Error('DataMerger module not loaded. Include data-merger.js');
      }

      // Validate Qualtrics credentials (support both qualtricsApiToken and qualtricsApiKey)
      const qualtricsApiToken = credentials.qualtricsApiToken || credentials.qualtricsApiKey;
      if (!qualtricsApiToken || !credentials.qualtricsDatacenter || !credentials.qualtricsSurveyId) {
        throw new Error('Missing Qualtrics credentials. Please ensure credentials.enc contains qualtricsApiToken (or qualtricsApiKey), qualtricsDatacenter, and qualtricsSurveyId');
      }
      
      // Normalize credentials to use qualtricsApiToken
      credentials.qualtricsApiToken = qualtricsApiToken;

      this.emitProgress('Starting Qualtrics integration...', 0);

      try {
        // Step 1: Fetch JotForm data (use existing cache system)
        this.emitProgress('Loading JotForm data...', 5);
        const jotformSubmissions = await this.getAllSubmissions(credentials);
        console.log('[JotFormCache] JotForm data loaded:', jotformSubmissions.length, 'submissions');

        // Step 2: Transform JotForm submissions to records format expected by data-merger
        this.emitProgress('Transforming JotForm data...', 8);
        const jotformData = this.transformSubmissionsToRecords(jotformSubmissions);
        console.log('[JotFormCache] JotForm data transformed:', jotformData.length, 'records');

        // Step 3: Initialize Qualtrics modules
        const qualtricsAPI = new window.QualtricsAPI();
        const transformer = new window.QualtricsTransformer();
        const merger = new window.DataMerger();

        // Connect progress callbacks
        qualtricsAPI.setProgressCallback((msg, progress) => {
          // Map Qualtrics progress (0-60) to our overall progress (10-60)
          const mappedProgress = 10 + Math.floor(progress * 0.5);
          this.emitProgress(msg, mappedProgress);
        });

        // Step 4: Load Qualtrics field mapping
        this.emitProgress('Loading Qualtrics field mapping...', 10);
        await transformer.loadMapping();

        // Step 5: Fetch Qualtrics responses
        this.emitProgress('Fetching Qualtrics responses...', 12);
        const rawResponses = await qualtricsAPI.fetchAllResponses(credentials);
        console.log('[JotFormCache] Qualtrics responses fetched:', rawResponses.length);

        // Step 6: Transform Qualtrics responses
        this.emitProgress('Transforming Qualtrics data...', 65);
        const transformedData = transformer.transformBatch(rawResponses);
        console.log('[JotFormCache] Qualtrics data transformed:', transformedData.length, 'records');

        // Step 7: Merge datasets
        this.emitProgress('Merging JotForm and Qualtrics data...', 70);
        const mergedData = merger.mergeDataSources(jotformData, transformedData);
        console.log('[JotFormCache] Data merged:', mergedData.length, 'records');

        // Step 7: Validate merge
        this.emitProgress('Validating merged data...', 80);
        const validation = merger.validateMergedData(mergedData);

        // Step 8: Cache Qualtrics data separately (for future incremental refresh)
        this.emitProgress('Caching Qualtrics responses...', 85);
        const qualtricsStorage = this.getQualtricsStorage();
        if (qualtricsStorage) {
          await qualtricsStorage.setItem('qualtrics_responses', {
            timestamp: Date.now(),
            responses: transformedData,
            surveyId: credentials.qualtricsSurveyId,
            count: transformedData.length
          });
          console.log('[JotFormCache] Qualtrics cache updated');
        }

        // Step 9: Convert merged records back to submission format
        this.emitProgress('Converting merged data to cache format...', 90);
        const mergedSubmissions = this.transformRecordsToSubmissions(mergedData, jotformSubmissions);
        console.log('[JotFormCache] Converted', mergedSubmissions.length, 'records back to submission format');

        // Step 10: Update main cache with merged data
        this.emitProgress('Updating main cache...', 93);
        await this.saveToCache(mergedSubmissions);
        this.cache = mergedSubmissions;
        console.log('[JotFormCache] Main cache updated with merged data');

        // Step 11: Clear validation cache (needs rebuild with TGMD data)
        this.emitProgress('Clearing validation cache...', 95);
        await this.clearValidationCache();
        console.log('[JotFormCache] Validation cache cleared (will rebuild on demand)');

        this.emitProgress('Qualtrics integration complete!', 100);
        console.log('[JotFormCache] ========== QUALTRICS REFRESH COMPLETE ==========');

        return {
          success: true,
          stats: {
            ...validation,
            jotformRecords: jotformData.length,
            qualtricsResponses: rawResponses.length,
            transformedRecords: transformedData.length,
            mergedRecords: mergedData.length
          }
        };
      } catch (error) {
        console.error('[JotFormCache] Qualtrics refresh failed:', error);
        this.emitProgress('Qualtrics refresh failed: ' + error.message, 0);
        throw error;
      }
    }

    /**
     * Get Qualtrics cache statistics
     * @returns {Promise<Object>} Qualtrics cache stats
     */
    async getQualtricsStats() {
      const qualtricsStorage = this.getQualtricsStorage();
      if (!qualtricsStorage) {
        return { cached: false };
      }

      try {
        const cached = await qualtricsStorage.getItem('qualtrics_responses');
        if (!cached) {
          return { cached: false };
        }

        const age = Date.now() - cached.timestamp;
        const ageMinutes = Math.floor(age / 60000);

        return {
          cached: true,
          count: cached.count,
          surveyId: cached.surveyId,
          timestamp: cached.timestamp,
          age: age,
          ageMinutes: ageMinutes,
          ageHours: Math.floor(ageMinutes / 60)
        };
      } catch (error) {
        console.error('[JotFormCache] Failed to get Qualtrics stats:', error);
        return { cached: false, error: error.message };
      }
    }

    /**
     * Clear Qualtrics cache
     * 
     * Part of comprehensive cache deletion system.
     * Removes TGMD survey responses fetched from Qualtrics API.
     * Separate from JotForm cache to allow selective refresh of TGMD data.
     */
    async clearQualtricsCache() {
      const qualtricsStorage = this.getQualtricsStorage();
      if (qualtricsStorage) {
        await qualtricsStorage.removeItem('qualtrics_responses');
        console.log('[JotFormCache] Qualtrics cache cleared');
      }
    }

    /**
     * Get submissions for a specific student from cache (includes Qualtrics-only records)
     * @param {string} coreId - Student core ID (e.g., "C10947")
     * @returns {Promise<Array>} Array of submissions matching the student
     */
    async getStudentSubmissions(coreId) {
      const cached = await this.loadFromCache();
      if (!cached || !cached.submissions) {
        console.log('[JotFormCache] No cached data available for student lookup');
        return [];
      }

      // Extract numeric ID from core ID (e.g., "C10947" -> "10947")
      const numericId = coreId.replace(/^C/i, '');
      
      // Filter submissions where sessionkey contains the student ID
      const studentSubmissions = cached.submissions.filter(submission => {
        const sessionkey = submission.sessionkey;
        if (!sessionkey) return false;
        
        // sessionkey format: "10947_YYYYMMDD_HH_MM" or contains the ID
        return sessionkey.startsWith(numericId + '_') || 
               sessionkey.includes('_' + numericId + '_');
      });

      console.log(`[JotFormCache] Found ${studentSubmissions.length} submissions for ${coreId} in cache`);
      
      // Log if any are Qualtrics-only records
      const qualtricsOnly = studentSubmissions.filter(s => s._orphaned || (s._sources && s._sources.length === 1 && s._sources[0] === 'qualtrics'));
      if (qualtricsOnly.length > 0) {
        console.log(`[JotFormCache] - ${qualtricsOnly.length} of these are Qualtrics-only records (no JotForm data)`);
      }
      
      return studentSubmissions;
    }
  }

  // Export global instance
  window.JotFormCache = new JotFormCache();
  console.log('[JotFormCache] Global cache manager initialized');
})();
