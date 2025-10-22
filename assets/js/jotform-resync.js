(() => {
  const state = {
    credentials: null,
    systemPassword: null,
    mapping: null,
    modalOpen: false,
    lastSyncTimestamp: null,
    updateTimerId: null
  };

  // Proxy configuration for CORS handling
  const PROXY_CONFIG = {
    enabled: true,  // Set to false to use direct API calls
    baseUrl: 'http://127.0.0.1:3000'
  };

  const apiRoutes = {
    latest: '/api/jotform/latest-submission',
    resync: '/api/jotform/resync'
  };

  const refs = {};

  function cacheRefs() {
    refs.submissionId = document.querySelector('[data-field="submission-id"]');
    refs.sessionKey = document.querySelector('[data-field="session-key"]');
    refs.schoolId = document.querySelector('[data-field="school-id"]');
    refs.uploaded = document.querySelector('[data-field="uploaded"]');
    refs.lastSync = document.querySelector('[data-field="last-sync"]');
    refs.feedback = document.querySelector('[data-feedback]');
    refs.resyncButton = document.querySelector('[data-action="resync-jotform"]');
    refs.resyncLabel = document.querySelector('[data-label="resync"]');
    refs.tableButton = document.querySelector('[data-action="view-table"]');
    refs.modalBackdrop = document.querySelector('[data-modal="password"]');
    refs.modalForm = document.querySelector('[data-modal-form]');
    refs.modalInput = document.querySelector('#system-password');
    refs.modalError = document.querySelector('[data-modal-error]');
    refs.modalClose = document.querySelector('[data-modal-close]');
    refs.modalCancel = document.querySelector('[data-modal-cancel]');
    refs.tableModalBackdrop = document.querySelector('[data-modal="table-password"]');
    refs.tableModalForm = refs.tableModalBackdrop?.querySelector('[data-modal-form]');
    refs.tableModalInput = document.querySelector('#table-system-password');
    refs.tableModalError = refs.tableModalBackdrop?.querySelector('[data-modal-error]');
    refs.tableModalClose = refs.tableModalBackdrop?.querySelector('[data-modal-close]');
    refs.tableModalCancel = refs.tableModalBackdrop?.querySelector('[data-modal-cancel]');
  }

  const feedbackClasses = {
    neutral: 'text-[color:var(--muted-foreground)]',
    success: 'text-[color:var(--success)]',
    error: 'text-[color:var(--accent)]'
  };

  const dateFormatter = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const fallbackRaw = {
    submissionId: '6362362300324596100',
    sessionKey: '99999_20251225_00_00',
    schoolId: 'S999',
    uploaded: '2025-10-14T15:30:00+08:00',
    lastSync: new Date().toISOString()
  };

  function applyFeedback(stateKey, message = '') {
    if (!refs.feedback) return;
    refs.feedback.textContent = message;
    Object.values(feedbackClasses).forEach(cls => refs.feedback.classList.remove(cls));
    refs.feedback.classList.add(feedbackClasses[stateKey] ?? feedbackClasses.neutral);
  }

  function setLoading(isLoading) {
    if (!refs.resyncButton || !refs.resyncLabel) return;
    refs.resyncButton.disabled = isLoading;
    refs.resyncButton.classList.toggle('opacity-70', isLoading);
    refs.resyncLabel.textContent = isLoading ? 'Resyncing…' : 'Resync';
  }

  function formatUploaded(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) return value;
    return dateFormatter.format(parsed);
  }

  function formatLastSync(value) {
    if (!value) return 'Last Sync: —';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) return `Last Sync: ${value}`;
    const now = new Date();
    const diffMs = now.getTime() - parsed.getTime();
    const diffMinutes = Math.round(diffMs / 60000);
    if (diffMinutes >= 0 && diffMinutes < 60) {
      return `Last Sync: ${diffMinutes} min${diffMinutes === 1 ? '' : 's'} ago`;
    }
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours >= 0 && diffHours < 24) {
      return `Last Sync: ${diffHours} hr${diffHours === 1 ? '' : 's'} ago`;
    }
    return `Last Sync: ${dateFormatter.format(parsed)}`;
  }

  function sanitizeKey(key = '') {
    return key.toString().replace(/[^a-z0-9]/gi, '').toLowerCase();
  }

  function extractAnswer(payload, fieldName) {
    if (!payload || !fieldName) return undefined;
    
    // Skip direct property check for Jotform metadata fields - go straight to answers lookup
    const skipDirectLookup = ['Response ID', 'sessionkey', 'school-id', 'student-id', 'Recorded Date'];
    
    if (!skipDirectLookup.includes(fieldName)) {
      if (fieldName in payload && payload[fieldName] != null) return payload[fieldName];

      const sanitized = sanitizeKey(fieldName);
      for (const [key, value] of Object.entries(payload)) {
        if (sanitizeKey(key) === sanitized && value != null) return value;
      }
    }

    // Look up in the mapping and extract from answers object
    const qid = state.mapping?.[fieldName];
    if (!qid) {
      console.warn(`[jotform] No QID mapping found for field: ${fieldName}`);
      return undefined;
    }
    
    const answers = payload.answers ?? payload.Answers ?? {};
    const entry = answers[qid] ?? answers[String(qid)];
    
    if (entry == null) {
      console.warn(`[jotform] No answer found for QID ${qid} (${fieldName})`);
      return undefined;
    }
    
    let extracted;
    if (typeof entry === 'object') {
      extracted = entry.answer ?? entry.value ?? entry.text ?? Object.values(entry)[0];
    } else {
      extracted = entry;
    }
    
    console.log(`[jotform] Extracted ${fieldName} (QID ${qid}):`, extracted);
    return extracted;
  }

  function normalizeSubmission(payload = {}) {
    // Use Jotform's top-level ID, not the "Response ID" field
    const submissionId = payload.id ?? payload.submissionId ?? extractAnswer(payload, 'Response ID') ?? '—';
    
    // Extract from form answers
    const sessionKey = extractAnswer(payload, 'sessionkey') ?? payload.sessionKey ?? '—';
    const schoolIdRaw = extractAnswer(payload, 'school-id') ?? payload.schoolId ?? '';
    
    // Format school ID (ensure S prefix and 3-digit padding)
    let schoolId = '—';
    if (schoolIdRaw && schoolIdRaw !== '—') {
      const numOnly = String(schoolIdRaw).replace(/[^\d]/g, '');
      if (numOnly) {
        schoolId = 'S' + numOnly.padStart(3, '0');
      }
    }
    
    const uploaded = payload.created_at ?? payload.uploaded ?? payload.submittedAt ?? payload.createdAt ?? extractAnswer(payload, 'Recorded Date');
    const lastSync = payload.lastSync ?? payload.syncedAt ?? new Date().toISOString();
    
    console.log('[jotform] Normalized:', { submissionId, sessionKey, schoolId, uploaded, lastSync });
    
    return { submissionId, sessionKey, schoolId, uploaded, lastSync };
  }

  function updateLastSyncDisplay() {
    if (refs.lastSync && state.lastSyncTimestamp) {
      refs.lastSync.textContent = formatLastSync(state.lastSyncTimestamp);
    }
  }

  function startLastSyncTimer() {
    // Clear existing timer
    if (state.updateTimerId) {
      clearInterval(state.updateTimerId);
    }
    // Update every 30 seconds
    state.updateTimerId = setInterval(updateLastSyncDisplay, 30000);
  }

  function renderSubmission(data) {
    // Don't merge with fallback - let normalizeSubmission handle defaults
    const normalized = normalizeSubmission(data);
    if (refs.submissionId) refs.submissionId.textContent = normalized.submissionId ?? '—';
    if (refs.sessionKey) refs.sessionKey.textContent = normalized.sessionKey ?? '—';
    if (refs.schoolId) refs.schoolId.textContent = normalized.schoolId ?? '—';
    if (refs.uploaded) refs.uploaded.textContent = formatUploaded(normalized.uploaded);
    
    // Store timestamp and update display
    if (normalized.lastSync) {
      state.lastSyncTimestamp = normalized.lastSync;
      updateLastSyncDisplay();
      startLastSyncTimer();
    }
  }

  async function loadQuestionMapping() {
    if (state.mapping) return state.mapping;
    
    // Try loading from local file first
    try {
      const response = await fetch('assets/jotformquestions.json', { cache: 'default' });
      if (!response.ok) throw new Error(`Mapping fetch failed: ${response.status}`);
      state.mapping = await response.json();
      console.log('[jotform] Loaded mapping from local file:', Object.keys(state.mapping).length, 'fields');
      return state.mapping;
    } catch (error) {
      console.warn('[jotform] Local mapping file unavailable, will try Jotform API:', error);
    }
    
    // Fallback: fetch from Jotform API if credentials are available
    if (state.credentials?.jotformApiKey && state.credentials?.jotformFormId) {
      try {
        const apiKey = state.credentials.jotformApiKey;
        const formId = state.credentials.jotformFormId;
        
        // Build URL using proxy if enabled
        let url;
        if (PROXY_CONFIG.enabled) {
          url = `${PROXY_CONFIG.baseUrl}/api/jotform/form/${formId}/questions?apiKey=${apiKey}`;
        } else {
          url = `https://api.jotform.com/form/${formId}/questions?apiKey=${apiKey}`;
        }
        
        const response = await fetch(url, { cache: 'default' });
        if (!response.ok) throw new Error(`Questions API failed: ${response.status}`);
        
        const data = await response.json();
        const questions = data.content || {};
        
        // Build name -> qid mapping
        const mapping = {};
        for (const [qid, question] of Object.entries(questions)) {
          const name = question.name || question.text;
          if (name && qid) {
            mapping[name] = qid;
          }
        }
        
        state.mapping = mapping;
        console.log('[jotform] Loaded mapping from API:', Object.keys(mapping).length, 'fields');
        return state.mapping;
      } catch (error) {
        console.warn('[jotform] API mapping fetch failed:', error);
      }
    }
    
    // Last resort: empty mapping
    console.warn('[jotform] No mapping available - using empty mapping');
    state.mapping = {};
    return state.mapping;
  }

  async function unlockSystemPassword(password) {
    // Use the shared encryption module
    const credentials = await window.Encryption.unlockCredentials(password);
    state.credentials = credentials;
    state.systemPassword = password;
    return credentials;
  }

  async function fetchLatestSubmission({ showFeedback = false } = {}) {
    await loadQuestionMapping();
    
    // If we don't have credentials yet, just show fallback
    if (!state.credentials?.jotformApiKey || !state.credentials?.jotformFormId) {
      renderSubmission(fallbackRaw);
      if (showFeedback) {
        applyFeedback('error', 'Credentials not loaded. Please resync to fetch live data.');
      }
      return;
    }
    
    try {
      // Call Jotform API to get latest submission (via proxy if enabled)
      const apiKey = state.credentials.jotformApiKey;
      const formId = state.credentials.jotformFormId;
      
      // Build URL using proxy if enabled
      let url;
      if (PROXY_CONFIG.enabled) {
        url = `${PROXY_CONFIG.baseUrl}/api/jotform/form/${formId}/submissions?apiKey=${apiKey}&limit=1&orderby=created_at&direction=DESC`;
      } else {
        url = `https://api.jotform.com/form/${formId}/submissions?apiKey=${apiKey}&limit=1&orderby=created_at&direction=DESC`;
      }
      
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Latest submission fetch failed: ${response.status}`);
      
      const data = await response.json();
      const submissions = data.content || [];
      
      if (submissions.length === 0) {
        throw new Error('No submissions found');
      }
      
      // Extract the latest submission
      const latest = submissions[0];
      
      console.log('[jotform] Latest submission data:', latest);
      console.log('[jotform] Mapping loaded:', state.mapping);
      
      // Build payload in the format that normalizeSubmission expects
      // It will extract answers using the extractAnswer function and mapping
      const payload = {
        id: latest.id,
        created_at: latest.created_at,
        lastSync: new Date().toISOString(),
        answers: latest.answers || {},
        Answers: latest.answers || {}  // Support both capitalizations
      };
      
      console.log('[jotform] Built payload:', payload);
      
      renderSubmission(payload);
      if (showFeedback) applyFeedback('success', 'Latest submission refreshed.');
    } catch (error) {
      console.warn('[jotform] latest fetch fallback', error);
      renderSubmission(fallbackRaw);
      if (showFeedback) {
        applyFeedback('error', 'Unable to fetch latest submission. Showing cached sample.');
      }
    }
  }

  async function performResync() {
    if (!state.systemPassword) {
      throw new Error('System password not unlocked.');
    }
    if (!state.credentials?.jotformApiKey || !state.credentials?.jotformFormId) {
      throw new Error('Jotform credentials not found in encrypted bundle.');
    }
    setLoading(true);
    applyFeedback('neutral', 'Resync in progress…');
    try {
      // Fetch latest submission directly from Jotform API
      await fetchLatestSubmission({ showFeedback: true });
    } catch (error) {
      console.error('[jotform] resync error', error);
      applyFeedback('error', 'Resync failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function openModal() {
    if (!refs.modalBackdrop) return;
    state.modalOpen = true;
    refs.modalBackdrop.classList.remove('hidden');
    refs.modalBackdrop.setAttribute('aria-hidden', 'false');
    if (refs.modalInput) {
      refs.modalInput.value = '';
      requestAnimationFrame(() => refs.modalInput?.focus());
    }
    if (refs.modalError) refs.modalError.textContent = '';
  }

  function closeModal() {
    if (!refs.modalBackdrop) return;
    state.modalOpen = false;
    refs.modalBackdrop.classList.add('hidden');
    refs.modalBackdrop.setAttribute('aria-hidden', 'true');
  }

  function handleModalError(message) {
    if (refs.modalError) refs.modalError.textContent = message;
  }

  function handleResyncClick() {
    if (!state.credentials || !state.systemPassword) {
      openModal();
    } else {
      performResync();
    }
  }

  async function handleModalSubmit(event) {
    event.preventDefault();
    if (!refs.modalInput) return;
    const password = refs.modalInput.value.trim();
    try {
      await unlockSystemPassword(password);
      closeModal();
      await performResync();
    } catch (error) {
      console.warn('[security] password unlock failed', error);
      handleModalError(error.message ?? 'Unable to unlock credentials.');
    }
  }

  function handleModalBackdropClick(event) {
    if (event.target === refs.modalBackdrop) {
      closeModal();
    }
  }

  function handleEscape(event) {
    if (event.key === 'Escape' && state.modalOpen) {
      closeModal();
      closeTableModal();
    }
  }

  // Table Modal Functions
  function openTableModal() {
    if (!refs.tableModalBackdrop) return;
    refs.tableModalBackdrop.classList.remove('hidden');
    refs.tableModalBackdrop.setAttribute('aria-hidden', 'false');
    if (refs.tableModalInput) {
      refs.tableModalInput.value = '';
      requestAnimationFrame(() => refs.tableModalInput?.focus());
    }
    if (refs.tableModalError) refs.tableModalError.textContent = '';
  }

  function closeTableModal() {
    if (!refs.tableModalBackdrop) return;
    refs.tableModalBackdrop.classList.add('hidden');
    refs.tableModalBackdrop.setAttribute('aria-hidden', 'true');
  }

  function handleTableClick() {
    if (!state.credentials || !state.systemPassword) {
      openTableModal();
    } else {
      openJotformTable();
    }
  }

  async function handleTableModalSubmit(event) {
    event.preventDefault();
    if (!refs.tableModalInput) return;
    const password = refs.tableModalInput.value.trim();
    try {
      await unlockSystemPassword(password);
      closeTableModal();
      openJotformTable();
    } catch (error) {
      console.warn('[security] password unlock failed', error);
      if (refs.tableModalError) {
        refs.tableModalError.textContent = error.message ?? 'Unable to unlock credentials.';
      }
    }
  }

  function handleTableModalBackdropClick(event) {
    if (event.target === refs.tableModalBackdrop) {
      closeTableModal();
    }
  }

  function openJotformTable() {
    window.open('https://www.jotform.com/table/252529024677058', '_blank', 'noopener,noreferrer');
  }

  function init() {
    cacheRefs();

    if (!refs.resyncButton) {
      console.warn('[jotform] resync button not found on page.');
      return;
    }

    renderSubmission(fallbackRaw);
    loadQuestionMapping();
    fetchLatestSubmission();

    refs.resyncButton.addEventListener('click', handleResyncClick);
    if (refs.tableButton) {
      refs.tableButton.addEventListener('click', handleTableClick);
    }
    if (refs.modalForm) {
      refs.modalForm.addEventListener('submit', handleModalSubmit);
    }
    if (refs.modalCancel) {
      refs.modalCancel.addEventListener('click', closeModal);
    }
    if (refs.modalClose) {
      refs.modalClose.addEventListener('click', closeModal);
    }
    if (refs.modalBackdrop) {
      refs.modalBackdrop.addEventListener('click', handleModalBackdropClick);
    }
    if (refs.tableModalForm) {
      refs.tableModalForm.addEventListener('submit', handleTableModalSubmit);
    }
    if (refs.tableModalCancel) {
      refs.tableModalCancel.addEventListener('click', closeTableModal);
    }
    if (refs.tableModalClose) {
      refs.tableModalClose.addEventListener('click', closeTableModal);
    }
    if (refs.tableModalBackdrop) {
      refs.tableModalBackdrop.addEventListener('click', handleTableModalBackdropClick);
    }
    document.addEventListener('keydown', handleEscape);

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
