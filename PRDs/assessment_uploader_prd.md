# Assessment Uploader Web Interface PRD

---
**Title:** 4Set Assessment Uploader Web Interface  
**Owner:** Project Maintainers  
**Last Updated:** 2025-10-15  
**Status:** Production Ready  
**Version:** 2.0 - File System Access API Implementation

---

## Overview

The Assessment Uploader is a GitHub Pages-hosted web interface for the 4Set Pipeline system using the **File System Access API** for direct file writing to monitored folders.

### Main Functions
1. **Dashboard** (`index.html`) - System monitoring and navigation
2. **Upload Interface** (`upload.html`) - PDF upload with File System Access API

### Key Innovation
✅ **Real File Writing** - Uses browser's File System Access API to write files directly to OneDrive-synced folders  
✅ **No Backend Required** - Pure client-side implementation  
✅ **Permission Persistence** - Folder access saved via IndexedDB

---

## Complete Upload Pipeline

```
┌─────────────────┐
│  1. User Drops  │
│   PDF on Web    │
└────────┬────────┘
         ↓
┌─────────────────┐
│ 2. Browser      │
│ Writes to Folder│ ← File System Access API
│  - file.pdf     │
│  - file.meta.   │
│    json         │
└────────┬────────┘
         ↓
┌─────────────────┐
│ 3. OneDrive     │
│ Syncs to Server │ ← Automatic (seconds)
└────────┬────────┘
         ↓
┌─────────────────┐
│ 4. Processor    │
│ Agent Detects   │ ← Watches folder
│ New File        │
└────────┬────────┘
         ↓
┌─────────────────┐
│ 5. Reads        │
│ Metadata        │ ← uploadedFrom = PC no
└────────┬────────┘
         ↓
┌─────────────────┐
│ 6. Enriches &   │
│ Uploads to      │ ← computerno field
│ Jotform         │
└─────────────────┘
```

---

## Architecture

### Technology Stack
- **Frontend:** Static HTML, CSS, JavaScript (ES6+)
- **File API:** File System Access API (Chrome/Edge 86+)
- **Storage:** IndexedDB for permission persistence
- **Styling:** TailwindCSS (CDN), Custom CSS modules
- **Icons:** Lucide Icons
- **Fonts:** Inter, JetBrains Mono
- **Deployment:** GitHub Pages (HTTPS required for API)

### File Structure

```
4Set-Server/
├── index.html                   # Dashboard
├── upload.html                  # Upload interface
├── checking_system_home.html    # Checking system entry
├── assets/
│   ├── css/
│   │   ├── global.css          # Shared (badges, modals, animations)
│   │   ├── index.css           # Index page specific
│   │   └── upload.css          # Upload page specific
│   ├── js/                     # (All inline for now)
│   └── favicon.ico
└── PRDs/
    └── assessment_uploader_prd.md
```

**Note:** Design iterations previously in `.superdesign/design_iterations/` have been documented in `overview_prd.md` "Design TBC" section and the directory has been retired.

---

## Upload Interface Components

### 1. System Status Card

**Three Status Badges:**

#### System Status Badge
- 🟢 **Ready** - Both PC number and destination set
- 🟠 **Partial Setup** - Only one configured
- 🔴 **Setup Required** - Neither configured

#### PC Number Badge
- 🟢 **Valid** - Shows number (e.g., "999")
- 🔴 **Error** - Shows "000" or "???"
- **Click:** Opens configuration modal
- **Source:** localStorage or auto-detection

#### Upload Destination Badge
- 🟢 **Valid** - Shows folder name (e.g., "incoming")
- 🔴 **Not Set** - No folder selected
- **Click:** Opens destination modal
- **Source:** File System Access API handle (IndexedDB)

### 2. Upload Zone

- Drag & drop PDF files
- Click to browse
- **Validation:** Checks PC number AND destination before accepting
- **Error Handling:** Spotlight badges when missing

### 3. Floating Upload Status Panel

**Expanded (400px × 500px max):**
- Shows list of uploading files
- Real-time status per file
- File name, size, status icon

