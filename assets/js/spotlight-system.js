/**
 * Spotlight System - Reusable Modal Spotlight with SVG Mask Cutouts
 * 
 * Creates a dimmed overlay with precise cutouts around specified elements,
 * dynamically updates for tooltips, and adapts to viewport changes.
 * 
 * Usage:
 *   const spotlight = new SpotlightSystem({
 *     overlaySelector: '#modalOverlay',
 *     targets: '[data-spotlight="button"], [data-spotlight="help"]',
 *     closeButton: '[data-spotlight="close"]',
 *     modalSelector: '#myModal',
 *     padding: 14,
 *     dimOpacity: 0.55
 *   });
 *   
 *   spotlight.enable();
 *   spotlight.disable();
 */

class SpotlightSystem {
  constructor(options = {}) {
    // Configuration
    this.config = {
      overlaySelector: options.overlaySelector || '#modalOverlay',
      targets: options.targets || '[data-spotlight="button"], [data-spotlight="help"]',
      closeButton: options.closeButton || '[data-spotlight="close"]',
      modalSelector: options.modalSelector || '#homepageModal',
      padding: options.padding || 14,
      dimOpacity: options.dimOpacity || 0.55,
      tooltipSelector: options.tooltipSelector || '.feature-tooltip[style*="display: block"]',
      updateInterval: options.updateInterval || 200
    };

    // State
    this.svg = null;
    this.mask = null;
    this.cleanupFn = null;
    this.updateHolesFn = null;
    this.intervalId = null;
  }

  /**
   * Enable spotlight effect
   */
  enable() {
    const modal = document.querySelector(this.config.modalSelector);
    const overlay = document.querySelector(this.config.overlaySelector);
    
    if (!modal || !overlay) {
      console.error('[SpotlightSystem] Modal or overlay element not found');
      return;
    }

    // Show spotlight immediately (no delay)
    modal.classList.add('spotlight-active');
    
    // Get spotlight targets
    const targets = modal.querySelectorAll(this.config.targets);
    const closeBtn = modal.querySelector(this.config.closeButton);
    
    if (closeBtn) {
      closeBtn.classList.add('spotlight-static');
    }

    // Apply spotlight highlight classes
    targets.forEach(target => {
      const spotlightType = target.getAttribute('data-spotlight');
      if (spotlightType === 'help') {
        target.classList.add('spotlight-highlight', 'help-icon-highlight');
      } else {
        target.classList.add('spotlight-highlight');
      }
    });

    // Create SVG mask immediately
    this._createSVGMask(overlay, modal, targets);
  }

  /**
   * Disable spotlight effect
   */
  disable() {
    const modal = document.querySelector(this.config.modalSelector);
    
    if (!modal) return;

    modal.classList.remove('spotlight-active');
    
    // Remove classes
    modal.querySelectorAll('.spotlight-highlight').forEach(el => {
      el.classList.remove('spotlight-highlight', 'help-icon-highlight');
    });
    
    modal.querySelectorAll('.spotlight-static').forEach(el => {
      el.classList.remove('spotlight-static');
    });

    // Cleanup
    if (this.cleanupFn) {
      this.cleanupFn();
      this.cleanupFn = null;
    }

    // Clear global reference
    this.updateHolesFn = null;
  }

