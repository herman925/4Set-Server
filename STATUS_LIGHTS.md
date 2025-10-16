# Status Light Design Documentation

## Overview

This document describes the definitive truth about how status lights work across the 4Set Checking System.

## Status Light Colors and Meanings

### System-Wide Status Colors

The system uses **three primary status colors** across most pages:

| Color | Status | Meaning |
|-------|--------|---------|
| 🟢 Green | Complete | 100% of tasks/submissions completed |
| 🔴 Red | Incomplete | Some progress made (0% < completion < 100%) |
| ⚪ Grey | Not Started | No progress made (0% completion) |

### Special Case: Post-Term Status (Class By Task & Student Pages Only)

On the **Class page (By Task view)** and **Student page**, a fourth status color exists:

| Color | Status | Meaning |
|-------|--------|---------|
| 🟡 Yellow | Post-Term | Task has answers submitted after termination |

**Important:** Yellow (Post-Term) status **ONLY** appears in:
- Class page when viewing "By Task" mode
- Student page

## Page-Specific Implementation

### District Page (`checking_system_1_district.html`)
- **Colors Used:** Green, Red, Grey (3 colors)
- **Legend Label:** "Status Lights"
- Shows aggregated status for all schools in a district

### Group Page (`checking_system_1_group.html`)
- **Colors Used:** Green, Red, Grey (3 colors)
- **Legend Label:** "Status Lights"
- Shows aggregated status for all schools in a group

### School Page (`checking_system_2_school.html`)
- **Colors Used:** Green, Red, Grey (3 colors)
- **Legend Label:** None (no "Legend:" prefix)
- Shows aggregated status for all classes in a school

### Class Page (`checking_system_3_class.html`)
- **By Set View:** Green, Red, Grey (3 colors)
- **By Task View:** Green, Yellow (Post-Term), Red, Grey (4 colors)
- **Legend:** Dynamic - changes based on view mode
- Yellow only appears in By Task view for tasks with post-termination answers

### Student Page (`checking_system_4_student.html`)
- **Colors Used:** Green, Yellow (Post-Term), Red, Grey (4 colors)
- Shows individual task completion status with post-term detection

## Historical Context: Removal of "In Progress" Status

### What Changed
Previously, the system had an ambiguous "In Progress" status that showed as yellow/orange. This was **removed** because:

1. **Semantic Ambiguity:** "In Progress" could mean "just started" or "almost done" - both showed as the same color
2. **Never Actually Used:** The validation system never produced an "in-progress" status
3. **Color Confusion:** Yellow/orange typically implies a warning state, not partial progress
4. **Data Layer Mismatch:** The JotForm cache layer only returns `complete`, `incomplete`, or `notstarted` - there was no true "in progress" state

### What Replaced It
All partial progress (0% < completion < 100%) is now shown as **RED (Incomplete)**, making it clear that:
- Green = Done ✓
- Red = Work remaining
- Grey = Not started yet

## Technical Implementation

### Data Layer (JotForm Cache)
Returns three possible statuses:
- `complete` - 100% completion
- `incomplete` - Partial completion (0% < x < 100%)
- `notstarted` - 0% completion

### UI Layer Status Mapping

#### District, Group, School Pages
```javascript
complete → status-green
incomplete → status-red
notstarted → status-grey
```

#### Class Page (By Set)
```javascript
complete → status-green
incomplete → status-red
notstarted → status-grey
```

#### Class Page (By Task) & Student Page
```javascript
complete → status-green
incomplete (with post-term answers) → status-yellow
incomplete (normal) → status-red
notstarted → status-grey
```

## CSS Classes

```css
.status-green { background-color: #22c55e; }   /* Green - Complete */
.status-red { background-color: #ef4444; }     /* Red - Incomplete */
.status-grey { background-color: #cbd5e1; }    /* Grey - Not Started */
.status-yellow { background-color: #fbbf24; }  /* Yellow - Post-Term (Class By Task & Student only) */
```

## Design Principles

1. **Consistency:** All aggregated views (District, Group, School, Class By Set) use the same 3-color system
2. **Simplicity:** Status should be immediately understandable without explanation
3. **Accuracy:** Status reflects actual data state, not aspirational states
4. **Context-Aware:** Special statuses (like Post-Term) only appear where relevant and actionable

## Future Considerations

- If new status types are needed, they should be based on actual data layer states
- Any new status color should have a clear, unambiguous meaning
- Consider whether the status is actionable before adding it to the UI
- Maintain consistency across pages unless there's a strong contextual reason to differ
