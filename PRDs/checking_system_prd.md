# 4set Web Successor — Checking System PRD

## Purpose
Define the database status monitoring subsystem ("Checking System") that audits Jotform submissions, evaluates completion and data quality per student, applies termination rules, and produces roll-up reports for operators.

## Core Objectives

The Checking System serves **two critical verification functions**:

### A. Display Uploaded Data Accurately
**Purpose**: Show what test administrators recorded and uploaded to Jotform
- Display all student answers exactly as submitted (including termination records marked by administrators)
- Reflect the administrator's manual decisions during assessment (e.g., whether termination was triggered)
- Provide complete visibility into what exists in the database
- Serve as the "source of truth" view for uploaded data

### B. Validate Through Recalculation
**Purpose**: Calculate what SHOULD be true based on the actual data and flag discrepancies
- Recalculate termination rules based on actual question responses
- Compare administrator's recorded decisions vs system calculations
- Identify data quality issues, missing data, and recording errors
- Alert administrators to inconsistencies requiring verification

### Key Questions Answered by the Checking System

#### 1. Data Completeness
- **Is there any missing data?** 
  - How many questions are unanswered?
  - Which specific questions are missing?
  - Are there gaps in required fields?
- **Visual Indicators**: Grey status circles, "Missing only" filter option, answered/total counts

#### 2. Administrator Accuracy Validation
- **Did the administrator mark termination rules correctly?**
  - What did the administrator record? (0=passed, 1=terminated)
  - What should they have recorded based on actual answers?
  - Do the two values match?
- **Visual Indicators**: 
  - ✅ **Green checkmark** = Verified - Record matches calculation
  - ⚠️ **Orange warning** = Mismatch detected - Please verify
  - Red highlight for triggered terminations
  - Side-by-side comparison: "Recorded: Terminated" vs "Calculated: Should Pass"

### Why This Dual Approach Matters

The checking system recognizes that **termination values in the JSON are RECORDS, not calculations**:
- In the PDF-based workflow, test administrators manually calculate termination rules during assessment
- They mark `0` (passed) or `1` (terminated) based on their real-time evaluation
- These marks are **data points** documenting what happened during the session
- The checking system **validates** these records by recalculating from the underlying question responses

