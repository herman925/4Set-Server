# User Guide System Design Specification

**Version:** 1.0  
**Last Updated:** October 27, 2025  
**Purpose:** Document the design patterns, components, and implementation details of the 4Set user guide system

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Spotlight System](#spotlight-system)
4. [Modal System](#modal-system)
5. [Tooltip System](#tooltip-system)
6. [Interactive Elements](#interactive-elements)
7. [Z-Index Management](#z-index-management)
8. [Styling Guidelines](#styling-guidelines)
9. [Implementation Examples](#implementation-examples)
10. [Best Practices](#best-practices)

---

## Overview

The 4Set user guide system provides an interactive learning experience through a combination of modals, tooltips, and a spotlight effect that draws attention to key UI elements. This document defines the technical specifications and design patterns used across all guide pages.

### Core Components

1. **Spotlight System** - Dynamic SVG-based masking that highlights specific UI elements
2. **Modal System** - Expandable previews showing 1:1 replicas of system interfaces
3. **Tooltip System** - Contextual information triggered by user interaction
4. **Interactive Elements** - Buttons, badges, and cards that respond to user actions

### Guide Pages

- `quick_start_guide.html` - Introduction to the 4Set system
- `user_guide_checking_system.html` - Checking system detailed guide
- `user_guide_uploader.html` - Assessment uploader guide
- `user_guide_qualtrics.html` - Qualtrics/TGMD integration guide
- `user_guide_conflicts.html` - Data conflicts resolution guide
- `guide_homepage.html` - Guide navigation hub

---

## Architecture

### **⭐ Golden Rule: Use the Flat Hierarchy Pattern**

**All modals MUST follow the pattern from `quick_start_guide.html` to avoid z-index issues.**

This is the **single source of truth** for modal implementation. The pattern solves all common z-index stacking context problems by using a flat hierarchy where the close button, overlay, and content are siblings rather than nested.

**Visual Hierarchy:**
```
Modal Backdrop (fixed fullscreen with padding)
  └─ Content Wrapper (centered, provides positioning context)
       ├─ Spotlight Overlay (fixed, fullscreen, pointer-events: none, z-index: 10000)
       ├─ Close Button (absolute, top: -12px, right: -12px, z-index: 10003)
       └─ Scrollable Content (relative, z-index: 10)
```

**Why This Pattern Works:**
1. **No nesting conflicts** - Close button is sibling to content, not child
2. **Simple z-index** - Linear hierarchy without stacking contexts
3. **Always visible** - Button positioned outside content box, no scrolling needed
4. **Spotlight compatible** - Overlay and targets are properly separated
5. **Universal compatibility** - Works across all browsers and screen sizes

**Reference Implementation:**  
See `quick_start_guide.html` lines 2112-2125 for the canonical example.

---

### File Structure

```
/
├── assets/
│   ├── css/
│   │   ├── spotlight-system.css      # Spotlight effect styles
│   │   ├── tooltip-styles.css        # Tooltip positioning and appearance
│   │   ├── user-guides.css           # Shared guide page styles
│   │   ├── theme_pantone_light_1.css # Color theme
│   │   └── global.css                # Global styles
│   └── js/
│       └── spotlight-system.js       # Spotlight implementation
├── PRDs/
│   ├── guideline_prd.md             # This document
│   └── [other PRD files]
└── [guide HTML files]
```

### Dependencies

All guide pages include the following dependencies in order:

```html
<script src="https://cdn.tailwindcss.com"></script>
<script src="assets/js/tailwind.config.js"></script>
<link rel="stylesheet" href="assets/css/theme_pantone_light_1.css">
<link rel="stylesheet" href="assets/css/global.css">
<link rel="stylesheet" href="assets/css/user-guides.css">
<link rel="stylesheet" href="assets/css/spotlight-system.css">
<link rel="stylesheet" href="assets/css/tooltip-styles.css">
```

---

## Spotlight System

The spotlight system creates a dimmed overlay with precise cutouts around interactive elements, drawing user attention to specific features.

### Technical Implementation

**File:** `assets/js/spotlight-system.js`

The `SpotlightSystem` class uses SVG masking to create dynamic cutouts:

```javascript
const spotlight = new SpotlightSystem({
  overlaySelector: '#modalOverlay',
  targets: '[data-spotlight="button"], [data-spotlight="help"]',
  closeButton: '[data-spotlight="close"]',
  modalSelector: '#homepageModal',
  padding: 14,
  dimOpacity: 0.55
});

spotlight.enable();  // Activate spotlight
spotlight.disable(); // Deactivate spotlight
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `overlaySelector` | string | `'#modalOverlay'` | CSS selector for overlay container |
| `targets` | string | `'[data-spotlight="button"]'` | CSS selector for highlighted elements |
| `closeButton` | string | `'[data-spotlight="close"]'` | CSS selector for close button |
| `modalSelector` | string | `'#homepageModal'` | CSS selector for modal container |
| `padding` | number | `14` | Pixels of padding around cutouts |
| `dimOpacity` | number | `0.55` | Opacity of dimmed areas (0-1) |
| `tooltipSelector` | string | `'.feature-tooltip'` | CSS selector for tooltips |
| `updateInterval` | number | `200` | Milliseconds between position updates |

### Data Attributes

Elements use `data-spotlight` attributes to specify their role:

- `data-spotlight="button"` - Interactive button (rectangular cutout)
- `data-spotlight="help"` - Help icon (circular cutout)
- `data-spotlight="close"` - Close button (static z-index)
- `data-spotlight-[modal]="[type]"` - Modal-specific spotlight targets

**Example:**
```html
<button data-spotlight="button" class="primary-button">
  Assessment Uploader
</button>

<div data-spotlight="help" class="help-icon">?</div>

<button data-spotlight="close" onclick="closeModal()">×</button>
```

### SVG Mask Mechanism

The spotlight system creates an SVG mask with:

1. **White background** - Full-screen rectangle (shows dim overlay everywhere)
2. **Black rectangles** - Positioned over target elements (creates transparent cutouts)
3. **Dynamic updates** - Repositions cutouts on scroll, resize, and tooltip changes

**Cutout shapes:**
- Buttons: Rounded rectangles (`rx="24"`)
- Help icons: Circles (`rx="999"`)
- Tooltips: Small rounded rectangles (`rx="8"`)

### Lifecycle

1. **Enable**: Called when modal opens
   - Adds `spotlight-active` class to modal
   - Applies `spotlight-highlight` to target elements
   - Applies `spotlight-static` to close button
   - Creates SVG mask overlay
   - Sets up event listeners (scroll, resize, tooltip changes)

2. **Update**: Triggered by events
   - Scroll: Recalculates cutout positions
   - Resize: Adjusts for viewport changes
   - Tooltip toggle: Adds/removes tooltip cutouts
   - Interval: Checks for visibility changes every 200ms

3. **Disable**: Called when modal closes
   - Removes all spotlight classes
   - Removes event listeners
   - Removes SVG from DOM
   - Clears interval timer

---

## Modal System

Modals display enlarged, interactive replicas of system interfaces with consistent structure and behavior.

### Standard Modal Structure

**BEST PRACTICE** (from `quick_start_guide.html`):

The optimal modal structure uses a **flat hierarchy** to avoid z-index stacking context issues. Key points:

1. **Modal backdrop** - Fixed fullscreen container with padding
2. **Content wrapper** - Centered with relative positioning (NOT the backdrop itself)
3. **Spotlight overlay** - Sibling to close button, inside content wrapper
4. **Close button** - Positioned absolutely, OUTSIDE the scrollable content
5. **Scrollable content** - Separate container with overflow handling

```html
<!-- Modal Backdrop - Fixed fullscreen with padding for centering -->
<div id="homepageModal" style="display: none; position: fixed; inset: 0; z-index: 9999; padding: 2rem; overflow-y: auto;">
  
  <!-- Content Wrapper - Centered, provides positioning context -->
  <div style="max-width: 1400px; margin: 0 auto; position: relative; z-index: 2;">
    
    <!-- Spotlight Overlay - Fixed, covers entire screen, pointer-events disabled -->
    <div id="modalOverlay" style="position: fixed; inset: 0; pointer-events: none; z-index: 10000;"></div>
    
    <!-- Close Button - OUTSIDE scrollable content, positioned absolutely -->
    <button 
      data-spotlight="close" 
      onclick="closeHomepageModal()" 
      style="position: absolute; top: -12px; right: -12px; width: 48px; height: 48px; background-color: white; border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; z-index: 10003;"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
      </svg>
    </button>
    
    <!-- Scrollable Content Container -->
    <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.4); overflow: hidden; position: relative; z-index: 10;">
      <!-- All modal content goes here -->
      <!-- No sticky header needed - close button always visible -->
    </div>
  </div>
</div>
```

**Why This Works:**

✅ **Close button positioning** - Positioned relative to content wrapper, appears OUTSIDE the scrollable area  
✅ **No stacking context issues** - Close button is sibling to content, not nested inside it  
✅ **Always visible** - No need for sticky positioning, button floats above content  
✅ **Clean z-index hierarchy** - Simple layering without complex nesting  
✅ **Spotlight compatible** - Overlay and close button are properly separated  

**Key Differences from Problematic Patterns:**

❌ **Old way** - Close button inside scrollable container → gets cut off  
❌ **Old way** - Close button inside sticky header → z-index conflicts  
❌ **Old way** - Modal uses flex centering → complicates positioning  

✅ **New way** - Backdrop handles scrolling, content wrapper provides positioning context  
✅ **New way** - Close button is absolutely positioned at `-12px, -12px` (outside content box)  
✅ **New way** - Uses padding on backdrop for centering instead of flexbox

### Modal JavaScript Pattern

```javascript
// Open modal function
function openModal() {
  const modal = document.getElementById('modalId');
  modal.style.display = 'flex';
  
  // Initialize spotlight
  if (typeof SpotlightSystem !== 'undefined') {
    window.modalSpotlight = new SpotlightSystem({
      overlaySelector: '#modalOverlay',
      targets: '[data-spotlight="button"]',
      closeButton: '[data-spotlight="close"]',
      modalSelector: '#modalId',
      padding: 14,
      dimOpacity: 0.55
    });
    window.modalSpotlight.enable();
  }
}

// Close modal function
function closeModal() {
  const modal = document.getElementById('modalId');
  modal.style.display = 'none';
  
  // Cleanup spotlight
  if (window.modalSpotlight) {
    window.modalSpotlight.disable();
    window.modalSpotlight = null;
  }
}

// ESC key handler
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('modalId')?.style.display === 'flex') {
    closeModal();
  }
});

// Click outside to close
document.getElementById('modalId')?.addEventListener('click', function(e) {
  if (e.target === this) {
    closeModal();
  }
});
```

### "See More" Button Pattern

Used to trigger modal opening from preview sections:

```html
<button 
  class="homepage-enlarge-btn" 
  onclick="openModal()"
  style="position: absolute; top: 12px; right: 12px; z-index: 50; background-color: rgba(43, 57, 144, 0.95); color: white; padding: 8px 16px; border-radius: 8px; font-size: 14px; font-weight: 600; box-shadow: 0 4px 12px rgba(0,0,0,0.2); opacity: 0; transition: opacity 0.2s ease; cursor: pointer; border: none;"
  title="See More"
>
  <span style="display: flex; align-items: center; gap: 6px;">
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>
    </svg>
    See More
  </span>
</button>
```

**Hover behavior:**
- Opacity changes from `0` to `1` when parent container is hovered
- Managed by CSS class `.homepage-layout-preview-container:hover .homepage-enlarge-btn`

---

## Tooltip System

Tooltips provide contextual information when users interact with spotlight-highlighted elements.

### Tooltip HTML Structure

```html
<div class="interactive-btn-wrapper" style="position: relative;">
  <!-- Trigger element -->
  <button data-spotlight="button" onclick="toggleTooltip('tooltip-id')">
    Interactive Element
  </button>
  
  <!-- Tooltip (hidden by default) -->
  <div id="tooltip-id" class="feature-tooltip" style="display: none;">
    <div style="font-weight: 600; margin-bottom: 4px;">Tooltip Title</div>
    <div style="font-size: 13px; opacity: 0.9;">Tooltip description text</div>
    <!-- Arrow pointing up -->
    <div style="position: absolute; top: -6px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 6px solid #1f2937;"></div>
  </div>
</div>
```

### Tooltip Toggle Function

```javascript
function toggleTooltip(tooltipId) {
  const tooltip = document.getElementById(tooltipId);
  if (!tooltip) return;
  
  const isVisible = tooltip.style.display === 'block';
  
  // Hide all other tooltips first
  document.querySelectorAll('.feature-tooltip').forEach(t => {
    if (t.id !== tooltipId) {
      t.style.display = 'none';
    }
  });
  
  // Toggle current tooltip
  tooltip.style.display = isVisible ? 'none' : 'block';
  
  // Update spotlight cutouts immediately
  if (window.modalSpotlight && window.modalSpotlight.updateHoles) {
    window.modalSpotlight.updateHoles();
  }
}
```

### Tooltip Styling

**File:** `assets/css/tooltip-styles.css`

```css
.feature-tooltip {
  position: absolute;
  top: calc(100% + 12px);
  left: 50%;
  transform: translateX(-50%);
  background-color: #1f2937;
  color: white;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 10003 !important;
  pointer-events: none;
}
```

---

## Interactive Elements

### Button Types

**Primary Action Buttons:**
```html
<button class="px-6 py-3 text-base font-semibold" 
  style="background-color: #2b3990; color: #ffffff; box-shadow: 0 6px 16px -6px rgba(43, 57, 144, 0.55); border-radius: 1rem; transition: transform 0.25s ease, box-shadow 0.25s ease; cursor: pointer;"
  data-spotlight="button"
  onclick="toggleTooltip('tooltip-id')">
  Button Text
</button>
```

**Secondary Action Buttons:**
```html
<button class="px-6 py-3 text-base font-semibold" 
  style="background-color: #f99d33; color: #3b2a12; box-shadow: 0 6px 16px -6px rgba(249, 157, 51, 0.55); border-radius: 1rem; transition: transform 0.25s ease, box-shadow 0.25s ease; cursor: pointer;"
  data-spotlight="button"
  onclick="toggleTooltip('tooltip-id')">
  Button Text
</button>
```

**Help Icons:**
```html
<div class="inline-flex items-center justify-center rounded-full" 
  style="width: 48px; height: 48px; background-color: #f3f4f6; color: #374151; cursor: pointer;"
  data-spotlight="help"
  onclick="toggleTooltip('tooltip-help')">
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="10"></circle>
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
    <line x1="12" y1="17" x2="12.01" y2="17"></line>
  </svg>
</div>
```

### Status Badges

Used to show system states (PC number, upload destination, cache status, etc.):

```html
<!-- Not Set / Error State -->
<button class="px-6 py-3 rounded-full bg-red-100 text-red-700 font-bold border-3 border-red-300"
  data-spotlight="button">
  ⚠️ Status: Not Set
</button>

<!-- Warning State -->
<button class="px-6 py-3 rounded-full bg-yellow-100 text-yellow-700 font-bold border-3 border-yellow-300"
  data-spotlight="button">
  ⚠️ Status: Warning
</button>

<!-- Success State -->
<button class="px-6 py-3 rounded-full bg-green-100 text-green-700 font-bold border-3 border-green-300"
  data-spotlight="button">
  ✅ Status: Ready
</button>
```

### Interactive Wrappers

All interactive elements with tooltips must be wrapped:

```html
<div class="interactive-btn-wrapper" style="position: relative;">
  <!-- Element + Tooltip -->
</div>
```

This ensures:
- Proper tooltip positioning
- Correct event handling
- Spotlight cutout alignment

---

## Z-Index Management

**Critical requirement:** Proper z-index layering prevents visual issues where close buttons or tooltips appear cut off.

### Z-Index Hierarchy

| Layer | Z-Index | Purpose | CSS Class/Inline Style |
|-------|---------|---------|----------------------|
| Modal backdrop | 9999 | Modal background overlay | `.z-[9999]` |
| Modal overlay (spotlight) | 10000 | SVG mask overlay | `#modalOverlay` (inline: 10000) |
| Spotlight targets | 10001 | Highlighted elements | `.spotlight-highlight` |
| Modal content | 10002 | Modal container | `.z-[10002]` |
| Close button | 10003 | Always visible | `style="z-index: 10003;"` |
| Tooltips | 10003 | Always visible | `.feature-tooltip` |

### **CRITICAL:** Close Button Positioning

The close button must be positioned **outside and before** the scrollable content container to avoid z-index stacking context issues.

✅ **CORRECT Pattern** (from `quick_start_guide.html`):

```html
<div id="homepageModal" style="display: none; position: fixed; inset: 0; z-index: 9999; padding: 2rem; overflow-y: auto;">
  <div style="max-width: 1400px; margin: 0 auto; position: relative; z-index: 2;">
    
    <!-- Spotlight overlay - sibling to close button -->
    <div id="modalOverlay" style="position: fixed; inset: 0; pointer-events: none; z-index: 10000;"></div>
    
    <!-- Close button - OUTSIDE scrollable content, positioned absolutely at top-right -->
    <button 
      data-spotlight="close" 
      onclick="closeModal()" 
      style="position: absolute; top: -12px; right: -12px; width: 48px; height: 48px; background-color: white; border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; z-index: 10003;">
      <svg>...</svg>
    </button>
    
    <!-- Scrollable content - close button floats above this -->
    <div style="background: ...; border-radius: 12px; box-shadow: ...; overflow: hidden; position: relative; z-index: 10;">
      <!-- Modal content here -->
    </div>
  </div>
</div>
```

**Key positioning details:**
- `top: -12px; right: -12px` → Button appears **outside** the content box (12px above and to the right)
- `position: absolute` → Positioned relative to content wrapper
- `width: 48px; height: 48px` → Circular button with adequate touch target
- `border-radius: 50%` → Perfect circle
- `background-color: white` → Visible against any background
- `z-index: 10003` → Above overlay (10000) and content (10)

❌ **WRONG** - Close button inside sticky header (gets cut off by stacking context):

```html
<div class="modal-content relative z-[10002]">
  <div class="sticky top-0 ... z-10">
    <button onclick="closeModal()">×</button> <!-- WRONG! Hidden by parent z-index -->
  </div>
</div>
```

❌ **WRONG** - Close button inside scrollable container (gets scrolled away):

```html
<div class="overflow-y-auto">
  <button class="absolute top-4 right-4">×</button> <!-- WRONG! Scrolls with content -->
  <div>Long content...</div>
</div>
```

❌ **WRONG** - Close button as child of flex-centered modal (positioning issues):

```html
<div class="flex items-center justify-center">
  <div class="modal-content">
    <button class="absolute top-4 right-4">×</button> <!-- WRONG! Positioning context unclear -->
  </div>
</div>
```

### Verification Checklist

For each modal, verify the **flat hierarchy pattern** (quick_start_guide.html style):

**Structure:**
- [ ] Modal backdrop uses `position: fixed; inset: 0; padding: 2rem; overflow-y: auto`
- [ ] Content wrapper uses `max-width` with `margin: 0 auto` for centering
- [ ] Content wrapper has `position: relative` for absolute positioning context
- [ ] Spotlight overlay is sibling to close button (not parent/child)
- [ ] Close button is sibling to scrollable content (not nested inside)

**Close Button:**
- [ ] Close button positioned `top: -12px; right: -12px` (outside content box)
- [ ] Close button has `z-index: 10003` (inline style, no need for class)
- [ ] Close button uses `position: absolute` relative to content wrapper
- [ ] Close button has `data-spotlight="close"` attribute
- [ ] Close button is circular: `width: 48px; height: 48px; border-radius: 50%`
- [ ] Close button has white background for visibility

**Overlay:**
- [ ] Overlay has unique ID for spotlight targeting (e.g., `#modalOverlay`)
- [ ] Overlay uses `position: fixed; inset: 0` (fullscreen)
- [ ] Overlay has `pointer-events: none` (allows clicks through to content)
- [ ] Overlay has `z-index: 10000` (below close button, above content)

**Content:**
- [ ] Scrollable content has `overflow: hidden` (not `overflow-y: auto`)
- [ ] Scrolling handled by backdrop container, not content
- [ ] Interactive elements have `data-spotlight="button"` or `data-spotlight="help"`
- [ ] No sticky headers needed (close button always visible)

**Common Mistakes to Avoid:**
- ❌ Using flexbox centering on backdrop (complicates positioning)
- ❌ Putting close button inside scrollable content
- ❌ Putting close button inside sticky header
- ❌ Using `z-[10003]` class instead of inline `z-index: 10003`
- ❌ Nesting overlay as parent of close button

---

## Styling Guidelines

### Color Palette

**Primary colors** (from `theme_pantone_light_1.css`):
- Primary: `#2b3990` (Dark blue)
- Secondary: `#f99d33` (Orange)
- Success: `#4CAF50` (Green)
- Warning: `#FFD54F` (Yellow)
- Error: `#E57373` (Red)

**UI colors:**
- Gray backgrounds: `#f3f4f6`, `#e9ecef`
- Text: `#374151` (dark), `#6b7280` (medium), `#9ca3af` (light)
- Borders: `#d1d5db`

### Typography

```css
font-family: 'Inter', sans-serif;        /* Body text */
font-family: 'JetBrains Mono', monospace; /* Code/technical */
```

**Font sizes:**
- Heading 1: `text-3xl` (30px)
- Heading 2: `text-2xl` (24px)
- Heading 3: `text-xl` (20px)
- Body: `text-base` (16px)
- Small: `text-sm` (14px)
- Tiny: `text-xs` (12px)

### Rounded Corners

- Buttons: `border-radius: 1rem` (16px)
- Modals: `rounded-2xl` (16px)
- Cards: `rounded-lg` (8px)
- Badges: `rounded-full` (pill shape)
- Tooltips: `border-radius: 8px`

### Shadows

- Modal: `box-shadow: 0 20px 60px rgba(0,0,0,0.4);`
- Button: `box-shadow: 0 6px 16px -6px rgba(43, 57, 144, 0.55);`
- Tooltip: `box-shadow: 0 4px 12px rgba(0,0,0,0.3);`
- Card: `box-shadow: 0 1px 3px 0 rgba(0,0,0,0.1);`

---

## Implementation Examples

### Example 1: Quick Start Guide Homepage Modal

**Location:** `quick_start_guide.html`

**Modal ID:** `homepageModal`

**Features:**
- Full homepage replica with interactive navigation
- Multiple interactive buttons with tooltips
- Help icon with circular spotlight cutout
- System status cards
- ESC key to close
- Click outside to close

**Spotlight configuration:**
```javascript
window.homepageSpotlight = new SpotlightSystem({
  overlaySelector: '#modalOverlay',
  targets: '[data-spotlight="button"], [data-spotlight="help"]',
  closeButton: '[data-spotlight="close"]',
  modalSelector: '#homepageModal',
  padding: 14,
  dimOpacity: 0.55
});
```

### Example 2: Checking System - Filter Panel Modal

**Location:** `user_guide_checking_system.html`

**Modal ID:** `filterPanelModal`

**Features:**
- Shows filter configuration interface
- Interactive filter chips with remove buttons
- Add filter dropdown simulation
- Clear all and Start Checking buttons
- Tooltip explanations for each filter type

**Spotlight configuration:**
```javascript
window.filterPanelSpotlight = new SpotlightSystem({
  overlaySelector: '#filterModalOverlay',
  targets: '[data-spotlight="button"]',
  closeButton: '[data-spotlight="close"]',
  modalSelector: '#filterPanelModal',
  padding: 14,
  dimOpacity: 0.55
});
```

### Example 3: Uploader - Configuration Modal

**Location:** `user_guide_uploader.html`

**Modal ID:** `uploadConfigModal`

**Features:**
- PC number and destination configuration
- Status badges (red/yellow/green states)
- Configuration form preview
- Save button interaction

**Spotlight configuration:**
```javascript
window.uploadConfigSpotlight = new SpotlightSystem({
  overlaySelector: '#modalOverlay',
  targets: '[data-spotlight="button"]',
  closeButton: '[data-spotlight="close"]',
  modalSelector: '#uploadConfigModal',
  padding: 14,
  dimOpacity: 0.55
});
```

---

## Best Practices

### 1. Modal Design

✅ **DO:**
- Use **flat hierarchy pattern** from `quick_start_guide.html`
- Position close button OUTSIDE scrollable content at `top: -12px; right: -12px`
- Make backdrop handle scrolling, not the content container
- Use `padding: 2rem` on backdrop for centering instead of flexbox
- Position overlay as sibling to close button (both children of content wrapper)
- Include `data-spotlight="close"` on close button
- Add ESC key handler and click-outside-to-close
- Use inline `z-index: 10003` on close button (no Tailwind class needed)
- Make close button circular with white background for universal visibility

❌ **DON'T:**
- Put close button inside scrollable content container
- Put close button inside sticky header
- Use flexbox centering on modal backdrop (use padding + margin: auto)
- Nest overlay as parent/child of close button
- Use `max-height` with `overflow-y: auto` on content (let backdrop scroll)
- Forget `pointer-events: none` on overlay
- Make close button too small (minimum 48x48px for touch targets)

### 2. Spotlight Usage

✅ **DO:**
- Use `data-spotlight="button"` for rectangular elements
- Use `data-spotlight="help"` for circular help icons
- Initialize spotlight in modal open function
- Cleanup spotlight in modal close function
- Call `spotlight.updateHoles()` after showing tooltips

❌ **DON'T:**
- Create spotlight without close button target
- Forget to set `padding` parameter
- Leave spotlight running after modal closes
- Use spotlight without overlay element

### 3. Tooltip Implementation

✅ **DO:**
- Wrap interactive elements in `.interactive-btn-wrapper`
- Position tooltips relative to wrapper (`position: relative`)
- Hide all other tooltips before showing new one
- Update spotlight holes after tooltip toggle
- Use consistent tooltip styling
- Include arrow pointer

❌ **DON'T:**
- Show multiple tooltips simultaneously
- Forget to update spotlight after tooltip change
- Use absolute positioning without wrapper
- Make tooltips too wide (use `white-space: nowrap` or set `max-width`)

### 4. Interactive Elements

✅ **DO:**
- Use consistent button styles
- Add hover effects (transform, shadow changes)
- Include `cursor: pointer`
- Make touch targets at least 48x48px
- Add `data-spotlight` attributes
- Use semantic HTML

❌ **DON'T:**
- Use `<div>` for clickable buttons
- Forget hover states
- Make buttons too small
- Use inconsistent styling

### 5. Accessibility

✅ **DO:**
- Include descriptive `title` attributes
- Use semantic HTML elements
- Ensure keyboard navigation works
- Provide ESC key to close
- Use adequate color contrast

❌ **DON'T:**
- Rely solely on color for meaning
- Trap keyboard focus
- Forget to handle ESC key
- Use tiny text sizes

### 6. Performance

✅ **DO:**
- Cleanup event listeners on modal close
- Use `requestAnimationFrame` for visual updates
- Limit spotlight update frequency (200ms interval)
- Remove SVG from DOM when not needed

❌ **DON'T:**
- Leave intervals running after modal closes
- Update positions on every mouse move
- Create memory leaks with uncleaned listeners

---

## Appendix

### Quick Reference: Data Attributes

```html
<!-- Spotlight system -->
data-spotlight="button"           <!-- Interactive button -->
data-spotlight="help"             <!-- Help icon (circular) -->
data-spotlight="close"            <!-- Close button -->

<!-- Modal-specific variants -->
data-spotlight-upload="button"    <!-- Uploader modal -->
data-spotlight-checking="button"  <!-- Checking system modal -->
data-spotlight-student="status"   <!-- Student view modal -->
data-spotlight-class="progress"   <!-- Class view modal -->
data-spotlight-school="breadcrumb" <!-- School view modal -->
```

### Quick Reference: Function Names

```javascript
// Modal controls
openHomepageModal()
closeHomepageModal()
openFilterPanelModal()
closeFilterPanelModal()
openCacheStatusModal()
closeCacheStatusModal()
openUploadConfigModal()
closeUploadConfigModal()

// Tooltip controls
toggleTooltip(tooltipId)

// Spotlight controls (via instance)
spotlight.enable()
spotlight.disable()
spotlight.updateHoles()
```

### Quick Reference: CSS Classes

```css
.spotlight-active        /* Applied to modal when spotlight enabled */
.spotlight-highlight     /* Applied to target elements */
.spotlight-static        /* Applied to close button */
.feature-tooltip         /* Tooltip container */
.interactive-btn-wrapper /* Wrapper for interactive elements with tooltips */
.homepage-enlarge-btn    /* "See More" button */
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.1 | October 27, 2025 | **MAJOR UPDATE**: Documented flat hierarchy pattern as golden rule. Added comprehensive close button positioning guide based on `quick_start_guide.html`. Updated all modal examples to use correct pattern. Added detailed z-index stacking context explanation. |
| 1.0 | October 27, 2025 | Initial documentation |

---

## Maintenance Notes

When adding new guide pages or modals:

1. Copy modal structure from existing guide page
2. Update modal ID and function names
3. Verify close button z-index (`10003`)
4. Configure spotlight with appropriate selectors
5. Test ESC key and click-outside-to-close
6. Verify tooltip positioning and cutouts
7. Check responsive behavior (mobile, tablet, desktop)
8. Validate accessibility (keyboard navigation, screen readers)

---

**Document maintained by:** 4Set Development Team  
**For questions or updates:** Contact project administrators
