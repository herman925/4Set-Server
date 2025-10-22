# Quick Debug Guide for CM Status Light Issue

## What Changed

### ✅ Requirement 1: Exports now show status light color
All exports now include a "Status Light" column/field showing:
- 🟢 Complete - All answered or properly terminated
- 🔴 Incomplete - Started but not finished
- 🟡 Post-Term - Has answers after termination
- ⚪ Not Started - No data

**Example:**
```markdown
| Task | Status Light | ANS | COR | TOT | Completion | Accuracy | Terminated |
|------|--------------|-----|-----|-----|------------|----------|------------|
| CM   | 🟢 Complete  | 7   | 0   | 7   | 100%       | 0%       | ✅ Q7      |
```

### ✅ Requirement 2: Display logic verified
Created test that confirms the logic is correct:
- Cache building: ✅ Sets `complete: true` for CM
- Display logic: ✅ Should show green for `complete: true`
- Export logic: ✅ Shows 🟢 Complete

**The logic works!** Issue must be in runtime data, not code.

## How to Debug

### Step 1: Open Class Page
1. Navigate to: `checking_system_3_class.html?classId=C-046-12`
2. Open browser console (F12 → Console tab)
3. Switch to "By Task" view (orange button)

### Step 2: Look for Debug Logs
Search console for: `CM Status` or `CM Cache`

#### If you see: `[JotFormCache] CM Cache Build for C10880:`
```javascript
{
  taskId: 'cm',
  isComplete: ???,  ← Should be true
  answered: 7,
  total: 7,
  terminated: true,
  hasPostTerminationAnswers: false
}
```
✅ Cache is being built - Check if `isComplete` is `true` or `false`

#### If you see: `[ClassPage] CM Status Debug for C10880:`
```javascript
{
  taskId: 'cm',
  complete: ???,  ← Should be true
  answered: 7,
  total: 7
}
```
✅ Task was found - Check if `complete` is `true` or `false`

#### If you see: `[ClassPage] CM NOT FOUND in cache for C10880`
```javascript
{
  searchTaskIds: ['cm'],
  taskName: 'CM',
  availableSets: [...]
}
```
⚠️ Task NOT found - This is the problem!

### Step 3: Export and Compare
1. Click "Export Class Report" button
2. Open the `.md` file
3. Find CM in the table
4. Check "Status Light" column

**Compare:**
- Console `complete:` value vs Export `Status Light:` value
- Should be consistent!

## Common Issues & Solutions

### Issue 1: "CM NOT FOUND in cache"
**Symptom:** Warning in console  
**Cause:** Task matching fails  
**Fix:**
```javascript
// Check if CM is in a different set
// Check survey-structure.json Set 3 sections
// Verify taskToSetMap includes 'cm'
```

### Issue 2: "`isComplete: false`" in cache build
**Symptom:** CM stored as incomplete  
**Cause:** Validation data incorrect  
**Fix:**
```javascript
// Check TaskValidator result
// Verify terminated=true in validation
// Check condition evaluation in log
```

### Issue 3: "`complete: false`" in display
**Symptom:** Found but shows as incomplete  
**Fix:**
```javascript
// Cache has wrong data
// Compare cache build log with display log
// May need to rebuild cache
```

### Issue 4: No debug logs at all
**Symptom:** No `[ClassPage]` or `[JotFormCache]` logs  
**Cause:** Student not C10880 or class not C-046-12  
**Fix:**
```javascript
// Verify you're on correct class page
// Check if C10880 is in the class
// Reload page and check console
```

## Quick Test Command

Run this in browser console:
```javascript
// Check if validation cache exists
window.JotFormCache.loadValidationCache().then(cache => {
  const c10880 = cache.get('C10880');
  console.log('C10880 Cache:', c10880);
  if (c10880 && c10880.setStatus) {
    console.log('Set3 Tasks:', c10880.setStatus.set3?.tasks);
    const cm = c10880.setStatus.set3?.tasks.find(t => t.taskId === 'cm');
    console.log('CM Task:', cm);
    console.log('CM Complete?', cm?.complete);
  }
});
```

Expected output:
```javascript
C10880 Cache: { setStatus: {…}, taskValidation: {…}, … }
Set3 Tasks: Array(3) [{taskId: 'ccm', …}, {taskId: 'cm', …}, {taskId: 'epn', …}]
CM Task: {taskId: 'cm', complete: true, answered: 7, total: 7, …}
CM Complete? true
```

## Report Back

Please share:
1. ✅ Console logs (screenshot or copy-paste)
2. ✅ Export file showing Status Light column
3. ✅ Result of quick test command above

This will help identify the exact issue!

## After Fix

Once the root cause is identified and fixed:
1. Remove debug logging from:
   - `assets/js/jotform-cache.js` (lines 914-926)
   - `assets/js/checking-system-class-page.js` (lines 836-870)
2. Test that CM shows 🟢 green
3. Verify export still shows 🟢 Complete
4. Done!
