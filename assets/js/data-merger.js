/**
 * Data Merger Module
 * 
 * Purpose: Merge JotForm and Qualtrics datasets with conflict resolution
 * Strategy: Qualtrics takes precedence for TGMD fields, JotForm for all others
 * 
 * Based on: PRDs/qualtrics_implementation_plan.md Section 3
 */

(() => {
  class DataMerger {
    /**
     * Merge JotForm and Qualtrics datasets by sessionkey
     * @param {Array} jotformData - JotForm submissions
     * @param {Array} qualtricsData - Transformed Qualtrics responses
     * @returns {Array} Merged records
     */
    mergeDataSources(jotformData, qualtricsData) {
      console.log(`[DataMerger] Merging ${jotformData.length} JotForm + ${qualtricsData.length} Qualtrics records`);

      const merged = new Map(); // sessionkey → merged record

      // Step 1: Add all JotForm records as base
      for (const record of jotformData) {
        const key = record.sessionkey;
        if (key) {
          merged.set(key, {
            ...record,
            _sources: ['jotform']
          });
        }
      }

      // Step 2: Merge Qualtrics records
      for (const record of qualtricsData) {
        const key = record.sessionkey;
        if (!key) {
          console.warn('[DataMerger] Skipping Qualtrics record without sessionkey');
          continue;
        }

        if (merged.has(key)) {
          // Existing record - merge TGMD fields
          const existing = merged.get(key);
          const mergedRecord = this.mergeTGMDFields(existing, record);
          merged.set(key, mergedRecord);
        } else {
          // New record from Qualtrics only
          merged.set(key, {
            ...record,
            _sources: ['qualtrics']
          });
        }
      }

      const result = Array.from(merged.values());
      console.log(`[DataMerger] Merged into ${result.length} records`);
      return result;
    }

    /**
     * Merge TGMD fields from Qualtrics into JotForm record
     * @param {Object} jotformRecord - Base JotForm record
     * @param {Object} qualtricsRecord - Qualtrics record with TGMD data
     * @returns {Object} Merged record with conflict metadata
     */
    mergeTGMDFields(jotformRecord, qualtricsRecord) {
      const merged = { ...jotformRecord };
      const conflicts = [];

      // Extract all TGMD fields from Qualtrics
      for (const [key, value] of Object.entries(qualtricsRecord)) {
        // Only merge TGMD fields
        if (!key.startsWith('TGMD_')) {
          continue;
        }

        const jotformValue = jotformRecord[key];
        const qualtricsValue = value;

        // Detect conflicts (both have values and they differ)
        if (jotformValue && qualtricsValue && jotformValue !== qualtricsValue) {
          // Normalize for comparison (empty string vs undefined, etc.)
          const jVal = String(jotformValue).trim();
          const qVal = String(qualtricsValue).trim();
          
          if (jVal !== qVal && jVal !== '' && qVal !== '') {
            conflicts.push({
              field: key,
              jotform: jotformValue,
              qualtrics: qualtricsValue,
              resolution: 'qualtrics'
            });
          }
        }

        // Always use Qualtrics value for TGMD fields (precedence rule)
        if (qualtricsValue !== null && qualtricsValue !== undefined && qualtricsValue !== '') {
          merged[key] = qualtricsValue;
        }
      }

      // Update metadata
      merged._sources = ['jotform', 'qualtrics'];
      merged._tgmdSource = 'qualtrics';
      
      if (conflicts.length > 0) {
        merged._tgmdConflicts = conflicts;
        console.log(`[DataMerger] Detected ${conflicts.length} conflicts for ${merged.sessionkey}`);
      }

      // Preserve Qualtrics metadata
      if (qualtricsRecord._meta) {
        merged._meta = {
          ...merged._meta,
          ...qualtricsRecord._meta
        };
      }

      return merged;
    }

    /**
     * Validate merged dataset and generate statistics
     * @param {Array} mergedRecords - Merged records
     * @returns {Object} Validation statistics
     */
    validateMergedData(mergedRecords) {
      const validation = {
        total: mergedRecords.length,
        withTGMD: 0,
        tgmdFromQualtrics: 0,
        tgmdFromJotform: 0,
        tgmdConflicts: 0,
        totalConflicts: 0,
        missingTGMD: [],
        qualtricsOnly: 0,
        jotformOnly: 0
      };

      for (const record of mergedRecords) {
        // Check if record has TGMD data
        const hasTGMD = record['TGMD_Hand'] || record['TGMD_Leg'] || 
                        Object.keys(record).some(k => k.startsWith('TGMD_'));

        if (hasTGMD) {
          validation.withTGMD++;

          // Track data source
          if (record._tgmdSource === 'qualtrics') {
            validation.tgmdFromQualtrics++;
          } else if (record._sources && record._sources.includes('jotform')) {
            validation.tgmdFromJotform++;
          }

          // Track conflicts
          if (record._tgmdConflicts) {
            validation.tgmdConflicts++;
            validation.totalConflicts += record._tgmdConflicts.length;
          }
        } else {
          validation.missingTGMD.push(record.sessionkey);
        }

        // Track source-only records
        if (record._sources && record._sources.length === 1) {
          if (record._sources[0] === 'qualtrics') {
            validation.qualtricsOnly++;
          } else if (record._sources[0] === 'jotform') {
            validation.jotformOnly++;
          }
        }
      }

      console.log('[DataMerger] Validation summary:', {
        total: validation.total,
        withTGMD: validation.withTGMD,
        fromQualtrics: validation.tgmdFromQualtrics,
        fromJotform: validation.tgmdFromJotform,
        conflicts: validation.tgmdConflicts,
        qualtricsOnly: validation.qualtricsOnly,
        jotformOnly: validation.jotformOnly
      });

      return validation;
    }

    /**
     * Extract conflict summary for reporting
     * @param {Array} mergedRecords - Merged records
     * @returns {Array} Array of conflict details
     */
    extractConflicts(mergedRecords) {
      const conflicts = [];

      for (const record of mergedRecords) {
        if (record._tgmdConflicts && record._tgmdConflicts.length > 0) {
          conflicts.push({
            sessionkey: record.sessionkey,
            studentId: record['student-id'],
            studentName: record['child-name'],
            conflicts: record._tgmdConflicts
          });
        }
      }

      return conflicts;
    }

    /**
     * Generate merge report for UI display
     * @param {Object} validation - Validation statistics
     * @param {Array} conflicts - Conflict details
     * @returns {Object} Report object
     */
    generateMergeReport(validation, conflicts) {
      return {
        summary: {
          total: validation.total,
          withTGMD: validation.withTGMD,
          tgmdFromQualtrics: validation.tgmdFromQualtrics,
          tgmdFromJotform: validation.tgmdFromJotform,
          qualtricsOnly: validation.qualtricsOnly,
          jotformOnly: validation.jotformOnly
        },
        conflicts: {
          recordsWithConflicts: validation.tgmdConflicts,
          totalConflictingFields: validation.totalConflicts,
          details: conflicts
        },
        missingTGMD: validation.missingTGMD.length,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Expose globally
  window.DataMerger = DataMerger;
  console.log('[DataMerger] Module loaded');
})();
