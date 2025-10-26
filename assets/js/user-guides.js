// User Guide JavaScript - Shared across all guides

document.addEventListener('DOMContentLoaded', () => {
  // Initialize collapsible sections
  initCollapsibles();
  
  // Initialize table of contents navigation
  initTOC();
  
  // Initialize smooth scrolling
  initSmoothScroll();
  
  // Initialize responsive sidebar
  initResponsiveSidebar();
});

// Responsive sidebar toggle
function initResponsiveSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  // Create toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'sidebar-toggle';
  toggleBtn.setAttribute('aria-label', 'Toggle table of contents');
  toggleBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="3" y1="12" x2="21" y2="12"></line>
      <line x1="3" y1="6" x2="21" y2="6"></line>
      <line x1="3" y1="18" x2="21" y2="18"></line>
    </svg>
  `;

  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';

  // Insert elements
  document.body.appendChild(toggleBtn);
  document.body.appendChild(overlay);

  // Toggle sidebar
  function toggleSidebar() {
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
  }

  toggleBtn.addEventListener('click', toggleSidebar);
  overlay.addEventListener('click', toggleSidebar);

  // Close sidebar when clicking a TOC link
  document.querySelectorAll('.toc-link').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 1024) {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
      }
    });
  });

  // Close sidebar on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('active')) {
      sidebar.classList.remove('active');
      overlay.classList.remove('active');
    }
  });
}

// Collapsible sections
function initCollapsibles() {
  document.querySelectorAll('.collapsible-header').forEach(header => {
    header.addEventListener('click', () => {
      const content = header.nextElementSibling;
      const arrow = header.querySelector('.arrow');
      
      content.classList.toggle('active');
      if (arrow) {
        arrow.textContent = content.classList.contains('active') ? '▲' : '▼';
      }
    });
  });

  // Open first collapsible by default in each section
  const firstCollapsible = document.querySelector('.collapsible-content');
  if (firstCollapsible) {
    firstCollapsible.classList.add('active');
    const arrow = firstCollapsible.previousElementSibling.querySelector('.arrow');
    if (arrow) arrow.textContent = '▲';
  }
}

// Table of Contents navigation with improved highlighting
function initTOC() {
  const sections = document.querySelectorAll('.content-section');
  const tocLinks = document.querySelectorAll('.toc-link');

  if (sections.length === 0 || tocLinks.length === 0) return;

  // Update active link on scroll with better accuracy
  function updateActiveTOC() {
    // Get current scroll position
    const scrollPosition = window.scrollY + 150; // Offset for header

    let currentSection = '';
    
    // Find which section we're currently in
    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      const sectionBottom = sectionTop + section.offsetHeight;
      
      if (scrollPosition >= sectionTop && scrollPosition < sectionBottom) {
        currentSection = section.getAttribute('id');
      }
    });

    // Update TOC links
    tocLinks.forEach(link => {
      link.classList.remove('active');
      const href = link.getAttribute('href');
      if (href === `#${currentSection}`) {
        link.classList.add('active');
        
        // Scroll the sidebar to show the active link
        const sidebar = link.closest('.sidebar');
        if (sidebar && link.offsetParent) {
          const linkTop = link.offsetTop;
          const sidebarScroll = sidebar.scrollTop;
          const sidebarHeight = sidebar.clientHeight;
          
          if (linkTop < sidebarScroll || linkTop > sidebarScroll + sidebarHeight - 100) {
            sidebar.scrollTo({
              top: linkTop - 100,
              behavior: 'smooth'
            });
          }
        }
      }
    });
  }

  // Throttle scroll event for performance
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    if (scrollTimeout) {
      window.cancelAnimationFrame(scrollTimeout);
    }
    scrollTimeout = window.requestAnimationFrame(() => {
      updateActiveTOC();
    });
  });

  // Initial update
  updateActiveTOC();
}

// Smooth scrolling for anchor links - jump to section headers
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href');
      if (targetId === '#') return;
      
      e.preventDefault();
      const targetSection = document.querySelector(targetId);
      if (targetSection) {
        // Calculate offset for sticky header
        const headerOffset = 80; // Adjust based on your header height
        const elementPosition = targetSection.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });

        // Update URL without jumping
        if (history.pushState) {
          history.pushState(null, null, targetId);
        }
      }
    });
  });
}

// Print functionality
function printGuide() {
  window.print();
}

// Search functionality (basic)
function searchGuide(query) {
  if (!query) {
    document.querySelectorAll('.content-section').forEach(section => {
      section.style.display = '';
    });
    return;
  }

  const lowerQuery = query.toLowerCase();
  document.querySelectorAll('.content-section').forEach(section => {
    const text = section.textContent.toLowerCase();
    section.style.display = text.includes(lowerQuery) ? '' : 'none';
  });
}
