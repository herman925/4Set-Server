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
     * Merge JotForm and Qualtrics datasets by sessionkey
     * @param {Array} jotformData - JotForm submissions
     * @param {Array} qualtricsData - Transformed Qualtrics responses
     * @returns {Array} Merged records
     */
    mergeDataSources(jotformData, qualtricsData) {
      console.log('[DataMerger] ========== MERGING DATA SOURCES ==========');
      console.log('[DataMerger] JotForm records:', jotformData.length);
      console.log('[DataMerger] Qualtrics records:', qualtricsData.length);

      const merged = new Map(); // sessionkey → merged record

      // Step 1: Add all JotForm records as base
      for (const record of jotformData) {
        const key = record.sessionkey;
        if (!key) {
          console.warn('[DataMerger] JotForm record missing sessionkey, skipping');
          continue;
        }

        merged.set(key, {
          ...record,
          _sources: ['jotform']
        });
      }

      // Step 2: Merge Qualtrics records
      let qualtricsOnlyCount = 0;
      let mergedCount = 0;

      for (const record of qualtricsData) {
        const key = record.sessionkey;
        if (!key) {
          console.warn('[DataMerger] Qualtrics record missing sessionkey, skipping:', record._meta?.qualtricsResponseId);
          continue;
        }

        if (merged.has(key)) {
          // Existing record - merge TGMD fields
          const existing = merged.get(key);
          const mergedRecord = this.mergeTGMDFields(existing, record);
          merged.set(key, mergedRecord);
          mergedCount++;
        } else {
          // New record from Qualtrics (no matching JotForm record)
          merged.set(key, {
            ...record,
            _sources: ['qualtrics'],
            _orphaned: true // Flag as Qualtrics-only
          });
          qualtricsOnlyCount++;
        }
      }

      console.log(`[DataMerger] Merge complete: ${merged.size} total records`);
      console.log(`[DataMerger] - ${mergedCount} merged (JotForm + Qualtrics)`);
      console.log(`[DataMerger] - ${qualtricsOnlyCount} Qualtrics-only records`);

      return Array.from(merged.values());
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
        
        // Log merge details for specific student if requested
        const studentId = jotformRecord['student-id'] || jotformRecord.sessionkey?.split('_')[0];
        console.log(`[DataMerger] Merged TGMD for student ${studentId} (sessionkey: ${jotformRecord.sessionkey}): ${conflicts.length} conflicts resolved, ${Object.keys(qualtricsRecord).filter(k => k.startsWith(this.tgmdFieldPrefix)).length} TGMD fields from Qualtrics`);
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
              sessionkey: record.sessionkey,
              studentId: record['student-id'],
              childName: record['child-name'],
              conflicts: record._tgmdConflicts
            });
          }
        } else {
          validation.missingTGMD.push({
            sessionkey: record.sessionkey,
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
            sessionkey: record.sessionkey,
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
      csvRows.push('Sessionkey,Student ID,Student Name,School ID,Field,JotForm Value,Qualtrics Value,Resolution');

      // Data rows
      for (const record of conflicts) {
        for (const conflict of record.conflicts) {
          csvRows.push([
            record.sessionkey,
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
