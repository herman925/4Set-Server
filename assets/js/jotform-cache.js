/**
 * Global Data Merge & Cache System (using IndexedDB via localForage)
 * 
 * PURPOSE: Merge JotForm + Qualtrics data by (coreId, grade) and cache final merged dataset
 * 
 * ============================================================================
 * CACHE ARCHITECTURE (Three-Layer Design)
 * ============================================================================
 * 
 * Layer 1: MERGED SUBMISSIONS CACHE (merged_jotform_qualtrics_cache)
 * - Final merged dataset ready for consumption by checking system
 * - Structure: Array of submission objects with QID-indexed answers
 * - Contains: JotForm-only, Qualtrics-only, and merged records
 * - Each record tagged with 'grade' field (K1/K2/K3)
 * - Access: loadFromCache() or getStudentSubmissions(coreId, grade)
 * 
 * Layer 2: VALIDATION CACHE (student_task_validation_cache)
 * - Pre-computed task validation results (answered/total per task)
 * - Structure: Map<coreId, validationData>
 * - Avoids re-running validation on every page load
 * - Invalidated on cache rebuild or data sync
 * 
 * Layer 3: RAW QUALTRICS CACHE (qualtrics_raw_responses)
 * - Transformed Qualtrics responses for quick re-sync
 * - Enables "Refresh with Qualtrics" without full rebuild
 * - Faster than re-fetching from Qualtrics API
 * 
 * ============================================================================
 * DATA PIPELINE FLOW
 * ============================================================================
 * 
 * Phase 1: PARALLEL FETCH (40% faster than sequential)
 * - JotForm API: getAllSubmissions() → returns QID-indexed answers
 * - Qualtrics API: fetchAllResponses() → returns fieldName-indexed data
 * - Both run simultaneously via Promise.all()
 * 
 * Phase 2: WITHIN-SOURCE MERGE (DataMerger.js)
 * - JotForm: Multiple PDF submissions → Merged by (coreId, grade)
 *   - sessionkey format: studentId_YYYYMMDD_HH_MM
 *   - Grade derived from sessionkey date (Aug-Jul school year)
 *   - Principle: "Earliest non-empty wins"
 * 
 * - Qualtrics: Multiple survey responses → Merged by (coreId, grade)
 *   - recordedDate format: ISO 8601 timestamp
 *   - Grade derived from recordedDate (Aug-Jul school year)
 *   - Principle: "Earliest non-empty wins"
 * 
 * Phase 3: CROSS-SOURCE MERGE (DataMerger.js)
 * - JotForm + Qualtrics → Aligned by (coreId, grade) pairs
 * - Produces 3 record types:
 *   a) JotForm-only: _sources: ['jotform']
 *   b) Qualtrics-only: _sources: ['qualtrics'], _orphaned: true
 *   c) Merged: _sources: ['jotform', 'qualtrics']
 * - CRITICAL: Never merges across different grades (K1/K2/K3)
 * 
 * Phase 4: CONVERT TO SUBMISSION FORMAT (transformRecordsToSubmissions)
 * - Converts merged records (fieldName-indexed) back to submission format
 * - KEY FIX: Qualtrics-only records get QID-indexed answers structure
 *   - Load jotformquestions.json: "TGMD_111_Hop_t1" → "145"
 *   - Use JotForm QID as answers key, preserve fieldName in .name property
 *   - Ensures validateStudent() can convert QID→fieldName uniformly
 * 
 * Phase 5: VALIDATION (validateStudent)
 * - Converts QID-indexed answers → fieldName-indexed mergedAnswers
 * - TaskValidator receives mergedAnswers["TGMD_111_Hop_t1"]
 * - Pre-computes task completion and stores in validation cache
 * 
 * ============================================================================
 * CRITICAL DESIGN DECISIONS
 * ============================================================================
 * 
 * 1. QID-INDEXED ANSWERS STRUCTURE
 *    - All submissions (JotForm and Qualtrics-only) use JotForm QID as key
 *    - Example: answers["145"] = { name: "TGMD_111_Hop_t1", answer: "1" }
 *    - Ensures uniform processing through validateStudent()
 * 
 * 2. TWO DIFFERENT "QID" CONCEPTS
 *    - Qualtrics QID: "QID125287935_TEXT" (from qualtrics-mapping.json)
 *      Used when fetching from Qualtrics API
 *    - JotForm QID: "145" (from jotformquestions.json)
 *      Used as answers index in submission structure
 * 
 * 3. GRADE-BASED GROUPING
 *    - Each (coreId, grade) pair creates separate cache record
 *    - Never mixes K1/K2/K3 data - critical for assessment accuracy
 *    - Grade filtering at retrieval: getStudentSubmissions(coreId, grade)
 * 
 * 4. GRADE DETECTION (GradeDetector.js)
 *    - Try recordedDate from Qualtrics (ISO 8601)
 *    - Fallback to sessionkey from JotForm (studentId_YYYYMMDD_HH_MM)
 *    - Calculate school year: month >= 8 ? year : year - 1
 *    - Map: 2023 → K1, 2024 → K2, 2025 → K3
 * 
 * Benefits:
 * - 40% faster data sync (parallel fetch)
 * - Instant client-side filtering by coreId + grade
 * - Accurate grade-aware display (K1/K2/K3 never mixed)
 * - Pre-computed validation (no redundant processing)
 * - Large storage capacity (hundreds of MB via IndexedDB)
 * - Qualtrics-only students fully supported with correct structure
 */

