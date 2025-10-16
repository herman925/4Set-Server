/**
 * Cache Manager UI
 * Manages the cache status pill and sync modal on checking_system_home.html
 */

(() => {
  let config = null;
  let isSyncing = false;
  let currentSyncProgress = 0;
  
  /**
   * Load configuration from JSON
   */
  async function loadConfig() {
    try {
      const response = await fetch('config/checking_system_config.json');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      config = await response.json();
      console.log('[CacheUI] Config loaded successfully');
    } catch (error) {
      console.error('[CacheUI] CRITICAL: Failed to load config file:', error);
      alert('Configuration file (checking_system_config.json) failed to load. Please contact system administrator.');
      throw error; // Stop execution if config is missing
    }
  }

  /**
   * Check if BOTH caches exist and are valid
   * - Submissions cache (raw JotForm data)
   * - Validation cache (TaskValidator results)
   */
  async function isCacheReady() {
    const checkStartTime = Date.now();
    console.log(`[SYNC-TIMING] ⏱️ isCacheReady: Starting check at ${new Date(checkStartTime).toISOString()}`);
    
    if (!window.JotFormCache) return false;
    
    // Check submissions cache
    const submissionsCheckStart = Date.now();
    const submissionsStats = await window.JotFormCache.getCacheStats();
    const submissionsCheckEnd = Date.now();
    console.log(`[SYNC-TIMING] ⏱️ isCacheReady: Submissions check took ${submissionsCheckEnd - submissionsCheckStart}ms`);
    
    if (!submissionsStats.exists || !submissionsStats.valid) {
      console.log('[CacheUI] Submissions cache not ready');
      console.log(`[SYNC-TIMING] ⏱️ isCacheReady: Total time ${Date.now() - checkStartTime}ms, result: FALSE (submissions missing)`);
      return false;
    }
    
    // Check validation cache
    const validationCheckStart = Date.now();
    const validationCache = await window.JotFormCache.loadValidationCache();
    const validationCheckEnd = Date.now();
    console.log(`[SYNC-TIMING] ⏱️ isCacheReady: Validation check took ${validationCheckEnd - validationCheckStart}ms`);
    
    if (!validationCache || validationCache.size === 0) {
      console.log('[CacheUI] Validation cache not ready');
      console.log(`[SYNC-TIMING] ⏱️ isCacheReady: Total time ${Date.now() - checkStartTime}ms, result: FALSE (validation missing)`);
      return false;
    }
    
    console.log('[CacheUI] Both caches ready: submissions + validation');
    console.log(`[SYNC-TIMING] ⏱️ isCacheReady: Total time ${Date.now() - checkStartTime}ms, result: TRUE ✅`);
    return true;
  }

  /**
   * Update "Last Synced" timestamp
   */
  async function updateLastSyncedTimestamp() {
    const timestampSpan = document.getElementById('snapshot-timestamp');
    if (!timestampSpan) return;
    
    const stats = await window.JotFormCache.getCacheStats();
    
    if (!stats.exists || !stats.valid) {
      timestampSpan.textContent = '—';
      return;
    }
    
    // Format timestamp
    const ageMinutes = stats.age;
    let timeText = '';
    
    if (ageMinutes < 1) {
      timeText = 'just now';
    } else if (ageMinutes < 60) {
      timeText = `${ageMinutes} min ago`;
    } else {
      const hours = Math.floor(ageMinutes / 60);
      timeText = `${hours} hour${hours > 1 ? 's' : ''} ago`;
    }
    
    timestampSpan.textContent = timeText;
  }

  /**
   * Update status pill UI with optional progress
   * @param {number} progress - Optional progress percentage (0-100) for syncing state
   */
  async function updateStatusPill(progress = null) {
    const badge = document.getElementById('system-health-badge');
    const statusText = document.getElementById('status-text');
    
    if (!badge || !statusText) {
      console.warn('[CacheUI] Status pill elements not found');
      return;
    }

    // Config not loaded yet - skip update
    if (!config) {
      console.warn('[CacheUI] Config not loaded yet, skipping pill update');
      return;
    }
    
    // Update timestamp regardless of pill state
    await updateLastSyncedTimestamp();

    // Remove all status classes
    badge.classList.remove('badge-success', 'badge-error', 'badge-warning');
    
    // Remove any existing progress bar
    const existingProgress = badge.querySelector('.pill-progress');
    if (existingProgress) {
      existingProgress.remove();
    }

    if (progress !== null && progress < 100) {
      // Orange: Syncing with progress bar
      badge.classList.add('badge-warning');
      statusText.textContent = config.cache.statusLabels.syncing;
      badge.title = `Syncing... ${Math.round(progress)}%`;
      badge.style.cursor = 'default';
      badge.style.position = 'relative';
      badge.style.overflow = 'hidden';
      
      // Add progress bar inside pill
      const progressBar = document.createElement('div');
      progressBar.className = 'pill-progress';
      progressBar.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: ${progress}%;
        background: rgba(249, 157, 51, 0.3);
        transition: width 0.3s ease-out;
        z-index: 0;
      `;
      badge.appendChild(progressBar);
      
      // Ensure text is above progress bar
      statusText.style.position = 'relative';
      statusText.style.zIndex = '1';
      const indicator = badge.querySelector('.status-indicator');
      if (indicator) {
        indicator.style.position = 'relative';
        indicator.style.zIndex = '1';
      }
      
    } else {
      const checkStartTime = Date.now();
      console.log(`[SYNC-TIMING] ⏱️ updateStatusPill: Starting cache readiness check at ${new Date(checkStartTime).toISOString()}`);
      console.log('[CacheUI] updateStatusPill checking cache readiness...');
      
      const isReady = await isCacheReady();
      
      const checkEndTime = Date.now();
      console.log(`[SYNC-TIMING] ⏱️ updateStatusPill: Cache check took ${checkEndTime - checkStartTime}ms`);
      console.log('[CacheUI] isCacheReady returned:', isReady);
      
      if (isReady) {
        // Green: System Ready (clickable to show cache info)
        const pillGreenTime = Date.now();
        console.log(`[SYNC-TIMING] ⏱️ updateStatusPill: Setting pill to GREEN at ${new Date(pillGreenTime).toISOString()}`);
        console.log('[CacheUI] Setting pill to GREEN (System Ready)');
        badge.classList.add('badge-success');
        statusText.textContent = config.cache.statusLabels.ready;
        badge.title = 'Cache is ready (click for options)';
        badge.style.cursor = 'pointer';
      } else {
        // Red: System Not Ready
        const pillRedTime = Date.now();
        console.log(`[SYNC-TIMING] ⏱️ updateStatusPill: Setting pill to RED at ${new Date(pillRedTime).toISOString()}`);
        console.log('[CacheUI] Setting pill to RED (System Not Ready)');
        badge.classList.add('badge-error');
        statusText.textContent = config.cache.statusLabels.notReady;
        badge.title = 'Click to build cache';
        badge.style.cursor = 'pointer';
      }
      
      // Reset progress-related inline styles only
      badge.style.position = '';
      badge.style.overflow = '';
      statusText.style.position = '';
      statusText.style.zIndex = '';
      const indicator = badge.querySelector('.status-indicator');
      if (indicator) {
        indicator.style.position = '';
        indicator.style.zIndex = '';
      }
    }
  }

  /**
   * Show spotlight effect on status pill
   */
  function showSpotlight() {
    const badge = document.getElementById('system-health-badge');
    if (!badge) return {};

    // Remove any existing spotlight first
    removeSpotlight();

    // Create spotlight cutout effect (highlight the pill)
    const pillRect = badge.getBoundingClientRect();
    const highlightBox = document.createElement('div');
    highlightBox.id = 'cache-spotlight-highlight';
    highlightBox.style.cssText = `
      position: fixed;
      top: ${pillRect.top - 10}px;
      left: ${pillRect.left - 10}px;
      width: ${pillRect.width + 20}px;
      height: ${pillRect.height + 20}px;
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
      border-radius: 9999px;
      border: 4px solid #f59e0b;
      z-index: 9999;
      pointer-events: none;
      animation: spotlightPulse 2s ease-in-out infinite;
    `;

    // Add pulse animation
    if (!document.getElementById('spotlight-style')) {
      const style = document.createElement('style');
      style.id = 'spotlight-style';
      style.textContent = `
        @keyframes spotlightPulse {
          0%, 100% { 
            opacity: 1; 
            transform: scale(1);
            border-color: #f59e0b;
          }
          50% { 
            opacity: 1; 
            transform: scale(1.05);
            border-color: #fb923c;
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(highlightBox);

    return { highlightBox };
  }

  /**
   * Remove spotlight effect
   */
  function removeSpotlight() {
    const highlight = document.getElementById('cache-spotlight-highlight');
    if (highlight) {
      highlight.remove();
    }
    
    // Fallback: remove any orphaned spotlight elements
    const orphans = document.querySelectorAll('[id^="cache-spotlight"]');
    orphans.forEach(el => el.remove());
  }

  /**
   * Ensure modal CSS is loaded (shared for all modals)
   */
  function ensureModalCSS() {
    if (!document.getElementById('modal-animation-style')) {
      const style = document.createElement('style');
      style.id = 'modal-animation-style';
      style.textContent = `
        @keyframes slideDown {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 10000;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
        }
        .modal-backdrop {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 1 !important;
          pointer-events: auto;
        }
        .modal-content {
          position: relative;
          background: white;
          border-radius: 12px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          width: 100%;
          z-index: 10 !important;
          pointer-events: auto;
        }
        .modal-header {
          padding: 20px 24px 16px;
          border-bottom: 1px solid var(--border);
        }
        .modal-body {
          padding: 20px 24px;
        }
        .modal-footer {
          padding: 16px 24px;
          border-top: 1px solid var(--border);
          display: flex;
          justify-content: flex-end;
        }
      `;
      document.head.appendChild(style);
    }
  }

  /**
   * Show blocking modal when trying to filter without cache
   */
  function showBlockingModal() {
    // Ensure CSS is loaded
    ensureModalCSS();
    
    const modal = document.createElement('div');
    modal.id = 'cache-block-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 400px; margin-top: 100px; animation: slideDown 0.3s ease-out;">
        <div class="modal-header">
          <h3 class="text-lg font-semibold text-[color:var(--foreground)] flex items-center gap-2">
            <i data-lucide="alert-triangle" class="w-5 h-5 text-orange-500"></i>
            ${config.cache.modalText.blockTitle}
          </h3>
        </div>
        <div class="modal-body">
          <p class="text-sm text-[color:var(--muted-foreground)]">
            ${config.cache.modalText.blockMessage}
          </p>
        </div>
        <div class="modal-footer">
          <button id="block-modal-ok" class="hero-button primary-button px-4 py-2 text-sm font-semibold">
            OK, Got It
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    lucide.createIcons();

    // Show spotlight
    const { spotlight, highlightBox } = showSpotlight();

    // Handle OK button
    document.getElementById('block-modal-ok').addEventListener('click', () => {
      modal.remove();
      removeSpotlight();
    });
  }

  /**
   * Show cache ready modal (when cache is already built)
   */
  async function showCacheReadyModal() {
    console.log('[CacheUI] showCacheReadyModal called');
    
    ensureModalCSS();
    
    if (!config) {
      console.error('[CacheUI] Config not loaded');
      return;
    }
    
    // Get cache stats
    const stats = await window.JotFormCache.getCacheStats();
    
    const modal = document.createElement('div');
    modal.id = 'cache-ready-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-backdrop" style="background: rgba(0, 0, 0, 0.5);"></div>
      <div class="modal-content" style="max-width: 500px; animation: slideDown 0.3s ease-out;">
        <div class="modal-header">
          <h3 class="text-lg font-semibold text-[color:var(--foreground)] flex items-center gap-2">
            <i data-lucide="database" class="w-6 h-6 text-green-600"></i>
            JotForm Data is Ready
          </h3>
        </div>
        <div class="modal-body">
          <p class="text-sm text-[color:var(--muted-foreground)]">
            Cache contains <strong>${stats.count}</strong> submissions, synced <strong>${stats.age}</strong> minutes ago. 
            You can delete the cache to force a fresh sync.
          </p>
        </div>
        <div class="modal-footer flex gap-3">
          <button id="cache-delete-btn" class="px-4 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors">
            Delete Cache
          </button>
          <button id="cache-close-btn" class="px-4 py-2.5 text-sm font-medium text-[color:var(--foreground)] bg-[color:var(--muted)] hover:bg-[color:var(--accent)] rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    lucide.createIcons();
    
    const deleteBtn = document.getElementById('cache-delete-btn');
    const closeBtn = document.getElementById('cache-close-btn');
    
    // Delete button
    deleteBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete the cache? This will require a fresh sync before using the system.')) {
        await window.JotFormCache.clearCache();
        console.log('[CacheUI] Cache deleted by user');
        modal.remove();
        updateStatusPill(); // Update pill to red
      }
    });
    
    // Close button
    closeBtn.addEventListener('click', () => {
      modal.remove();
    });
    
    // Click backdrop to close
    const backdrop = modal.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => modal.remove());
    }
  }

  /**
   * Show sync modal (for building cache)
   */
  async function showSyncModal() {
    console.log('[CacheUI] showSyncModal called');
    
    // Remove any existing modal first
    const existingModal = document.getElementById('cache-sync-modal');
    if (existingModal) {
      console.log('[CacheUI] Removing existing modal');
      existingModal.remove();
    }
    
    // Ensure CSS is loaded
    ensureModalCSS();
    
    // Check if config is loaded
    if (!config) {
      console.error('[CacheUI] Config not loaded, cannot show modal');
      return;
    }
    
    const modal = document.createElement('div');
    modal.id = 'cache-sync-modal';
    modal.className = 'modal-overlay';
    
    // Check if sync is in progress - show progress immediately
    const showProgressNow = isSyncing;
    console.log('[CacheUI] Creating modal, showProgressNow:', showProgressNow);
    
    modal.innerHTML = `
      <div class="modal-backdrop" style="background: rgba(0, 0, 0, 0.5);"></div>
      <div class="modal-content" style="max-width: 500px; animation: slideDown 0.3s ease-out;">
        <div class="modal-header">
          <h3 class="text-lg font-semibold text-[color:var(--foreground)] flex items-center gap-2">
            <i data-lucide="database" class="w-5 h-5 text-blue-500"></i>
            <span id="sync-modal-title">${showProgressNow ? 'Syncing...' : config.cache.modalText.syncTitle}</span>
          </h3>
        </div>
        <div class="modal-body">
          <p id="sync-modal-message" class="text-sm text-[color:var(--muted-foreground)] mb-4">
            ${showProgressNow ? 'Building cache from Jotform...' : config.cache.modalText.syncMessage}
          </p>
          
          <!-- Progress section (always visible) -->
          <div id="sync-progress-section">
            <div class="mb-2">
              <div class="flex justify-between items-center mb-1">
                <span id="sync-progress-text" class="text-xs text-[color:var(--muted-foreground)]">${showProgressNow ? 'Syncing...' : 'Ready to begin'}</span>
                <span id="sync-progress-percent" class="text-xs font-mono font-semibold text-[color:var(--primary)]">${showProgressNow ? Math.round(currentSyncProgress) : 0}%</span>
              </div>
              <div class="w-full h-2 bg-[color:var(--muted)] rounded-full overflow-hidden">
                <div id="sync-progress-bar" class="h-full bg-[color:var(--primary)] transition-all duration-300" style="width: ${showProgressNow ? currentSyncProgress : 0}%"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button id="sync-modal-cancel" class="hero-button secondary-button px-4 py-2 text-sm font-semibold mr-2">
            ${showProgressNow ? 'Close' : config.cache.modalText.syncCancel}
          </button>
          <button id="sync-modal-confirm" class="hero-button primary-button px-4 py-2 text-sm font-semibold ${showProgressNow ? 'hidden' : ''}">
            ${config.cache.modalText.syncButton}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    console.log('[CacheUI] Modal appended to body');
    lucide.createIcons();

    const cancelBtn = document.getElementById('sync-modal-cancel');
    const confirmBtn = document.getElementById('sync-modal-confirm');
    const progressSection = document.getElementById('sync-progress-section');
    const progressBar = document.getElementById('sync-progress-bar');
    const progressText = document.getElementById('sync-progress-text');
    const progressPercent = document.getElementById('sync-progress-percent');
    const modalTitle = document.getElementById('sync-modal-title');
    const modalMessage = document.getElementById('sync-modal-message');
    
    console.log('[CacheUI] Modal elements:', {
      cancelBtn: !!cancelBtn,
      confirmBtn: !!confirmBtn,
      progressSection: !!progressSection,
      modalTitle: !!modalTitle
    });

    // Cancel button - can close during sync
    if (!cancelBtn) {
      console.error('[CacheUI] Cancel button not found!');
      return;
    }
    
    cancelBtn.addEventListener('click', () => {
      modal.remove();
      // If syncing, it will continue in background with pill showing progress
    });
    
    // Allow backdrop click to close (during or before sync)
    const backdrop = modal.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => {
        modal.remove();
      });
    }

    // Confirm button - start sync (only if not already syncing)
    if (!confirmBtn) {
      console.error('[CacheUI] Confirm button not found!');
      return;
    }
    
    if (!showProgressNow) {
      // Only set up confirm listener if not already syncing
      confirmBtn.addEventListener('click', async () => {
      // Hide buttons, show progress
      cancelBtn.textContent = 'Close';
      cancelBtn.classList.remove('hidden');
      confirmBtn.classList.add('hidden');
      progressSection.classList.remove('hidden');

      // Mark syncing state
      isSyncing = true;
      currentSyncProgress = 0;

      // Set up progress callback - updates BOTH modal AND pill
      window.JotFormCache.setProgressCallback((message, progress) => {
        currentSyncProgress = progress;
        
        // Update modal progress (if still open)
        if (progressText) progressText.textContent = message;
        if (progressPercent) progressPercent.textContent = `${Math.round(progress)}%`;
        if (progressBar) progressBar.style.width = `${progress}%`;
        
        // Update pill progress (always, even if modal closed)
        updateStatusPill(progress);
      });

      try {
        // Get credentials
        const cachedData = window.CheckingSystemData?.getCachedData();
        if (!cachedData || !cachedData.credentials) {
          throw new Error('Credentials not available');
        }

        const credentials = cachedData.credentials;

        // Force fetch (clear cache first)
        await window.JotFormCache.clearCache();
        
        // Step 1: Fetch all submissions from JotForm API (0-70%)
        console.log('[CacheUI] Calling getAllSubmissions...');
        progressBar.style.width = '70%';
        progressPercent.textContent = '70%';
        progressText.textContent = 'Fetching submissions from JotForm...';
        
        // This waits for IndexedDB write to fully complete
        const result = await window.JotFormCache.getAllSubmissions({
          formId: credentials.jotformFormId || credentials.formId,
          apiKey: credentials.jotformApiKey || credentials.apiKey
        });
        console.log('[CacheUI] getAllSubmissions returned:', result ? result.length : 0, 'submissions');
        
        // Step 2: Build validation cache (70-95%)
        progressBar.style.width = '75%';
        progressPercent.textContent = '75%';
        progressText.textContent = 'Submissions cached, loading validation data...';
        
        // Get student data from CheckingSystemData
        const cachedSystemData = window.CheckingSystemData?.getCachedData();
        
        console.log('[CacheUI] CheckingSystemData available?', !!window.CheckingSystemData);
        console.log('[CacheUI] Students available?', !!cachedSystemData?.students);
        
        if (!cachedSystemData?.students) {
          console.warn('[CacheUI] Student data not available, skipping validation cache build');
          console.warn('[CacheUI] Validation cache will be built when class page loads');
          
          // Still mark as complete - submissions are cached
          progressBar.style.width = '100%';
          progressPercent.textContent = '100%';
          progressText.textContent = 'Submissions cached! (Validation pending)';
          
          isSyncing = false;
          currentSyncProgress = 100;
          await updateStatusPill();
          
          modalTitle.textContent = 'Submissions Cached';
          modalMessage.textContent = 'Submission data cached successfully. Validation will complete when you navigate to a class page.';
          modalMessage.classList.remove('text-[color:var(--muted-foreground)]');
          modalMessage.classList.add('text-yellow-600');
          
          cancelBtn.classList.add('hidden');
          confirmBtn.textContent = 'Close';
          confirmBtn.classList.remove('hidden');
          confirmBtn.onclick = () => modal.remove();
          
          return;
        }
        
        // Load survey structure
        console.log('[CacheUI] Loading survey structure...');
        const surveyResponse = await fetch('assets/tasks/survey-structure.json');
        const surveyStructure = await surveyResponse.json();
        console.log('[CacheUI] Survey structure loaded');
        
        progressText.textContent = 'Submissions cached, validating students...';
        
        // Hook up progress callback for validation
        window.JotFormCache.setProgressCallback((message, progress) => {
          if (progressBar) {
            progressBar.style.width = `${progress}%`;
            progressPercent.textContent = `${progress}%`;
            progressText.textContent = message;
          }
          // Don't call updateStatusPill here - it causes hundreds of IndexedDB reads
          // The pill will be updated once when validation completes
        });
        
        console.log('[CacheUI] Building validation cache...');
        const validationCache = await window.JotFormCache.buildStudentValidationCache(
          cachedSystemData.students,
          surveyStructure,
          true // Force rebuild
        );
        console.log('[CacheUI] Validation cache built:', validationCache.size, 'students');
        
        // Clear progress callback
        window.JotFormCache.setProgressCallback(null);
        
        // Step 3: All done (100%)
        const progressBar100Time = Date.now();
        progressBar.style.width = '100%';
        progressPercent.textContent = '100%';
        progressText.textContent = 'All caches ready!';
        console.log(`[SYNC-TIMING] ⏱️ Progress bar set to 100% at: ${new Date(progressBar100Time).toISOString()}`);
        
        // Mark sync complete and update pill
        isSyncing = false;
        currentSyncProgress = 100;
        
        const pillUpdateStartTime = Date.now();
        console.log(`[SYNC-TIMING] ⏱️ Starting pill update at: ${new Date(pillUpdateStartTime).toISOString()}`);
        console.log(`[SYNC-TIMING] ⏱️ Time between progress bar 100% and pill update start: ${pillUpdateStartTime - progressBar100Time}ms`);
        
        await updateStatusPill();
        
        const pillUpdateEndTime = Date.now();
        console.log(`[SYNC-TIMING] ⏱️ Pill update completed at: ${new Date(pillUpdateEndTime).toISOString()}`);
        console.log(`[SYNC-TIMING] ⏱️ Pill update took: ${pillUpdateEndTime - pillUpdateStartTime}ms`);
        console.log(`[SYNC-TIMING] ⏱️ Total time from progress 100% to pill green: ${pillUpdateEndTime - progressBar100Time}ms`);
        console.log('[CacheUI] ✅ Both caches complete, pill updated to green');
        
        // NOW show success message (cache is confirmed saved)
        progressText.textContent = 'Complete!';
        modalTitle.textContent = config.cache.modalText.completeTitle;
        modalMessage.textContent = config.cache.modalText.completeMessage;
        modalMessage.classList.remove('text-[color:var(--muted-foreground)]');
        modalMessage.classList.add('text-green-600');
        
        // Hide cancel button, show only confirm as Close
        cancelBtn.classList.add('hidden');
        confirmBtn.textContent = 'Close';
        confirmBtn.classList.remove('hidden');
        confirmBtn.onclick = () => {
          modal.remove();
          // No need to update pill - already updated at line 585
        };

      } catch (error) {
        console.error('[CacheUI] Failed to build cache:', error);
        isSyncing = false;
        
        modalTitle.textContent = 'Sync Failed';
        modalMessage.textContent = `Error: ${error.message}`;
        modalMessage.classList.remove('text-[color:var(--muted-foreground)]');
        modalMessage.classList.add('text-red-600');
        
        // Update pill back to red (error)
        updateStatusPill();
        
        // Show retry button
        confirmBtn.textContent = 'Retry';
        confirmBtn.classList.remove('hidden');
        confirmBtn.onclick = () => modal.remove();
        
        cancelBtn.textContent = 'Close';
        cancelBtn.classList.remove('hidden');
        cancelBtn.onclick = () => modal.remove();
      }
      }); // End of confirmBtn.addEventListener
    } // End of if (!showProgressNow)
  } // End of showSyncModal

  /**
   * Initialize cache manager UI
   */
  async function init() {
    console.log('[CacheUI] Initializing cache manager UI');

    // Load configuration
    await loadConfig();

    // Wait for page elements to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setup);
    } else {
      setup();
    }
  }

  // Track if setup has run to prevent double-initialization
  let isSetupComplete = false;

  /**
   * Setup UI event listeners
   */
  function setup() {
    if (isSetupComplete) {
      console.warn('[CacheUI] Setup already complete, skipping');
      return;
    }
    
    // Update status pill initially
    updateStatusPill();

    // Click on status pill
    const badge = document.getElementById('system-health-badge');
    if (badge) {
      badge.addEventListener('click', async () => {
        const ready = await isCacheReady();
        if (!ready) {
          showSyncModal();
        } else {
          showCacheReadyModal();
        }
      });
    }

    // Intercept "Start Checking" button - use CAPTURE phase to run before other listeners
    const startCheckingBtn = document.getElementById('start-checking-btn');
    if (startCheckingBtn) {
      startCheckingBtn.addEventListener('click', (e) => {
        // ALWAYS prevent default immediately - check cache async
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        console.log('[CacheUI] Start Checking clicked, checking cache...');
        
        // Check cache asynchronously
        isCacheReady().then(ready => {
          console.log('[CacheUI] Cache ready:', ready);
          if (!ready) {
            showBlockingModal();
          } else {
            // Cache is ready, proceed with navigation manually
            if (typeof window.CheckingSystemRouter !== 'undefined' && 
                typeof window.CheckingSystemFilters !== 'undefined') {
              const filters = window.CheckingSystemFilters.getActiveFilters();
              if (Object.keys(filters).length > 0) {
                window.CheckingSystemRouter.navigateTodrilldown(filters);
              }
            }
          }
        });
        
        return false;
      }, true); // CAPTURE PHASE - runs before other listeners!
    }

    isSetupComplete = true;
    console.log('[CacheUI] Setup complete');
  }

  // Export for manual control
  window.CacheManagerUI = {
    updateStatusPill,
    isCacheReady,
    showSyncModal,
    showBlockingModal
  };

  // Auto-initialize
  init();
})();
