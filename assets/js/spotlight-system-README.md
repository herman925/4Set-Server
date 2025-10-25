# Spotlight System

Reusable modal spotlight effect with SVG mask cutouts and dynamic tooltip detection.

## Features

- ✅ Dims entire modal backdrop with precise button cutouts
- ✅ Dynamically tracks visible tooltips (zero padding for clean edges)
- ✅ Adapts to viewport changes (resize, scroll)
- ✅ Clean separation of concerns (CSS + JS modules)
- ✅ Easy to integrate into any HTML page

## Installation

### 1. Include CSS

```html
<link rel="stylesheet" href="assets/css/spotlight-system.css">
```

### 2. Include JavaScript

```html
<script src="assets/js/spotlight-system.js"></script>
```

## Usage

### Basic Setup

```javascript
// Initialize the spotlight system
const spotlightSystem = new SpotlightSystem({
  overlaySelector: '#modalOverlay',          // Overlay container element
  targets: '[data-spotlight="button"]',       // Buttons to spotlight
  closeButton: '[data-spotlight="close"]',    // Close button (no animation)
  modalSelector: '#myModal',                  // Modal container
  padding: 14,                                // Padding around cutouts (px)
  dimOpacity: 0.55,                           // Dim opacity (0-1)
  tooltipSelector: '.feature-tooltip[style*="display: block"]',  // Visible tooltips
  updateInterval: 200                         // Tooltip polling interval (ms)
});

// Enable spotlight when opening modal
function openModal() {
  document.getElementById('myModal').style.display = 'block';
  spotlightSystem.enable();
}

// Disable spotlight when closing modal
function closeModal() {
  document.getElementById('myModal').style.display = 'none';
  spotlightSystem.disable();
}
```

### HTML Structure

Add `data-spotlight` attributes to elements you want to spotlight:

```html
<!-- Modal Container -->
<div id="myModal">
  <div id="modalOverlay"></div>
  
  <!-- Close Button (no animation) -->
  <button data-spotlight="close" onclick="closeModal()">×</button>
  
  <!-- Spotlight Buttons (with cutouts) -->
  <button data-spotlight="button">Action 1</button>
  <button data-spotlight="button">Action 2</button>
  
  <!-- Help Icon (circular cutout) -->
  <button data-spotlight="help">?</button>
  
  <!-- Tooltips (automatically detected) -->
  <div class="feature-tooltip" style="display: none;">
    Tooltip content
  </div>
</div>
```

### Instant Tooltip Updates

Call `updateHoles()` when tooltips show/hide for instant mask updates:

```javascript
function toggleTooltip(tooltipId) {
  const tooltip = document.getElementById(tooltipId);
  tooltip.style.display = tooltip.style.display === 'block' ? 'none' : 'block';
  
  // Instantly update spotlight mask
  spotlightSystem.updateHoles();
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `overlaySelector` | String | `'#modalOverlay'` | CSS selector for overlay container |
| `targets` | String | `'[data-spotlight="button"]'` | CSS selector for spotlight targets |
| `closeButton` | String | `'[data-spotlight="close"]'` | CSS selector for close button |
| `modalSelector` | String | `'#homepageModal'` | CSS selector for modal container |
| `padding` | Number | `14` | Padding around button cutouts (px) |
| `dimOpacity` | Number | `0.55` | Opacity of dim layer (0-1) |
| `tooltipSelector` | String | `'.feature-tooltip[style*="display: block"]'` | Selector for visible tooltips |
| `updateInterval` | Number | `200` | Tooltip polling interval (ms) |

## API Methods

### `enable()`

Enables the spotlight effect with cutouts around targets.

```javascript
spotlightSystem.enable();
```

### `disable()`

Disables the spotlight effect and cleans up resources.

```javascript
spotlightSystem.disable();
```

### `updateHoles()`

Manually triggers hole position updates (useful for instant tooltip updates).

```javascript
spotlightSystem.updateHoles();
```

## CSS Classes

The system automatically applies these classes:

- `.spotlight-active` - Applied to modal when spotlight is enabled
- `.spotlight-highlight` - Applied to spotlight target buttons
- `.help-icon-highlight` - Applied to help icons for circular cutouts
- `.spotlight-static` - Applied to close button (no animation)

## How It Works

1. **SVG Mask Layer**: Creates a fixed-position SVG overlay at `z-index: 10000`
2. **White Background**: Mask has white background = shows dim everywhere
3. **Black Holes**: Black rectangles in mask at button positions = hides dim (creates cutouts)
4. **Dynamic Updates**: 
   - Buttons: 14px padding cutouts
   - Tooltips: Zero padding cutouts for clean edges
   - Updates on scroll, resize, and tooltip visibility changes

## Z-Index Stacking

```
10003 - Tooltips (above everything)
10002 - Close button (above overlay)
10001 - Spotlight buttons (above overlay)
10000 - SVG mask overlay (dims everything below)
```

## Example: quick_start_guide.html

```javascript
// Initialize spotlight system
const spotlightSystem = new SpotlightSystem({
  overlaySelector: '#modalOverlay',
  targets: '[data-spotlight="button"], [data-spotlight="help"]',
  closeButton: '[data-spotlight="close"]',
  modalSelector: '#homepageModal',
  padding: 14,
  dimOpacity: 0.55
});

function openHomepageModal() {
  document.getElementById('homepageModal').style.display = 'block';
  document.body.style.overflow = 'hidden';
  spotlightSystem.enable();
}

function closeHomepageModal() {
  document.getElementById('homepageModal').style.display = 'none';
  document.body.style.overflow = 'auto';
  spotlightSystem.disable();
}

function toggleTooltip(tooltipId) {
  const tooltip = document.getElementById(tooltipId);
  tooltip.style.display = tooltip.style.display === 'block' ? 'none' : 'block';
  spotlightSystem.updateHoles();
}
```

## Troubleshooting

### Spotlight not appearing

- Ensure `spotlight-system.js` is loaded **before** initializing `SpotlightSystem`
- Check that `modalOverlay` element exists in the DOM
- Verify `data-spotlight` attributes are correctly set

### Tooltips appearing dimmed

- Ensure tooltips have `z-index: 10003` or higher
- Verify `tooltipSelector` matches your tooltip elements
- Check that tooltips use `display: block` when visible

### Cutouts not updating on resize

- Ensure modal has proper scroll/resize event listeners
- Check browser console for JavaScript errors
- Verify `updateInterval` is set to a reasonable value (100-300ms)

## Browser Compatibility

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

Requires support for:
- SVG masks
- `requestAnimationFrame`
- ES6 classes
- `getBoundingClientRect()`

## License

Internal use for 4Set System project.

## Changelog

### v1.0.0 (2025-10-26)
- Initial release
- SVG mask-based cutouts
- Dynamic tooltip detection
- Viewport adaptation
- Modular CSS/JS separation