This approach provides a **holistic and accurate view** because:
1. We see what was officially recorded (the administrator's decision)
2. We verify it against what the data says (system calculation)
3. We can catch recording errors, miscounts, or data quality issues
4. We maintain audit trail of both human decisions and system validation

## Goals
- Surface end-to-end database health independent of the upload pipeline status.
- Highlight missing data, unexpected fields, and `termination-rules.md` violations for prompt remediation.
- Provide aggregate insights at class, school, district, and project-group levels.
- Integrate with the front-page dashboard alongside the pipeline monitor.
- **Enable quality assurance** by comparing administrator records against system calculations
- **Support data integrity** through mismatch detection and validation workflows

- Poll Jotform APIs to retrieve submission snapshots for configured forms.
- Enforce task completion checks per student (all required PDFs/tasks submitted, mandatory fields populated).
- Apply `TEMP/tasks/termination-rules.md` to detect early termination scenarios and extra/unexpected inputs.
- Generate summaries (counts, percentages, KPI scores) per school, district, project group, and overall.
- Expose status via dashboard modules and downloadable reports.
- Consume metadata from `assets/id_mapping/schoolid.enc` to map submissions to schools (`School ID`, `School Name`, `School Name (Chinese)`), districts (`District Cleaned`), and project groups (`Group`).
- Use `assets/id_mapping/jotformquestions.json` to resolve Jotform field QIDs (e.g., `sessionkey`, `school-id`, matrix question identifiers) when parsing API responses.
- Reference `assets/id_mapping/survey-structure.json` to enumerate sets (`第一組` – `第四組`) and their section files (e.g., `ERV.json`, `SYM.json`, gender-conditional `TEC_Male.json`/`TEC_Female.json`), ensuring completion reports mirror the canonical ordering and show/hide logic.
- Join class metadata by linking `assets/id_mapping/coreid.enc` (`Class ID 25/26`) with `assets/id_mapping/classid.enc` (`Class ID`, `Actual Class Name`), enabling class-level drilldowns, breadcrumbs, and filter labels.
- Provide search flexibility for student ID, student name, or school name.
- Offer a numeric group filter (`1`–`5`) matching `schoolid.enc` metadata.
- Use a curated district taxonomy in UI/filters: `Shatin`, `Sham Shui Po`, `Kowloon City`, `Tuen Mun`, `Yuen Long`, `Others` (catch-all). Filter combinations (district → group → school) must support dependent narrowing with multi-select chips.
- Implement a status light engine (`/api/checking/status`) to expose task-level completion metrics and termination reasons.
- Support demo coverage for the Checking System dashboard tab.

## Home Page Entry Point (`checking_system_home.html`)

### Purpose
The Checking System home page serves as the intelligent entry point that allows operators to configure filters and automatically routes them to the appropriate drilldown view based on the hierarchy level touched by their selection.

### Data Loading & Authentication

#### System Password Prompt
- On page load, prompt the user for the `systemPassword` required to decrypt `.enc` files.
- Store the password securely in session storage (cleared on browser close) for subsequent API calls.
- If decryption fails, display an error message and prevent access to filter selectors.
- Provide a "Re-enter Password" option if decryption errors occur.

#### Encrypted File Loading
The system must decrypt and load the following files using the `systemPassword`:
1. **`assets/schoolid.enc`** → Provides:
   - `School ID` (e.g., S001, S002)
   - `School Name (Chinese)` (e.g., 天后中英文幼稚園)
   - `School Name` (English name)
   - `Group` (numeric: 1-4)
   - `District Cleaned` (curated: Tuen Mun, Sham Shui Po, Kowloon City, Yuen Long, Others)
   - Contact information

2. **`assets/classid.enc`** → Provides:
   - `Class ID` (e.g., C-001-01)
   - `School ID` (links to schoolid)
   - `Actual Class Name` (bilingual where available, e.g., K1A 愛班)
   - `Teacher Names` for current year

3. **`assets/coreid.enc`** → Provides:
   - `Core ID` (e.g., C10001)
   - `Student ID` (e.g., St11121)
   - `Student Name` (bilingual)
   - `School ID` (links to schoolid)
   - `Class ID 25/26` (current year class assignment)
   - `Group` (numeric: 1-4)
   - `Gender` (M/F)

#### Data Parsing Requirements
- Parse CSV structure after decryption (comma-delimited, first row is header).
- Build in-memory lookup tables indexed by:
  - **Schools**: by `School ID`, `School Name`, `School Name (Chinese)`
  - **Classes**: by `Class ID`, `School ID`
  - **Students**: by `Core ID`, `Student ID`, `Student Name`, `Class ID`
- Normalize district names to the curated list: `Tuen Mun`, `Sham Shui Po`, `Kowloon City`, `Yuen Long`, `Others` (catch-all for unmapped districts).
- Support bilingual search (English + Chinese characters) for school and student names.

### Filter Selector Interface

#### Filter Types
The home page provides **six filter types** that users can add dynamically:

1. **District**: Dropdown populated from unique `District Cleaned` values in `schoolid.enc`
   - Options: Tuen Mun, Sham Shui Po, Kowloon City, Yuen Long, Others
   - Multi-select support via chips

2. **Group**: Dropdown with numeric values 1-4 from `schoolid.enc`
   - Single selection
   - Dependent on District selection (optional narrowing)

3. **School**: Searchable dropdown/autocomplete
   - Display format: `{School Name (Chinese)} · {School Name}` (e.g., "天后中英文幼稚園 · Regina Coeli Anglo-Chinese Kindergarten")
   - Search supports: English name, Chinese name, School ID (with or without leading "S")
   - If School ID filter is used, it should pre-populate this selector

4. **Class**: Dropdown populated based on selected School
   - Display format: `{Actual Class Name}` (e.g., "K1A 愛班")
   - **Only enabled when a School is selected** (dependent filter)
   - Shows classes from `classid.enc` matching the selected School ID
   - Supports multi-select

5. **School ID**: Text input or dropdown
   - Accepts: Numeric ID (001, 002) or formatted (S001, S002)
   - Auto-normalizes input to match `schoolid.enc` format
   - Selecting a School ID should auto-populate the School filter

6. **Student**: Searchable autocomplete
   - Search supports: Student ID, Student Name (English), Student Name (Chinese), Core ID
   - Display format: `{Student Name} ({Student ID})`
   - Shows all students initially; narrows to selected School/Class if those filters are active

#### Filter UI Behavior

##### Initial State
- Display a clean interface with:
  - Header: "Checking System"
  - Subtitle: "Search and analyze pipeline data with flexible filters"
  - One empty filter row with type selector defaulted to "School"
  - "Add filter" button
  - "Start Checking" button (initially disabled)

##### Adding Filters
- Click "Add filter" to reveal a new filter row
- Each row contains:
  - **Filter Type Selector** (dropdown): District, Group, School, Class, School ID, Student
  - **Filter Value Selector** (contextual control): dropdown, searchable input, or autocomplete based on type
  - **Remove Button** (X icon): Removes the filter row
- Maximum 6 filters (one of each type)
- Filters display as removable chips above the filter configuration area

##### Dynamic Dependencies
- **Class filter** is disabled until a School (or School ID) is selected
  - Show tooltip: "Select a school first to enable class selection"
- **Group filter** can narrow School options when District is selected
- **School ID and School filters** are mutually synchronized:
  - Selecting School ID auto-fills School
  - Selecting School displays its School ID as a chip
- Invalid combinations are prevented via disabled states

##### Filter Validation
- At least one filter must be selected to enable "Start Checking"
- Invalid combinations show inline error messages:
  - "Class requires School selection"
  - "Conflicting School and School ID selections"

##### Visual Feedback
- Active filters appear as colored chips with remove (×) icons
- Filter count badge: "X filters applied"
- Clear All button removes all filters and resets the interface

### Routing Logic & Drilldown Determination

#### Hierarchy Levels
The system follows a strict 5-level hierarchy:
```
District (Level 5) > Group (Level 4) > School (Level 3) > Class (Level 2) > Student (Level 1)
```

#### Routing Decision Rules
When "Start Checking" is clicked, evaluate all active filters and route to the **lowest level** touched:

1. **Student Drilldown** (Level 1)
   - **Trigger**: Any filter includes a Student selection
   - **Route**: `checking_system_drilldown_desktop_1.html?studentId={coreId}`
   - **Example**: Student="張梓煋" → Student drilldown for C10001

2. **Class Drilldown** (Level 2)
   - **Trigger**: Class filter is selected, AND no Student filter
   - **Route**: `checking_system_drilldown_desktop_2.html?classId={classId}`
   - **Example**: School="天后中英文幼稚園" + Class="K1A 愛班" → Class drilldown for C-001-02

3. **School Drilldown** (Level 3)
   - **Trigger**: School (or School ID) filter is selected, AND no Class or Student filters
   - **Route**: `checking_system_drilldown_desktop_3.html?schoolId={schoolId}`
   - **Example**: School="天后中英文幼稚園" → School drilldown for S001

4. **Group Drilldown** (Level 4)
   - **Trigger**: Group filter is selected, AND no School, Class, or Student filters
   - **Route**: `checking_system_drilldown_desktop_4.html?group={groupNumber}`
   - **Example**: District="Tuen Mun" + Group="2" → Group drilldown for Group 2

5. **District Drilldown** (Level 5)
   - **Trigger**: Only District filter is selected
   - **Route**: `checking_system_drilldown_desktop_5.html?district={districtName}`
   - **Example**: District="Tuen Mun" → District drilldown for Tuen Mun

#### URL Parameter Construction
- Pass all active filters as URL parameters for context preservation
- Primary parameter determines the drilldown level
- Secondary parameters provide breadcrumb context

**Examples:**
```
# Student drilldown with full context
checking_system_drilldown_desktop_1.html?studentId=C10001&classId=C-085-01&schoolId=S085&group=3&district=Kowloon%20City

# School drilldown with district context
checking_system_drilldown_desktop_3.html?schoolId=S001&group=2&district=Tuen%20Mun

# District drilldown (minimal)
checking_system_drilldown_desktop_5.html?district=Tuen%20Mun
```

### Recent Checks / Quick Access

#### Purpose
Provide quick re-entry to previously viewed drilldowns without reconfiguring filters.

#### Storage
- Store last 10 checks in `localStorage` as:
  ```json
  {
    "timestamp": "2025-10-15T10:30:00Z",
    "level": "class",
    "displayLabel": "K1A 愛班 · 天后中英文幼稚園",
    "url": "checking_system_drilldown_desktop_2.html?classId=C-001-02&schoolId=S001"
  }
  ```

#### UI Display
- Render as clickable pill buttons below filter configuration
- Show label with appropriate icon (district/school/class/student)
- Highlight the most recent check
- Click navigates directly to the stored URL

### System Health Badge

#### Purpose
Display data freshness and system status at the top of the home page.

#### Indicators
- **System Healthy** (green): Last snapshot < 30 minutes old
- **Data Stale** (yellow): Last snapshot 30-60 minutes old
- **Refresh Needed** (red): Last snapshot > 60 minutes old or pipeline error

#### Display
- Badge with pulsing indicator dot
- Timestamp: "Last snapshot: 2025-10-06 11:45"
- Link to "View routing rules" (opens modal with filter logic documentation)

### Mobile Responsiveness

#### Breakpoint Adjustments
- **Desktop (≥1024px)**: Side-by-side filter type and value selectors
- **Tablet (768-1023px)**: Stacked filter rows with full-width controls
- **Mobile (<768px)**:
  - Collapsible filter section (initially collapsed)
  - Full-screen filter selection overlay
  - Chips displayed in a scrollable horizontal list
  - Sticky "Start Checking" button at bottom

#### Touch Optimizations
- Larger tap targets (44×44px minimum)
- Swipe-to-remove for filter chips
- Bottom sheet for filter type selection on mobile

### Error Handling

#### Decryption Failures
- Display modal: "Unable to decrypt data files. Please check your system password."
- Provide retry option without page reload
- Log decryption errors to console for debugging

#### Missing Data
- If enc files are missing or corrupted:
  - Display warning banner: "Data files unavailable. Please contact system administrator."
  - Disable filter selectors and show maintenance message

#### Empty Filter Results
- If a filter combination yields no results:
  - Show inline message: "No matching records found. Try adjusting your filters."
  - Suggest alternative filter combinations

#### Network Errors
- If API calls to `/api/checking/metadata` fail:
  - Fall back to locally parsed enc file data
  - Display warning: "Using cached data. Refresh may be needed."

### Performance Considerations

#### Data Loading
- Decrypt and parse enc files on initial load (show loading spinner)
- Cache parsed data in memory for session duration
- Estimated load time: <2 seconds for ~3500 student records

#### Search Optimization
- Implement debounced search (300ms delay) for autocomplete fields
- Index student names with normalized strings (remove accents, case-insensitive)
- Limit autocomplete results to 50 items; show "View all" option

#### Filter Application
- Client-side filtering for responsive UI
- Pre-compute filter result counts ("X schools match your criteria")
- Lazy-load dropdown options (e.g., load class options only when School is selected)

## Out of Scope
- Direct modification of Jotform submissions (read-only analysis).
- Manual data correction UI; remediation handled in existing tools/runbooks.
- Real-time alerting beyond dashboard notifications (future webhook/Teams integration optional).
{{ ... }}
## Stakeholders
- Operations team monitoring data completeness.
- School leads reviewing submission coverage.
- Backend engineers maintaining the processor agent and dashboard.

## Functional Requirements
1. **Data Harvesting**
   - Scheduled or on-demand fetch from Jotform (`GET /form/{formId}/submissions` with pagination, filters by date range).
   - Cache results for comparison across runs (detect new, updated, deleted submissions).
   - Support multiple form IDs per project; maintain mapping to school/district metadata.
   - Default API call template:
     ```bash
     curl -X GET "https://api.jotform.com/form/{formId}/submissions?apiKey={apiKey}&limit={limit}&offset={offset}&orderby=created_at"
     ```
   - Parameters to support in configuration/UI:
     - `limit` (default 100, max 1000) for pagination window.
     - `offset` for pagination cursor.
     - `filter` JSON (e.g., `{"created_at:gt":"2024-01-01 00:00:00"}`) for date or status range.
     - `orderby` (`created_at`, `updated_at`, etc.) to control ordering.
   - Response parsing must read the `answers` object for each submission; `created_at` provides submission timestamp.

2. **Student Completion Evaluation**
   - Define required artifacts per student (PDF session keys, follow-up surveys, etc.).
   - Cross-reference Jotform submissions with mapping assets (`assets/coreid.enc`, `assets/schoolid.enc`, etc.).
   - Flag missing submissions, duplicate sessionkeys, or extra entries outside expected roster.
   - Recompute question totals dynamically using survey content JSON (matrix questions count per row, instructions excluded) so denominators adapt when forms change.
   - Determine answered counts by evaluating each question’s response payload, including matrix-row completeness rules and autosave semantics from the desktop tool.

3. **Field Validation & Termination Rules**
   - Parse submission answers; enforce mandatory field presence.
   - Credential use: read Jotform API settings (`jotformApiKey`, `jotformFormId`, `jotformUploadLogFormId`) from `assets/credentials.enc`; support secure retrieval via Credential Manager/Docker Secrets per deployment.
   - Reproduce legacy `renderToc()` logic to derive status lights: compute answered/total, evaluate `_Com` completion summaries, and apply termination flags to classify each task as `status-green`, `status-yellow`, or `status-red` with `completionReason()` text.
   - Differentiate between acceptable optional data vs unexpected inputs; emit severity levels (info/warn/critical) and capture completion reasons (full coverage vs termination-driven completion).
   - Evaluate each task’s question set using survey JSON definitions to identify completion thresholds.
   - Apply `TEMP/tasks/termination-rules.md` logic (e.g., `ERV_Ter1`, `ERV_Ter2`, gender-conditional TEC rules) and surface yellow status lights when responses continue post-termination.
   - Flag matrix questions with partial answers, misordered overrides (e.g., Math Pattern text overrides), and non-numeric timer anomalies for SYM/NONSYM.
   - Persist termination reasons alongside completion summaries for reporting/export.

4. **Aggregation & Reporting**
   - Compute metrics per school/district/project group: completion %, outstanding count, termination-trigger counts.
   - Produce trend comparisons (e.g., delta vs previous day/week).
   - Generate downloadable CSV/JSON summaries for archival.

5. **Dashboard Integration**
   - Extend front-page dashboard with a "Checking System" tab or section featuring:
     - Hero metrics: overall completion rate, flagged submissions, termination alerts.
     - Filters for school/district/project group/class with mix-and-match selectors (student ID/name/school search bar, district dropdown using curated list, numeric group dropdown `1–5`, class dropdown driven by class metadata once a school is chosen, set toggles).
     - Tables/charts summarizing outstanding tasks and violations.
   - Provide deep-link to detailed views per student (show submission history, rule hits).
   - Workflow: from the main landing, operators choose between Pipeline Monitor and Checking System; the Checking System view loads a snapshot on first entry and offers manual refresh controls.
   - Ensure mobile-friendly layout with collapsible filters and search for student/session keys; expose active filters as removable chips.
   - Entry point experience:
     - Landing screen presents a single "Start Checking" action with a selector for the entity type (`District`, `Group`, `School`, `Class`, `School ID`, `Student`).
     - Once a type is chosen, the UI reveals contextual inputs:
       - `District` and `Group` → dependent dropdowns driven by curated lists.
       - `School`/`School ID` → search supports English/Chinese names or numeric ID (with/without leading `S`).
       - `Class` → dropdown populated by linked class metadata (labelled with bilingual class names where available). Only enabled when a school (or school ID) has been selected.
       - `Student` → search accepts ID, English/Chinese name.
     - Users can add additional filters via a `+ Add filter` affordance; selections display as removable chips.
     - `Start Checking` button activates when at least one criterion is provided and routes to the smallest applicable hierarchy level.
   - Routing rule: evaluate selected filters and navigate to the lowest-level drilldown available (District → Group → School → Class → Student). Class selections require a school context; invalid combinations (e.g., District + Class without School) are prevented via disabled controls. Examples:
     - District + Group → Group drilldown.
     - School (or School ID) → School drilldown listing classes.
     - School + Class (or direct Class selection) → Class drilldown listing students.
     - Student criterion present → Student drilldown.
   - Drilldown pages include persistent breadcrumbs, bilingual school and class names where applicable, task/alert tables with TOC status lights, and a `Return to Entry Point` button for quick navigation back.
- Drilldown top navigation bar anchors shared context: left-aligned breadcrumbs/home button, center title (district/group/school/class/student) with bilingual label when relevant, right-aligned actions for refresh/export/context menu, and snapshot timestamp so operators always see data freshness. Export action generates CSV snapshots scoped to the current drilldown level (e.g., district summary, a group’s school matrix, a school’s class roster, or a class’s student roster) so operators can share or archive a static view of the data they are inspecting.
- Reference layouts live in `.superdesign/design_iterations/`: desktop (`checking_system_drilldown_desktop_5.html` district → `..._4.html` group → `..._3.html` school → `..._2.html` class → `..._1.html` student) and mobile (`checking_system_drilldown_mobile_5.html` → `..._4.html` → `..._3.html` → `..._2.html` → `..._1.html`). Class drilldown variants introduce per-student heatmaps, intervention timelines, and targeted exports that downstream teams should mirror during implementation.
   - Set progress matrix adapts to the current scope:
     - **District scope**: columns represent sets, rows list schools, each cell showing count of students with incomplete sets (click drills down to the selected school).
     - **Group scope**: columns represent sets, rows list schools within the group, each cell showing count of students with incomplete sets (click drills down to that school).
     - **School scope**: columns represent sets, rows list classes within the school, each cell showing count of students within that class with incomplete sets (click drills down to that class).
     - **Class scope**: columns represent sets, rows list individual students (student ID or name), each cell showing completion status/light per student (click drills down to student detail).
{{ ... }}
   - Matrix cells are interactive; clicking drills down to the next hierarchy level (District → Group → School → Student). Breadcrumbs should allow stepping back up the hierarchy.
   - Student-level drilldowns must be the only place termination rule outcomes are enumerated; aggregate views may show counts but not detailed rule breakdowns. Surface termination context within each task row’s expansion panel (no standalone summary section) and render compact stage chips (e.g., `Stage 1 · N`, `Stage 2 · Y`, `Stage 3 · N`) beside the task headers to highlight triggering stages. Rule descriptions and thresholds must mirror `TEMP/tasks/termination-rules.md` and the corresponding entries in `assets/tasks/*` so the UI stays synchronized with underlying content.
   - Status lights follow revised semantics: green = complete without termination anomalies, yellow = responses captured after a termination gate was crossed (post-termination activity worth flagging but not critical), red = incomplete/outstanding work remaining, grey = not yet started/not assigned. Apply colours consistently across legends, task rows, and question filters.
   - Within the student `Task Progress` table, keep columns consistently aligned (task, status, answered/total, last updated) and rely on row expansion panels to reveal question-level data, termination checklists, and supporting notes. Provide a `Question view` selector allowing operators to toggle between all questions, completed only, correct only, incorrect only, and missing only; filter states apply to expanded question rows without collapsing the parent task. Replace the inline visible-task multi-select with a `Configure visible tasks` button that launches the modal prototype in `.superdesign/design_iterations/task_visibility_modal_1.html`; the modal must preserve set ordering from `assets/id_mapping/survey-structure.json`, support quick select/clear, and present bilingual task labels.
   - Organise task rows beneath four collapsible set headers (Set 1–4) defined in `assets/id_mapping/survey-structure.json`. Each set summary surface should show a compact roll-up of task status counts using the revised status colours.
   - Surface a collapsible `Student Profile` panel ahead of hero metrics (collapsed by default). Populate `student-id`, `child-name`, `Gender`, `school-id`, `district`, `class-id`, and `class-name` from Jotform responses when present; use encrypted lookup tables (`coreid.enc`, `schoolid.enc`, `classid.enc`) to backfill missing values and derive Core ID, Group, school/class labels. Display Chinese labels first with English in parentheses, combine Student ID and Core ID on one card, and ensure group is shown as the numeric value only. Clearly annotate any derived fields so operators understand the source hierarchy.
   - Present the hero metric tiles inside a collapsible `Task Status Overview` section (collapsed by default) covering completion, termination, answered counts, and outstanding focus.
   - Visible tasks must auto-hide the opposite-gender TEC variant (e.g., suppress `TEC (Male)` when `Gender` = F) while retaining audit history; reflect this rule in both the UI state and the modal’s default selections.
- Remove the legacy “Autosave & Enrichment Notes” panel, the bottom navigation ribbon, and the follow-up actions tile; the top navigation bar and task progress layers provide sufficient context.

### Drilldown page configurations

#### Student drilldown (`checking_system_drilldown_desktop_1.html`)

- **Breadcrumb inputs**
  - District label from `schoolid.enc` `District (Cleaned)` (fallback `district` response).
  - Group numeric value from `schoolid.enc`/`coreid.enc`.
  - School bilingual name from `schoolid.enc` `School Name (Chinese)` + `School Name`.
  - Class label from `classid.enc` `Actual Class Name` mapped by `class-id`/`coreid.enc`.
  - Student bilingual name from `child-name` in Jotform (`jotformquestions.json` id `21`) with Chinese first.
- **Collapsible sections**
  - `Student Profile` draws from Jotform (`student-id`, `child-name`, `school-id`, `district`, `class-id`, `class-name`, `gender`) with derived Core ID and Group from `coreid.enc`. Show Student ID + Core ID in one tile, class display uses bilingual formatting.
  - `Task Status Overview` (hero metrics) reads completion %, termination note, answered count, and outstanding focus from `/api/checking/detail` summarised payload.
  - `Task Progress` set accordion uses `assets/id_mapping/survey-structure.json` to determine set ordering and task roster. Each task row consumes `/api/checking/status` to render status light, completion counts, and termination annotations. The `Question view` filter adjusts question-level collections pulled from `/api/checking/detail?studentId=...`.
- **Termination chips**
  - Stage chips map to `TEMP/tasks/termination-rules.md` definitions; display values provided by evaluation engine (`Stage1Hit`, etc.).
- **Task configuration modal trigger**
  - `data-open-modal="visible-tasks"` must load the modal in `.superdesign/design_iterations/task_visibility_modal_1.html`; modal defaults derived from `survey-structure.json` plus gender gating.
- **Status legend**
  - Colour tokens: `status-green` (#22c55e) = complete, `status-yellow` (#fbbf24) = post-termination activity, `status-red` (#ef4444) = incomplete, `status-grey` (#cbd5f5) = not started.

#### Class drilldown (`checking_system_drilldown_desktop_2.html`)

- **Breadcrumb inputs**
  - Same hierarchy as student, but final crumb is `Completion dashboard`. Class anchor uses `class-id` for linking.
- **Class profile cards**
  - `Students` (roster count) from aggregation snapshot per class.
  - `Mentor` from `classid.enc` (field `Class Mentor`) with fallback to manual roster.
  - `School`, `District`, `Group` from `schoolid.enc` joined via class’s school ID.
- **Metrics accordion**
  - `Overall Completion`, `Outstanding Sets`, `Termination Alerts`, `Caregiver Follow-ups` pulled from class-level aggregate API (`/api/checking/status?classId=...`). Termination summary enumerates rule IDs with counts.
- **Task progress table**
  - Columns: Student name (links to student drilldown anchor `#st{studentId}`), Student ID, Set 1–4 status cells, Outstanding count, Last Activity timestamp.
  - Student name/ID from `coreid.enc` and Jotform fields; status cells rely on student-level status lights aggregated per set.
  - Outstanding count = unresolved task total; Last Activity = latest submission timestamp.
- **Actions**
  - `Set Config` button (amber gradient) opens class-level modal (`data-open-modal="class-set-config"`), reusing the task visibility configuration.

#### School drilldown (`checking_system_drilldown_desktop_3.html`)

- **Breadcrumb inputs**
  - District → Group → School → `Completion dashboard`, mirroring upper hierarchy.
- **School profile accordion**
  - `District (Cleaned)` from `schoolid.enc`.
  - `Group` numeric label from `schoolid.enc`.
  - `School ID` from `schoolid.enc` mapped to UI code (e.g., `SCH-STP-031`).
  - Use bilingual school name in header (`School Name`, `School Name (Chinese)`).
- **Metrics accordion**
  - `Overall Completion`, `Students Flagged`, `Termination Alerts`, `Outstanding Sets` computed by school-level aggregation service.
  - Values align with KPI cards in `.superdesign/design_iterations/checking_system_drilldown_desktop_3.html` and should track deltas vs prior snapshot if provided.
- **Class completion overview table**
  - Columns: `Class` (link to class drilldown), `Class Teacher`, `Potential Students` (total roster size), `Completed Students` (students with all sets green), `Outstanding Students` (students missing any greenlight).
  - `Potential Students` derived from roster mapping (`classid.enc` + `coreid.enc`).
  - `Completed`/`Outstanding` counts aggregated from student status data.
  - Search input filters rows against `class-id`, `class-name`, and `Class Teacher`; implementation must support matching hidden identifiers (e.g., class ID codes) even if not shown.
- **Legend removal**
  - School view no longer shows per-set legends; focus is on aggregate counts. Status colours remain consistent if badges or pills are introduced later.

> **Implementation note:** Every drilldown edition must pull text labels (Chinese/English), counts, and timestamps from the same service layer used by previous dashboards to guarantee parity. Keep configuration values (IDs, mappings) in a single source of truth (`config/checking_system.json`) to avoid drift between UI and backend.

6. **APIs & Storage**
   - Agent exposes REST endpoints `/api/checking/status`, `/api/checking/detail`, `/api/checking/export`.
   - `/api/checking/status` returns per task: `{taskId, setId, statusLight (green|yellow|red), percent, answered, total, reason}` enabling UI bindings for status circles and tooltips.
   - Store snapshots in local database or JSON cache (encrypted at rest) for historical comparisons.

## Non-Functional Requirements
- **Security**: Store Jotform API keys via the same secret-management approach (Credential Manager/Docker Secrets). Data cache encrypted at rest; PII masked in logs.
- **Performance**: Fetch and evaluate 10k submissions within 5 minutes on baseline hardware.
- **Reliability**: Retry Jotform API calls with exponential backoff; fall back to last-known snapshot when offline.
- **Configurability**: Allow operators to adjust polling frequency, thresholds for alerts, and target forms without redeploying code.

## Operational Workflow

### Backend Data Pipeline
1. Scheduler triggers checking system (cron or manual dashboard action).
2. Service retrieves submissions, caches responses, and normalizes data.
3. Evaluation engine runs completion checks, applies termination rules, records findings.
4. Aggregation module computes metrics and stores snapshot.
5. Dashboard/API surfaces updated results; notifications raised for critical violations.

### Frontend User Journey
1. **Entry**: User navigates to `checking_system_home.html` from main dashboard.
2. **Authentication**: System prompts for `systemPassword` to decrypt all encrypted files.
3. **Data Loading**: Client decrypts **all encrypted files in parallel**:
   - `schoolid.enc` → School identity data
   - `classid.enc` → Class identity data  
   - `coreid.enc` → Student identity data
   - `credentials.enc` → Jotform API credentials (apiKey, formId)
   - All data cached in `sessionStorage` (version 1.2) for use across all pages
4. **Filter Configuration**: User selects combination of District, Group, School, Class, or Student filters.
5. **Validation**: System validates filter dependencies (e.g., Class requires School) and enables "Start Checking" button.
6. **Routing**: System determines most specific hierarchy level touched by filters and routes to appropriate drilldown:
   - **Level 4** (Student) → `checking_system_4_student.html`
   - **Level 3** (Class) → `checking_system_3_class.html`
   - **Level 2** (School) → `checking_system_2_school.html`
   - **Level 1** (Group) → `checking_system_1_group.html`
   - **Level 1** (District) → `checking_system_1_district.html`
   
   **Note**: District and Group are both Level 1 (independent dimensions) and can coexist.
7. **Drilldown View**: User views completion metrics, task status, and can drill further down or navigate back via breadcrumbs.
8. **Export/Actions**: User can export data, refresh snapshot, or return to home page for new search.

### Student Detail Page Data Flow (Level 1 Drilldown)

When a user selects a student filter and clicks "Start Checking," the following pipeline executes:

1. **Home Page** (`checking_system_home.html`)
   - User selects student filter (e.g., "C10001" or "張梓煋")
   - Clicks "Start Checking" button

2. **Router Determines Route** (`checking-system-router.js` → `determineRoute()`)
   - Detects student filter is present
   - Determines Level 4 (Student Drilldown - most specific)
   - Builds clean URL: `checking_system_4_student.html?studentId=C10001`
   - **Note**: Only Core ID is passed; page derives all parent context (class, school, district, group) from student data
   - Saves to recent checks (localStorage)
   - Navigates to student detail page

3. **Student Page Initialization** (`checking_system_4_student.html` → `checking-system-student-page.js` → `init()`)
   - Parses URL parameter: `studentId` (Core ID only)
   - Checks for cached sessionStorage data
   - **If cached**: Loads student data immediately from `coreIdMap`
   - **If not cached**: Prompts for system password → Decrypts `.enc` files → Caches data
   - Derives all parent context from student record:
     - `student.classId` → lookup class data
     - `student.schoolId` → lookup school data
     - `school.district` → derive district
     - `school.group` → derive group

4. **Student Profile Population** (`populateStudentProfile()`)
   - Retrieves student record from `coreIdMap` using Core ID
   - Retrieves related school from `schoolIdMap`
   - Retrieves related class from `classIdMap`
   - Updates HTML elements with IDs:
     - `student-core-id` → Core ID (e.g., C10001)
     - `student-student-id` → Student ID (e.g., St11121)
     - `student-name` → Student Name (e.g., 張梓煋)
     - `student-gender` → Gender (M/F)
     - `student-school-name` → School (Chinese + English)
     - `student-district` → District
     - `student-class-name` → Class Name
     - `student-group` → Group Number

5. **Jotform Data Fetching** (Task Completion Status)
   - Fetch student submissions from Jotform API filtered by Core ID
   - Use `assets/jotformquestions.json` to resolve question IDs
   - Filter submissions: `{"{qid_studentId}": "{coreId}"}`
   - Parse `sessionkey` (QID 3) format: `coreid_yyyymmdd_hh_mm`
   - **Merge multiple submissions**: Union answer sets, prefer earlier session for conflicts
   - Maximum 511 questions per student
   - **Cache**: Store merged results in `localStorage` (1-hour TTL)
   - Calculate completion metrics:
     - Total questions answered vs. required
     - Per-set completion (Set 1-4)
     - Termination rules violations
     - Traffic light status (green/yellow/red)

6. **UI Rendering**
   - Display task status cards (completion %, answered/total)
   - Show per-set breakdowns with status lights
   - Populate question tables with answers
   - Display termination flags if applicable
   - Enable export functionality

7. **Breadcrumb Navigation** (`updateBreadcrumbs()`)
   - Builds dynamic breadcrumbs from **loaded data** (not URL parameters):
     - District → `checking_system_1_district.html?district={district}`
     - Group → `checking_system_1_group.html?group={group}`
     - School → `checking_system_2_school.html?schoolId={schoolId}`
     - Class → `checking_system_3_class.html?classId={classId}`
     - Student (current page, not linked)
   - All breadcrumbs are clickable for navigation back up the hierarchy
   - Each breadcrumb link only passes the single ID needed for that level

### URL Design Philosophy

**Clean, Minimal URLs** - Each drilldown page receives only the ID for its specific level:

| Level | Page | URL Example | Context Derivation |
|-------|------|-------------|-------------------|
| Level 4 | Student | `?studentId=C10001` | Student record contains `classId`, `schoolId` → lookup class/school → derive district, group |
| Level 3 | Class | `?classId=C-085-02` | Class record contains `schoolId` → lookup school → derive district, group |
| Level 2 | School | `?schoolId=S085` | School record contains `district`, `group` directly |
| Level 1 | Group | `?group=3` | Standalone; optionally `&district=X` if both filters used |
| Level 1 | District | `?district=Kowloon%20City` | Standalone; optionally `&group=3` if both filters used |

**Rationale**: 
- Avoids redundant URL parameters
- Data lookups provide full context
- Cleaner URLs for sharing and bookmarking
- Reduces router complexity

### Jotform API Integration Requirements

**Endpoint**: Jotform REST API v1  
**Authentication**: API key from `credentials.enc` (decrypted once on home page, cached in sessionStorage)

**Request Format**:
```javascript
GET https://api.jotform.com/form/{formId}/submissions
?filter={"{qid_studentId}:eq":"{coreId}"}
&limit=1000
&orderby=created_at
&direction=ASC
```

**Example** (if studentId QID is 20 and Core ID is "C10001"):
```javascript
// Raw filter JSON:
{"20:eq":"C10001"}

// URL-encoded:
%7B%227%3Aeq%22%3A%22C10001%22%7D

// Full URL:
GET https://api.jotform.com/form/123456/submissions?filter=%7B%227%3Aeq%22%3A%22C10001%22%7D&limit=1000&orderby=created_at&direction=ASC&apiKey=...
```

**Response Processing**:
1. Parse all submissions for the student
2. Extract answers array from each submission
3. Merge answers: latest submission wins for each question
4. Map question IDs to readable names using `jotformquestions.json`
5. Calculate completion percentage per set
6. Apply termination rules from `TEMP/tasks/termination-rules.md`

**Caching Strategy**:
- Cache merged student data in `localStorage` with key: `student_jotform_{coreId}`
- Include timestamp and 1-hour TTL
- Manual refresh button to bypass cache
- Clear cache on password re-entry

**Error Handling**:
- API rate limit (429): Show warning, use cached data
- Network error: Fall back to last cached data, show "Offline" badge
- Invalid Core ID: Display error message, offer return to home
- No submissions found: Display "No data submitted yet" message

## Dependencies
- Jotform REST API access and API key permissions.
- Mapping assets (`assets/jotformquestions.json`, `assets/*.enc`).
- Existing dashboard framework for new UI modules.
- `TEMP/tasks/termination-rules.md` maintained by curriculum team.

## UI/UX Considerations
- Introduce a dashboard tab with cards and data tables mirroring pipeline styling.
- Provide filters, search, and export controls accessible on desktop and mobile; search bar must accept student ID, student name, or school name.
- Use consistent colour semantics for alerts (info/ warning/critical) aligned with theme CSS.
- Demonstrate traffic-light states (green/yellow/red) across breakpoints to match legacy TOC expectations, including tooltips explaining completion reasons.

## Telemetry & Logging
- Log fetch durations, API responses, error rates, and rule violations.
- Emit structured events (`checking_run_started`, `checking_run_completed`, `checking_violation_detected`).
- Retain historical snapshots for trend analysis (configurable retention).

## Open Questions
- Preferred schedule (hourly, daily, manual trigger) for production.
- Storage choice for historical snapshots (SQLite vs. JSON vs. external DB).
- Whether to integrate Teams/email alerting in MVP or defer.
- Required access controls for detailed student-level data on the dashboard.
