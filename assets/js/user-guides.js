// User Guide JavaScript - Shared across all guides

document.addEventListener('DOMContentLoaded', () => {
  // Initialize collapsible sections
  initCollapsibles();
  
  // Initialize table of contents navigation
  initTOC();
  
  // Initialize smooth scrolling
  initSmoothScroll();
});

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

// Table of Contents navigation
function initTOC() {
  const sections = document.querySelectorAll('.content-section');
  const tocLinks = document.querySelectorAll('.toc-link');

  // Update active link on scroll
  window.addEventListener('scroll', () => {
    let current = '';
    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      if (window.scrollY >= (sectionTop - 100)) {
        current = section.getAttribute('id');
      }
    });

    tocLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${current}`) {
        link.classList.add('active');
      }
    });
  });
}

// Smooth scrolling for anchor links
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href');
      if (targetId === '#') return;
      
      e.preventDefault();
      const targetSection = document.querySelector(targetId);
      if (targetSection) {
        targetSection.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'start' 
        });
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