**Collapsed (60px circle):**
- Minimizes to corner
- Shows upload icon
- Fade out completely with CSS

---

## Configuration System

### Upload Destination Modal

**Purpose:** Set the folder where files will be written

**Content:**
- Explanation: "Select the folder that the processor agent is monitoring"
- Current destination display
- Warning: Must match processor agent's watch path
- **Action:** "Set Upload Destination" button

**Flow:**
1. User clicks Upload Destination badge
2. Modal shows current folder (or "Not set")
3. User clicks "Set Upload Destination"
4. → Permission Info Modal appears
5. → Browser folder picker opens
6. User selects monitored folder (e.g., `incoming`)
7. Permission granted, handle stored in IndexedDB

### Permission Info Modal

**Purpose:** Educate user before showing folder picker

**Content:**
- Why permission is needed
- Privacy notice (local storage only)
- "Select Folder" button

**Key Message:**
- One-time setup per workstation
- Browser remembers permission
- Files written directly to selected folder

### PC Number Modal

**Purpose:** Configure PC number for metadata

**Features:**
- Input with auto-formatting (e.g., 10 → 010)
- Validation (numeric, not 0)
- Saves to `localStorage.pc_number`
- Clear cache option

---

## File System Access API Implementation

### Browser Compatibility
- ✅ Chrome 86+
- ✅ Edge 86+
- ❌ Firefox (not supported)
- ❌ Safari (not supported)

### Permission Model

**First Time:**
1. User drops PDF
2. System checks: `state.directoryHandle` exists?
3. If no → Show Upload Destination modal
4. User clicks "Set Upload Destination"
5. → Permission Info modal
6. → Browser folder picker
7. User selects folder (e.g., `C:\...\incoming`)
8. Browser grants write permission
9. Handle stored in IndexedDB

**Subsequent Uploads:**
1. Page loads → `restoreDirectoryHandle()` from IndexedDB
2. `state.directoryHandle` exists ✓
3. User drops PDF → Direct write, no prompts

### Technical Implementation

**Key Functions:**

```javascript
// Request folder access
async function requestDirectoryAccess() {
    const dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: state.directoryHandle || 'documents'
    });
    
    // Verify permission
    const permission = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
        await dirHandle.requestPermission({ mode: 'readwrite' });
    }
    
    state.directoryHandle = dirHandle;
    await storeDirectoryHandle(dirHandle);
}

// Write files
async function uploadFile(id, file) {
    // Write PDF
    const pdfHandle = await state.directoryHandle.getFileHandle(file.name, { create: true });
    const writable = await pdfHandle.createWritable();
    await writable.write(file);
    await writable.close();
    
    // Write metadata (only computer number needed)
    const metadata = {
        uploadedFrom: state.pcNumber
    };
    
    const metaHandle = await state.directoryHandle.getFileHandle(
        file.name.replace('.pdf', '.meta.json'), 
        { create: true }
    );
    const metaWritable = await metaHandle.createWritable();
    await metaWritable.write(JSON.stringify(metadata, null, 2));
    await metaWritable.close();
}
```

---

## Metadata File Format

### Purpose
Metadata files pass PC number from web uploader to processor agent.

### File Naming
- Pattern: `{original_filename}.meta.json`
- Example: `scan.pdf` → `scan.meta.json`

### Content Structure

```json
{
  "uploadedFrom": "999"
}
```

### Field Definitions

| Field | Type | Purpose | Example |
|-------|------|---------|---------|
| `uploadedFrom` | string | PC number of uploader | "010", "999" |

**Note:** Only the PC number is needed. All other information (School ID, District, student data) is extracted from the PDF by the processor agent.

---

## Processor Agent Integration

### How Agent Reads Metadata

