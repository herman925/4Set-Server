# Cache System Quick Reference

**For:** 4Set Checking System Users  
**Last Updated:** 2025-10-23

---

## 🎯 Quick Answer: What You Need to Know

### Is Cache Deletion Comprehensive?
**YES ✅** - It deletes EVERYTHING from IndexedDB:
- JotForm submissions (all form data)
- Validation cache (student task status)
- Qualtrics cache (TGMD responses)

### Can I Fetch Data On-Demand?
**NO ❌** - Only full cache mode is available right now.

### Where's the "Switch" to Change Modes?
**DOESN'T EXIST YET ❌** - Only one mode available (full cache).

---

## 📊 Visual Guide: Cache Status

```
┌────────────────────────────────────────┐
│  System Status Pills                   │
├────────────────────────────────────────┤
│                                        │
│  🔴 System Not Ready                   │
│     ↳ No cache exists                  │
│     ↳ Click to build cache             │
│                                        │
│  🟠 Syncing 47%                        │
│     ↳ Cache building in progress       │
│     ↳ Show progress bar                │
│                                        │
│  🟢 System Ready                       │
│     ↳ Cache valid and loaded           │
│     ↳ Click to see options             │
│                                        │
└────────────────────────────────────────┘
```

---

## 🔄 What Happens When You...

### Click Red Pill (System Not Ready)
```
You → Click pill
  ↓
System → Show sync modal
  ↓
You → Click "Sync Now"
  ↓
System → Fetch JotForm (0-50%)
  ↓
System → Fetch Qualtrics (50-70%) [if credentials exist]
  ↓
System → Build validation (70-100%)
  ↓
System → Save to IndexedDB
  ↓
Pill → 🟢 Turns GREEN
  ↓
Ready to use! ✅
```

**Time:** 60-90 seconds

### Click Green Pill → "Delete Cache"
```
You → Click green pill
  ↓
System → Show cache info modal
  ↓
You → Click "Delete Cache"
  ↓
System → Show confirmation (lists 3 stores)
  ↓
You → Confirm
  ↓
System → Delete submissions cache
  ↓
System → Delete validation cache
  ↓
System → Delete Qualtrics cache
  ↓
Pill → 🔴 Turns RED
  ↓
Need to re-sync before use ⚠️
```

**Time:** Instant (but requires 60-90 sec re-sync)

### Click Green Pill → "Refresh with Qualtrics"
```
You → Click green pill
  ↓
System → Show cache info modal
  ↓
You → Click "Refresh with Qualtrics"
  ↓
System → Fetch TGMD data from Qualtrics
  ↓
System → Merge with existing JotForm cache
  ↓
System → Update Qualtrics cache only
  ↓
Pill → 🟢 Stays GREEN
  ↓
Ready to use! ✅
```

**Time:** ~30 seconds (faster than full delete)

---

## 💾 What's Stored in IndexedDB

```
JotFormCacheDB (IndexedDB Database)
│
├── 📦 cache (store)
│   └── jotform_global_cache
│       ├── 500-2000 submissions
│       ├── ~20-40 MB size
│       └── Expires: 1 hour
│
├── 📦 student_validation (store)
│   └── validation_cache
│       ├── Pre-computed task status
│       ├── One entry per student
│       └── Rebuilds when submissions change
│
└── 📦 qualtrics_cache (store)
    └── qualtrics_responses
        ├── TGMD survey data
        ├── Merged with JotForm
        └── No expiration (manual refresh)
```

---

## 🤔 Decision Tree: Which Option?

```
START: Need fresh data?
  │
  ├─ YES → Need TGMD data specifically?
  │   │
  │   ├─ YES → Use "Refresh with Qualtrics"
  │   │         (30 sec, keeps JotForm cache)
  │   │
  │   └─ NO → Use "Delete Cache"
  │             (90 sec, purges everything)
  │
  └─ NO → System working fine?
      │
      ├─ YES → Do nothing! ✅
      │
      └─ NO → Troubleshooting needed?
              └─ Try "Delete Cache" first
                 (forces complete refresh)
```

---

## 📋 Common Scenarios

### Scenario 1: "Data looks outdated"
**Solution:** Delete Cache → Re-sync
- Purges all 3 stores
- Forces fresh API fetch
- Takes 90 seconds

### Scenario 2: "TGMD data missing/wrong"
**Solution:** Refresh with Qualtrics
- Only re-syncs TGMD data
- Keeps JotForm cache intact
- Takes 30 seconds

### Scenario 3: "System very slow"
**Solution:** Try these in order:
1. Close other browser tabs
2. Clear browser cache (Ctrl+Shift+R)
3. Delete IndexedDB cache (via green pill)
4. Restart browser

### Scenario 4: "Just opened system"
**Solution:** Wait for cache to build
- First time: 60-90 seconds
- After that: Instant (uses cache)
- Cache expires after 1 hour

---

## ⚠️ Common Misconceptions

| ❌ Wrong Assumption | ✅ Reality |
|---------------------|------------|
| "Delete only clears old data" | Deletes ALL 3 stores completely |
| "Can fetch individual students" | Only full cache mode available |
| "There's a toggle to change modes" | No toggle - only one mode exists |
| "Data deleted from JotForm" | Only local cache deleted, JotForm untouched |
| "Need to delete every hour" | Cache auto-expires, but system handles it |

---

## 🚀 Best Practices

### Daily Use
- ✅ Let cache expire naturally (1 hour)
- ✅ Use "Refresh Qualtrics" for TGMD updates
- ✅ Delete cache if you suspect data issues

### Don't Do This
- ❌ Delete cache every time you open system
- ❌ Delete cache multiple times in a row
- ❌ Expect on-demand fetch (not implemented)
- ❌ Try to "switch" modes (no switch exists)

### When to Delete Cache
- Data looks incorrect/outdated
- After major JotForm changes
- Troubleshooting data issues
- System behaving strangely
- Been offline for extended period

---

## 📚 Where to Learn More

- **User Guide:** `USER_GUIDE_CHECKING_SYSTEM.md` → Cache Management section
- **Technical Spec:** `CACHE_SYSTEM_STATUS.md` → Full implementation details
- **Issue Resolution:** `ISSUE_RESOLUTION_CACHE.md` → Answers to specific questions

---

## 🔧 Troubleshooting Quick Fixes

| Problem | Quick Fix |
|---------|-----------|
| Sync stuck at X% | Close modal, refresh page (Ctrl+R), try again |
| Green pill but no data | Delete cache → Re-sync |
| "System Not Ready" won't go away | Check browser console (F12) for errors |
| Very slow performance | Clear browser cache (Ctrl+Shift+R) |
| Can't delete cache | Use DevTools → Application → Clear Storage |

---

## 💡 Pro Tips

1. **Check cache age before deleting**
   - Click green pill to see "synced X minutes ago"
   - If < 5 minutes, deletion probably unnecessary

2. **Use Qualtrics refresh when possible**
   - Faster than full delete (30s vs 90s)
   - Preserves JotForm cache

3. **Don't worry about "wasting" the cache**
   - Deleting is safe - data re-fetches from API
   - No permanent data loss

4. **Monitor the status pill**
   - Red = Need to sync
   - Orange = Syncing now
   - Green = Ready to go

---

**Need Help?** See full documentation or contact support.
