/**
 * Data Merger Module
 * 
 * Purpose: Merge JotForm and Qualtrics datasets with conflict resolution
 * Key Principle: Earliest non-empty value wins (consistent across all merges)
 */

(() => {
  /**
   * Data Merger
   */
  class DataMerger {
    constructor() {
      // Configuration - fields to exclude from merge
      // Note: Fields starting with '_' are automatically excluded during iteration
      // _fieldProvenance is preserved separately and merged explicitly
      this.excludeFields = new Set([
        '_recordId', 'responseId', '_meta', '_sources', 
        '_orphaned', '_qualtricsConflicts'
      ]);
    }

    /**
     * Extract value from answer object (handles both new format and legacy)
     * CRITICAL: Must handle numeric 0 correctly (TGMD "Not Observed")
     * @param {Object|string|number} answerObj - Answer object or primitive value
     * @returns {string|number|null} - The extracted value or null
     */
    extractAnswerValue(answerObj) {
      if (!answerObj && answerObj !== 0) {  // Allow numeric 0 to pass through
        return null;
      }
      
      // If it's an object (answer object from JotForm/Qualtrics), extract .answer or .text
      if (typeof answerObj === 'object' && answerObj !== null) {
        // Use explicit checks instead of || to preserve 0
        if (answerObj.answer !== undefined && answerObj.answer !== null) {
          return answerObj.answer;
        }
        if (answerObj.text !== undefined && answerObj.text !== null) {
          return answerObj.text;
        }
        return null;
      }
      
      // If it's a primitive (legacy format or direct value), return as-is
      return answerObj;
    }

    /**
     * Check if a value is empty (null, undefined, or empty string)
     * CRITICAL: Preserves numeric 0 as non-empty (TGMD "Not Observed")
     * @param {*} answerLike - Answer object or primitive value
     * @returns {boolean} - True if empty, false otherwise
     */
    isValueEmpty(answerLike) {
      const value = this.extractAnswerValue(answerLike);
      return value === undefined || value === null || value === '';
    }

    /**
     * Check if a value is present (not empty)
     * @param {*} answerLike - Answer object or primitive value
     * @returns {boolean} - True if present, false otherwise
     */
    isValuePresent(answerLike) {
      return !this.isValueEmpty(answerLike);
    }

    /**
     * Create provenance metadata for a field
     * Tracks which source(s) provided data and when
     * @param {string} fieldName - Name of the field
     * @param {string} source - Source identifier ('jotform' or 'qualtrics')
     * @param {Object} sourceRecord - The full source record
     * @param {string} winner - Which source 'won' for this field
     * @returns {Object} Provenance metadata
     */
    createFieldProvenance(fieldName, source, sourceRecord, winner) {
      // Use descriptive fallback for missing grade to highlight data quality issues
      let grade = sourceRecord.grade;
      if (!grade) {
        grade = 'Grade Not Detected';
        console.warn(`[DataMerger] Grade not detected for field ${fieldName} from ${source}`);
      }
      
      const provenance = {
        field: fieldName,
        sources: [],
        winner: winner,
        grade: grade
      };

      if (source === 'jotform') {
        const submissionId = sourceRecord._meta?.submissionId || sourceRecord.id;
        const sessionKey = sourceRecord.sessionkey || sourceRecord['session-key'];
        const createdAt = sourceRecord.created_at || sourceRecord._meta?.created_at;
        
        provenance.sources.push({
          type: 'JotForm',
          submissionId: submissionId,
          sessionKey: sessionKey,
          timestamp: createdAt,
          found: this.isValuePresent(sourceRecord[fieldName])
        });
      } else if (source === 'qualtrics') {
        const responseId = sourceRecord._meta?.qualtricsResponseId || sourceRecord.responseId;
        const startDate = sourceRecord._meta?.startDate || sourceRecord.recordedDate;
        
        provenance.sources.push({
          type: 'Qualtrics',
          responseId: responseId,
          timestamp: startDate,
          found: this.isValuePresent(sourceRecord[fieldName])
        });
      }

      return provenance;
    }

    /**
     * Merge field provenances from multiple sources
     * @param {Object} existingProvenance - Existing provenance for this field
     * @param {Object} newProvenance - New provenance to add
     * @returns {Object} Merged provenance
     */
    mergeFieldProvenance(existingProvenance, newProvenance) {
      if (!existingProvenance) {
        return newProvenance;
      }

      // Merge sources arrays
      const mergedSources = [...existingProvenance.sources];
      for (const newSource of newProvenance.sources) {
        // Check if we already have this source
        const exists = mergedSources.some(s => 
          s.type === newSource.type && 
          (s.submissionId === newSource.submissionId || s.responseId === newSource.responseId)
        );
        if (!exists) {
          mergedSources.push(newSource);
        }
      }

      // Sort by timestamp (earliest first)
      mergedSources.sort((a, b) => {
        const dateA = a.timestamp ? new Date(a.timestamp) : new Date(0);
        const dateB = b.timestamp ? new Date(b.timestamp) : new Date(0);
        return dateA - dateB;
      });

      return {
        ...existingProvenance,
        sources: mergedSources,
        winner: newProvenance.winner || existingProvenance.winner
      };
    }

    /**
     * Merge JotForm and Qualtrics datasets by coreId WITH GRADE-BASED GROUPING
     * 
     * CRITICAL FIX: Never merge data from different grades (K1/K2/K3)
     * Per user requirement: "We should NEVER merge anything that is NOT from the same grade.
     * You don't merge jotform K3 data with qualtrics K2 data."
     * 
     * Strategy:
     * 1. Determine grade for each JotForm and Qualtrics record BEFORE merging
     * 2. Group records by (coreId, grade) pair
     * 3. For each coreId, create SEPARATE merged records for each grade
     * 4. Merge data using earliest non-empty value wins WITHIN the same grade
     * 5. Flag cross-grade data as validation warnings (should not be merged)
     * 
     * This matches JotForm's merge principle (line 795 in jotform-cache.js):
     * "Sort by created_at (earliest first), earliest non-empty value wins"
     * 
     * But now applied PER GRADE LEVEL:
     * - JotForm K3 + Qualtrics K3 → Merge ✓
     * - JotForm K2 + Qualtrics K2 → Merge ✓
     * - JotForm K3 + Qualtrics K2 → DO NOT MERGE ✗ (validation error)
     * 
     * @param {Array} jotformData - JotForm submissions
     * @param {Array} qualtricsData - Transformed Qualtrics responses
     * @returns {Array} Merged records (one per coreId per grade)
     */
    mergeDataSources(jotformData, qualtricsData) {
      console.log('[DataMerger] ========== MERGING DATA SOURCES (GRADE-AWARE) ==========');
      console.log('[DataMerger] JotForm records:', jotformData.length);
      console.log('[DataMerger] Qualtrics records:', qualtricsData.length);

      // Step 1: Determine grade for ALL records BEFORE merging
      // Group by (coreId, grade) to ensure we never mix different grade levels
      const recordsByStudent = new Map(); // coreId → { grades: Map<grade, {jotform: [], qualtrics: []}> }
      
      // Process Qualtrics records - determine grade and group
      console.log('[DataMerger] Step 1: Determining grades for Qualtrics records...');
      for (const record of qualtricsData) {
        const coreId = record.coreId;
        if (!coreId) {
          console.warn('[DataMerger] Qualtrics record missing coreId, skipping:', record._meta?.qualtricsResponseId);
          continue;
        }
        
        // Use pre-determined grade from Qualtrics cache
        const grade = record.grade || 'Unknown';
        console.log(`[DataMerger] Qualtrics record ${coreId}: grade=${grade}`);
        
        // Initialize student entry if needed
        if (!recordsByStudent.has(coreId)) {
          recordsByStudent.set(coreId, { grades: new Map() });
        }
        
        const student = recordsByStudent.get(coreId);
        if (!student.grades.has(grade)) {
          student.grades.set(grade, { jotform: [], qualtrics: [] });
        }
        
        student.grades.get(grade).qualtrics.push(record);
      }
      
      // Process JotForm records - determine grade and group
      console.log('[DataMerger] Step 2: Determining grades for JotForm records...');
      for (const record of jotformData) {
        const coreId = record.coreId;
        if (!coreId) {
          console.warn('[DataMerger] JotForm record missing coreId, skipping');
          continue;
        }
        
        // Use pre-determined grade from JotForm cache
        const grade = record.grade || 'Unknown';
        console.log(`[DataMerger] JotForm record ${coreId}: grade=${grade}`);
        
        // Initialize student entry if needed
        if (!recordsByStudent.has(coreId)) {
          recordsByStudent.set(coreId, { grades: new Map() });
        }
        
        const student = recordsByStudent.get(coreId);
        if (!student.grades.has(grade)) {
          student.grades.set(grade, { jotform: [], qualtrics: [] });
        }
        
        student.grades.get(grade).jotform.push(record);
      }
      
      console.log(`[DataMerger] Grouped data: ${recordsByStudent.size} students across multiple grades`);
      
      // Merge data WITHIN each grade for each student
      console.log('[DataMerger] Merging data within each grade...');
      const mergedRecords = [];
      let crossGradeWarnings = 0;
      let sameGradeMerges = 0;
      let jotformOnlyCount = 0;
      let qualtricsOnlyCount = 0;
      
      for (const [coreId, student] of recordsByStudent.entries()) {
        // Check for cross-grade data (validation warning)
        if (student.grades.size > 1) {
          const grades = Array.from(student.grades.keys()).join(', ');
          console.warn(`[DataMerger] ⚠️  Student ${coreId} has data from multiple grades: ${grades} - NOT merging across grades`);
          crossGradeWarnings++;
        }
        
        // Process each grade separately
        for (const [grade, gradeData] of student.grades.entries()) {
          const { jotform, qualtrics } = gradeData;
          
          // Merge multiple Qualtrics responses for this grade (earliest wins)
          let mergedQualtrics = null;
          if (qualtrics.length > 0) {
            // Sort by date
            qualtrics.sort((a, b) => {
              const dateA = a._meta?.startDate ? new Date(a._meta.startDate) : new Date(0);
              const dateB = b._meta?.startDate ? new Date(b._meta.startDate) : new Date(0);
              return dateA - dateB;
            });
            
            mergedQualtrics = qualtrics[0]; // Start with earliest
            for (let i = 1; i < qualtrics.length; i++) {
              mergedQualtrics = this.mergeMultipleQualtricsRecords(mergedQualtrics, qualtrics[i]);
            }
          }
          
          // Merge multiple JotForm submissions for this grade (earliest wins)
          let mergedJotform = null;
          if (jotform.length > 0) {
            // Sort by created_at (earliest first)
            jotform.sort((a, b) => {
              const dateA = a._meta?.created_at ? new Date(a._meta.created_at) : new Date(0);
              const dateB = b._meta?.created_at ? new Date(b._meta.created_at) : new Date(0);
              return dateA - dateB;
            });
            
            // Merge all JotForm submissions field-by-field (earliest non-empty wins)
            mergedJotform = this.mergeMultipleJotFormRecords(jotform);
          }
          
          // Now merge JotForm + Qualtrics FOR THIS GRADE ONLY
          if (mergedJotform && mergedQualtrics) {
            // Both sources available for this grade - merge them
            const merged = this.mergeTGMDFields(mergedJotform, mergedQualtrics);
            merged.grade = grade; // Explicitly set grade
            mergedRecords.push(merged);
            sameGradeMerges++;
            console.log(`[DataMerger] ✓ Merged ${coreId} (${grade}): JotForm + Qualtrics`);
          } else if (mergedJotform) {
            // JotForm only for this grade
            const jotformOnly = {
              ...mergedJotform,
              _sources: ['jotform'],
              grade: grade
            };
            mergedRecords.push(jotformOnly);
            jotformOnlyCount++;
          } else if (mergedQualtrics) {
            // Qualtrics only for this grade (valid scenario - TGMD can be standalone)
            const qualtricsOnly = {
              ...mergedQualtrics,
              _sources: ['qualtrics'],
              _orphaned: true,
              grade: grade
            };
            mergedRecords.push(qualtricsOnly);
            qualtricsOnlyCount++;
            console.log(`[DataMerger] ℹ️  Qualtrics-only record for ${coreId} (${grade})`);
          }
        }
      }
      
      console.log(`[DataMerger] ========== MERGE COMPLETE ==========`);
      console.log(`[DataMerger] Total records: ${mergedRecords.length}`);
      console.log(`[DataMerger] - ${sameGradeMerges} merged (JotForm + Qualtrics, same grade)`);
      console.log(`[DataMerger] - ${jotformOnlyCount} JotForm-only`);
      console.log(`[DataMerger] - ${qualtricsOnlyCount} Qualtrics-only`);
      if (crossGradeWarnings > 0) {
        console.warn(`[DataMerger] ⚠️  ${crossGradeWarnings} students with cross-grade data (kept separate)`);
      }

      return mergedRecords;
    }

    /**
     * Merge multiple Qualtrics responses for the same student
     * Uses earliest non-empty value principle (matches JotForm merge logic)
     * Merges ALL fields, not just TGMD
     * @param {Object} record1 - First (earlier) Qualtrics record
     * @param {Object} record2 - Second (later) Qualtrics record
     * @returns {Object} Merged record
     */
    mergeMultipleQualtricsRecords(record1, record2) {
      // CRITICAL: Validate same grade before merging (never merge K1 with K2 or K3)
      if (record1.grade && record2.grade && record1.grade !== record2.grade) {
        console.error(`[DataMerger] ⚠️  Cannot merge Qualtrics records from different grades: ${record1.grade} vs ${record2.grade} for student ${record1.coreId || 'unknown'}`);
        return record1; // Return first record unchanged to prevent cross-grade contamination
      }
      
      const merged = { ...record1 };

      // Merge ALL Qualtrics fields - ONLY fill in if not already present (earliest non-empty value wins)
      // Now handles answer objects instead of raw values
      for (const [key, answerObj] of Object.entries(record2)) {
        // Skip metadata fields
        if (this.excludeFields.has(key) || key.startsWith('_')) {
          continue;
        }
        
        // Only set if not already present and value is not empty (earliest wins)
        // CRITICAL: Use explicit checks - "0" is valid TGMD answer (Not Observed)
        if (this.isValuePresent(answerObj) && this.isValueEmpty(merged[key])) {
          merged[key] = answerObj; // Store the full answer object
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
     * Merge multiple JotForm submissions for the same student
     * Uses earliest non-empty value principle (matches production jotform-cache.js)
     * This replicates the logic from jotform-cache.js lines 798-817
     * @param {Array} jotformRecords - Array of JotForm records (already sorted by created_at)
     * @returns {Object} Merged record with all fields combined
     */
    mergeMultipleJotFormRecords(jotformRecords) {
      if (jotformRecords.length === 0) {
        return null;
      }
      
      if (jotformRecords.length === 1) {
        return jotformRecords[0];
      }

      // CRITICAL: Validate all records have same grade (never merge K1 with K2 or K3)
      const grades = new Set(jotformRecords.map(r => r.grade).filter(g => g));
      let workingRecords = jotformRecords;
      if (grades.size > 1) {
        console.error(`[DataMerger] ⚠️  Cannot merge JotForm records from different grades: ${Array.from(grades).join(', ')} for student ${jotformRecords[0].coreId || 'unknown'}`);
        // Filter to only records from the earliest grade to prevent cross-grade contamination
        const firstGrade = jotformRecords[0].grade;
        workingRecords = jotformRecords.filter(r => r.grade === firstGrade);
        console.log(`[DataMerger] Filtered to ${workingRecords.length} records from grade ${firstGrade}`);
      }

      // Start with base structure from earliest record
      const merged = {
        coreId: workingRecords[0].coreId,
        'student-id': workingRecords[0]['student-id'],
        _meta: {
          ...workingRecords[0]._meta,
          multipleSubmissions: true,
          submissionCount: workingRecords.length,
          submissionIds: workingRecords.map(r => r._meta.submissionId)
        },
        _fieldProvenance: {} // Track which submission provided each field
      };

      // Merge all fields from all submissions (earliest non-empty value wins)
      for (let i = 0; i < workingRecords.length; i++) {
        const record = workingRecords[i];
        for (const [key, answerObj] of Object.entries(record)) {
          // Skip metadata and special fields
          if (this.excludeFields.has(key) || key.startsWith('_') || 
              key === 'coreId' || key === 'student-id') {
            continue;
          }
          
          // Track provenance for all fields (even if empty)
          const provenance = this.createFieldProvenance(key, 'jotform', record, null);
          if (!merged._fieldProvenance[key]) {
            merged._fieldProvenance[key] = provenance;
          } else {
            merged._fieldProvenance[key] = this.mergeFieldProvenance(merged._fieldProvenance[key], provenance);
          }
          
          // Only set if not already present and value is not empty (earliest wins)
          // CRITICAL: Use explicit checks - "0" is valid TGMD answer (Not Observed)
          if (this.isValuePresent(answerObj) && this.isValueEmpty(merged[key])) {
            merged[key] = answerObj; // Store the full answer object
            // Mark this source as the winner
            merged._fieldProvenance[key].winner = 'jotform';
            merged._fieldProvenance[key].winnerIndex = i;
            merged._fieldProvenance[key].winnerSubmissionId = record._meta?.submissionId;
            merged._fieldProvenance[key].winnerTimestamp = record.created_at || record._meta?.created_at;
          }
        }
      }

      return merged;
    }

    /**
     * Merge Qualtrics fields (ALL tasks) with JotForm data using earliest non-empty wins
     * Strategy: Compare timestamps and keep the earliest non-empty value
     * @param {Object} jotformRecord - Base JotForm record
     * @param {Object} qualtricsRecord - Qualtrics record with task data
     * @returns {Object} Merged record with conflict metadata
     */
    mergeTGMDFields(jotformRecord, qualtricsRecord) {
      const merged = { ...jotformRecord };
      const conflicts = [];

      // Initialize provenance tracking if not exists
      if (!merged._fieldProvenance) {
        merged._fieldProvenance = {};
      }

      // Get timestamps for comparison
      const jotformTimestamp = jotformRecord.created_at ? new Date(jotformRecord.created_at) : new Date();
      const qualtricsTimestamp = qualtricsRecord._meta?.startDate 
        ? new Date(qualtricsRecord._meta.startDate) 
        : (qualtricsRecord.recordedDate ? new Date(qualtricsRecord.recordedDate) : new Date());

      // Extract ALL task fields from Qualtrics (not just TGMD)
      for (const [key, value] of Object.entries(qualtricsRecord)) {
        // Skip metadata fields
        if (this.excludeFields.has(key) || key.startsWith('_')) {
          continue;
        }

        const jotformAnswerObj = jotformRecord[key];
        const qualtricsAnswerObj = value;

        // Track Qualtrics provenance
        const qualtricsProvenance = this.createFieldProvenance(key, 'qualtrics', qualtricsRecord, null);
        
        // Skip if Qualtrics value is empty
        // CRITICAL: Use explicit null/undefined/empty checks, NOT falsy check
        // Reason: TGMD "0" (Not Observed) is valid answer, numeric 0 is falsy
        if (this.isValueEmpty(qualtricsAnswerObj)) {
          // Still track that Qualtrics was checked for this field
          if (merged._fieldProvenance[key]) {
            merged._fieldProvenance[key] = this.mergeFieldProvenance(merged._fieldProvenance[key], qualtricsProvenance);
          }
          continue;
        }

        // If JotForm doesn't have this field, use Qualtrics answer object
        if (!jotformAnswerObj) {
          merged[key] = qualtricsAnswerObj;
          qualtricsProvenance.winner = 'qualtrics';
          qualtricsProvenance.winnerTimestamp = qualtricsTimestamp.toISOString();
          qualtricsProvenance.winnerReason = 'Only source with data';
          merged._fieldProvenance[key] = qualtricsProvenance;
          continue;
        }
        
        // If JotForm has the field but no value, use Qualtrics
        // CRITICAL: Use explicit null/undefined/empty checks (same reason as above)
        if (this.isValueEmpty(jotformAnswerObj)) {
          merged[key] = qualtricsAnswerObj;
          qualtricsProvenance.winner = 'qualtrics';
          qualtricsProvenance.winnerTimestamp = qualtricsTimestamp.toISOString();
          qualtricsProvenance.winnerReason = 'JotForm empty, Qualtrics has data';
          merged._fieldProvenance[key] = this.mergeFieldProvenance(merged._fieldProvenance[key], qualtricsProvenance);
          continue;
        }
        
        // Both have values - extract for comparison
        const qualtricsValue = this.extractAnswerValue(qualtricsAnswerObj);
        const jotformValue = this.extractAnswerValue(jotformAnswerObj);

        // Merge provenance
        merged._fieldProvenance[key] = this.mergeFieldProvenance(merged._fieldProvenance[key], qualtricsProvenance);

        // Compare actual values and use earliest non-empty
        if (jotformValue !== qualtricsValue) {
          // Detect conflict
          conflicts.push({
            field: key,
            jotform: jotformValue,
            jotformTimestamp: jotformTimestamp.toISOString(),
            qualtrics: qualtricsValue,
            qualtricsTimestamp: qualtricsTimestamp.toISOString(),
            resolution: jotformTimestamp <= qualtricsTimestamp ? 'jotform' : 'qualtrics'
          });

          // Keep earliest answer object based on timestamp
          if (qualtricsTimestamp < jotformTimestamp) {
            merged[key] = qualtricsAnswerObj;
            merged._fieldProvenance[key].winner = 'qualtrics';
            merged._fieldProvenance[key].winnerTimestamp = qualtricsTimestamp.toISOString();
            merged._fieldProvenance[key].winnerReason = 'Earliest non-empty (Qualtrics before JotForm)';
          } else {
            // Keep JotForm (already in merged)
            merged._fieldProvenance[key].winner = 'jotform';
            merged._fieldProvenance[key].winnerTimestamp = jotformTimestamp.toISOString();
            merged._fieldProvenance[key].winnerReason = 'Earliest non-empty (JotForm before Qualtrics)';
          }
        } else {
          // Values are equal - mark JotForm as winner (arbitrary, since they match)
          merged._fieldProvenance[key].winner = 'jotform';
          merged._fieldProvenance[key].winnerTimestamp = jotformTimestamp.toISOString();
          merged._fieldProvenance[key].winnerReason = 'Both sources have same value';
        }
      }

      // Update metadata
      merged._sources = ['jotform', 'qualtrics'];
      merged._qualtricsDataMerged = true;

      if (conflicts.length > 0) {
        merged._qualtricsConflicts = conflicts;
        
        // Log merge details
        const coreId = jotformRecord.coreId;
        const qualtricsFieldCount = Object.keys(qualtricsRecord).filter(k => !this.excludeFields.has(k) && !k.startsWith('_')).length;
        const earliestWins = conflicts.filter(c => c.resolution === 'jotform').length;
        console.log(`[DataMerger] Merged data for student ${coreId}: ${conflicts.length} conflicts resolved (${earliestWins} from JotForm, ${conflicts.length - earliestWins} from Qualtrics based on timestamps), ${qualtricsFieldCount} fields from Qualtrics`);
      }

      // Preserve Qualtrics metadata
      if (qualtricsRecord._meta) {
        merged._meta = {
          ...merged._meta,
          qualtricsResponseId: qualtricsRecord._meta.qualtricsResponseId,
          qualtricsRetrievedAt: qualtricsRecord._meta.retrievedAt,
          qualtricsStartDate: qualtricsRecord._meta.startDate,
          qualtricsEndDate: qualtricsRecord._meta.endDate,
          jotformCreatedAt: jotformRecord.created_at
        };
      }

      // NOTE: Grade is now determined BEFORE merging in mergeDataSources()
      // Do NOT re-determine grade here to avoid overriding the correct grade grouping

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
        withQualtricsData: 0,
        qualtricsOnly: 0,
        jotformOnly: 0,
        merged: 0,
        qualtricsConflicts: 0,
        conflictDetails: []
      };

      for (const record of mergedRecords) {
        // Check if has Qualtrics data
        const hasQualtricsData = record._sources?.includes('qualtrics') || record._orphaned;

        if (hasQualtricsData) {
          validation.withQualtricsData++;
        }

        // Count by source type
        if (record._orphaned) {
          validation.qualtricsOnly++;
        } else if (record._sources?.includes('qualtrics') && record._sources?.includes('jotform')) {
          validation.merged++;
        } else if (record._sources?.includes('jotform')) {
          validation.jotformOnly++;
        }

        // Check for conflicts
        if (record._qualtricsConflicts && record._qualtricsConflicts.length > 0) {
          validation.qualtricsConflicts++;
          validation.conflictDetails.push({
            coreId: record.coreId,
            studentId: record['student-id'],
            childName: record['child-name'],
            conflicts: record._qualtricsConflicts
          });
        }
      }

      console.log('[DataMerger] Validation complete:', {
        total: validation.total,
        withQualtricsData: validation.withQualtricsData,
        merged: validation.merged,
        jotformOnly: validation.jotformOnly,
        qualtricsOnly: validation.qualtricsOnly,
        qualtricsConflicts: validation.qualtricsConflicts
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