**PowerShell Code:**
```powershell
# Check for metadata file
$metadataFile = "$($file.DirectoryName)\$($file.BaseName).meta.json"

if (Test-Path $metadataFile) {
    try {
        $metadata = Get-Content -Path $metadataFile -Raw | ConvertFrom-Json
        
        if ($metadata.uploadedFrom) {
            $computerNo = $metadata.uploadedFrom
            Write-Log "Using computer number from metadata: $computerNo"
            
            # Clean up metadata file after reading
            Remove-Item -Path $metadataFile -Force
        }
    }
    catch {
        Write-Log "Failed to read metadata file" -Level "ERROR"
    }
}
```

### Field Mapping

**Web → Agent → Jotform:**
```
uploadedFrom (metadata.json)
    ↓
$computerNo (PowerShell variable)
    ↓
computerno (Jotform field ID 647)
```

### Agent Behavior

1. **Detects new PDF** in watched folder
2. **Looks for `.meta.json`** with same basename
3. **Reads `uploadedFrom`** field
4. **Uses as `computerno`** for Jotform submission
5. **Deletes metadata file** after reading (cleanup)
6. **Falls back** to agent's PC number if no metadata

---

## State Management

### Application State

```javascript
const state = {
    pcNumber: null,              // PC number (3-digit string)
    uploadQueue: [],             // [{id, file, status}, ...]
    isUploading: false,          // Upload in progress flag
    directoryHandle: null        // FileSystemDirectoryHandle
};
```

### localStorage Keys

| Key | Type | Purpose |
|-----|------|---------|
| `pc_number` | string | PC number (e.g., "010") |

**Note:** OneDrive path no longer stored - using File System Access API instead

### IndexedDB Storage

**Database:** `4SetUploader`  
**Object Store:** `handles`  
**Key:** `incomingFolder`  
**Value:** FileSystemDirectoryHandle

---

## Upload Flow

### Complete Process

```
1. User Drops/Selects PDF
   ↓
2. Validate PC Number
   - If not set → Show PC modal + spotlight
   ↓
3. Validate Upload Destination
   - If not set → Show Destination modal + spotlight
   ↓
4. Add to Upload Queue
   ↓
5. Show Floating Panel
   ↓
6. Write PDF File
   - await directoryHandle.getFileHandle()
   - await writable.write(file)
   ↓
7. Write Metadata File
   - Create {filename}.meta.json
   - Write uploadedFrom (PC number only)
   ↓
8. Update Status (Success)
   - Green checkmark
   - Console logs
   ↓
9. OneDrive Auto-Sync
   - Happens in background (seconds)
   ↓
10. Processor Agent Picks Up
    - Reads metadata
    - Uses uploadedFrom for computerno
    - Uploads to Jotform
```

### Error Handling

**No Permission:**
```
- Shows Destination modal
- User must grant access
- Upload retries automatically
```

**Permission Denied:**
```
- Error: "Permission denied to write files"
- User must re-grant or check folder
```

**Unsupported Browser:**
```
- Error: "Browser does not support file writing"
- Recommendation: Use Chrome or Edge
```

---

## PC Number Detection

**Priority Order:**

1. **Manual Configuration** (`localStorage.pc_number`)
   - User explicitly set via modal
   - Highest priority

2. **Auto-Detection from Paths**
   - Pattern matching: `KS###`, `LAPTOP###`, `PC###`
   - Extract from username in URL
   - Auto-saves if found

3. **Failed Detection**
   - Returns "000"
   - Red badge displayed
   - User prompted on upload attempt

**Note:** OneDrive path detection removed - no longer needed with File System Access API

---

## CSS Architecture

### Load Order
1. `theme_pantone_light_1.css` - Design system variables
2. Page-specific CSS (`index.css` or `upload.css`)
3. `global.css` - Shared components

### global.css (262 lines)
- Badge states (success, warning, error, valid)
- PC number states & spotlight animation
- Hero background & glow rings
- Entry cards & animations
- Buttons & hovers
- Modals (backdrop, panel, inputs)
- Safari compatibility (`-webkit-backdrop-filter`)

### upload.css (124 lines)
- Upload zone & drag-over effects
- File item animations
- Floating upload panel
- Panel collapse/expand states

---

## Responsive Design

