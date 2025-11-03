/**
 * Smart Navigation System
 * Automatically hides the current page's navigation icon from the header
 * while keeping "Back to System Home" and "Back to Guide Menu" always visible
 * 
 * Usage: Include this script in any guide page header:
 * <script src="assets/js/smart-navigation.js"></script>
 */

(function() {
  'use strict';

  /**
   * List of all guide pages in the system
   * Add new guide pages here to include them in smart navigation
   */
  const GUIDE_PAGES = [
    'quick_start_guide.html',
    'user_guide_processor_setup.html',
    'user_guide_uploader.html',
    'user_guide_checking_system.html',
    'user_guide_conflicts.html',
    'user_guide_qualtrics.html'
  ];

  /**
   * Pages that should ALWAYS be visible in navigation
   * These links will never be hidden
   */
  const ALWAYS_VISIBLE_PAGES = [
    'index.html',           // Back to System Home
    'guide_homepage.html'   // Back to Guide Menu
  ];

  /**
   * Get the current page filename from the URL
   * @returns {string} Current page filename (e.g., "quick_start_guide.html")
   */
  function getCurrentPage() {
    const path = window.location.pathname;
    return path.split('/').pop() || 'index.html';
  }

  /**
   * Check if a link should always be visible
   * @param {string} href - The href attribute of the link
   * @returns {boolean} True if link should always be visible
   */
  function isAlwaysVisible(href) {
    return ALWAYS_VISIBLE_PAGES.some(page => href && href.includes(page));
  }

  /**
   * Hide navigation links that point to the current page
   * Keeps "Back to System Home" and "Back to Guide Menu" always visible
   */
  function hideCurrentPageNav() {
    const currentPage = getCurrentPage();
    
    // Only hide if current page is a guide page
    if (!GUIDE_PAGES.includes(currentPage)) {
      console.log(`[SmartNav] Current page "${currentPage}" is not a guide page, skipping`);
      return;
    }
    
    // Select all navigation links in the header
    const navLinks = document.querySelectorAll('header nav a, header .flex.items-center.gap-3 a');
    
    let hiddenCount = 0;
    navLinks.forEach(link => {
      const linkHref = link.getAttribute('href');
      
      // Skip if this is an always-visible link
      if (isAlwaysVisible(linkHref)) {
        return;
      }
      
      // Check if the link points to the current page
      if (linkHref && linkHref.includes(currentPage)) {
        link.style.display = 'none';
        hiddenCount++;
        console.log(`[SmartNav] Hidden navigation link to current page: ${linkHref}`);
      }
    });
    
    console.log(`[SmartNav] Processed navigation for "${currentPage}" - Hidden ${hiddenCount} link(s)`);
  }

  /**
   * Initialize smart navigation when DOM is ready
   */
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hideCurrentPageNav);
    } else {
      // DOM already loaded
      hideCurrentPageNav();
    }
  }

  // Run initialization
  init();
})();
