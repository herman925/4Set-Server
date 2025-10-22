# Status Light Data Flow Diagram

## Current Issue

```
┌─────────────────────────────────────────────────────┐
│         JotForm Submissions (API)                   │
│         C10880: CM answered 7/7, terminated Q7      │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│      TaskValidator.validateAllTasks()               │
│      - Validates CM: terminated=true, ans=7, tot=7  │
│      - Returns: { terminated, hasPostTermination }  │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│      JotFormCache.validateStudent()                 │
│      - Calculates: isComplete = true                │
│      - Stores: { taskId:'cm', complete:true, ... }  │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│      IndexedDB Cache                                │
│      validationCache.set('C10880', {                │
│        setStatus: {                                 │
│          set3: {                                    │
│            tasks: [{                                │
│              taskId: 'cm',                          │
│              complete: true  ← Should be true!      │
│            }]                                       │
│          }                                          │
│        }                                            │
│      })                                             │
└─────────────────┬───────────────────────────────────┘
                  │
                  ├─────────────────────────┬──────────────────────
                  │                         │
                  ▼                         ▼
┌─────────────────────────────┐  ┌──────────────────────────────┐
│   Class Page Display        │  │   Export to Markdown         │
│   (By Task View)            │  │                              │
│                             │  │   NOW INCLUDES:              │
│   getTaskStatus():          │  │   | Task | Status Light |   │
│   - Find 'cm' in cache      │  │   | CM   | 🟢 Complete |   │
│   - If complete=true:       │  │                              │
│     return 'status-green'   │  │   Makes discrepancy         │
│                             │  │   visible!                   │
│   ISSUE: Shows ⚪ (grey)    │  │                              │
│   Expected: 🟢 (green)      │  │                              │
└─────────────────────────────┘  └──────────────────────────────┘
```

## Debug Logging Added

### When Cache is Built
```javascript
[JotFormCache] CM Cache Build for C10880: {
  taskId: 'cm',
  setId: 'set3',
  isComplete: true/false,  ← Key diagnostic!
  answered: 7,
  total: 7,
  terminated: true,
  hasPostTerminationAnswers: false,
  answeredEqualsTotal: true,
  condition1: true,  // answered === total
  condition2: true   // terminated && !hasPostTerm
}
```

### When Class Page Renders
```javascript
// IF FOUND:
[ClassPage] CM Status Debug for C10880: {
  taskId: 'cm',
  complete: true/false,  ← Compare with cache build!
  answered: 7,
  total: 7,
  hasPostTerminationAnswers: false,
  setId: 'set3'
}

// IF NOT FOUND:
[ClassPage] CM NOT FOUND in cache for C10880 {
  searchTaskIds: ['cm'],
  taskName: 'CM',
  availableSets: ['set1', 'set2', 'set3', 'set4']
}
```

## Diagnostic Scenarios

### Scenario 1: Task Not Found (Most Likely)
```
Console shows: [ClassPage] CM NOT FOUND in cache for C10880

Root Cause:
- Task name mismatch ('CM' vs 'cm')
- Wrong set ID in cache
- Cache not loaded properly

Fix:
- Improve task matching logic
- Verify set ID mapping
- Check cache loading timing
```

### Scenario 2: Cache Has Wrong Data
```
Console shows: 
[JotFormCache] CM Cache Build for C10880: { isComplete: false }
[ClassPage] CM Status Debug for C10880: { complete: false }

Root Cause:
- Validation logic failing
- Missing validation data
- Incorrect condition evaluation

Fix:
- Investigate why isComplete is false
- Check TaskValidator result
- Verify condition logic
```

### Scenario 3: Stale Cache
```
Console shows old timestamp or no cache build log

Root Cause:
- Old cache being used
- Cache not rebuilding properly
- Force rebuild not working

Fix:
- Clear IndexedDB cache
- Force cache rebuild
- Check cache invalidation logic
```

## What Users See Now

### Before (Issue)
```
Class Page (By Task View):
┌──────────────┬────┐
│ Student      │ CM │
├──────────────┼────┤
│ C10880       │ ⚪ │  ← WRONG! Should be green
└──────────────┴────┘

Export:
| Task | ANS | COR | TOT | Terminated |
| CM   | 7   | 0   | 7   | ✅ Q7      |
                           ↑ Clearly complete!
```

### After (With Fix)
```
Class Page (By Task View):
┌──────────────┬────┐
│ Student      │ CM │
├──────────────┼────┤
│ C10880       │ 🟢 │  ← CORRECT!
└──────────────┴────┘

Export:
| Task | Status Light | ANS | COR | TOT | Terminated |
| CM   | 🟢 Complete  | 7   | 0   | 7   | ✅ Q7      |
           ↑ Now explicitly shown!
```

## Testing Checklist

1. ☐ Load class page C-046-12
2. ☐ Open browser console (F12)
3. ☐ Look for `[JotFormCache] CM Cache Build` log
   - Check: `isComplete` value
   - Check: `condition1` and `condition2` values
4. ☐ Look for `[ClassPage] CM Status Debug` log
   - Check: `complete` value
   - Check: `answered` value
5. ☐ Export class report
6. ☐ Check "Status Light" column for CM
7. ☐ Compare console values with export value
8. ☐ Identify discrepancy and root cause
9. ☐ Apply appropriate fix
10. ☐ Remove debug logging

## Expected Console Output (Correct Case)

```javascript
// During cache build:
[JotFormCache] Building student validation cache...
[JotFormCache] Validating 1 students...
[JotFormCache] CM Cache Build for C10880: {
  taskId: 'cm',
  setId: 'set3',
  isComplete: true,        ✅
  answered: 7,
  total: 7,
  terminated: true,
  hasPostTerminationAnswers: false,
  answeredEqualsTotal: true,
  condition1: true,        ✅ (ans === tot)
  condition2: true         ✅ (terminated && !postTerm)
}
[JotFormCache] ✅ Student validation complete: 1 students

// During class page render:
[ClassPage] CM Status Debug for C10880: {
  taskId: 'cm',
  complete: true,          ✅ Matches cache!
  answered: 7,
  total: 7,
  hasPostTerminationAnswers: false,
  setId: 'set3'
}
```

Result: Status light shows 🟢 green ✅
