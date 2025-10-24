/**
 * Data Merger Module
 * 
 * Purpose: Merge JotForm and Qualtrics datasets with conflict resolution
 * Key Principle: Qualtrics data takes precedence for TGMD fields
 */

(() => {
  /**
   * Data Merger
   */
  class DataMerger {
    constructor() {
      // Configuration
      this.tgmdFieldPrefix = 'TGMD_';
    }

    /**
     * Merge JotForm and Qualtrics datasets by coreId
     * Strategy:
     * 1. Sort Qualtrics records by date (earliest first)
     * 2. Group all records by coreId (multiple submissions possible)
     * 3. For each coreId, merge Qualtrics records using earliest non-empty value wins
     * 4. Merge grouped Qualtrics TGMD data into JotForm submissions
     * 
     * This matches JotForm's merge principle (line 779 in jotform-cache.js):
     * "Sort by created_at (earliest first), earliest non-empty value wins"
     * 
     * @param {Array} jotformData - JotForm submissions
     * @param {Array} qualtricsData - Transformed Qualtrics responses
     * @returns {Array} Merged records
     */
    mergeDataSources(jotformData, qualtricsData) {
      console.log('[DataMerger] ========== MERGING DATA SOURCES ==========');
      console.log('[DataMerger] JotForm records:', jotformData.length);
      console.log('[DataMerger] Qualtrics records:', qualtricsData.length);

      // Step 1: Sort Qualtrics records by date (earliest first) to match JotForm merge logic
      const sortedQualtricsData = qualtricsData.sort((a, b) => {
        const dateA = a._meta?.startDate ? new Date(a._meta.startDate) : new Date(0);
        const dateB = b._meta?.startDate ? new Date(b._meta.startDate) : new Date(0);
        return dateA - dateB;
      });

      // Step 2: Group Qualtrics records by coreId and merge multiple responses
      const qualtricsByCoreId = new Map(); // coreId → merged TGMD data
      
      for (const record of sortedQualtricsData) {
        const coreId = record.coreId;
        if (!coreId) {
          console.warn('[DataMerger] Qualtrics record missing coreId, skipping:', record._meta?.qualtricsResponseId);
          continue;
        }

        if (qualtricsByCoreId.has(coreId)) {
          // Multiple Qualtrics responses for same student - merge TGMD fields
          const existing = qualtricsByCoreId.get(coreId);
          const merged = this.mergeMultipleQualtricsRecords(existing, record);
          qualtricsByCoreId.set(coreId, merged);
          console.log(`[DataMerger] Merged multiple Qualtrics responses for ${coreId}`);
        } else {
          qualtricsByCoreId.set(coreId, record);
        }
      }

      console.log(`[DataMerger] Grouped Qualtrics data into ${qualtricsByCoreId.size} unique students`);

      // Step 3: Process JotForm records and merge with Qualtrics
      const mergedRecords = [];
      let jotformOnlyCount = 0;
      let mergedWithQualtricsCount = 0;

      for (const jotformRecord of jotformData) {
        const coreId = jotformRecord.coreId;
        if (!coreId) {
          console.warn('[DataMerger] JotForm record missing coreId, skipping');
          continue;
        }

        if (qualtricsByCoreId.has(coreId)) {
          // Merge Qualtrics TGMD data into this JotForm record
          const qualtricsData = qualtricsByCoreId.get(coreId);
          const merged = this.mergeTGMDFields(jotformRecord, qualtricsData);
          mergedRecords.push(merged);
          mergedWithQualtricsCount++;
          
          console.log(`[DataMerger] ✓ Matched and merged TGMD for student ${coreId}`);
        } else {
          // JotForm-only record
          mergedRecords.push({
            ...jotformRecord,
            _sources: ['jotform']
          });
          jotformOnlyCount++;
        }
      }

      // Step 4: Add Qualtrics-only records (students not in JotForm)
      const jotformCoreIds = new Set(jotformData.map(r => r.coreId).filter(Boolean));
      let qualtricsOnlyCount = 0;

      for (const [coreId, qualtricsRecord] of qualtricsByCoreId.entries()) {
        if (!jotformCoreIds.has(coreId)) {
          mergedRecords.push({
            ...qualtricsRecord,
            _sources: ['qualtrics'],
            _orphaned: true // Flag as Qualtrics-only
          });
          qualtricsOnlyCount++;
          console.log(`[DataMerger] ℹ️  Qualtrics-only record for student ${coreId} - no JotForm match`);
        }
      }

      console.log(`[DataMerger] Merge complete: ${mergedRecords.length} total records`);
      console.log(`[DataMerger] - ${mergedWithQualtricsCount} merged (JotForm + Qualtrics)`);
      console.log(`[DataMerger] - ${jotformOnlyCount} JotForm-only records`);
      console.log(`[DataMerger] - ${qualtricsOnlyCount} Qualtrics-only records`);

      return mergedRecords;
    }

    /**
     * Merge multiple Qualtrics responses for the same student
     * Uses earliest non-empty value principle (matches JotForm merge logic)
     * @param {Object} record1 - First (earlier) Qualtrics record
     * @param {Object} record2 - Second (later) Qualtrics record
     * @returns {Object} Merged record
     */
    mergeMultipleQualtricsRecords(record1, record2) {
      const merged = { ...record1 };

      // Merge TGMD fields - ONLY fill in if not already present (earliest non-empty value wins)
      // This matches JotForm's merge principle: line 779 in jotform-cache.js
      for (const [key, value] of Object.entries(record2)) {
        if (key.startsWith(this.tgmdFieldPrefix) && value) {
          // Only set if not already present (earliest wins)
          if (!merged[key]) {
            merged[key] = value;
          }
        }
      }

      // Track that we had multiple responses
      merged._meta = {
        ...(merged._meta || {}),
        multipleResponses: true,
        mergedResponseCount: (merged._meta?.mergedResponseCount || 1) + 1
      };

      return merged;
    }

    /**
     * Merge TGMD fields with conflict detection
     * @param {Object} jotformRecord - Base JotForm record
     * @param {Object} qualtricsRecord - Qualtrics record with TGMD data
     * @returns {Object} Merged record with conflict metadata
     */
    mergeTGMDFields(jotformRecord, qualtricsRecord) {
      const merged = { ...jotformRecord };
      const conflicts = [];

      // Extract TGMD fields from Qualtrics
      for (const [key, value] of Object.entries(qualtricsRecord)) {
        // Skip non-TGMD fields and metadata
        if (!key.startsWith(this.tgmdFieldPrefix)) {
          continue;
        }

        const jotformValue = jotformRecord[key];
        const qualtricsValue = value;

        // Detect conflicts (both have values but they differ)
        if (jotformValue && qualtricsValue && jotformValue !== qualtricsValue) {
          conflicts.push({
            field: key,
            jotform: jotformValue,
            qualtrics: qualtricsValue,
            resolution: 'qualtrics' // Always use Qualtrics value
          });
        }

        // Always use Qualtrics value for TGMD fields
        merged[key] = qualtricsValue;
      }

      // Update metadata
      merged._sources = ['jotform', 'qualtrics'];
      merged._tgmdSource = 'qualtrics';

      if (conflicts.length > 0) {
        merged._tgmdConflicts = conflicts;
        
        // Log merge details
        const coreId = jotformRecord.coreId;
        console.log(`[DataMerger] Merged TGMD for student ${coreId}: ${conflicts.length} conflicts resolved, ${Object.keys(qualtricsRecord).filter(k => k.startsWith(this.tgmdFieldPrefix)).length} TGMD fields from Qualtrics`);
      }

      // Preserve Qualtrics metadata
      if (qualtricsRecord._meta) {
        merged._meta = {
          ...merged._meta,
          qualtricsResponseId: qualtricsRecord._meta.qualtricsResponseId,
          qualtricsRetrievedAt: qualtricsRecord._meta.retrievedAt,
          qualtricsStartDate: qualtricsRecord._meta.startDate,
          qualtricsEndDate: qualtricsRecord._meta.endDate
        };
      }

      return merged;
    }

    /**
     * Validate merged data and generate statistics
     * @param {Array} mergedRecords - Array of merged records
     * @returns {Object} Validation statistics
     */
    validateMergedData(mergedRecords) {
      console.log('[DataMerger] Validating merged data...');

      const validation = {
        total: mergedRecords.length,
        withTGMD: 0,
        tgmdFromQualtrics: 0,
        tgmdFromJotform: 0,
        tgmdConflicts: 0,
        qualtricsOnly: 0,
        missingTGMD: [],
        conflictDetails: []
      };

      for (const record of mergedRecords) {
        // Check if has any TGMD data
        const hasTGMD = Object.keys(record).some(key => 
          key.startsWith(this.tgmdFieldPrefix) && record[key]
        );

        if (hasTGMD) {
          validation.withTGMD++;

          // Determine source
          if (record._tgmdSource === 'qualtrics') {
            validation.tgmdFromQualtrics++;
          } else if (record._sources && record._sources.includes('jotform')) {
            validation.tgmdFromJotform++;
          }

          // Check for conflicts
          if (record._tgmdConflicts && record._tgmdConflicts.length > 0) {
            validation.tgmdConflicts++;
            validation.conflictDetails.push({
              coreId: record.coreId,
              studentId: record['student-id'],
              childName: record['child-name'],
              conflicts: record._tgmdConflicts
            });
          }
        } else {
          validation.missingTGMD.push({
            coreId: record.coreId,
            studentId: record['student-id'],
            sources: record._sources
          });
        }

        // Track Qualtrics-only records
        if (record._orphaned) {
          validation.qualtricsOnly++;
        }
      }

      console.log('[DataMerger] Validation complete:', {
        total: validation.total,
        withTGMD: validation.withTGMD,
        tgmdFromQualtrics: validation.tgmdFromQualtrics,
        tgmdFromJotform: validation.tgmdFromJotform,
        tgmdConflicts: validation.tgmdConflicts,
        qualtricsOnly: validation.qualtricsOnly,
        missingTGMD: validation.missingTGMD.length
      });

      return validation;
    }

    /**
     * Get conflict summary for UI display
     * @param {Array} mergedRecords - Array of merged records
     * @returns {Array} Array of conflict summaries
     */
    getConflictSummary(mergedRecords) {
      const conflicts = [];

      for (const record of mergedRecords) {
        if (record._tgmdConflicts && record._tgmdConflicts.length > 0) {
          conflicts.push({
            coreId: record.coreId,
            studentId: record['student-id'],
            studentName: record['child-name'],
            schoolId: record['school-id'],
            conflictCount: record._tgmdConflicts.length,
            conflicts: record._tgmdConflicts
          });
        }
      }

      return conflicts;
    }

    /**
     * Export conflicts to CSV format
     * @param {Array} mergedRecords - Array of merged records
     * @returns {string} CSV content
     */
    exportConflictsToCSV(mergedRecords) {
      const conflicts = this.getConflictSummary(mergedRecords);
      
      if (conflicts.length === 0) {
        return 'No conflicts to export';
      }

      const csvRows = [];
      
      // Header
      csvRows.push('CoreID,Student ID,Student Name,School ID,Field,JotForm Value,Qualtrics Value,Resolution');

      // Data rows
      for (const record of conflicts) {
        for (const conflict of record.conflicts) {
          csvRows.push([
            record.coreId,
            record.studentId,
            record.studentName,
            record.schoolId,
            conflict.field,
            conflict.jotform,
            conflict.qualtrics,
            conflict.resolution
          ].join(','));
        }
      }

      return csvRows.join('\n');
    }

    /**
     * Filter records by data source
     * @param {Array} mergedRecords - Array of merged records
     * @param {string} source - 'jotform', 'qualtrics', or 'both'
     * @returns {Array} Filtered records
     */
    filterBySource(mergedRecords, source) {
      if (source === 'both') {
        return mergedRecords.filter(r => 
          r._sources && 
          r._sources.includes('jotform') && 
          r._sources.includes('qualtrics')
        );
      }

      return mergedRecords.filter(r => 
        r._sources && r._sources.includes(source)
      );
    }

    /**
     * Get merge statistics summary
     * @param {Object} validation - Validation results from validateMergedData
     * @returns {Object} Summary statistics
     */
    getSummaryStats(validation) {
      return {
        totalRecords: validation.total,
        recordsWithTGMD: validation.withTGMD,
        tgmdCoveragePercent: validation.total > 0 
          ? Math.round((validation.withTGMD / validation.total) * 100) 
          : 0,
        qualtricsDataUsage: validation.tgmdFromQualtrics,
        jotformDataUsage: validation.tgmdFromJotform,
        conflictCount: validation.tgmdConflicts,
        conflictRate: validation.withTGMD > 0
          ? Math.round((validation.tgmdConflicts / validation.withTGMD) * 100)
          : 0,
        qualtricsOnlyRecords: validation.qualtricsOnly
      };
    }
  }

  // Expose globally
  window.DataMerger = DataMerger;
  console.log('[DataMerger] Module loaded');
})();