### Breakpoints
- **Mobile:** <640px
- **Tablet:** 640px - 1024px
- **Desktop:** >1024px

### Badge Behavior
- **Desktop:** All badges + info box on one row
- **Tablet:** Info box wraps
- **Mobile:** Full vertical stack

---

## Security & Privacy

### Client-Side Only
- ✅ No server communication
- ✅ No backend required
- ✅ No API keys
- ✅ Files written directly to local folder

### Permission Model
- ✅ Explicit user consent (browser folder picker)
- ✅ Permission stored locally (IndexedDB)
- ✅ Domain-specific (GitHub Pages origin)
- ✅ Revocable (clear browser data)

### Data Flow
```
User PC → Local Folder → OneDrive Sync → Server PC
```
- Files never pass through external servers
- Web interface acts as file writer only
- Metadata contains only upload info (no sensitive data)

---

## Testing Scenarios

### Setup Testing
1. Fresh browser (no localStorage/IndexedDB)
2. Invalid PC number (0, non-numeric)
3. Grant folder permission
4. Revoke and re-grant permission
5. Clear IndexedDB and verify re-prompt

### Upload Testing
1. Upload without PC number → Blocked
2. Upload without folder permission → Modal shown
3. Upload single PDF → Success
4. Upload multiple PDFs → Queue handling
5. Upload non-PDF → Rejected
6. Drag & drop vs. click browse

### Permission Persistence
1. Upload file → Grant permission
2. Refresh page
3. Upload again → No prompt (should work)
4. Clear IndexedDB
5. Upload → Prompt returns

### Browser Compatibility
1. Chrome/Edge → Full functionality
2. Firefox → Show error message
3. Safari → Show error message

---

## Known Limitations

### Browser Support
- ❌ Only Chrome/Edge 86+
- ❌ Firefox and Safari not supported
- ✅ GitHub Pages (HTTPS) required

### Permission Behavior
- Permission persists per browser profile
- Private/Incognito mode may not persist
- Clearing site data revokes permission

### OneDrive Sync
- Cannot monitor sync status from browser
- Assumes sync happens automatically (usually <10 seconds)
- No feedback when file reaches server

---

## Future Enhancements

### Phase 1: Completed ✅
- File System Access API implementation
- IndexedDB permission persistence
- Metadata file creation
- PC number configuration

### Phase 2: Planned
- Upload progress tracking (file write progress)
- Batch upload optimization
- Upload history/log viewer
- Retry failed uploads

### Phase 3: Advanced
- OneDrive sync status monitoring (if API available)
- Multiple folder support
- Upload scheduling
- File validation preview

---

## Deployment

### GitHub Pages Configuration
- **Source:** `main` branch, root directory
- **HTTPS:** Required for File System Access API
- **No Build Step:** Static files only

### Environment Requirements
- ✅ HTTPS (GitHub Pages provides this)
- ✅ Modern browser (Chrome/Edge 86+)
- ✅ OneDrive installed and syncing on client PCs

### Testing Environments
- **Local:** `python -m http.server 8000` (http://localhost:8000)
- **Production:** GitHub Pages (https://[username].github.io/repo)

---

## Version History

**v2.0 (2025-10-15)** - File System Access API
- Implemented File System Access API
- Removed OneDrive path detection
- Added permission persistence via IndexedDB
- Real file writing to monitored folders
- Metadata file creation for processor agent

**v1.1 (2025-10-14)** - CSS Refactoring
- Moved inline CSS to external files
- Created global.css for shared styles
- Safari compatibility fixes

**v1.0 (2025-10-14)** - Initial Implementation
- System status badges
- PC number configuration
- Upload zone with validation
- Simulated upload (no actual file writing)

---

## References

### Related PRDs
- `processor_agent_prd.md` - PowerShell processor agent
- `checking_system_pipeline_prd.md` - Checking system
- `jotform-integration.md` - Jotform API integration

### External Documentation
- [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [TailwindCSS](https://tailwindcss.com/docs)
- [Lucide Icons](https://lucide.dev/)