  /**
   * Create SVG mask with cutouts
   */
  _createSVGMask(overlay, modal, targets) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 10000;
      pointer-events: none;
    `;

    // Create mask
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
    mask.setAttribute('id', 'spotlight-mask');

    // White background = show dim everywhere
    const maskBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    maskBg.setAttribute('width', '100%');
    maskBg.setAttribute('height', '100%');
    maskBg.setAttribute('fill', 'white');
    mask.appendChild(maskBg);

    // Black holes at button positions = hide dim (create cutouts)
    targets.forEach(target => {
      const rect = target.getBoundingClientRect();
      const spotlightType = target.getAttribute('data-spotlight');
      const isCircular = spotlightType === 'help';

      const hole = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hole.setAttribute('x', rect.left - this.config.padding);
      hole.setAttribute('y', rect.top - this.config.padding);
      hole.setAttribute('width', rect.width + this.config.padding * 2);
      hole.setAttribute('height', rect.height + this.config.padding * 2);
      hole.setAttribute('rx', isCircular ? 999 : 24);
      hole.setAttribute('fill', 'black');
      mask.appendChild(hole);
    });

    defs.appendChild(mask);
    svg.appendChild(defs);

    // Dim rectangle with mask applied
    const dimRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    dimRect.setAttribute('width', '100%');
    dimRect.setAttribute('height', '100%');
    dimRect.setAttribute('fill', `rgba(0, 0, 0, ${this.config.dimOpacity})`);
    dimRect.setAttribute('mask', 'url(#spotlight-mask)');
    svg.appendChild(dimRect);

    overlay.appendChild(svg);

    // Store references
    this.svg = svg;
    this.mask = mask;

    // Setup dynamic updates
    this._setupDynamicUpdates(modal, targets, mask);
  }

  /**
   * Setup dynamic hole position updates
   */
  _setupDynamicUpdates(modal, targets, mask) {
    const updateHolePositions = () => {
      // Remove all holes except background
      const existingHoles = mask.querySelectorAll('rect:not(:first-child)');
      existingHoles.forEach(h => h.remove());

      // Add holes for buttons
      targets.forEach(target => {
        const rect = target.getBoundingClientRect();
        const spotlightType = target.getAttribute('data-spotlight');
        const isCircular = spotlightType === 'help';

        const hole = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        hole.setAttribute('x', rect.left - this.config.padding);
        hole.setAttribute('y', rect.top - this.config.padding);
        hole.setAttribute('width', rect.width + this.config.padding * 2);
        hole.setAttribute('height', rect.height + this.config.padding * 2);
        hole.setAttribute('rx', isCircular ? 999 : 24);
        hole.setAttribute('fill', 'black');
        mask.appendChild(hole);
      });

      // Add holes for visible tooltips (no padding for clean edges)
      const visibleTooltips = modal.querySelectorAll('.feature-tooltip');
      visibleTooltips.forEach(tooltip => {
        // Only process if actually visible (computed style check)
        if (tooltip.offsetParent === null || window.getComputedStyle(tooltip).display === 'none') {
          return;
        }
        
        const rect = tooltip.getBoundingClientRect();
        const hole = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        hole.setAttribute('x', rect.left);
        hole.setAttribute('y', rect.top);
        hole.setAttribute('width', rect.width);
        hole.setAttribute('height', rect.height);
        hole.setAttribute('rx', 8);
        hole.setAttribute('fill', 'black');
        mask.appendChild(hole);
      });
    };

    const scrollHandler = () => updateHolePositions();
    const resizeHandler = () => updateHolePositions();

    modal.addEventListener('scroll', scrollHandler);
    window.addEventListener('resize', resizeHandler);

    // Store global reference for instant updates from toggleTooltip
    this.updateHolesFn = updateHolePositions;

    // Check for tooltip visibility changes periodically
    this.intervalId = setInterval(() => {
      updateHolePositions();
    }, this.config.updateInterval);

    // Cleanup function
    this.cleanupFn = () => {
      modal.removeEventListener('scroll', scrollHandler);
      window.removeEventListener('resize', resizeHandler);
      clearInterval(this.intervalId);
      if (this.svg) this.svg.remove();
    };
  }

  /**
   * Manually trigger hole position update (for instant tooltip updates)
   */
  updateHoles() {
    if (this.updateHolesFn) {
      // Use double rAF to ensure layout is complete
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Don't reposition tooltips - they're positioned once on show
          // Repositioning causes duplicate calls and visual jumps
          // if (window.tooltipPositioner) {
          //   window.tooltipPositioner.positionAllTooltips();
          // }
          this.updateHolesFn();
        });
      });
    }
  }
}

// Export for module usage or attach to window for global access
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpotlightSystem;
} else {
  window.SpotlightSystem = SpotlightSystem;
}
