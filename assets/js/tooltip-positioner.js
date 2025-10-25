/**
 * Tooltip Positioner - Dynamic Tooltip Positioning with Viewport Edge Detection
 * 
 * Automatically adjusts tooltip positions to stay within viewport bounds.
 * Works with spotlight system to update cutouts when positions change.
 * 
 * Usage:
 *   const positioner = new TooltipPositioner({
 *     tooltipSelector: '.feature-tooltip',
 *     padding: 10
 *   });
 *   
 *   positioner.positionTooltip(tooltipElement, triggerElement);
 */

class TooltipPositioner {
  constructor(options = {}) {
    this.config = {
      tooltipSelector: options.tooltipSelector || '.feature-tooltip',
      padding: options.padding || 10,  // Padding from viewport edges
      arrowSize: options.arrowSize || 6,
      preferredPosition: options.preferredPosition || 'bottom'  // 'top', 'bottom', 'left', 'right'
    };
  }

  /**
   * Position tooltip relative to trigger element, avoiding viewport edges
   */
  positionTooltip(tooltip, trigger) {
    if (!tooltip || !trigger) return;

    // Guard: Don't reposition if already visible and positioned
    if (tooltip.style.visibility === 'visible' && tooltip.style.left && tooltip.style.left !== '0px') {
      return; // Already positioned, skip
    }

    const tooltipId = tooltip.id;

    // FIRST: Clear ALL positioning styles BEFORE showing tooltip
    tooltip.style.setProperty('transition', 'none', 'important');  // Override CSS !important
    tooltip.style.setProperty('animation', 'none', 'important');   // Override CSS !important fadeIn
    tooltip.style.position = 'absolute';   // KEEP absolute positioning
    tooltip.style.left = '';               // Clear left: 50% BEFORE display: block
    tooltip.style.right = '';
    tooltip.style.top = '';
    tooltip.style.bottom = '';
    tooltip.style.transform = '';          // Clear transform BEFORE display: block
    tooltip.style.whiteSpace = 'normal';   // Force text wrapping
    tooltip.style.maxWidth = '350px';      // Force max-width
    tooltip.style.wordWrap = 'break-word'; // Force word wrap
    
    // Show invisibly to measure (keep hidden AND off-screen during calculation)
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'block';
    tooltip.style.opacity = '0';  // Extra safety - completely transparent
    tooltip.style.pointerEvents = 'none';  // No mouse interaction during positioning
    
    // Force layout recalculation so tooltip can wrap
    tooltip.offsetHeight;  // Trigger reflow
    
    // NOW measure dimensions with proper wrapping applied
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // console.log('[TooltipPositioner] Viewport:', viewportWidth, 'Tooltip width after wrap:', tooltipWidth);

    // Calculate available space in each direction
    const spaceAbove = triggerRect.top;
    const spaceBelow = viewportHeight - triggerRect.bottom;

    // Determine best vertical position (top or bottom)
    let verticalPosition = 'bottom';
    if (spaceBelow < tooltipHeight + this.config.padding) {
      if (spaceAbove > spaceBelow) {
        verticalPosition = 'top';
      }
    }

    // Get parent positioning context for relative positioning
    const parent = tooltip.offsetParent || document.body;
    const parentRect = parent.getBoundingClientRect();
    
    // Position vertically (relative to parent, not viewport)
    if (verticalPosition === 'bottom') {
      const relativeTop = triggerRect.bottom - parentRect.top + this.config.arrowSize;
      if (isNaN(relativeTop) || relativeTop === undefined) {
        console.error('[TooltipPositioner] Invalid relativeTop:', relativeTop, 'trigger:', triggerRect, 'parent:', parentRect);
        tooltip.style.top = '100%'; // Fallback
      } else {
        tooltip.style.top = `${relativeTop}px`;
      }
      tooltip.style.bottom = '';
    } else {
      const relativeBottom = parentRect.bottom - triggerRect.top + this.config.arrowSize;
      if (isNaN(relativeBottom) || relativeBottom === undefined) {
        console.error('[TooltipPositioner] Invalid relativeBottom:', relativeBottom);
        tooltip.style.bottom = '100%'; // Fallback
      } else {
        tooltip.style.bottom = `${relativeBottom}px`;
      }
      tooltip.style.top = '';
    }

    // ANCHOR tooltip at button center, check parent bounds (not viewport!)
    const triggerCenter = triggerRect.left + triggerRect.width / 2;
    const triggerCenterRelative = triggerCenter - parentRect.left; // Relative to parent
    
    // Start centered on button (relative to parent)
    let left = triggerCenterRelative - (tooltipWidth / 2);
    let arrowPosition = tooltipWidth / 2; // Arrow at center of tooltip
    
    // Check if overflows PARENT right edge
    const rightEdgeRelative = left + tooltipWidth;
    const parentWidth = parentRect.width;
    if (rightEdgeRelative > parentWidth - this.config.padding) {
      const overflow = rightEdgeRelative - (parentWidth - this.config.padding);
      // console.log('[TooltipPositioner] Right overflow (parent):', overflow, 'px - shifting left');
      left -= overflow; // Shift tooltip left
      arrowPosition += overflow; // Arrow moves right relative to tooltip
    }
    
    // Check if overflows PARENT left edge
    if (left < this.config.padding) {
      const overflow = this.config.padding - left;
      // console.log('[TooltipPositioner] Left overflow (parent):', overflow, 'px - shifting right');
      left += overflow; // Shift tooltip right
      arrowPosition -= overflow; // Arrow moves left relative to tooltip
    }
    
    // Clamp to parent bounds
    if (left < 0) {
      arrowPosition += left;
      left = 0;
    }
    if (left + tooltipWidth > parentWidth) {
      const excess = (left + tooltipWidth) - parentWidth;
      left -= excess;
      arrowPosition += excess;
    }
    
    // Apply final position (relative to parent)
    tooltip.style.left = `${left}px`;
    tooltip.style.right = '';
    tooltip.style.transform = 'none';
    
    // Ensure tooltip stays visible (don't accidentally hide it)
    if (tooltip.style.display !== 'block') {
      console.warn('[TooltipPositioner] WARNING: Tooltip display was not block, fixing it');
      tooltip.style.display = 'block';
    }
    
    // Ensure high z-index
    tooltip.style.zIndex = '10003';
    
    // Update arrow to point at button center
    this._updateArrowPosition(tooltip, trigger, arrowPosition, verticalPosition);
    
    const t2 = performance.now();
    
    // Show tooltip: apply simple fade-in animation (opacity only, no transform)
    tooltip.style.setProperty('animation', 'simpleFadeIn 0.2s ease', 'important');  // Simple fade
    tooltip.style.setProperty('opacity', '1', 'important');         // End state: opacity 1
    tooltip.style.visibility = 'visible';                           // Make visible
    tooltip.style.pointerEvents = '';                               // Restore mouse events
    
    // Positioning complete - tooltip will now be visible with animation

    return {
      position: verticalPosition,
      left: left,
      top: parseFloat(tooltip.style.top) || null,
      bottom: parseFloat(tooltip.style.bottom) || null
    };
  }

