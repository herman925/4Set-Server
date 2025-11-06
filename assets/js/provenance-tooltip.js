/**
 * Data Provenance Tooltip Component
 * 
 * Purpose: Display source metadata for merged data fields
 * Shows: Grade context, source availability, submission IDs, timestamps, final winner
 * 
 * Usage:
 * 1. Extract provenance data: const provData = ProvenanceTooltip.extractProvenance(submission, fieldId)
 * 2. Attach to element: ProvenanceTooltip.attachToElement(element, provData)
 * 3. Initialize handlers: ProvenanceTooltip.initialize()
 */

window.ProvenanceTooltip = (() => {
  // Tooltip state
  let tooltipElement = null;
  let activeTarget = null;
  let hideTimeout = null;

  /**
   * Extract provenance information for a specific field
   * @param {Object} submission - Student submission with metadata
   * @param {String} fieldId - Field identifier (e.g., "TGMD_111_Hop_t1")
   * @returns {Object} - Provenance data structure
   */
  function extractProvenance(submission, fieldId) {
    if (!submission) {
      return null;
    }

    const provenance = {
      field: fieldId,
      grade: submission.grade || 'Unknown',
      sources: [],
      finalWinner: null,
      singleSource: false
    };

    // Determine sources from metadata
    const sources = submission._sources || [];
    const hasJotForm = sources.includes('jotform');
    const hasQualtrics = sources.includes('qualtrics');
    const isOrphaned = submission._orphaned === true;

    // Handle single-source cases
    if (isOrphaned || sources.length === 1) {
      provenance.singleSource = true;
      
      if (isOrphaned || hasQualtrics) {
        provenance.sources.push({
          type: 'qualtrics',
          available: true,
          responseId: submission._meta?.qualtricsResponseId || 'N/A',
          timestamp: submission._meta?.qualtricsStartDate || submission._meta?.qualtricsEndDate || 'N/A',
          count: 1
        });
        provenance.finalWinner = {
          source: 'Qualtrics',
          reason: 'Qualtrics only',
          timestamp: submission._meta?.qualtricsStartDate || 'N/A'
        };
      } else if (hasJotForm) {
        const submissionCount = submission._meta?.submissionCount || 1;
        const submissionIds = submission._meta?.submissionIds || [submission._meta?.submissionId || 'N/A'];
        provenance.sources.push({
          type: 'jotform',
          available: true,
          submissionIds: submissionIds,
          timestamp: submission._meta?.created_at || submission.created_at || 'N/A',
          count: submissionCount
        });
        provenance.finalWinner = {
          source: 'JotForm',
          reason: submissionCount > 1 ? `Earliest of ${submissionCount} submissions` : 'JotForm only',
          timestamp: submission._meta?.created_at || submission.created_at || 'N/A'
        };
      }
      
      return provenance;
    }

    // Handle merged sources (both JotForm and Qualtrics)
    if (hasJotForm) {
      const submissionCount = submission._meta?.submissionCount || 1;
      const submissionIds = submission._meta?.submissionIds || [submission._meta?.submissionId || 'N/A'];
      provenance.sources.push({
        type: 'jotform',
        available: true,
        submissionIds: submissionIds,
        timestamp: submission._meta?.jotformCreatedAt || submission._meta?.created_at || submission.created_at || 'N/A',
        count: submissionCount
      });
    }

    if (hasQualtrics) {
      const responseCount = submission._meta?.mergedResponseCount || 1;
      provenance.sources.push({
        type: 'qualtrics',
        available: true,
        responseId: submission._meta?.qualtricsResponseId || 'N/A',
        timestamp: submission._meta?.qualtricsStartDate || 'N/A',
        count: responseCount
      });
    }

    // Determine final winner for this specific field
    if (submission._qualtricsConflicts && submission._qualtricsConflicts.length > 0) {
      // Check if this field had a conflict
      const conflict = submission._qualtricsConflicts.find(c => c.field === fieldId);
      if (conflict) {
        provenance.finalWinner = {
          source: conflict.resolution === 'jotform' ? 'JotForm' : 'Qualtrics',
          reason: 'Earliest non-empty',
          timestamp: conflict.resolution === 'jotform' ? conflict.jotformTimestamp : conflict.qualtricsTimestamp,
          conflictValue: conflict.resolution === 'jotform' ? conflict.qualtrics : conflict.jotform,
          conflictSource: conflict.resolution === 'jotform' ? 'Qualtrics' : 'JotForm'
        };
      } else {
        // No conflict - determine which source had the value
        const answer = submission.answers?.[fieldId] || submission[fieldId];
        if (answer) {
          // Try to determine source from available data
          // Use far-future date for missing timestamps to sort them last
          const jotformTimestamp = new Date(submission._meta?.jotformCreatedAt || submission._meta?.created_at || '9999-12-31');
          const qualtricsTimestamp = new Date(submission._meta?.qualtricsStartDate || '9999-12-31');
          
          provenance.finalWinner = {
            source: jotformTimestamp <= qualtricsTimestamp ? 'JotForm' : 'Qualtrics',
            reason: 'Only one source had value',
            timestamp: jotformTimestamp <= qualtricsTimestamp ? 
              (submission._meta?.jotformCreatedAt || submission._meta?.created_at) : 
              submission._meta?.qualtricsStartDate
          };
        }
      }
    } else {
      // No conflicts - both sources agree or only one had data
      // Use far-future date for missing timestamps to sort them last
      const jotformTimestamp = new Date(submission._meta?.jotformCreatedAt || submission._meta?.created_at || '9999-12-31');
      const qualtricsTimestamp = new Date(submission._meta?.qualtricsStartDate || '9999-12-31');
      
      provenance.finalWinner = {
        source: jotformTimestamp <= qualtricsTimestamp ? 'JotForm' : 'Qualtrics',
        reason: 'Earliest non-empty',
        timestamp: jotformTimestamp <= qualtricsTimestamp ? 
          (submission._meta?.jotformCreatedAt || submission._meta?.created_at) : 
          submission._meta?.qualtricsStartDate
      };
    }

    return provenance;
  }

  /**
   * Format timestamp for display
   * @param {String} timestamp - ISO timestamp or date string
   * @returns {String} - Formatted date string
   */
  function formatTimestamp(timestamp) {
    if (!timestamp || timestamp === 'N/A') {
      return 'N/A';
    }
    
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        return timestamp;
      }
      
      // Format as: YYYY-MM-DD HH:MM
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    } catch (error) {
      return timestamp;
    }
  }

  /**
   * Build tooltip HTML content from provenance data
   * @param {Object} provenance - Provenance data structure
   * @returns {String} - HTML content
   */
  function buildTooltipContent(provenance) {
    if (!provenance) {
      return '<div class="provenance-tooltip-content">No provenance data available</div>';
    }

    let html = '<div class="provenance-tooltip-content">';
    
    // Grade context
    html += `<div class="provenance-section">`;
    html += `<div class="provenance-label">Grade Context</div>`;
    html += `<div class="provenance-value">${provenance.grade}</div>`;
    html += `</div>`;

    // Source availability
    html += `<div class="provenance-section">`;
    html += `<div class="provenance-label">Data Sources</div>`;
    
    if (provenance.sources.length === 0) {
      html += `<div class="provenance-value">No sources available</div>`;
    } else {
      for (const source of provenance.sources) {
        const sourceLabel = source.type === 'jotform' ? 'JotForm' : 'Qualtrics';
        const sourceIcon = source.type === 'jotform' ? 'file-text' : 'clipboard-list';
        
        html += `<div class="provenance-source">`;
        html += `<div class="provenance-source-header">`;
        html += `<i data-lucide="${sourceIcon}" class="w-3.5 h-3.5"></i>`;
        html += `<span class="font-semibold">${sourceLabel}</span>`;
        html += `</div>`;
        
        if (source.type === 'jotform') {
          html += `<div class="provenance-source-detail">`;
          html += `<span class="provenance-detail-label">Submissions:</span>`;
          html += `<span class="provenance-detail-value">${source.count}</span>`;
          html += `</div>`;
          
          if (source.submissionIds && source.submissionIds.length > 0) {
            html += `<div class="provenance-source-detail">`;
            html += `<span class="provenance-detail-label">IDs:</span>`;
            html += `<span class="provenance-detail-value font-mono text-xs">${source.submissionIds.slice(0, 3).join(', ')}${source.submissionIds.length > 3 ? '...' : ''}</span>`;
            html += `</div>`;
          }
          
          html += `<div class="provenance-source-detail">`;
          html += `<span class="provenance-detail-label">Earliest:</span>`;
          html += `<span class="provenance-detail-value">${formatTimestamp(source.timestamp)}</span>`;
          html += `</div>`;
        } else {
          html += `<div class="provenance-source-detail">`;
          html += `<span class="provenance-detail-label">Responses:</span>`;
          html += `<span class="provenance-detail-value">${source.count}</span>`;
          html += `</div>`;
          
          html += `<div class="provenance-source-detail">`;
          html += `<span class="provenance-detail-label">Response ID:</span>`;
          html += `<span class="provenance-detail-value font-mono text-xs">${source.responseId}</span>`;
          html += `</div>`;
          
          html += `<div class="provenance-source-detail">`;
          html += `<span class="provenance-detail-label">Recorded:</span>`;
          html += `<span class="provenance-detail-value">${formatTimestamp(source.timestamp)}</span>`;
          html += `</div>`;
        }
        
        html += `</div>`; // Close provenance-source
      }
    }
    
    html += `</div>`; // Close provenance-section

    // Final winner
    if (provenance.finalWinner) {
      html += `<div class="provenance-section provenance-winner">`;
      html += `<div class="provenance-label">Final Answer Source</div>`;
      html += `<div class="provenance-winner-content">`;
      html += `<div class="provenance-winner-source">`;
      html += `<i data-lucide="award" class="w-4 h-4"></i>`;
      html += `<span class="font-semibold">${provenance.finalWinner.source}</span>`;
      html += `</div>`;
      html += `<div class="provenance-winner-reason">${provenance.finalWinner.reason}</div>`;
      html += `<div class="provenance-winner-timestamp">${formatTimestamp(provenance.finalWinner.timestamp)}</div>`;
      
      if (provenance.finalWinner.conflictValue) {
        html += `<div class="provenance-conflict">`;
        html += `<i data-lucide="alert-triangle" class="w-3 h-3"></i>`;
        html += `<span>Conflict: ${provenance.finalWinner.conflictSource} had "${provenance.finalWinner.conflictValue}"</span>`;
        html += `</div>`;
      }
      
      html += `</div>`; // Close provenance-winner-content
      html += `</div>`; // Close provenance-section
    }

    html += '</div>'; // Close provenance-tooltip-content
    
    return html;
  }

  /**
   * Create or get tooltip element
   * @returns {HTMLElement} - Tooltip element
   */
  function ensureTooltipElement() {
    if (!tooltipElement) {
      tooltipElement = document.createElement('div');
      tooltipElement.id = 'provenance-tooltip';
      tooltipElement.className = 'provenance-tooltip';
      tooltipElement.setAttribute('role', 'tooltip');
      tooltipElement.setAttribute('aria-live', 'polite');
      document.body.appendChild(tooltipElement);
    }
    return tooltipElement;
  }

  /**
   * Position tooltip near target element
   * @param {HTMLElement} target - Target element to position near
   */
  function positionTooltip(target) {
    const tooltip = ensureTooltipElement();
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    
    // Default position: above the target
    let top = rect.top - tooltipRect.height - 12;
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    
    // Adjust if tooltip goes off screen
    if (top < 10) {
      // Position below if not enough space above
      top = rect.bottom + 12;
    }
    
    if (left < 10) {
      left = 10;
    } else if (left + tooltipRect.width > window.innerWidth - 10) {
      left = window.innerWidth - tooltipRect.width - 10;
    }
    
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  /**
   * Show tooltip for target element
   * @param {HTMLElement} target - Target element
   */
  function showTooltip(target) {
    // Clear any pending hide timeout
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    const provenanceData = target.dataset.provenance;
    if (!provenanceData) {
      return;
    }

    let provenance;
    try {
      provenance = JSON.parse(provenanceData);
    } catch (error) {
      console.error('[ProvenanceTooltip] Failed to parse provenance data:', error);
      return;
    }

    const tooltip = ensureTooltipElement();
    tooltip.innerHTML = buildTooltipContent(provenance);
    
    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
    
    // Position and show
    tooltip.classList.add('visible');
    positionTooltip(target);
    
    // Mark target as active
    if (activeTarget && activeTarget !== target) {
      activeTarget.classList.remove('provenance-active');
    }
    target.classList.add('provenance-active');
    activeTarget = target;
  }

  /**
   * Hide tooltip
   * @param {Boolean} immediate - Hide immediately without delay
   */
  function hideTooltip(immediate = false) {
    if (immediate) {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
      
      const tooltip = ensureTooltipElement();
      tooltip.classList.remove('visible');
      tooltip.innerHTML = '';
      
      if (activeTarget) {
        activeTarget.classList.remove('provenance-active');
        activeTarget = null;
      }
    } else {
      // Delay hiding to allow moving mouse to tooltip
      hideTimeout = setTimeout(() => {
        hideTooltip(true);
      }, 200);
    }
  }

  /**
   * Attach provenance data and handlers to element
   * @param {HTMLElement} element - Element to attach to (e.g., question ID badge)
   * @param {Object} provenance - Provenance data
   */
  function attachToElement(element, provenance) {
    if (!element || !provenance) {
      return;
    }

    // Store provenance data as JSON string
    element.dataset.provenance = JSON.stringify(provenance);
    
    // Add class for styling
    element.classList.add('has-provenance');
    
    // Add accessibility attributes
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-label', `View data source information for ${provenance.field}`);
    
    // Add icon indicator if not already present
    if (!element.querySelector('.provenance-indicator')) {
      const indicator = document.createElement('i');
      indicator.className = 'provenance-indicator';
      indicator.setAttribute('data-lucide', 'info');
      indicator.style.marginLeft = '4px';
      element.appendChild(indicator);
      
      // Initialize icon
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
    }
  }

  /**
   * Initialize tooltip event handlers
   * Should be called once on page load
   */
  function initialize() {
    console.log('[ProvenanceTooltip] Initializing event handlers');
    
    // Delegate events from document body
    document.body.addEventListener('mouseenter', (e) => {
      const target = e.target.closest('.has-provenance');
      if (target) {
        showTooltip(target);
      }
    }, true);

    document.body.addEventListener('mouseleave', (e) => {
      const target = e.target.closest('.has-provenance');
      if (target) {
        hideTooltip(false);
      }
    }, true);

    document.body.addEventListener('focus', (e) => {
      const target = e.target.closest('.has-provenance');
      if (target) {
        showTooltip(target);
      }
    }, true);

    document.body.addEventListener('blur', (e) => {
      const target = e.target.closest('.has-provenance');
      if (target) {
        hideTooltip(true);
      }
    }, true);

    // Touch support - tap to toggle tooltip
    document.body.addEventListener('touchstart', (e) => {
      const target = e.target.closest('.has-provenance');
      if (target) {
        // Only prevent default if we're actually showing/hiding tooltip
        // This allows normal scrolling when not interacting with provenance badges
        if (activeTarget === target || !activeTarget) {
          e.preventDefault();
          if (activeTarget === target) {
            hideTooltip(true);
          } else {
            showTooltip(target);
          }
        }
      }
    }, { passive: false }); // passive: false needed for preventDefault() to work

    // Prevent tooltip from hiding when hovering over it
    document.body.addEventListener('mouseenter', (e) => {
      if (e.target.closest('#provenance-tooltip')) {
        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = null;
        }
      }
    }, true);

    document.body.addEventListener('mouseleave', (e) => {
      if (e.target.closest('#provenance-tooltip')) {
        hideTooltip(false);
      }
    }, true);

    console.log('[ProvenanceTooltip] Event handlers initialized');
  }

  // Public API
  return {
    extractProvenance,
    attachToElement,
    initialize,
    showTooltip,
    hideTooltip
  };
})();
