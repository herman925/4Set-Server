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
        .then(submissions => {
          console.log('[JotFormCache] Fetch complete, saving', submissions.length, 'submissions');
          this.saveToCache(submissions);
          this.cache = submissions;
          this.isLoading = false;
          this.loadPromise = null;
          console.log('[JotFormCache] getAllSubmissions complete');
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
      console.log('[JotFormCache] Cache cleared');
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
  }

  // Export global instance
  window.JotFormCache = new JotFormCache();
  console.log('[JotFormCache] Global cache manager initialized');
})();
