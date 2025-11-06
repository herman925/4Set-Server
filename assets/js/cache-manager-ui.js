/**
 * Cache Manager UI
 * Manages the cache status pill and sync modal on checking_system_home.html
 */

(() => {
  let config = null;
  let isSyncing = false;
  let currentSyncProgress = 0;
  
  // Progress threshold constants
  const PROGRESS_THRESHOLDS = {
    FETCH_START: 0,
    FETCH_COMPLETE: 100,
    VALIDATION_START: 75,
    VALIDATION_COMPLETE: 95
  };
  
  /**
   * Update status text element based on progress and operation type
   * @param {HTMLElement} statusElement - The status text element to update
   * @param {number} progress - Progress percentage (0-100)
   * @param {string} operationType - 'jotform' or 'qualtrics'
   * @param {string} customMessage - Optional custom message to display (from emitProgress)
   */
  function updateStatusText(statusElement, progress, operationType, customMessage = null) {
    if (!statusElement) return;
    
    // If a custom message is provided, use it directly
    if (customMessage) {
      statusElement.textContent = customMessage;
      return;
    }
    
    // Otherwise, fall back to generic messages based on progress
    const messages = {
      jotform: {
        waiting: 'Waiting to start...',
        fetching: 'Fetching submissions...',
        validating: 'Validating students...',
        processing: 'Processing data...',
        complete: 'Complete!'
      },
      qualtrics: {
        waiting: 'Waiting to start...',
        fetching: 'Fetching TGMD data...',
        validating: 'Validating students...',
        processing: 'Processing data...',
        complete: 'Complete!'
      }
    };
    
    const msg = messages[operationType] || messages.jotform;
    
    // Use thresholds in descending order to avoid conflicts
    if (progress >= PROGRESS_THRESHOLDS.FETCH_COMPLETE) {
      statusElement.textContent = msg.complete;
    } else if (progress >= PROGRESS_THRESHOLDS.VALIDATION_COMPLETE) {
      statusElement.textContent = msg.validating;
    } else if (progress >= PROGRESS_THRESHOLDS.VALIDATION_START) {
      statusElement.textContent = msg.validating;
    } else if (progress > PROGRESS_THRESHOLDS.FETCH_START) {
      statusElement.textContent = msg.fetching;
    } else {
      // progress <= 0
      statusElement.textContent = msg.waiting;
    }
  }
  
  /**
   * Load configuration from JSON
   */
  async function loadConfig() {
    try {
      const response = await fetch('config/checking_system_config.json', {
        cache: 'no-cache'
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      config = await response.json();
      console.log('[CacheUI] Config loaded successfully');
      
      // Update status pill now that config is loaded
      // This handles the case where updateStatusPill was called before config loaded
      await updateStatusPill();
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
    
    if (!window.JotFormCache) {
      console.log('[CacheUI] JotFormCache not available');
      return false;
    }
    
    try {
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
    } catch (error) {
      console.error('[CacheUI] Error in isCacheReady:', error);
      console.log(`[SYNC-TIMING] ⏱️ isCacheReady: Total time ${Date.now() - checkStartTime}ms, result: FALSE (error)`);
      return false;
    }
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
   * @param {boolean} skipCheck - Skip cache readiness check (use when we know cache is ready)
   */
  async function updateStatusPill(progress = null, skipCheck = false) {
    const badge = document.getElementById('system-health-badge');
    const statusText = document.getElementById('status-text');
    
    if (!badge || !statusText) {
      console.warn('[CacheUI] Status pill elements not found');
      return;
    }

    // Config not loaded yet - set loading state and return
    if (!config) {
      console.warn('[CacheUI] Config not loaded yet, setting default loading state');
      badge.classList.remove('badge-success', 'badge-error');
      badge.classList.add('badge-warning');
      statusText.textContent = 'Loading...';
      badge.title = 'Loading configuration';
      badge.style.cursor = 'default';
      return;
    }
    
    // Update timestamp regardless of pill state
    await updateLastSyncedTimestamp();

    // Remove any existing progress bar
    const existingProgress = badge.querySelector('.pill-progress');
    if (existingProgress) {
      existingProgress.remove();
    }

    if (progress !== null && progress < 100) {
      // Orange: Syncing with progress bar
      badge.classList.remove('badge-success', 'badge-error', 'badge-warning');
      badge.classList.add('badge-warning');
      
      // Show percentage in status text for better feedback
      const roundedProgress = Math.round(progress);
      statusText.textContent = `Syncing ${roundedProgress}%`;
      badge.title = `Syncing... ${roundedProgress}%`;
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
        background: linear-gradient(90deg, rgba(249, 157, 51, 0.4), rgba(249, 157, 51, 0.6));
        transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
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
      // If skipCheck is true, directly set to green without checking
      let isReady = skipCheck;
      
      if (!skipCheck) {
        // Set loading state (orange) while checking cache
        badge.classList.remove('badge-success', 'badge-error', 'badge-warning');
        badge.classList.add('badge-warning');
        statusText.textContent = config.cache.statusLabels?.checking || 'Checking...';
        badge.title = config.cache.statusLabels?.checking || 'Checking cache status';
        badge.style.cursor = 'default';
        
        const checkStartTime = Date.now();
        console.log(`[SYNC-TIMING] ⏱️ updateStatusPill: Starting cache readiness check at ${new Date(checkStartTime).toISOString()}`);
        console.log('[CacheUI] updateStatusPill checking cache readiness...');
        
        try {
          // Add timeout to prevent hanging (5 seconds max)
          const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => {
              console.warn('[CacheUI] Cache check timed out after 5 seconds, defaulting to not ready');
              resolve(false); // Resolve with false instead of reject
            }, 5000);
          });
          
          isReady = await Promise.race([
            isCacheReady(),
            timeoutPromise
          ]);
          
          const checkEndTime = Date.now();
          console.log(`[SYNC-TIMING] ⏱️ updateStatusPill: Cache check took ${checkEndTime - checkStartTime}ms`);
          console.log('[CacheUI] isCacheReady returned:', isReady);
        } catch (error) {
          console.error('[CacheUI] Error checking cache readiness:', error);
          isReady = false; // Default to not ready on error
          const checkEndTime = Date.now();
          console.log(`[SYNC-TIMING] ⏱️ updateStatusPill: Cache check failed after ${checkEndTime - checkStartTime}ms`);
        }
      } else {
        console.log('[CacheUI] Skipping cache check (skipCheck=true), directly setting to GREEN');
      }
      
      // Remove all status classes before applying the final state
      badge.classList.remove('badge-success', 'badge-error', 'badge-warning');
      
      if (isReady) {
        // Green: System Ready (clickable to show cache info)
        const pillGreenTime = Date.now();
        console.log(`[SYNC-TIMING] ⏱️ updateStatusPill: Setting pill to GREEN at ${new Date(pillGreenTime).toISOString()}`);
        console.log('[CacheUI] Setting pill to GREEN (System Ready)');
        badge.classList.add('badge-success');
        statusText.textContent = config.cache.statusLabels?.ready || 'System Ready';
        badge.title = 'Cache is ready (click for options)';
        badge.style.cursor = 'pointer';
      } else {
        // Red: System Not Ready
        const pillRedTime = Date.now();
        console.log(`[SYNC-TIMING] ⏱️ updateStatusPill: Setting pill to RED at ${new Date(pillRedTime).toISOString()}`);
        console.log('[CacheUI] Setting pill to RED (System Not Ready)');
        badge.classList.add('badge-error');
        statusText.textContent = config.cache.statusLabels?.notReady || 'System Not Ready';
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
    
    // Get Qualtrics stats if available
    let qualtricsStats = { cached: false };
    try {
      qualtricsStats = await window.JotFormCache.getQualtricsStats();
    } catch (e) {
      console.log('[CacheUI] Qualtrics stats not available:', e.message);
    }
    
    // Build Qualtrics section
    let qualtricsSection = '';
    if (qualtricsStats.cached) {
      qualtricsSection = `
        <div class="mt-4 pt-4 border-t border-[color:var(--border)]">
          <p class="text-sm text-[color:var(--muted-foreground)] mb-2">
            <i data-lucide="check-circle" class="w-4 h-4 inline text-green-600"></i>
            Qualtrics TGMD data: <strong>${qualtricsStats.count}</strong> responses, 
            synced <strong>${qualtricsStats.ageMinutes}</strong> minutes ago.
          </p>
        </div>
      `;
    } else {
      qualtricsSection = `
        <div class="mt-4 pt-4 border-t border-[color:var(--border)]">
          <p class="text-sm text-[color:var(--muted-foreground)] mb-2">
            <i data-lucide="alert-circle" class="w-4 h-4 inline text-amber-600"></i>
            Qualtrics TGMD data not synced yet. Use "Fetch Database" button to sync both JotForm and Qualtrics data.
          </p>
        </div>
      `;
    }
    
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
          <p class="text-sm text-[color:var(--muted-foreground)] mb-3">
            Cache contains <strong>${stats.count}</strong> submissions, synced <strong>${stats.age}</strong> minutes ago.
          </p>
          
          <div class="cache-ready-info-box">
            <p class="cache-ready-info-title text-xs mb-2">
              <strong>💡 Cache Management:</strong>
            </p>
            <ul class="cache-ready-info-list text-xs space-y-1 ml-4">
              <li><strong>Delete Cache:</strong> Purges ALL data (JotForm + Qualtrics) - requires full re-sync (~90 sec)</li>
              <li>To refresh data, delete cache and click "Fetch Database" from the "System Not Ready" screen</li>
            </ul>
          </div>
          
          ${qualtricsSection}
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
    
    // Delete button - Performs comprehensive cache purge
    // Deletes ALL three IndexedDB stores: submissions, validation, Qualtrics
    deleteBtn.addEventListener('click', async () => {
      if (confirm('⚠️ DELETE ALL CACHED DATA?\n\nThis will remove the following IndexedDB stores:\n• Merged submissions cache (JotForm + Qualtrics)\n• Student validation cache (task results)\n• Qualtrics TGMD cache (raw responses)\n\nAfter deletion the system returns to "System Not Ready" and requires a full Fetch Database run (about 60-90 seconds).\n\nContinue?')) {
        console.log('[CacheUI] User confirmed comprehensive cache deletion');
        await window.JotFormCache.clearCache();
        console.log('[CacheUI] ✅ Comprehensive cache purge complete');
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
   * Show Qualtrics progress modal with dual progress bars
   */
  async function showQualtricsProgressModal() {
    ensureModalCSS();
    
    const modal = document.createElement('div');
    modal.id = 'qualtrics-progress-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-backdrop" style="background: rgba(0, 0, 0, 0.5);"></div>
      <div class="modal-content" style="max-width: 500px; animation: slideDown 0.3s ease-out;">
        <div class="modal-header">
          <h3 class="text-lg font-semibold text-[color:var(--foreground)] flex items-center gap-2">
            <i data-lucide="refresh-cw" class="w-5 h-5 text-purple-600 animate-spin"></i>
            <span>Syncing Database</span>
          </h3>
        </div>
        <div class="modal-body">
          <p id="qualtrics-progress-message" class="text-sm text-[color:var(--muted-foreground)] mb-4">
            status updates will appear below each progress bar...
          </p>
          
          <!-- JotForm Progress Bar (Blue) -->
          <div class="mb-3">
            <div class="flex justify-between items-center mb-1">
              <span class="text-xs font-medium text-blue-600">JotForm</span>
              <span id="jotform-progress-percent" class="text-xs font-mono font-semibold text-blue-600">0%</span>
            </div>
            <p id="jotform-status-text" class="text-xs text-[color:var(--muted-foreground)] mb-1 min-h-[16px]">Waiting to start...</p>
            <div class="w-full h-2 bg-[color:var(--muted)] rounded-full overflow-hidden">
              <div id="jotform-progress-bar" class="h-full bg-blue-600 transition-all duration-300" style="width: 0%"></div>
            </div>
          </div>
          
          <!-- Qualtrics Progress Bar (Purple) -->
          <div class="mb-2">
            <div class="flex justify-between items-center mb-1">
              <span class="text-xs font-medium text-purple-600">Qualtrics</span>
              <span id="qualtrics-progress-percent" class="text-xs font-mono font-semibold text-purple-600">0%</span>
            </div>
            <p id="qualtrics-status-text" class="text-xs text-[color:var(--muted-foreground)] mb-1 min-h-[16px]">Waiting to start...</p>
            <div class="w-full h-2 bg-[color:var(--muted)] rounded-full overflow-hidden">
              <div id="qualtrics-progress-bar" class="h-full bg-purple-600 transition-all duration-300" style="width: 0%"></div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button id="qualtrics-progress-cancel" class="px-4 py-2.5 text-sm font-medium text-[color:var(--foreground)] bg-[color:var(--muted)] hover:bg-[color:var(--accent)] rounded-lg transition-colors" disabled>
            Please Wait...
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    lucide.createIcons();
  }

  /**
   * Update Qualtrics progress modal with dual progress bars
   * @param {string} message - Overall progress message
   * @param {number} jotformProgress - JotForm progress (0-100)
   * @param {number} qualtricsProgress - Qualtrics progress (0-100)
   * @param {string} jotformMessage - Optional detailed JotForm message
   * @param {string} qualtricsMessage - Optional detailed Qualtrics message
   */
  function updateQualtricsProgress(message, jotformProgress = 0, qualtricsProgress = 0, jotformMessage = null, qualtricsMessage = null) {
    const messageEl = document.getElementById('qualtrics-progress-message');
    const jotformBarEl = document.getElementById('jotform-progress-bar');
    const jotformPercentEl = document.getElementById('jotform-progress-percent');
    const jotformStatusEl = document.getElementById('jotform-status-text');
    const qualtricsBarEl = document.getElementById('qualtrics-progress-bar');
    const qualtricsPercentEl = document.getElementById('qualtrics-progress-percent');
    const qualtricsStatusEl = document.getElementById('qualtrics-status-text');
    
    // Don't update messageEl here - detailed status is shown under each progress bar
    
    // Update JotForm progress bar (blue)
    if (jotformBarEl) jotformBarEl.style.width = Math.round(jotformProgress) + '%';
    if (jotformPercentEl) jotformPercentEl.textContent = Math.round(jotformProgress) + '%';
    updateStatusText(jotformStatusEl, jotformProgress, 'jotform', jotformMessage);
    
    // Update Qualtrics progress bar (purple)
    if (qualtricsBarEl) qualtricsBarEl.style.width = Math.round(qualtricsProgress) + '%';
    if (qualtricsPercentEl) qualtricsPercentEl.textContent = Math.round(qualtricsProgress) + '%';
    updateStatusText(qualtricsStatusEl, qualtricsProgress, 'qualtrics', qualtricsMessage);
  }

  /**
   * Show Qualtrics completion modal
   */
  async function showQualtricsCompleteModal(stats) {
    // Remove progress modal
    const progressModal = document.getElementById('qualtrics-progress-modal');
    if (progressModal) progressModal.remove();
    
    ensureModalCSS();
    
    const modal = document.createElement('div');
    modal.id = 'qualtrics-complete-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-backdrop" style="background: rgba(0, 0, 0, 0.5);"></div>
      <div class="modal-content" style="max-width: 500px; animation: slideDown 0.3s ease-out;">
        <div class="modal-header">
          <h3 class="text-lg font-semibold text-[color:var(--foreground)] flex items-center gap-2">
            <i data-lucide="check-circle" class="w-6 h-6 text-green-600"></i>
            Qualtrics Sync Complete
          </h3>
        </div>
        <div class="modal-body">
          <p class="text-sm text-[color:var(--muted-foreground)] mb-4">
            Successfully merged Qualtrics TGMD data with JotForm submissions.
          </p>
          
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-[color:var(--muted-foreground)]">Total records:</span>
              <span class="font-semibold">${stats.total}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[color:var(--muted-foreground)]">Records with TGMD:</span>
              <span class="font-semibold">${stats.withTGMD}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[color:var(--muted-foreground)]">TGMD from Qualtrics:</span>
              <span class="font-semibold text-purple-600">${stats.tgmdFromQualtrics}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[color:var(--muted-foreground)]">TGMD from JotForm:</span>
              <span class="font-semibold">${stats.tgmdFromJotform}</span>
            </div>
            ${stats.tgmdConflicts > 0 ? `
            <div class="flex justify-between text-amber-600">
              <span>Conflicts detected:</span>
              <span class="font-semibold">${stats.tgmdConflicts}</span>
            </div>
            ` : ''}
          </div>
          
          ${stats.tgmdConflicts > 0 ? `
          <div class="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
            <p class="text-xs text-amber-800 dark:text-amber-200">
              <i data-lucide="alert-triangle" class="w-4 h-4 inline"></i>
              Data conflicts were detected where JotForm and Qualtrics had different values. 
              Qualtrics data was prioritized for TGMD fields.
            </p>
          </div>
          ` : ''}
        </div>
        <div class="modal-footer">
          <button id="qualtrics-complete-close" class="px-4 py-2.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors">
            Done
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    lucide.createIcons();
    
    const closeBtn = document.getElementById('qualtrics-complete-close');
    closeBtn.addEventListener('click', () => {
      modal.remove();
    });
    
    const backdrop = modal.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => modal.remove());
    }
  }

  /**
   * Show Qualtrics error modal
   */
  function showQualtricsErrorModal(errorMessage) {
    // Remove progress modal
    const progressModal = document.getElementById('qualtrics-progress-modal');
    if (progressModal) progressModal.remove();
    
    ensureModalCSS();
    
    const modal = document.createElement('div');
    modal.id = 'qualtrics-error-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-backdrop" style="background: rgba(0, 0, 0, 0.5);"></div>
      <div class="modal-content" style="max-width: 500px; animation: slideDown 0.3s ease-out;">
        <div class="modal-header">
          <h3 class="text-lg font-semibold text-[color:var(--foreground)] flex items-center gap-2">
            <i data-lucide="x-circle" class="w-6 h-6 text-red-600"></i>
            Qualtrics Sync Failed
          </h3>
        </div>
        <div class="modal-body">
          <p class="text-sm text-[color:var(--muted-foreground)] mb-4">
            The Qualtrics integration failed. Please try again or contact support if the issue persists.
          </p>
          
          <div class="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p class="text-xs font-mono text-red-800 dark:text-red-200">
              ${errorMessage}
            </p>
          </div>
        </div>
        <div class="modal-footer">
          <button id="qualtrics-error-close" class="px-4 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    lucide.createIcons();
    
    const closeBtn = document.getElementById('qualtrics-error-close');
    closeBtn.addEventListener('click', () => {
      modal.remove();
    });
    
    const backdrop = modal.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => modal.remove());
    }
  }

  /**
   * Get credentials helper
   */
  async function getCredentials() {
    // Check if credentials are in checking_system_data (where they are actually stored)
    const cachedData = sessionStorage.getItem('checking_system_data');
    if (cachedData) {
      try {
        const data = JSON.parse(cachedData);
        if (data.credentials) {
          console.log('[CacheUI] Credentials found in checking_system_data');
          return data.credentials;
        }
      } catch (error) {
        console.error('[CacheUI] Error parsing checking_system_data:', error);
      }
    }
    console.warn('[CacheUI] No credentials found in sessionStorage');
    return null;
  }

  /**
   * Show sync modal (for building cache)
   */
  async function showSyncModal(showProgressNow = false) {
    console.log('[CacheUI] showSyncModal called');
    console.trace('[CacheUI] showSyncModal call stack:');
    
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
    
    // If showProgressNow not explicitly set, check if sync is in progress
    if (showProgressNow === false && isSyncing) {
      showProgressNow = true;
    }
    console.log('[CacheUI] Creating modal, showProgressNow:', showProgressNow);
    
    modal.innerHTML = `
      <div class="modal-backdrop" style="background: rgba(0, 0, 0, 0.5);"></div>
      <div class="modal-content" style="max-width: 500px; animation: slideDown 0.3s ease-out;">
        <div class="modal-header">
          <h3 class="text-lg font-semibold text-[color:var(--foreground)] flex items-center gap-2">
            <i data-lucide="database" class="w-5 h-5 text-blue-500"></i>
            <span id="sync-modal-title">${showProgressNow ? 'Syncing Database' : config.cache.modalText.syncTitle}</span>
          </h3>
        </div>
        <div class="modal-body">
          <p id="sync-modal-message" class="text-sm text-[color:var(--muted-foreground)] mb-4">
            ${showProgressNow ? 'status updates will appear below each progress bar...' : config.cache.modalText.syncMessage}
          </p>
          
          <!-- Progress section with dual progress bars -->
          <div id="sync-progress-section">
            <!-- JotForm Progress Bar (Blue) -->
            <div class="mb-3">
              <div class="flex justify-between items-center mb-1">
                <span class="text-xs font-medium text-blue-600">JotForm</span>
                <span id="sync-jotform-percent" class="text-xs font-mono font-semibold text-blue-600">0%</span>
              </div>
              <p id="sync-jotform-status" class="text-xs text-[color:var(--muted-foreground)] mb-1 min-h-[16px]">Waiting to start...</p>
              <div class="w-full h-2 bg-[color:var(--muted)] rounded-full overflow-hidden">
                <div id="sync-jotform-bar" class="h-full bg-blue-600 transition-all duration-300" style="width: 0%"></div>
              </div>
            </div>
            
            <!-- Qualtrics Progress Bar (Purple) -->
            <div class="mb-2">
              <div class="flex justify-between items-center mb-1">
                <span class="text-xs font-medium text-purple-600">Qualtrics</span>
                <span id="sync-qualtrics-percent" class="text-xs font-mono font-semibold text-purple-600">0%</span>
              </div>
              <p id="sync-qualtrics-status" class="text-xs text-[color:var(--muted-foreground)] mb-1 min-h-[16px]">Waiting to start...</p>
              <div class="w-full h-2 bg-[color:var(--muted)] rounded-full overflow-hidden">
                <div id="sync-qualtrics-bar" class="h-full bg-purple-600 transition-all duration-300" style="width: 0%"></div>
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
    const jotformBar = document.getElementById('sync-jotform-bar');
    const jotformPercent = document.getElementById('sync-jotform-percent');
    const jotformStatus = document.getElementById('sync-jotform-status');
    const qualtricsBar = document.getElementById('sync-qualtrics-bar');
    const qualtricsPercent = document.getElementById('sync-qualtrics-percent');
    const qualtricsStatus = document.getElementById('sync-qualtrics-status');
    const modalTitle = document.getElementById('sync-modal-title');
    const modalMessage = document.getElementById('sync-modal-message');
    
    console.log('[CacheUI] Modal elements:', {
      cancelBtn: !!cancelBtn,
      confirmBtn: !!confirmBtn,
      progressSection: !!progressSection,
      jotformBar: !!jotformBar,
      jotformStatus: !!jotformStatus,
      qualtricsBar: !!qualtricsBar,
      qualtricsStatus: !!qualtricsStatus,
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
      const syncHandler = async () => {
      // Hide buttons, show progress
      cancelBtn.textContent = 'Close';
      cancelBtn.classList.remove('hidden');
      confirmBtn.classList.add('hidden');
      progressSection.classList.remove('hidden');

      // Mark syncing state
      isSyncing = true;
      currentSyncProgress = 0;
      let maxProgress = 0; // Track maximum progress to prevent regression
      let maxJotformProgress = 0; // Track max JotForm progress (non-regressive)
      let maxQualtricsProgress = 0; // Track max Qualtrics progress (non-regressive)

      // Set up progress callback - updates BOTH modal AND pill
      window.JotFormCache.setProgressCallback((message, progress, details = {}) => {
        // Prevent progress regression (silently - warnings would clutter console)
        if (progress < maxProgress) {
          // Don't regress, but don't warn - this can happen during parallel fetch coordination
          return;
        }
        maxProgress = progress;
        currentSyncProgress = progress;
        
        // Extract individual progress values from details
        let jotformProgress = details.jotformProgress || 0;
        let qualtricsProgress = details.qualtricsProgress || 0;
        
        // Apply non-regressive logic to individual bars (silently)
        if (jotformProgress < maxJotformProgress) {
          // Keep at max, don't regress
          jotformProgress = maxJotformProgress;
        } else {
          maxJotformProgress = jotformProgress;
        }
        
        if (qualtricsProgress < maxQualtricsProgress) {
          // Keep at max, don't regress
          qualtricsProgress = maxQualtricsProgress;
        } else {
          maxQualtricsProgress = qualtricsProgress;
        }
        
        // Update modal progress bars (if still open)
        if (jotformBar) jotformBar.style.width = `${jotformProgress}%`;
        if (jotformPercent) jotformPercent.textContent = `${Math.round(jotformProgress)}%`;
        // Use detailed message from details object if available
        updateStatusText(jotformStatus, jotformProgress, 'jotform', details.jotformMessage);
        
        if (qualtricsBar) qualtricsBar.style.width = `${qualtricsProgress}%`;
        if (qualtricsPercent) qualtricsPercent.textContent = `${Math.round(qualtricsProgress)}%`;
        // Use detailed message from details object if available
        updateStatusText(qualtricsStatus, qualtricsProgress, 'qualtrics', details.qualtricsMessage);
        
        // Don't update modalMessage here - it's redundant with the detailed status lines above
        // Only update it for phase transitions (fetching -> validating -> complete)
        
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
        
        // Check if Qualtrics credentials are available
        // Support both qualtricsApiToken and qualtricsApiKey for backwards compatibility
        const qualtricsApiToken = credentials.qualtricsApiToken || credentials.qualtricsApiKey;
        const hasQualtricsCredentials = qualtricsApiToken && 
                                       credentials.qualtricsDatacenter && 
                                       credentials.qualtricsSurveyId;
        
        // Normalize credentials to use qualtricsApiToken
        if (hasQualtricsCredentials && !credentials.qualtricsApiToken) {
          credentials.qualtricsApiToken = qualtricsApiToken;
        }
        
        modalTitle.textContent = 'Syncing Database';
        modalMessage.textContent = 'Fetching student data... (status details shown below)';
        
        // Step 1: Fetch data (0-70%)
        // If Qualtrics credentials are available, use PARALLEL fetch (JotForm + Qualtrics simultaneously)
        // Otherwise, fetch JotForm only
        if (hasQualtricsCredentials) {
          console.log('[CacheUI] Qualtrics credentials found, using PARALLEL fetch...');
          
          try {
            // Check if modules are loaded
            if (typeof window.QualtricsAPI !== 'undefined' && 
                typeof window.QualtricsTransformer !== 'undefined' && 
                typeof window.DataMerger !== 'undefined') {
              
              // refreshWithQualtrics will handle PARALLEL fetch and dual progress bars
              // JotForm and Qualtrics will fetch simultaneously using Promise.all
              const qualtricsResult = await window.JotFormCache.refreshWithQualtrics(credentials);
              console.log('[CacheUI] Parallel fetch and merge complete');
              
              // Ensure we're at 70% after parallel fetch
              if (maxProgress < 70) {
                maxProgress = 70;
                if (modalMessage) modalMessage.textContent = 'Parallel fetch complete - data merged successfully!';
              }
            } else {
              console.warn('[CacheUI] Qualtrics modules not loaded, falling back to JotForm only');
              
              // Reset progress tracking for fallback
              maxProgress = 0;
              maxJotformProgress = 0;
              maxQualtricsProgress = 0;
              
              // Fallback to JotForm only
              const result = await window.JotFormCache.getAllSubmissions({
                formId: credentials.jotformFormId || credentials.formId,
                apiKey: credentials.jotformApiKey || credentials.apiKey
              });
              console.log('[CacheUI] getAllSubmissions returned:', result ? result.length : 0, 'submissions');
              
              maxProgress = 70;
              if (modalMessage) modalMessage.textContent = 'JotForm data cached (Qualtrics modules not loaded)';
            }
          } catch (fetchError) {
            console.error('[CacheUI] Parallel fetch failed, falling back to JotForm only:', fetchError);
            
            // Reset progress tracking for fallback
            maxProgress = 0;
            maxJotformProgress = 0;
            maxQualtricsProgress = 0;
            
            // Fallback to JotForm only
            try {
              const result = await window.JotFormCache.getAllSubmissions({
                formId: credentials.jotformFormId || credentials.formId,
                apiKey: credentials.jotformApiKey || credentials.apiKey
              });
              console.log('[CacheUI] getAllSubmissions returned:', result ? result.length : 0, 'submissions');
              
              maxProgress = 70;
              if (modalMessage) modalMessage.textContent = 'JotForm data cached (Qualtrics sync failed)';
            } catch (jotformError) {
              throw jotformError; // Rethrow if even JotForm fails
            }
          }
        } else {
          console.log('[CacheUI] No Qualtrics credentials found, using JotForm only');
          
          // Fetch JotForm only (sequential, no parallel fetch needed)
          const result = await window.JotFormCache.getAllSubmissions({
            formId: credentials.jotformFormId || credentials.formId,
            apiKey: credentials.jotformApiKey || credentials.apiKey
          });
          console.log('[CacheUI] getAllSubmissions returned:', result ? result.length : 0, 'submissions');
          
          maxProgress = 70;
          if (modalMessage) modalMessage.textContent = 'JotForm data cached';
        }
        
        // Step 2: Build validation cache (70-95%)
        maxProgress = 75;
        if (jotformBar) jotformBar.style.width = '75%';
        if (jotformPercent) jotformPercent.textContent = '75%';
        updateStatusText(jotformStatus, 75, 'jotform', 'Loading validation data...');
        if (qualtricsBar) qualtricsBar.style.width = '75%';
        if (qualtricsPercent) qualtricsPercent.textContent = '75%';
        updateStatusText(qualtricsStatus, 75, 'qualtrics', 'Loading validation data...');
        if (modalMessage) modalMessage.textContent = 'Now validating student submissions...';
        
        // Get student data from CheckingSystemData
        const cachedSystemData = window.CheckingSystemData?.getCachedData();
        
        console.log('[CacheUI] CheckingSystemData available?', !!window.CheckingSystemData);
        console.log('[CacheUI] Students available?', !!cachedSystemData?.students);
        
        if (!cachedSystemData?.students) {
          console.warn('[CacheUI] Student data not available, skipping validation cache build');
          console.warn('[CacheUI] Validation cache will be built when class page loads');
          
          // Still mark as complete - submissions are cached
          if (jotformBar) jotformBar.style.width = '100%';
          if (jotformPercent) jotformPercent.textContent = '100%';
          updateStatusText(jotformStatus, 100, 'jotform', 'Complete!');
          if (qualtricsBar) qualtricsBar.style.width = '100%';
          if (qualtricsPercent) qualtricsPercent.textContent = '100%';
          updateStatusText(qualtricsStatus, 100, 'qualtrics', 'Complete!');
          
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
        
        if (modalMessage) modalMessage.textContent = 'Validating student task completion...';
        
        // Hook up progress callback for validation with throttled pill updates
        let lastPillUpdate = 0;
        const PILL_UPDATE_THROTTLE = 1000; // Update pill max once per second
        
        window.JotFormCache.setProgressCallback((message, progress, details = {}) => {
          // Prevent regression
          if (progress < maxProgress) {
            console.warn(`[CacheUI] Validation progress regression prevented: ${progress}% < ${maxProgress}%`);
            return;
          }
          maxProgress = progress;
          
          // Extract individual progress (validation phase won't have jotform/qualtrics split)
          const jProgress = details.jotformProgress || progress;
          const qProgress = details.qualtricsProgress || progress;
          const jMessage = details.jotformMessage;
          const qMessage = details.qualtricsMessage;
          
          // Always update modal (no throttle)
          if (jotformBar) jotformBar.style.width = `${jProgress}%`;
          if (jotformPercent) jotformPercent.textContent = `${Math.round(jProgress)}%`;
          // During validation, use the main message if no individual message
          updateStatusText(jotformStatus, jProgress, 'jotform', jMessage || message);
          
          if (qualtricsBar) qualtricsBar.style.width = `${qProgress}%`;
          if (qualtricsPercent) qualtricsPercent.textContent = `${Math.round(qProgress)}%`;
          // During validation, use the main message if no individual message
          updateStatusText(qualtricsStatus, qProgress, 'qualtrics', qMessage || message);
          
          // Don't update modalMessage here - detailed status shown under progress bars
          
          // Throttled pill updates to avoid excessive IndexedDB reads
          const now = Date.now();
          if (now - lastPillUpdate >= PILL_UPDATE_THROTTLE) {
            lastPillUpdate = now;
            updateStatusPill(progress);
          }
        });
        
        console.log('[CacheUI] Building validation cache...');
        const validationCache = await window.JotFormCache.buildStudentValidationCache(
          cachedSystemData.students,
          surveyStructure,
          true, // Force rebuild
          credentials // Pass credentials
        );
        console.log('[CacheUI] Validation cache built:', validationCache.size, 'students');
        
        // Clear progress callback
        window.JotFormCache.setProgressCallback(null);
        
        // Step 3: All done (100%)
        const progressBar100Time = Date.now();
        if (jotformBar) jotformBar.style.width = '100%';
        if (jotformPercent) jotformPercent.textContent = '100%';
        updateStatusText(jotformStatus, 100, 'jotform', 'Complete!');
        if (qualtricsBar) qualtricsBar.style.width = '100%';
        if (qualtricsPercent) qualtricsPercent.textContent = '100%';
        updateStatusText(qualtricsStatus, 100, 'qualtrics', 'Complete!');
        console.log(`[SYNC-TIMING] ⏱️ Progress bars set to 100% at: ${new Date(progressBar100Time).toISOString()}`);
        
        // Mark sync complete and update pill
        isSyncing = false;
        currentSyncProgress = 100;
        
        const pillUpdateStartTime = Date.now();
        console.log(`[SYNC-TIMING] ⏱️ Starting pill update at: ${new Date(pillUpdateStartTime).toISOString()}`);
        console.log(`[SYNC-TIMING] ⏱️ Time between progress bars 100% and pill update start: ${pillUpdateStartTime - progressBar100Time}ms`);
        
        // Skip cache check - we KNOW it's ready (we just built it!)
        await updateStatusPill(null, true);
        
        const pillUpdateEndTime = Date.now();
        console.log(`[SYNC-TIMING] ⏱️ Pill update completed at: ${new Date(pillUpdateEndTime).toISOString()}`);
        console.log(`[SYNC-TIMING] ⏱️ Pill update took: ${pillUpdateEndTime - pillUpdateStartTime}ms`);
        console.log(`[SYNC-TIMING] ⏱️ Total time from progress 100% to pill green: ${pillUpdateEndTime - progressBar100Time}ms`);
        console.log('[CacheUI] ✅ Both caches complete, pill updated to green');
        
        // NOW show success message (cache is confirmed saved)
        if (modalMessage) modalMessage.textContent = 'Complete!';
        modalTitle.textContent = config.cache.modalText.completeTitle;
        
        // Build success message based on what was synced
        let successMessage = config.cache.modalText.completeMessage;
        if (hasQualtricsCredentials) {
          successMessage += ' TGMD data from Qualtrics has been merged.';
        }
        modalMessage.textContent = successMessage;
        modalMessage.classList.remove('text-[color:var(--muted-foreground)]');
        modalMessage.classList.add('text-green-600');
        
        // Hide cancel button, show only confirm as Close
        cancelBtn.classList.add('hidden');
        confirmBtn.textContent = 'Close';
        confirmBtn.classList.remove('hidden');
        
        // CRITICAL: Remove the sync handler before setting close handler!
        if (confirmBtn.syncHandler) {
          confirmBtn.removeEventListener('click', confirmBtn.syncHandler);
          confirmBtn.syncHandler = null;
          console.log('[CacheUI] Removed sync handler, setting close handler');
        }
        
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
        
        // Remove sync handler before setting retry/close handlers
        if (confirmBtn.syncHandler) {
          confirmBtn.removeEventListener('click', confirmBtn.syncHandler);
          confirmBtn.syncHandler = null;
        }
        
        // Show retry button
        confirmBtn.textContent = 'Retry';
        confirmBtn.classList.remove('hidden');
        confirmBtn.onclick = () => modal.remove();
        
        cancelBtn.textContent = 'Close';
        cancelBtn.classList.remove('hidden');
        cancelBtn.onclick = () => modal.remove();
      }
      }; // End of syncHandler
      
      confirmBtn.addEventListener('click', syncHandler);
      
      // Store handler reference so we can remove it later
      confirmBtn.dataset.hasSyncHandler = 'true';
      confirmBtn.syncHandler = syncHandler;
    } // End of if (!showProgressNow)
  } // End of showSyncModal

  /**
   * Show emergency reset password modal
   * Requires system password (same as decryption password) to authorize complete cache purge
   */
  function showEmergencyResetModal() {
    ensureModalCSS();
    
    const modal = document.createElement('div');
    modal.id = 'emergency-reset-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-backdrop" style="background: rgba(0, 0, 0, 0.7);"></div>
      <div class="modal-content" style="max-width: 500px; animation: slideDown 0.3s ease-out; border: 2px solid #ef4444;">
        <div class="modal-header" style="background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); border-bottom: 2px solid #ef4444;">
          <h3 class="text-lg font-semibold text-red-900 flex items-center gap-2">
            <i data-lucide="alert-triangle" class="w-6 h-6 text-red-600 animate-pulse"></i>
            ⚠️ EMERGENCY CACHE RESET
          </h3>
        </div>
        <div class="modal-body">
          <div class="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg mb-4 border-2 border-red-400">
            <p class="text-sm font-bold text-red-950 dark:text-red-100 mb-2">
              <i data-lucide="shield-alert" class="w-4 h-4 inline"></i>
              This action will completely purge ALL browser data for this site:
            </p>
            <ul class="text-xs text-red-900 dark:text-red-100 space-y-1 ml-6 list-disc font-medium">
              <li><strong>IndexedDB:</strong> JotForm submissions, validation cache, Qualtrics TGMD data</li>
              <li><strong>localStorage:</strong> User preferences, saved passwords, view settings</li>
              <li><strong>sessionStorage:</strong> Current session data, decrypted credentials</li>
              <li><strong>All cached metadata:</strong> School IDs, class mappings, student rosters</li>
            </ul>
          </div>
          
          <div class="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg mb-4 border border-amber-400">
            <p class="text-xs text-amber-950 dark:text-amber-100 font-semibold">
              <i data-lucide="info" class="w-4 h-4 inline"></i>
              <strong>After reset:</strong> You will need to re-enter the system password, rebuild the cache (60-90 sec), and reconfigure all preferences.
            </p>
          </div>
          
          <div class="mb-4">
            <label for="emergency-password" class="block text-sm font-medium text-[color:var(--foreground)] mb-2">
              Enter System Password to Authorize
            </label>
            <input 
              type="password" 
              id="emergency-password" 
              class="w-full px-3 py-2 border border-[color:var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-[color:var(--background)] text-[color:var(--foreground)]"
              placeholder="System password required"
              autocomplete="off"
            />
            <p id="emergency-error" class="text-xs text-red-600 mt-1 hidden">Incorrect password. Access denied.</p>
          </div>
        </div>
        <div class="modal-footer flex gap-3">
          <button id="emergency-cancel-btn" class="px-4 py-2.5 text-sm font-medium text-[color:var(--foreground)] bg-[color:var(--muted)] hover:bg-[color:var(--accent)] rounded-lg transition-colors">
            Cancel
          </button>
          <button id="emergency-confirm-btn" class="px-4 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors font-semibold">
            🚨 PURGE ALL DATA
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    lucide.createIcons();
    
    const passwordInput = document.getElementById('emergency-password');
    const errorText = document.getElementById('emergency-error');
    const confirmBtn = document.getElementById('emergency-confirm-btn');
    const cancelBtn = document.getElementById('emergency-cancel-btn');
    
    // Focus password input
    setTimeout(() => passwordInput.focus(), 100);
    
    // Allow Enter key to submit
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        confirmBtn.click();
      }
    });
    
    // Cancel button
    cancelBtn.addEventListener('click', () => {
      modal.remove();
    });
    
    // Backdrop click to cancel
    const backdrop = modal.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => modal.remove());
    }
    
    // Confirm button - verify password and execute purge
    confirmBtn.addEventListener('click', async () => {
      const password = passwordInput.value;
      
      if (!password) {
        errorText.textContent = 'Password required.';
        errorText.classList.remove('hidden');
        passwordInput.focus();
        return;
      }
      
      // Verify password matches system password (stored in sessionStorage)
      const cachedData = sessionStorage.getItem('checking_system_data');
      if (!cachedData) {
        errorText.textContent = 'System not initialized. Please reload and decrypt first.';
        errorText.classList.remove('hidden');
        return;
      }
      
      let systemPassword = null;
      try {
        const data = JSON.parse(cachedData);
        systemPassword = data.password; // The password used for decryption
      } catch (e) {
        console.error('[EmergencyReset] Error reading system password:', e);
        errorText.textContent = 'System error. Please contact administrator.';
        errorText.classList.remove('hidden');
        return;
      }
      
      // Verify password
      if (password !== systemPassword) {
        errorText.textContent = 'Incorrect password. Access denied.';
        errorText.classList.remove('hidden');
        passwordInput.value = '';
        passwordInput.focus();
        return;
      }
      
      // Password verified - show final confirmation
      const finalConfirm = confirm(
        '⚠️⚠️⚠️ FINAL CONFIRMATION ⚠️⚠️⚠️\n\n' +
        'You are about to PERMANENTLY DELETE all cached data for this site.\n\n' +
        'This includes:\n' +
        '• All JotForm submissions and validation results\n' +
        '• All Qualtrics TGMD data\n' +
        '• All user preferences and saved passwords\n' +
        '• All session data and decrypted credentials\n\n' +
        'This action CANNOT be undone.\n\n' +
        'Are you ABSOLUTELY SURE you want to proceed?'
      );
      
      if (!finalConfirm) {
        modal.remove();
        return;
      }
      
      // Execute comprehensive purge
      console.log('[EmergencyReset] 🚨 EXECUTING COMPREHENSIVE PURGE...');
      
      try {
        // Step 1: Clear IndexedDB stores
        console.log('[EmergencyReset] Clearing IndexedDB stores...');
        if (window.JotFormCache) {
          await window.JotFormCache.clearCache(); // Clears all 3 stores
        }
        
        // Step 2: Clear localStorage
        console.log('[EmergencyReset] Clearing localStorage...');
        localStorage.clear();
        
        // Step 3: Clear sessionStorage
        console.log('[EmergencyReset] Clearing sessionStorage...');
        sessionStorage.clear();
        
        // Step 4: Clear any service worker caches (if present)
        if ('caches' in window) {
          console.log('[EmergencyReset] Clearing service worker caches...');
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));
        }
        
        console.log('[EmergencyReset] ✅ COMPREHENSIVE PURGE COMPLETE');
        
        // Close modal
        modal.remove();
        
        // Show success message and reload
        alert(
          '✅ EMERGENCY RESET COMPLETE\n\n' +
          'All cached data has been purged from your browser.\n\n' +
          'The page will now reload. You will need to:\n' +
          '1. Re-enter the system password\n' +
          '2. Rebuild the cache (Fetch Database)\n' +
          '3. Reconfigure any preferences'
        );
        
        // Reload page to fresh state
        window.location.reload();
        
      } catch (error) {
        console.error('[EmergencyReset] Error during purge:', error);
        alert(
          '❌ ERROR DURING PURGE\n\n' +
          'An error occurred while clearing data:\n' +
          error.message + '\n\n' +
          'Please try again or contact system administrator.'
        );
      }
    });
  }

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
    
    // Don't update pill here - let checking-system-app trigger it after full initialization
    // This prevents race condition where IndexedDB isn't fully ready yet

    // Click on status pill
    const badge = document.getElementById('system-health-badge');
    if (badge) {
      badge.addEventListener('click', async () => {
        // Performance optimization: Check pill state first to avoid expensive cache check
        // If pill is already green (System Ready), directly show modal without re-checking
        const isGreen = badge.classList.contains('badge-success');
        const statusText = document.getElementById('status-text');
        const isSystemReady = statusText?.textContent === 'System Ready';
        
        if (isGreen && isSystemReady) {
          // Fast path: Pill is green, cache is already confirmed ready
          console.log('[CacheUI] Pill is green, showing modal immediately (no cache check)');
          showCacheReadyModal();
        } else {
          // Slow path: Verify cache status before showing appropriate modal
          console.log('[CacheUI] Pill state unknown, checking cache readiness...');
          const ready = await isCacheReady();
          if (!ready) {
            showSyncModal();
          } else {
            showCacheReadyModal();
          }
        }
      });
    }

    // Click on Emergency Reset pill
    const emergencyBadge = document.getElementById('emergency-reset-badge');
    if (emergencyBadge) {
      emergencyBadge.addEventListener('click', () => {
        console.log('[CacheUI] Emergency Reset clicked');
        showEmergencyResetModal();
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
    showBlockingModal,
    showEmergencyResetModal
  };

  // Auto-initialize
  init();
})();