(() => {
  // Cache key names (descriptive of the merge process)
  const MERGED_DATA_CACHE_KEY = 'merged_jotform_qualtrics_cache'; // Final merged data (coreId+grade aligned)
  const QUALTRICS_RAW_CACHE_KEY = 'qualtrics_raw_responses'; // Raw Qualtrics responses before merge
  const VALIDATION_CACHE_KEY = 'student_task_validation_cache'; // Pre-computed task validation results
  
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

  // Progress allocation (phase 1: fetch, phase 2: validation)
  const FETCH_PHASE_END_PERCENT = 75; // Phase 1 target (fetching JotForm submissions)
  const VALIDATION_PHASE_START_PERCENT = FETCH_PHASE_END_PERCENT; // Phase 2 starts exactly where fetch ends
  const VALIDATION_PHASE_RANGE = 100 - VALIDATION_PHASE_START_PERCENT;

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
     * Normalize credential field names (supports legacy jotformApiKey/jotformFormId)
     * @param {Object} credentials
     * @returns {Object}
     */
    normalizeJotformCredentials(credentials) {
      if (!credentials) {
        return { formId: undefined, apiKey: undefined };
      }

      const formId = credentials.jotformFormId || credentials.formId;
      const apiKey = credentials.jotformApiKey || credentials.apiKey;

      return {
        ...credentials,
        formId,
        apiKey
      };
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
        // Running locally - use Flask proxy server on port 5000
        // NOTE: Port 3000 is reserved by Windows Hyper-V, using 5000 instead
        return 'http://localhost:5000/api/jotform';
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
     * @param {Object} details - Optional details like individual progress values
     */
    emitProgress(message, progress, details = {}) {
      if (this.progressCallback) {
        this.progressCallback(message, progress, details);
      }
    }

    /**
     * Fix untransformed submissions in cache (missing coreId)
     * This handles submissions that have answers object but no coreId field
     * @param {Array} submissions - Submissions array
     * @returns {Array} - Fixed submissions
     */
    fixUntransformedSubmissions(submissions) {
      let fixedCount = 0;
      
      for (const submission of submissions) {
        // Check if submission needs fixing (has answers but no coreId)
        if (submission.answers && !submission.coreId) {
          try {
            // Try to extract student ID from QID 3 (sessionkey field) if malformed
            const qid3Answer = submission.answers['3'];
            const qid3Value = qid3Answer?.answer || qid3Answer?.text;
            
            if (qid3Value && qid3Value.includes('_')) {
              // Extract student ID from sessionkey format
              const match = qid3Value.match(/^(\d+)_/);
              if (match) {
                const studentId = match[1];
                submission.coreId = `C${studentId}`;
                submission['student-id'] = studentId;
                submission._sources = ['jotform'];
                
                // Determine grade from sessionkey
                if (typeof window.GradeDetector !== 'undefined') {
                  submission.grade = window.GradeDetector.determineGradeFromSessionKey(qid3Value);
                }
                
                fixedCount++;
              }
            }
          } catch (error) {
            console.warn('[JotFormCache] Failed to fix submission:', submission.id, error);
          }
        }
      }
      
      if (fixedCount > 0) {
        console.log(`[JotFormCache] ✅ Fixed ${fixedCount} untransformed submissions in cache`);
      }
      
      return submissions;
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
        
        // Fix any untransformed submissions before returning
        const fixedSubmissions = this.fixUntransformedSubmissions(cached.submissions);
        
        // If we fixed any, save back to cache
        if (fixedSubmissions !== cached.submissions) {
          await this.saveToCache(fixedSubmissions);
        }
        
        return fixedSubmissions;
      }

      // If already loading, wait for existing promise
      if (this.isLoading && this.loadPromise) {
        console.log('[JotFormCache] Waiting for existing load operation...');
        return this.loadPromise;
      }

      // Fetch fresh data
  const normalizedCredentials = this.normalizeJotformCredentials(credentials);

  this.isLoading = true;
  console.log('[JotFormCache] Starting fresh fetch...');
  this.loadPromise = this.fetchAllSubmissions(normalizedCredentials)
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
      const formId = credentials?.formId;
      const apiKey = credentials?.apiKey;

      if (!formId || !apiKey) {
        throw new Error('Missing JotForm credentials (formId/apiKey)');
      }

      console.log('[JotFormCache] Form ID:', formId);

      // Load configuration
      await this.loadConfig();
      
      this.emitProgress('Connecting to Jotform API...', 5, {
        jotformMessage: 'Connecting to Jotform API...',
        qualtricsMessage: 'Waiting to start...'
      });

      const allSubmissions = [];
      let offset = 0;
      let hasMore = true;
      let pageNum = 1;
      
      // Adaptive batch sizing (like processor_agent.ps1)
      const baseBatchSize = this.config.initialBatchSize;
      let currentBatchSize = baseBatchSize;
      
  // Dynamic progress tracking
  // Reserve 1-75% for fetching (74% range), 75-100% for post-processing
    // Prefer precise progress using API-provided totals; fall back to
    // adaptive estimation only if total count is unavailable.
    let currentProgress = 1; // Start at 1%
    const FETCH_END_PERCENT = FETCH_PHASE_END_PERCENT;
  const FETCH_RANGE = FETCH_END_PERCENT - 1; // e.g. 74% when fetch cap is 75
    let totalExpectedSubmissions = null;

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
          
          const url = `${this.apiBaseUrl}/form/${formId}/submissions?` +
                      `apiKey=${apiKey}` +
                      `&limit=${currentBatchSize}` +
                      `&offset=${offset}` +
                      `&orderby=created_at` +
                      `&direction=ASC`;

          // Progress BEFORE fetch: show what we're about to do
          const fetchMessage = `Fetching page ${pageNum} (batch: ${currentBatchSize})...`;
          this.emitProgress(fetchMessage, Math.round(currentProgress), {
            jotformMessage: fetchMessage,
            qualtricsMessage: 'Waiting to start...'
          });
          
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

            if (typeof result.total === 'number' && !Number.isNaN(result.total)) {
              if (!totalExpectedSubmissions || result.total > totalExpectedSubmissions) {
                totalExpectedSubmissions = result.total;
              }
            }

            // Progress AFTER successful fetch
            const isLastPage = result.content.length < currentBatchSize;
            let downloadProgress;

            if (totalExpectedSubmissions && totalExpectedSubmissions > 0) {
              const cappedTotal = Math.max(totalExpectedSubmissions, allSubmissions.length);
              const completionRatio = Math.min(allSubmissions.length / cappedTotal, 1);
              if (isLastPage || completionRatio >= 1) {
                downloadProgress = FETCH_END_PERCENT;
              } else {
                downloadProgress = 1 + completionRatio * FETCH_RANGE;
                downloadProgress = Math.min(downloadProgress, FETCH_END_PERCENT - 1);
              }
            } else {
              // Fallback: adaptive increment based on page count when total is unknown
              const remainingRange = FETCH_END_PERCENT - currentProgress;
              const adaptiveIncrement = remainingRange / (pageNum * 0.5 + 2);
              downloadProgress = Math.min(currentProgress + adaptiveIncrement, FETCH_END_PERCENT - 1);
            }

            currentProgress = Math.min(downloadProgress, FETCH_END_PERCENT);
            
            const downloadMessage = `Downloaded ${allSubmissions.length} submissions...`;
            this.emitProgress(downloadMessage, Math.round(downloadProgress), {
              jotformMessage: downloadMessage,
              qualtricsMessage: 'Waiting to start...'
            });

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
        currentProgress = FETCH_END_PERCENT;
        this.emitProgress('Saving to local cache...', FETCH_END_PERCENT, {
          jotformMessage: 'Saving to local cache...',
          qualtricsMessage: 'Waiting to start...'
        });
        console.log(`[JotFormCache] ========== FETCH COMPLETE ==========`);
        console.log(`[JotFormCache] Total submissions: ${allSubmissions.length}`);
        
        // DEBUG: Check C10034 submissions in raw fetch
        const c10034Submissions = allSubmissions.filter(s => {
          const sessionkey = s.answers?.['3']?.answer;
          return sessionkey && sessionkey.startsWith('10034_');
        });
        if (c10034Submissions.length > 0) {
          console.log(`[JotFormCache] 🔍 DEBUG: Found ${c10034Submissions.length} C10034 submission(s) in fetch:`);
          c10034Submissions.forEach(s => {
            console.log(`   ${s.answers['3'].answer} (ID: ${s.id}, created: ${s.created_at})`);
          });
        }
        
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
    filterByCoreId(submissions, coreId, studentIdQid = STUDENT_ID_QID) {
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
        
        await storage.setItem(MERGED_DATA_CACHE_KEY, cacheEntry);
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
        const cacheEntry = await storage.getItem(MERGED_DATA_CACHE_KEY);
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
     * 1. Submissions cache (merged_jotform_qualtrics_cache) - All merged JotForm + Qualtrics data
     * 2. Validation cache (student_task_validation_cache) - Pre-computed task validation results  
     * 3. Qualtrics cache (qualtrics_raw_responses) - Raw Qualtrics survey data
     * 
     * After calling this method, the system requires a full re-sync (60-90 seconds)
     * before it can be used again. This is the recommended way to force a fresh
     * data fetch when suspecting stale or incorrect cached data.
     * 
     * Related: See CACHE_SYSTEM_STATUS.md for implementation details
     */
    async clearCache() {
      if (storage) {
        await storage.removeItem(MERGED_DATA_CACHE_KEY);
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
     * 
     * GRADE-AWARE FILTERING:
     * This method now supports grade-based filtering to prevent cross-grade data contamination.
     * If all students in the array have the same grade (year), only submissions matching that
     * grade will be processed. This ensures class/school pages showing K3 students don't
     * accidentally merge K1 or K2 submissions.
     * 
     * @param {Array} students - Array of student objects from coreid.csv
     * @param {Object} surveyStructure - Survey structure for task-to-set mapping
     * @param {Object} credentials - { formId, apiKey } for JotForm API
     * @param {boolean} forceRebuild - Force rebuild even if cache exists
     * @returns {Promise<Map>} - Map of coreId -> validation cache
     */
    async buildStudentValidationCache(students, surveyStructure, credentials, forceRebuild = false) {
      console.log('[JotFormCache] Building student validation cache...');
      
      if (!window.TaskValidator) {
        throw new Error('TaskValidator not loaded');
      }
      
      // Detect if all students have the same grade (for grade-aware filtering)
      const studentGrades = new Set(students.map(s => s.year).filter(y => y));
      const singleGrade = studentGrades.size === 1 ? Array.from(studentGrades)[0] : null;
      
      if (singleGrade) {
        console.log(`[JotFormCache] Grade-aware mode: All students are ${singleGrade}, will filter submissions by grade`);
      } else if (studentGrades.size > 1) {
        console.log(`[JotFormCache] Multi-grade mode: Students span ${studentGrades.size} grades (${Array.from(studentGrades).join(', ')})`);
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
  let submissions = await this.getAllSubmissions(credentials);
      
      if (!submissions || submissions.length === 0) {
        console.warn('[JotFormCache] No submissions to validate');
        return validationCache;
      }
      
      // GRADE-AWARE FILTERING: If all students are same grade, filter submissions by that grade
      // This prevents mixing K1+K2+K3 data when building cache for a single-grade class
      if (singleGrade) {
        const beforeFilter = submissions.length;
        submissions = submissions.filter(s => s.grade === singleGrade);
        console.log(`[JotFormCache] Grade filter (${singleGrade}): ${beforeFilter} → ${submissions.length} submissions`);
      }
      
      // Group submissions by student
      const studentSubmissions = new Map();
      const unmatchedSubmissions = [];
      
      // Debug: Log class student Core IDs
      console.log(`[JotFormCache] Class students expecting data:`, students.map(s => `${s.coreId} (${s.studentName || 'no name'})`).slice(0, 5));
      
      for (const submission of submissions) {
        const studentIdAnswer = submission.answers?.[STUDENT_ID_QID];
        const studentId = studentIdAnswer?.answer || studentIdAnswer?.text;
        if (!studentId) {
          unmatchedSubmissions.push({ reason: 'No student ID in submission', submissionId: submission.id });
          continue;
        }
        
        // Find student by Core ID (and optionally verify grade match)
        const student = students.find(s => {
          const numericCoreId = s.coreId.startsWith('C') ? s.coreId.substring(1) : s.coreId;
          const numericStudentId = studentId.startsWith('C') ? studentId.substring(1) : studentId;
          const coreIdMatches = numericCoreId === numericStudentId;
          
          // If we're in single-grade mode, the submission grade should already match
          // If multi-grade mode, match student by both coreId AND grade
          if (studentGrades.size > 1 && submission.grade) {
            return coreIdMatches && s.year === submission.grade;
          }
          
          return coreIdMatches;
        });
        
        if (student) {
          if (!studentSubmissions.has(student.coreId)) {
            studentSubmissions.set(student.coreId, {
              student,
              submissions: []
            });
          }
          studentSubmissions.get(student.coreId).submissions.push(submission);
        } else {
          unmatchedSubmissions.push({ 
            studentId, 
            grade: submission.grade, 
            submissionId: submission.id,
            created: submission.created_at 
          });
        }
      }
      
      console.log(`[JotFormCache] Matched ${studentSubmissions.size}/${students.length} students with submissions`);
      console.log(`[JotFormCache] Matched students:`, Array.from(studentSubmissions.keys()));
      
      if (unmatchedSubmissions.length > 0) {
        console.log(`[JotFormCache] ⚠️ ${unmatchedSubmissions.length} submissions couldn't be matched to students`);
        console.log(`[JotFormCache] First 10 unmatched:`, unmatchedSubmissions.slice(0, 10));
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
          
          // Report progress (phase 2 picks up exactly where fetch ended)
          const validationProgress = VALIDATION_PHASE_START_PERCENT +
            Math.round((processed / totalStudents) * VALIDATION_PHASE_RANGE);
          const validationMessage = `Validating students (${processed}/${totalStudents})`;
          this.emitProgress(validationMessage, validationProgress, {
            jotformMessage: validationMessage,
            qualtricsMessage: validationMessage
          });
          
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
        
        await validationStorage.setItem(VALIDATION_CACHE_KEY, cacheEntry);
        console.log(`[JotFormCache] ✅ Saved validation cache: ${validationCache.size} students`);
        
        // Verify
        const verification = await validationStorage.getItem(VALIDATION_CACHE_KEY);
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
        const cacheEntry = await validationStorage.getItem(VALIDATION_CACHE_KEY);
        
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
            console.log('[JotFormCache] ℹ️  Validation cache has outdated structure (missing taskValidation or setStatus), rebuilding...');
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
        await validationStorage.removeItem(VALIDATION_CACHE_KEY);
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
        set1: { status: 'notstarted', tasksComplete: 0, tasksStarted: 0, tasksTotal: 0, tasks: [] },
        set2: { status: 'notstarted', tasksComplete: 0, tasksStarted: 0, tasksTotal: 0, tasks: [] },
        set3: { status: 'notstarted', tasksComplete: 0, tasksStarted: 0, tasksTotal: 0, tasks: [] },
        set4: { status: 'notstarted', tasksComplete: 0, tasksStarted: 0, tasksTotal: 0, tasks: [] }
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
        
        const normalizedTaskId = taskId.toLowerCase();
        const isIgnoredForIncompleteChecks = setId === 'set4' && normalizedTaskId === 'mf';
        
        // Only count tasks that are applicable to this student and not ignored for completion
        if (!isIgnoredForIncompleteChecks) {
          totalTasks++;
        }
        
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
        
        if (isComplete && !isIgnoredForIncompleteChecks) {
          completeTasks++;
          setStatus[setId].tasksComplete++;
        }
        
        // Track if task has been started (at least 1 answer)
        if (answered > 0 && !isIgnoredForIncompleteChecks) {
          setStatus[setId].tasksStarted++;
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
          hasPostTerminationAnswers: validation.hasPostTerminationAnswers || false,
          ignoredForIncompleteChecks: isIgnoredForIncompleteChecks
        });
      }
      
      // Calculate set status
      for (const setId in setStatus) {
        const set = setStatus[setId];
        if (set.tasksTotal === 0) continue;
        
        // Special handling for Set 4: Exclude MF (Math Fluency) from completion criteria
        // Set 4 can be green if FineMotor and TGMD satisfy green light criteria, regardless of MF status
        let effectiveTasksTotal = set.tasksTotal;
        let effectiveTasksComplete = set.tasksComplete;
        
        if (setId === 'set4') {
          // Find MF task in set4
          const mfTask = set.tasks.find(t => t.taskId === 'mf' || t.taskId?.toLowerCase() === 'mf');
          if (mfTask && effectiveTasksTotal > 0) {
            // Exclude MF from both total and complete counts
            effectiveTasksTotal--;
            console.log(`[JotFormCache] Set 4: Excluding MF from completion criteria (${effectiveTasksComplete}/${effectiveTasksTotal} required)`);
          }
        }
        
        // Avoid division by zero if all tasks were excluded
        if (effectiveTasksTotal === 0) {
          set.status = 'notstarted';
          continue;
        }
        
        const completionRate = effectiveTasksComplete / effectiveTasksTotal;
        if (completionRate === 1) {
          set.status = 'complete';
        } else if (set.tasksStarted > 0) {
          // If any task has been started (has at least 1 answer), set is incomplete
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
          let studentIdAnswer = submission.answers?.[STUDENT_ID_QID];
          let studentId = studentIdAnswer?.answer || studentIdAnswer?.text;
          
          // FALLBACK: If student-id is missing or looks like sessionkey format, try QID 3 (sessionkey field)
          // This handles PDFs where field mappings are wrong (sessionkey value in student-id field)
          if (!studentId || (studentId && studentId.includes('_'))) {
            const qid3Answer = submission.answers?.['3'];
            const qid3Value = qid3Answer?.answer || qid3Answer?.text;
            
            if (qid3Value && qid3Value.includes('_')) {
              // Extract student ID from sessionkey format (e.g., "10034_20250916_10_45" → "10034")
              const match = qid3Value.match(/^(\d+)_/);
              if (match) {
                studentId = match[1];
                console.log(`[JotFormCache] ℹ️  Extracted student-id from sessionkey format: ${qid3Value} → ${studentId}`);
              }
            }
          }
          
          if (!studentId) {
            console.warn('[JotFormCache] Submission missing student ID, skipping:', submission.id);
            continue;
          }
          
          // Create coreId with "C" prefix
          const coreId = this.ensureCoreIdPrefix(studentId);
          
          // Determine grade from sessionkey if available
          let grade = 'Unknown';
          // Extract sessionkey from answers (QID 3) or root level
          const sessionkey = submission.sessionkey || submission.answers?.['3']?.answer || submission.answers?.['3']?.text;
          if (sessionkey && typeof window.GradeDetector !== 'undefined') {
            grade = window.GradeDetector.determineGradeFromSessionKey(sessionkey);
            console.log(`[JotFormCache] Student ${coreId}: sessionkey=${sessionkey} → grade=${grade}`);
          }
          
          // Build flat record with all answer fields
          const record = {
            coreId: coreId,
            'student-id': studentId,
            grade: grade,  // Add grade at root level
            _meta: {
              source: 'jotform',
              submissionId: submission.id,
              created_at: submission.created_at,
              updated_at: submission.updated_at,
              sessionkey: sessionkey  // Store sessionkey from extracted value
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
      
      // DEBUG: Check C10034 in transformed records
      const c10034Records = records.filter(r => r.coreId === 'C10034');
      if (c10034Records.length > 0) {
        console.log(`[JotFormCache] 🔍 DEBUG: C10034 after transform: ${c10034Records.length} record(s)`);
        c10034Records.forEach(r => {
          console.log(`   Grade: ${r.grade}, SessionKey: ${r._meta?.sessionkey}, Created: ${r._meta?.created_at}`);
        });
      }
      
      return records;
    }

    /**
     * Transform merged records back to submission format for caching
     * Converts from flat record format back to JotForm submission structure
     * 
     * IMPORTANT: This method assumes student ID is in answers[STUDENT_ID_QID].
     * If JotForm's question structure changes, the STUDENT_ID_QID constant must be updated.
     * 
     * CRITICAL FIX (October 30, 2025): COMPOSITE KEY FOR MULTI-GRADE STUDENTS
     * Previously used submissionMap.set(coreId, submission), which caused cross-grade contamination
     * when students had data from multiple grades (e.g., K2 Qualtrics + K3 JotForm).
     * 
     * Bug symptom: K2 Qualtrics-only records would incorrectly display K3 JotForm data because
     * the map lookup only used coreId, causing all grades to share the last JotForm submission.
     * 
     * Now uses composite key: submissionMap.set(`${coreId}_${grade}`, submission)
     * This ensures each grade gets its own original submission match, preventing cross-grade
     * data contamination for longitudinal studies.
     * 
     * Test case: Student C10034
     * - Before fix: K2 record showed K3 sessionkey (10034_20250916_10_45) with 633 JotForm answers
     * - After fix: K2 record properly orphaned with 377 answers (101 Qualtrics fields), no sessionkey
     * 
     * ORPHANED RECORDS BEHAVIOR:
     * Records marked with _orphaned: true (Qualtrics-only data with no JotForm submission)
     * will be skipped during this transformation. This is EXPECTED behavior when:
     * 1. A student has completed the Qualtrics survey but hasn't done JotForm assessment yet
     * 2. Cross-grade data exists (e.g., student has K2 data in Qualtrics, K3 in JotForm)
     * 
     * These records are preserved in the merged dataset for validation purposes but cannot
     * be converted back to JotForm submission format since there's no original structure to clone.
     * 
     * Console messages will indicate:
     * - ℹ️  Info level: Expected Qualtrics-only records (normal operation)
     * - ⚠️  Warning level: Unexpected missing submissions (potential data issue)
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
     * @param {Array} records - Merged records with flat structure (may include orphaned records)
     * @param {Array} originalSubmissions - Original JotForm submissions for structure reference
     * @returns {Array} Submissions in JotForm format (orphaned records excluded)
     */
    async transformRecordsToSubmissions(records, originalSubmissions) {
      console.log('[JotFormCache] Converting records back to submission format...');
      
      // Load JotForm QID mapping for Qualtrics-only submissions
      // This is critical because TaskValidator expects answers indexed by JotForm QID, not fieldName
      let fieldNameToQid = {};
      try {
        const response = await fetch('assets/jotformquestions.json');
        if (response.ok) {
          fieldNameToQid = await response.json();
          console.log('[JotFormCache] Loaded fieldName → JotForm QID mapping for Qualtrics-only submissions');
        } else {
          console.warn('[JotFormCache] Could not load jotformquestions.json - Qualtrics-only submissions may not display correctly');
        }
      } catch (error) {
        console.error('[JotFormCache] Failed to load jotformquestions.json:', error);
      }
      
      // Create a map of original submissions by (coreId, grade) for easy lookup
      // CRITICAL: Use coreId+grade as key to handle students with data from multiple grades
      const submissionMap = new Map();
      for (const submission of originalSubmissions) {
        const studentIdAnswer = submission.answers?.[STUDENT_ID_QID];
        const studentId = studentIdAnswer?.answer || studentIdAnswer?.text;
        if (studentId) {
          const coreId = this.ensureCoreIdPrefix(studentId);
          
          // Determine grade from this submission's sessionkey
          const sessionkey = submission.answers?.['3']?.answer || submission.answers?.['3']?.text;
          const grade = (sessionkey && window.GradeDetector) 
            ? window.GradeDetector.determineGradeFromSessionKey(sessionkey)
            : 'Unknown';
          
          // Use coreId+grade as composite key
          const mapKey = `${coreId}_${grade}`;
          submissionMap.set(mapKey, submission);
        }
      }
      
      const submissions = [];
      let orphanedCount = 0;
      let unexpectedMissingCount = 0;
      
      for (const record of records) {
        try {
          // Get original submission structure using coreId+grade composite key
          const mapKey = `${record.coreId}_${record.grade || 'Unknown'}`;
          const originalSubmission = submissionMap.get(mapKey);
          
          if (!originalSubmission) {
            // This is expected for Qualtrics-only records (orphaned data)
            // It means the student has Qualtrics survey data but no JotForm submission yet
            if (record._orphaned) {
              console.log(`[JotFormCache] ℹ️  Creating submission structure for Qualtrics-only record: ${record.coreId}`);
              orphanedCount++;
              
              // Create a minimal submission structure for Qualtrics-only data
              // This allows Qualtrics-only students to be displayed in the checking system
              const qualtricsSubmission = {
                id: `qualtrics_${record.coreId}_${record.grade || 'unknown'}`,
                form_id: 'qualtrics',
                ip: '',
                created_at: record._meta?.recordedDate || record._meta?.startDate || new Date().toISOString(),
                status: 'ACTIVE',
                new: '0',
                flag: '0',
                notes: '',
                updated_at: null,
                coreId: record.coreId,
                grade: record.grade,
                _sources: ['qualtrics'],
                _orphaned: true,
                answers: {}
              };
              
              // Convert all Qualtrics fields to answer objects
              // CRITICAL: Use JotForm QID as the key, NOT fieldName
              // TaskValidator expects answers[qid], not answers[fieldName]
              for (const [fieldName, answerObj] of Object.entries(record)) {
                // Skip metadata fields
                if (fieldName === 'coreId' || 
                    fieldName === 'student-id' || 
                    fieldName === 'grade' ||
                    fieldName === '_meta' || 
                    fieldName === '_sources' ||
                    fieldName === '_orphaned') {
                  continue;
                }
                
                // Look up the JotForm QID for this field
                // This is the KEY FIX: Use QID as the answers key, not fieldName
                const qid = fieldNameToQid[fieldName];
                
                if (qid) {
                  // Create answer object in JotForm submission format
                  // Use QID as key so TaskValidator can find the answer
                  // CRITICAL: Extract plain value from answer object if nested
                  const actualAnswer = (answerObj && typeof answerObj === 'object' && answerObj.answer !== undefined)
                    ? answerObj.answer
                    : answerObj;
                  const actualText = (answerObj && typeof answerObj === 'object')
                    ? (answerObj.text || answerObj.answer || answerObj)
                    : answerObj;
                  
                  qualtricsSubmission.answers[qid] = {
                    name: fieldName,  // Preserve fieldName in the answer object
                    answer: actualAnswer,
                    text: actualText,
                    type: 'control_textbox'
                  };
                } else {
                  // Fallback: If no QID mapping found, use fieldName as key
                  // This preserves the field even if not in the mapping file
                  const actualAnswer = (answerObj && typeof answerObj === 'object' && answerObj.answer !== undefined)
                    ? answerObj.answer
                    : answerObj;
                  const actualText = (answerObj && typeof answerObj === 'object')
                    ? (answerObj.text || answerObj.answer || answerObj)
                    : answerObj;
                  
                  qualtricsSubmission.answers[fieldName] = {
                    name: fieldName,
                    answer: actualAnswer,
                    text: actualText,
                    type: 'control_textbox'
                  };
                }
              }
              
              submissions.push(qualtricsSubmission);
              continue;
            } else {
              console.warn(`[JotFormCache] ⚠️  No original JotForm submission found for ${record.coreId} - this may indicate a data inconsistency`);
              unexpectedMissingCount++;
              continue;
            }
          }
          
          // Clone the original submission
          const submission = JSON.parse(JSON.stringify(originalSubmission));
          
          // CRITICAL: Preserve coreId and _sources from merged record
          // These fields are added during transformation and must be preserved
          if (record.coreId) {
            submission.coreId = record.coreId;
          }
          if (record._sources) {
            submission._sources = record._sources;
          }
          
          // Preserve grade field from merged record at submission level
          // This is critical for grade-based filtering in getStudentSubmissions()
          if (record.grade) {
            submission.grade = record.grade;
          }
          
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
              // NOTE: grade is now preserved at submission level (see above), so skip it here
              if (fieldName === 'coreId' || 
                  fieldName === 'student-id' || 
                  fieldName === 'grade' ||  // Skip grade field (preserved at submission level)
                  fieldName === '_meta' || 
                  fieldName === '_sources' ||
                  fieldName === '_orphaned') {
                continue;
              }
              
              // Look up QID using reverse map (O(1) instead of O(n))
              const qidToUpdate = fieldNameToQid[fieldName];
              
              // Update the answer if we found the QID
              if (qidToUpdate && submission.answers[qidToUpdate]) {
                // CRITICAL FIX: Extract the actual value from answer object
                // Qualtrics data comes as {answer: "0", text: "0"}, not plain strings
                const actualValue = (value && typeof value === 'object' && value.answer !== undefined)
                  ? value.answer  // Extract from answer object
                  : value;         // Use as-is if already a primitive
                
                submission.answers[qidToUpdate].answer = actualValue;
                if (submission.answers[qidToUpdate].text !== undefined) {
                  submission.answers[qidToUpdate].text = actualValue;
                }
              }
            }
          }
          
          submissions.push(submission);
        } catch (error) {
          console.error('[JotFormCache] Failed to convert record to submission:', record.coreId, error);
        }
      }
      
      console.log(`[JotFormCache] ========== TRANSFORMATION COMPLETE ==========`);
      console.log(`[JotFormCache] Total input records: ${records.length}`);
      console.log(`[JotFormCache] ✓ Successfully converted: ${submissions.length}`);
      if (orphanedCount > 0) {
        console.log(`[JotFormCache] ℹ️  Skipped (Qualtrics-only): ${orphanedCount}`);
      }
      if (unexpectedMissingCount > 0) {
        console.warn(`[JotFormCache] ⚠️  Skipped (missing original): ${unexpectedMissingCount}`);
      }
      console.log(`[JotFormCache] ===============================================`);
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
        // PARALLEL OPTIMIZATION: Fetch JotForm and Qualtrics data simultaneously
        // This significantly reduces total sync time (30-40% faster)
        
        // Initialize Qualtrics modules first (needed for parallel fetch)
        const qualtricsAPI = new window.QualtricsAPI();
        const transformer = new window.QualtricsTransformer();
        const merger = new window.DataMerger();
        
        // Set up progress tracking for parallel operations
        // JotForm: 0-80%, Qualtrics: 0-60% (both contribute to combined progress)
        // Reserve 80-100% for post-processing
        let jotformProgress = 0;
        let qualtricsProgress = 0;
        let jotformMessage = 'Waiting to start...';
        let qualtricsMessage = 'Waiting to start...';
        let isUpdatingProgress = false; // Prevent recursive calls
        
        // Save original callback BEFORE defining the update function
        const originalJotformCallback = this.progressCallback;
        
        const updateCombinedProgress = () => {
          // Prevent infinite recursion
          if (isUpdatingProgress) return;
          
          try {
            isUpdatingProgress = true;
            
            // Combined progress weighted average
            // JotForm typically has more data, so weight it more heavily
            const combined = Math.round((jotformProgress * 0.6 + qualtricsProgress * 0.4));
            
            // Call the original callback directly to avoid triggering our own callback
            if (originalJotformCallback) {
              originalJotformCallback(
                `Fetching data from both sources...`,
                combined,
                {
                  // JotForm: scale 0-80 to 0-100
                  jotformProgress: Math.round((jotformProgress / 80) * 100),
                  // Qualtrics: scale 0-60 to 0-100  
                  qualtricsProgress: Math.round((qualtricsProgress / 60) * 100),
                  jotformMessage: jotformMessage,
                  qualtricsMessage: qualtricsMessage
                }
              );
            }
          } finally {
            isUpdatingProgress = false;
          }
        };
        
        // Set up progress callbacks for both operations
        this.setProgressCallback((msg, progress, details) => {
          // Only handle progress from JotForm's getAllSubmissions
          // Ignore our own emitProgress calls by checking the details object
          if (!details || !details.jotformProgress) {
            // This is from JotForm's internal progress, update our tracking
            jotformProgress = Math.min(progress, 80);
            jotformMessage = msg; // Capture the detailed message
            updateCombinedProgress();
          }
        });
        
        qualtricsAPI.setProgressCallback((msg, progress) => {
          // Qualtrics reports 0-100%, map to 0-60% of total
          qualtricsProgress = Math.min(progress * 0.6, 60);
          qualtricsMessage = msg; // Capture the detailed message
          updateCombinedProgress();
        });
        
        this.emitProgress('Starting parallel fetch: JotForm + Qualtrics...', 0);
        console.log('[JotFormCache] ========== PARALLEL FETCH STARTED ==========');
        
        try {
          // STEP 1: Fetch JotForm and Qualtrics data in PARALLEL
          const [jotformSubmissions, rawResponses] = await Promise.all([
            // Fetch JotForm submissions (0-50% progress)
            this.getAllSubmissions(credentials),
            
            // Fetch Qualtrics responses (0-50% progress)
            (async () => {
              await transformer.loadMapping();
              return await qualtricsAPI.fetchAllResponses(credentials);
            })()
          ]);
          
          console.log('[JotFormCache] ========== PARALLEL FETCH COMPLETE ==========');
          console.log(`[JotFormCache] JotForm: ${jotformSubmissions.length} submissions`);
          console.log(`[JotFormCache] Qualtrics: ${rawResponses.length} responses`);
          
          // STEP 2: Transform both datasets (80-85%)
          this.emitProgress('Transforming JotForm data...', 78, {
            jotformProgress: 100,
            qualtricsProgress: 5,
            jotformMessage: 'Transforming data...',
            qualtricsMessage: 'Transforming data...'
          });
          const jotformData = this.transformSubmissionsToRecords(jotformSubmissions);
          console.log('[JotFormCache] JotForm data transformed:', jotformData.length, 'records');

          this.emitProgress('Transforming Qualtrics data...', 80, {
            jotformProgress: 100,
            qualtricsProgress: 15,
            jotformMessage: 'Transforming data...',
            qualtricsMessage: 'Transforming data...'
          });
          const transformedData = transformer.transformBatch(rawResponses);
          console.log('[JotFormCache] Qualtrics data transformed:', transformedData.length, 'records');

          // STEP 3: Merge datasets (85-88%)
          this.emitProgress('Merging JotForm and Qualtrics data...', 82, {
            jotformProgress: 100,
            qualtricsProgress: 25,
            jotformMessage: 'Merging data...',
            qualtricsMessage: 'Merging data...'
          });
          const mergedData = merger.mergeDataSources(jotformData, transformedData);
          console.log('[JotFormCache] Data merged:', mergedData.length, 'records');

          // STEP 4: Validate merge (88-90%)
          this.emitProgress('Validating merged data...', 85, {
            jotformProgress: 100,
            qualtricsProgress: 40,
            jotformMessage: 'Validating data...',
            qualtricsMessage: 'Validating data...'
          });
          const validation = merger.validateMergedData(mergedData);

          // STEP 5: Cache Qualtrics data separately (90-92%)
          this.emitProgress('Caching Qualtrics responses...', 87, {
            jotformProgress: 100,
            qualtricsProgress: 60,
            jotformMessage: 'Caching data...',
            qualtricsMessage: 'Caching data...'
          });
          const qualtricsStorage = this.getQualtricsStorage();
          if (qualtricsStorage) {
            await qualtricsStorage.setItem(QUALTRICS_RAW_CACHE_KEY, {
              timestamp: Date.now(),
              responses: transformedData,
              surveyId: credentials.qualtricsSurveyId,
              count: transformedData.length
            });
            console.log('[JotFormCache] Qualtrics cache updated');
          }

          // STEP 6: Convert merged records back to submission format (92-95%)
          this.emitProgress('Converting merged data to cache format...', 90, {
            jotformProgress: 100,
            qualtricsProgress: 75,
            jotformMessage: 'Converting data...',
            qualtricsMessage: 'Converting data...'
          });
          const mergedSubmissions = await this.transformRecordsToSubmissions(mergedData, jotformSubmissions);
          console.log('[JotFormCache] Converted', mergedSubmissions.length, 'records back to submission format');

          // STEP 7: Update main cache with merged data (95-98%)
          this.emitProgress('Updating main cache...', 93, {
            jotformProgress: 100,
            qualtricsProgress: 90,
            jotformMessage: 'Updating cache...',
            qualtricsMessage: 'Updating cache...'
          });
          await this.saveToCache(mergedSubmissions);
          this.cache = mergedSubmissions;
          console.log('[JotFormCache] Main cache updated with merged data');

          // STEP 8: Clear validation cache (98-100%)
          this.emitProgress('Clearing validation cache...', 97, {
            jotformProgress: 100,
            qualtricsProgress: 96,
            jotformMessage: 'Clearing validation cache...',
            qualtricsMessage: 'Clearing validation cache...'
          });
          await this.clearValidationCache();
          console.log('[JotFormCache] Validation cache cleared (will rebuild on demand)');

          this.emitProgress('Qualtrics integration complete!', 100, {
            jotformProgress: 100,
            qualtricsProgress: 100,
            jotformMessage: 'Complete!',
            qualtricsMessage: 'Complete!'
          });
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
        } finally {
          // Always restore original progress callback, even on error
          this.setProgressCallback(originalJotformCallback);
        }
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
        const cached = await qualtricsStorage.getItem(QUALTRICS_RAW_CACHE_KEY);
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
        await qualtricsStorage.removeItem(QUALTRICS_RAW_CACHE_KEY);
        console.log('[JotFormCache] Qualtrics cache cleared');
      }
    }

    /**
     * Get submissions for a specific student from cache (includes Qualtrics-only records)
     * @param {string} coreId - Student core ID (e.g., "C10947")
     * @returns {Promise<Array>} Array of submissions matching the student
     */
    /**
     * Get submissions for a specific student, optionally filtered by grade
     * 
     * CRITICAL: After JotForm+Qualtrics merge, data is organized by (coreId, grade) pairs:
     * - JotForm internal merge: Multiple PDFs → Single record per (coreId, sessionkey-derived-grade)
     * - Qualtrics internal merge: Multiple responses → Single record per (coreId, recordedDate-derived-grade)  
     * - Final merge: JotForm + Qualtrics → Final cache aligned by (coreId, grade)
     * 
     * sessionkey's role: ONLY used during JotForm merge to derive grade, then becomes irrelevant
     * recordedDate's role: ONLY used during Qualtrics merge to derive grade, then becomes irrelevant
     * 
     * After merge, we search by coreId (+ optional grade filter), NOT by sessionkey or recordedDate
     * 
     * @param {string} coreId - Student Core ID (e.g., "C10947")
     * @param {string} [grade] - Optional grade filter (K1/K2/K3). If omitted, returns all grades.
     * @returns {Promise<Array>} Submissions for the student (filtered by grade if specified)
     */
    async getStudentSubmissions(coreId, grade = null) {
      const cached = await this.loadFromCache();
      if (!cached || !cached.submissions) {
        console.log('[JotFormCache] No cached data available for student lookup');
        return [];
      }

      // Normalize coreId for comparison (remove "C" prefix if present)
      const normalizedCoreId = coreId.replace(/^C/i, '');
      
      // Filter submissions by coreId (the actual merge key)
      // Works for: JotForm-only, Qualtrics-only, and JotForm+Qualtrics merged records
      let studentSubmissions = cached.submissions.filter(submission => {
        if (!submission.coreId) {
          return false;
        }
        
        // Normalize submission coreId for comparison
        const submissionCoreId = submission.coreId.replace(/^C/i, '');
        return submissionCoreId === normalizedCoreId;
      });

      // Apply grade filter if specified (CRITICAL for grade-aware data display)
      if (grade) {
        const beforeGradeFilter = studentSubmissions.length;
        studentSubmissions = studentSubmissions.filter(s => s.grade === grade);
        console.log(`[JotFormCache] Grade filter (${grade}): ${beforeGradeFilter} → ${studentSubmissions.length} submissions`);
      }

      console.log(`[JotFormCache] Found ${studentSubmissions.length} submissions for ${coreId}${grade ? ` (grade ${grade})` : ''} in cache`);
      
      // Log data sources for debugging
      const jotformOnly = studentSubmissions.filter(s => s._sources && s._sources.length === 1 && s._sources[0] === 'jotform');
      const qualtricsOnly = studentSubmissions.filter(s => s._orphaned || (s._sources && s._sources.length === 1 && s._sources[0] === 'qualtrics'));
      const merged = studentSubmissions.filter(s => s._sources && s._sources.length > 1);
      
      if (jotformOnly.length > 0) {
        console.log(`[JotFormCache] - ${jotformOnly.length} JotForm-only record(s)`);
      }
      if (qualtricsOnly.length > 0) {
        console.log(`[JotFormCache] - ${qualtricsOnly.length} Qualtrics-only record(s)`);
      }
      if (merged.length > 0) {
        console.log(`[JotFormCache] - ${merged.length} JotForm+Qualtrics merged record(s)`);
      }
      
      return studentSubmissions;
    }
  }

  // Export global instance and constant
  // STUDENT_ID_QID is exported so other modules can use the same constant
  // instead of hardcoding '20'. This makes it easier to update if the
  // JotForm question structure changes.
  window.JotFormCache = new JotFormCache();
  window.JotFormCache.STUDENT_ID_QID = STUDENT_ID_QID;
  console.log('[JotFormCache] Global cache manager initialized');
})();
