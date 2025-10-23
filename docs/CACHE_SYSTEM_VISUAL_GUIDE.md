# Cache System - Visual Guide

> **Purpose**: Visual walkthrough of cache management UI and workflows

---

## 🎯 Where to Find Cache Controls

### Location: checking_system_home.html
Status Pill is in the top-right corner of the page, next to "Last Synced" timestamp.

---

## 🟢 GREEN Pill: System Ready

### What It Means
- ✅ Cache exists in IndexedDB
- ✅ Cache is valid (<1 hour old)
- ✅ Ready to navigate to any page

### Click Action
Opens modal with "Delete Cache" button to purge cache

---

## 🔴 RED Pill: System Not Ready

### What It Means
- ❌ Cache does NOT exist or has expired
- ❌ Must rebuild before use

### Click Action
Opens modal with "Sync" button to rebuild cache from JotForm API

---

## 🎬 Quick Workflow: Delete and Rebuild Cache

```
Step 1: Click GREEN pill → "Delete Cache" → Confirm
Step 2: Click RED pill → "Sync" → Wait 30-60 sec
✅ Done! Fresh data loaded from JotForm
```

---

**Related Docs**: 
- `CACHE_SYSTEM_SUMMARY.md` - Quick reference
- `PRDs/cache_system_analysis.md` - Complete analysis
