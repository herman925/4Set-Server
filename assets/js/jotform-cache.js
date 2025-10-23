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

          console.log(`[JotFormCache] Fetching page ${pageNum} (offset ${offset}, batch ${currentBatchSize})`);
          // Progress: 0-70% for fetching (phase 1)
          // Intelligent progress: estimate based on typical batch patterns
          // Assume we're roughly halfway done if we're fetching full batches
          // This provides better UX than fixed 2% per page
          let fetchProgress;
          if (pageNum === 1) {
            fetchProgress = 5; // Starting
          } else {
            // Logarithmic curve: slower growth as we fetch more pages
            // This prevents hitting 70% too early on large datasets
            fetchProgress = Math.min(65, 5 + Math.log(pageNum) * 15);
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
            console.log(`[JotFormCache] Page ${pageNum}: Retrieved ${result.content.length} submissions (total: ${allSubmissions.length})`);
            
            // Progress: 0-70% for fetching (phase 1)
            // Smart progress: if we got less than batch size, we're near the end!
            let downloadProgress;
            if (result.content.length < currentBatchSize) {
              // Last page - jump to 70% to transition smoothly to validation
              downloadProgress = 70;
            } else {
              // Still fetching - use logarithmic curve
              downloadProgress = Math.min(65, 5 + Math.log(pageNum) * 15);
            }
            this.emitProgress(`Downloaded ${allSubmissions.length} submissions...`, Math.round(downloadProgress));

            // Gradually increase batch size if we're below baseline and have multiple consecutive successes
            if (this.reductionIndex > 0 && this.consecutiveSuccesses >= this.config.consecutiveSuccessesForIncrease) {
              this.reductionIndex = Math.max(0, this.reductionIndex - 1);
              const newSize = this.reductionIndex === 0 ? baseBatchSize : Math.floor(baseBatchSize * this.config.batchSizeReductions[this.reductionIndex]);
              this.consecutiveSuccesses = 0; // Reset counter after increase
              console.log(`[JotFormCache] After ${this.config.consecutiveSuccessesForIncrease} successes, increasing batch size to ${newSize} (${Math.round((this.reductionIndex === 0 ? 1 : this.config.batchSizeReductions[this.reductionIndex]) * 100)}%)`);
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
        this.emitProgress('Saving to local cache...', 70);
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
            console.log(`[JotFormCache] Set ${set.id}, File ${section.file}: student.gender="${student.gender}"→"${studentGender}", required="${requiredGender}", match=${matches}`);
            return matches;
          }
          
          return true; // No matching condition = applicable by default
        });
        
        setStatus[set.id].tasksTotal = applicableSections.length;
        console.log(`[JotFormCache] ${student.coreId} (${student.gender}): Set ${set.id} tasksTotal = ${applicableSections.length}`);
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
        
        // Debug logging for CM task
        if (taskId === 'cm' && student.coreId === 'C10880') {
          console.log('[JotFormCache] CM Cache Build for C10880:', {
            taskId,
            setId,
            isComplete,
            answered,
            total,
            terminated: validation.terminated,
            hasPostTerminationAnswers: validation.hasPostTerminationAnswers,
            answeredEqualsTotal: answered === total,
            condition1: answered === total && total > 0,
            condition2: validation.terminated && !validation.hasPostTerminationAnswers && answered > 0
          });
        }
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
    
    /**
     * Fetch Qualtrics data and transform to standard format
     * @param {Object} credentials - Qualtrics credentials
     * @returns {Promise<Array>} Transformed Qualtrics responses
     */
    async fetchQualtricsData(credentials) {
      if (!credentials.qualtricsApiKey || !credentials.qualtricsDatacenter || !credentials.qualtricsSurveyId) {
        throw new Error('Missing Qualtrics credentials (qualtricsApiKey, qualtricsDatacenter, or qualtricsSurveyId)');
      }
      
      console.log('[JotFormCache] Fetching Qualtrics data...');
      
      // Initialize API and transformer
      const api = new window.QualtricsAPI();
      const transformer = new window.QualtricsTransformer();
      
      // Load mapping
      const mapping = await transformer.loadMapping();
      
      // Extract TGMD question IDs for filtered export
      const tgmdQids = transformer.extractTGMDQuestionIds(mapping);
      console.log(`[JotFormCache] Requesting ${tgmdQids.length} TGMD questions from Qualtrics`);
      
      // Progress callback for UI updates
      const progressCallback = (message, percent) => {
        this.emitProgress(message, percent);
      };
      
      // Fetch responses
      const responses = await api.fetchAllResponses(credentials, tgmdQids, progressCallback);
      
      // Transform responses
      const transformed = await transformer.transformBatch(responses, mapping);
      
      // Filter out invalid records
      const valid = transformed.filter(record => transformer.validateRecord(record));
      
      console.log(`[JotFormCache] Fetched and transformed ${valid.length} Qualtrics responses`);
      return valid;
    }
    
    /**
     * Merge JotForm and Qualtrics datasets
     * @param {Array} jotformData - JotForm submissions
     * @param {Array} qualtricsData - Transformed Qualtrics responses
     * @returns {Object} { mergedData, statistics }
     */
    mergeWithQualtrics(jotformData, qualtricsData) {
      console.log('[JotFormCache] Merging datasets...');
      
      const merger = new window.DataMerger();
      
      // Merge datasets
      const mergedData = merger.mergeDataSources(jotformData, qualtricsData);
      
      // Validate and generate statistics
      const validation = merger.validateMergedData(mergedData);
      const conflicts = merger.extractConflicts(mergedData);
      const report = merger.generateMergeReport(validation, conflicts);
      
      return {
        mergedData,
        statistics: report
      };
    }
    
    /**
     * Refresh cache with Qualtrics data integration
     * @param {Object} credentials - Combined credentials (JotForm + Qualtrics)
     * @returns {Promise<Object>} Refresh result with statistics
     */
    async refreshWithQualtrics(credentials) {
      console.log('[JotFormCache] Starting Qualtrics-integrated cache refresh...');
      this.isLoading = true;
      
      try {
        // Step 1: Fetch JotForm data (existing method)
        this.emitProgress('Fetching JotForm submissions...', 5);
        const jotformData = await this.getAllSubmissions(credentials);
        console.log(`[JotFormCache] Fetched ${jotformData.length} JotForm submissions`);
        
        // Step 2: Fetch Qualtrics data
        this.emitProgress('Fetching Qualtrics TGMD data...', 30);
        let qualtricsData = [];
        try {
          qualtricsData = await this.fetchQualtricsData(credentials);
          console.log(`[JotFormCache] Fetched ${qualtricsData.length} Qualtrics responses`);
        } catch (qualtricsError) {
          console.warn('[JotFormCache] Failed to fetch Qualtrics data, continuing with JotForm only:', qualtricsError);
          // Continue with JotForm-only data
        }
        
        // Step 3: Merge datasets
        this.emitProgress('Merging datasets...', 85);
        const { mergedData, statistics } = this.mergeWithQualtrics(jotformData, qualtricsData);
        
        // Step 4: Cache merged data
        this.emitProgress('Saving to cache...', 92);
        await this.saveToCache(mergedData);
        
        // Step 5: Cache Qualtrics data separately (for refresh)
        if (qualtricsData.length > 0) {
          const qualtricsStorage = localforage.createInstance({
            name: 'JotFormCacheDB',
            storeName: 'qualtrics_cache'
          });
          await qualtricsStorage.setItem('qualtrics_responses', {
            timestamp: Date.now(),
            responses: qualtricsData,
            surveyId: credentials.qualtricsSurveyId
          });
          console.log('[JotFormCache] Cached Qualtrics responses separately');
        }
        
        // Update in-memory cache
        this.cache = mergedData;
        
        this.emitProgress('Complete!', 100);
        this.isLoading = false;
        
        console.log('[JotFormCache] Qualtrics-integrated refresh complete');
        
        return {
          success: true,
          statistics: statistics,
          jotformCount: jotformData.length,
          qualtricsCount: qualtricsData.length,
          mergedCount: mergedData.length
        };
        
      } catch (error) {
        this.isLoading = false;
        console.error('[JotFormCache] Refresh with Qualtrics failed:', error);
        throw error;
      }
    }
    
    /**
     * Get cached Qualtrics data
     * @returns {Promise<Object|null>} Cached Qualtrics data or null
     */
    async getCachedQualtricsData() {
      try {
        const qualtricsStorage = localforage.createInstance({
          name: 'JotFormCacheDB',
          storeName: 'qualtrics_cache'
        });
        const cached = await qualtricsStorage.getItem('qualtrics_responses');
        return cached;
      } catch (error) {
        console.error('[JotFormCache] Failed to load Qualtrics cache:', error);
        return null;
      }
    }
    
    /**
     * Clear Qualtrics cache
     */
    async clearQualtricsCache() {
      try {
        const qualtricsStorage = localforage.createInstance({
          name: 'JotFormCacheDB',
          storeName: 'qualtrics_cache'
        });
        await qualtricsStorage.removeItem('qualtrics_responses');
        console.log('[JotFormCache] Qualtrics cache cleared');
      } catch (error) {
        console.error('[JotFormCache] Failed to clear Qualtrics cache:', error);
      }
    }
  }

  // Export global instance
  window.JotFormCache = new JotFormCache();
  console.log('[JotFormCache] Global cache manager initialized');
})();
