# Data Flow Documentation: JotForm Extraction & Merge Mechanisms

## Purpose
This document clarifies the unified data flow mechanism in the 4Set system per issue #121 investigation.

## Unified Data Schema: Answer Objects

**Key Principle:** Both JotForm and Qualtrics data are transformed to use the **same answer object schema** that TaskValidator expects.

```javascript
// Answer Object Schema (used by both sources)
{
  fieldName: {
    answer: "value",
    text: "value", 
    name: "fieldName"
  }
}
```

This ensures TaskValidator (the source of truth) can process both data sources without modification.

## Production & Test Pipeline Flow (Now Aligned)

```
┌─────────────┐     ┌──────────────┐
│ JotForm API │     │ Qualtrics API│
└──────┬──────┘     └──────┬───────┘
       │                   │
       ▼                   ▼
  Transform to         Transform to
  answer objects       answer objects
  { answer, text }     { answer, text }
       │                   │
       └───────┬───────────┘
               ▼
      ┌────────────────┐
      │  DataMerger    │
      │ - Grade-aware  │
      │ - Earliest wins│
      │ - Answer objs  │
      └────────┬───────┘
               │
               ▼
      ┌────────────────┐
      │ TaskValidator  │
      │ - Expects      │
      │   answer objs  │
      └────────────────┘
```

## Data Transformation

### JotForm Transformation
**Location:** `TEMP/test-pipeline-core-id.html` (test) / `assets/js/jotform-cache.js` (production)

```javascript
// Store FULL answer objects from JotForm API
for (const [qid, answerObj] of Object.entries(submission.answers)) {
  if (!answerObj.name || !answerObj.answer) continue;
  
  // answerObj already has the correct schema from JotForm API
  record[answerObj.name] = answerObj; // { answer, text, name, type, ... }
}
```

### Qualtrics Transformation  
**Location:** `TEMP/qualtrics-transformer-test.js`

```javascript
// Create answer objects to match JotForm schema
const value = this.extractValue(response.values, qidSpec);
if (value !== '') {
  result[fieldName] = {
    answer: value,
    text: value,
    name: fieldName
  };
}
```

## DataMerger: Answer Object Aware

**Location:** `assets/js/data-merger.js`

The DataMerger now:
1. **Extracts values** from answer objects for comparison
2. **Stores answer objects** (not raw values) in merged results
3. **Compares actual values** while preserving object structure

```javascript
// Extract value helper
extractAnswerValue(answerObj) {
  if (typeof answerObj === 'object' && answerObj !== null) {
    return answerObj.answer || answerObj.text || null;
  }
  return answerObj; // fallback for primitives
}

// Merge logic
const jotformValue = this.extractAnswerValue(jotformAnswerObj);
const qualtricsValue = this.extractAnswerValue(qualtricsAnswerObj);

// Compare values, but store answer objects
if (qualtricsTimestamp < jotformTimestamp) {
  merged[key] = qualtricsAnswerObj; // Store object, not value
}
```

## Merge Strategy: "Earliest Non-Empty Wins"

Both production and test use the same principle:

1. **Sort by timestamp** (earliest first)
2. **Extract values** from answer objects for comparison
3. **Keep earliest answer object** when conflicts occur
4. **Preserve object structure** for TaskValidator

## Grade-Based Grouping

Data is grouped by (CoreID, Grade) to prevent cross-grade merging:
- K1 data merges with K1 data only
- K2 data merges with K2 data only  
- K3 data merges with K3 data only

## TaskValidator Compatibility

TaskValidator expects answer objects and extracts values like:
```javascript
let studentAnswer = mergedAnswers[questionId]?.answer || 
                    mergedAnswers[questionId]?.text || 
                    null;
```

Since both JotForm and Qualtrics now produce answer objects, TaskValidator works correctly with both sources **without modification**.

## Changes Made (Revised Approach)

### 1. Test Pipeline JotForm Transformation
**File:** `TEMP/test-pipeline-core-id.html`

**Changed:** Store full answer objects instead of raw values
```javascript
// Before: record[answerObj.name] = value;
// After:  record[answerObj.name] = answerObj;
```

### 2. Qualtrics Transformer
**File:** `TEMP/qualtrics-transformer-test.js`

**Changed:** Create answer objects to match JotForm schema
```javascript
// Before: result[fieldName] = value;
// After:  result[fieldName] = { answer: value, text: value, name: fieldName };
```

### 3. DataMerger Enhancement
**File:** `assets/js/data-merger.js`

**Added:** `extractAnswerValue()` helper method  
**Updated:** Merge logic to handle answer objects instead of raw values

### 4. TaskValidator
**File:** `assets/js/task-validator.js`

**Status:** **NO CHANGES** - Works as designed with answer objects

## Why This Approach is Better

✅ **TaskValidator unchanged** - It's the source of truth for validation  
✅ **Data adapts to validator** - Not the other way around  
✅ **Unified schema** - Both sources use answer objects  
✅ **Production-aligned** - Test pipeline replicates production schema  
✅ **Maintainable** - Single validation logic, no dual-format handling  

## Verification Checklist

- [x] JotForm transformation produces answer objects
- [x] Qualtrics transformation produces answer objects
- [x] DataMerger handles answer objects correctly
- [x] TaskValidator unchanged (uses answer objects as designed)
- [x] Merge strategy is "earliest non-empty wins"
- [x] Grade-based grouping prevents cross-grade merging

## Conclusion

The alignment issue has been **RESOLVED** by adapting the data to fit TaskValidator's schema, rather than modifying TaskValidator to handle multiple formats.

**Key Insight:** TaskValidator is the source of truth. The data transformation layer should produce what TaskValidator expects (answer objects), not the other way around.

---

**Document Version:** 2.0  
**Last Updated:** 2025-10-27  
**Related Issue:** #121, #122