  /**
   * Update arrow position to point at trigger
   */
  _updateArrowPosition(tooltip, trigger, arrowOffsetX, verticalPosition) {
    const arrow = tooltip.querySelector('[style*="border"]');
    if (!arrow) return;

    // Clamp arrow position to stay within tooltip bounds
    const minArrowPos = 12; // Padding from edge
    const maxArrowPos = tooltip.offsetWidth - 12;
    const clampedArrowPos = Math.max(minArrowPos, Math.min(maxArrowPos, arrowOffsetX));

    // Position arrow
    arrow.style.left = `${clampedArrowPos}px`;
    arrow.style.right = 'auto';
    arrow.style.transform = 'translateX(-50%)';

    // Flip arrow direction if needed
    if (verticalPosition === 'top') {
      arrow.style.top = 'auto';
      arrow.style.bottom = `${-this.config.arrowSize}px`;
      arrow.style.borderTop = `${this.config.arrowSize}px solid #1f2937`;
      arrow.style.borderBottom = 'none';
    } else {
      arrow.style.top = `${-this.config.arrowSize}px`;
      arrow.style.bottom = 'auto';
      arrow.style.borderBottom = `${this.config.arrowSize}px solid #1f2937`;
      arrow.style.borderTop = 'none';
    }
  }

  /**
   * Position all visible tooltips
   */
  positionAllTooltips() {
    const tooltips = document.querySelectorAll(`${this.config.tooltipSelector}[style*="display: block"]`);
    
    tooltips.forEach(tooltip => {
      // Skip if tooltip is not actually visible
      if (tooltip.style.display === 'none' || !tooltip.offsetParent) {
        return;
      }
      
      // Find the parent wrapper with the trigger element
      const wrapper = tooltip.closest('.interactive-btn-wrapper');
      if (wrapper) {
        // Find trigger - could be button OR div (help icon)
        const trigger = wrapper.querySelector('button') || wrapper.querySelector('[data-spotlight]');
        if (trigger) {
          this.positionTooltip(tooltip, trigger);
        }
      }
    });
  }

  /**
   * Auto-reposition on window resize
   */
  enableAutoReposition() {
    this.resizeHandler = () => {
      this.positionAllTooltips();
    };

    window.addEventListener('resize', this.resizeHandler);
  }

  /**
   * Disable auto-repositioning
   */
  disableAutoReposition() {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
  }
}

// Export for module usage or attach to window for global access
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TooltipPositioner;
} else {
  window.TooltipPositioner = TooltipPositioner;
}
