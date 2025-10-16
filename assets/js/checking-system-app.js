/**
 * Main Application Controller for Checking System Home Page
 * Orchestrates authentication, data loading, and UI initialization
 */
(() => {
  let appData = null;
  let systemPassword = null;

  /**
   * Initialize the application on page load
   */
  async function init() {
    // Check if data is cached in session
    appData = window.CheckingSystemData.getCachedData();
    
    // Validate cached data has credentials (version 1.3+)
    if (appData && appData.credentials && appData.version === '1.3') {
      // Data already loaded with credentials, skip password prompt
      hidePasswordModal();
      initializeUI();
      return;
    }

    // Clear old/invalid cache
    if (appData && (!appData.credentials || appData.version !== '1.3')) {
      console.log('Cache outdated or missing credentials, clearing...');
      sessionStorage.removeItem('checking_system_data');
      appData = null;
    }

    // Show password modal
    showPasswordModal();
  }

  /**
   * Show password entry modal
   */
  function showPasswordModal() {
    const modal = document.getElementById('password-modal');
    if (!modal) {
      console.error('Password modal not found');
      return;
    }

    modal.classList.remove('hidden');
    
    // Focus on password input
    const passwordInput = document.getElementById('system-password-input');
    if (passwordInput) {
      passwordInput.focus();
    }

    // Set up event listeners
    const submitBtn = document.getElementById('password-submit-btn');
    if (submitBtn) {
      submitBtn.addEventListener('click', handlePasswordSubmit);
    }

    const passwordForm = document.getElementById('password-form');
    if (passwordForm) {
      passwordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handlePasswordSubmit();
      });
    }

    // Handle Enter key in password input
    if (passwordInput) {
      passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handlePasswordSubmit();
        }
      });
    }
  }

  /**
   * Hide password entry modal
   */
  function hidePasswordModal() {
    const modal = document.getElementById('password-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  /**
   * Handle password submission
   */
  async function handlePasswordSubmit() {
    const passwordInput = document.getElementById('system-password-input');
    const errorDiv = document.getElementById('password-error');
    const submitBtn = document.getElementById('password-submit-btn');

    if (!passwordInput || !errorDiv || !submitBtn) return;

    const password = passwordInput.value.trim();

    if (!password) {
      showError(errorDiv, 'Please enter the system password');
      return;
    }

    // Disable button and show loading
    submitBtn.disabled = true;
    submitBtn.textContent = 'Unlocking...';
    errorDiv.textContent = '';

    try {
      // Show loading overlay
      showLoadingOverlay('Decrypting data files...');

      // Load and decrypt data (including credentials.enc)
      systemPassword = password;
      appData = await window.CheckingSystemData.loadAllData(systemPassword);

      // Cache the data (includes credentials for Jotform API)
      window.CheckingSystemData.cacheData(appData);

      // Hide modal and loading
      hidePasswordModal();
      hideLoadingOverlay();

      // Initialize UI
      initializeUI();

    } catch (error) {
      console.error('Failed to load data:', error);
      showError(errorDiv, 'Incorrect password or unable to decrypt data files');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Unlock';
      hideLoadingOverlay();
    }
  }

  /**
   * Show error message
   */
  function showError(errorDiv, message) {
    errorDiv.textContent = message;
    errorDiv.classList.add('error-message');
  }

  /**
   * Show loading overlay
   */
  function showLoadingOverlay(message = 'Loading...') {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;

    const loadingText = overlay.querySelector('.loading-text');
    if (loadingText) {
      loadingText.textContent = message;
    }

    overlay.classList.remove('hidden');
  }

  /**
   * Hide loading overlay
   */
  function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }

  /**
   * Initialize UI components after data is loaded
   */
  function initializeUI() {
    // Initialize filter system
    window.CheckingSystemFilters.initialize(appData);

    // Render recent checks
    window.CheckingSystemRouter.renderRecentChecks();

    // Update system health badge
    updateSystemHealthBadge();

    // Show success message
    console.log('Checking System initialized successfully');
    console.log(`Loaded: ${appData.metadata.recordCounts.schools} schools, ${appData.metadata.recordCounts.classes} classes, ${appData.metadata.recordCounts.students} students`);
  }

  /**
   * Update system health badge
   * Sets decryption pill to green, triggers cache manager to check cache status
   */
  function updateSystemHealthBadge() {
    const timestampSpan = document.getElementById('snapshot-timestamp');
    const decryptionBadge = document.getElementById('decryption-status-badge');
    const decryptionText = document.getElementById('decryption-status-text');

    if (!timestampSpan) return;

    // Update timestamp
    const now = new Date();
    const timeString = now.toISOString().slice(0, 16).replace('T', ' ');
    timestampSpan.textContent = timeString;

    // Update decryption status pill to green (decryption successful)
    if (decryptionBadge && decryptionText) {
      decryptionBadge.className = 'badge-success flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium';
      decryptionText.textContent = 'Data Decrypted';
    }

    // Trigger cache manager UI to check cache status and update cache badge
    if (window.CacheManagerUI && window.CacheManagerUI.updateStatusPill) {
      window.CacheManagerUI.updateStatusPill();
    }
  }

  /**
   * Handle "Re-enter Password" action
   */
  function handleReenterPassword() {
    // Clear cached data (which includes credentials)
    sessionStorage.removeItem('checking_system_data');
    
    // Reset data
    appData = null;
    systemPassword = null;

    // Clear password input
    const passwordInput = document.getElementById('system-password-input');
    if (passwordInput) {
      passwordInput.value = '';
    }

    // Show password modal again
    showPasswordModal();
  }

  // Initialize on DOM content loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export to global scope
  window.CheckingSystemApp = {
    init,
    handleReenterPassword,
    showLoadingOverlay,
    hideLoadingOverlay
  };
})();
