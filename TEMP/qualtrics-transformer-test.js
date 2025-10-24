/**
 * TEST-SPECIFIC VERSION - Qualtrics Transformer Module
 * 
 * This is a modified version for test-pipeline-core-id.html
 * DO NOT use this in the main checking system - use assets/js/qualtrics-transformer.js instead
 * 
 * Changes from original:
 * - Multi-path resolution for qualtrics-mapping.json to support TEMP folder location
 * - Tries absolute, relative from root, and relative from TEMP paths
 * 
 * ---
 * 
 * Purpose: Transform Qualtrics QID-based responses to standardized field format
 * Compatible with existing JotForm data structure
 */

(() => {
  /**
   * Qualtrics Data Transformer
   */
  class QualtricsTransformer {
    constructor() {
      this.mapping = null;
      this.mappingLoaded = false;
    }

    /**
     * Load Qualtrics field mapping configuration
     * @returns {Promise<Object>} Mapping object
     */
    async loadMapping() {
      if (this.mappingLoaded && this.mapping) {
        return this.mapping;
      }

      try {
        console.log('[QualtricsTransformer] Loading field mapping...');
        
        // Try multiple path variations to support different deployment locations
        const pathsToTry = [
          '/assets/qualtrics-mapping.json',  // Absolute path from root
          'assets/qualtrics-mapping.json',   // Relative from root
          '../assets/qualtrics-mapping.json' // Relative from TEMP folder
        ];
        
        let response = null;
        let lastError = null;
        
        for (const path of pathsToTry) {
          try {
            response = await fetch(path);
            if (response.ok) {
              console.log(`[QualtricsTransformer] Mapping loaded from: ${path}`);
              break;
            }
          } catch (err) {
            lastError = err;
          }
        }
        
        if (!response || !response.ok) {
          throw new Error(`Failed to load mapping from any path. Last error: ${lastError?.message || 'Unknown'}`);
        }

        this.mapping = await response.json();
        this.mappingLoaded = true;
        
        console.log('[QualtricsTransformer] Mapping loaded successfully');
        return this.mapping;
      } catch (error) {
        console.error('[QualtricsTransformer] Failed to load mapping:', error);
        throw error;
      }
    }

    /**
     * Extract value from Qualtrics response based on QID specification
     * Handles different Qualtrics question types:
     * - Simple fields: "QID123"
     * - Matrix sub-questions: "QID123#1_1" (row_column)
     * - Text entry: "QID123_TEXT"
     * 
     * @param {Object} values - Qualtrics response values object
     * @param {string} qidSpec - QID specification from mapping
     * @returns {string} Extracted value or empty string
     */
    extractValue(values, qidSpec) {
      if (!qidSpec || !values) {
        return '';
      }

      // Handle special metadata fields that are already in the right format
      if (qidSpec === 'sessionkey' || qidSpec === 'jotformsubmissionid') {
        return values[qidSpec] || '';
      }

      // Handle embedded data fields (no QID prefix)
      if (!qidSpec.startsWith('QID') && !qidSpec.includes('#')) {
        return values[qidSpec] || '';
      }

      // Handle matrix sub-questions: "QID126166420#1_1"
      if (qidSpec.includes('#')) {
        const [qid, subKey] = qidSpec.split('#');
        const matrixData = values[qid];
        
        if (!matrixData || typeof matrixData !== 'object') {
          return '';
        }
        
        return matrixData[subKey] || '';
      }

      // Handle text entry sub-fields: "QID125287935_TEXT"
      if (qidSpec.endsWith('_TEXT')) {
        const qid = qidSpec.replace('_TEXT', '');
        const textData = values[qid];
        
        if (!textData) {
          return '';
        }
        
        // Sometimes text is nested under 'text' property
        if (typeof textData === 'object' && textData.text) {
          return textData.text;
        }
        
        return String(textData);
      }

      // Simple field: direct QID lookup
      const value = values[qidSpec];
      return value !== undefined && value !== null ? String(value) : '';
    }

    /**
     * Transform single Qualtrics response to standard format
     * @param {Object} response - Raw Qualtrics response
     * @param {Object} mapping - Field mapping configuration (optional, uses loaded if not provided)
     * @returns {Object} Transformed record in standard format
     */
    transformResponse(response, mapping = null) {
      const fieldMapping = mapping || this.mapping;
      
      if (!fieldMapping) {
        throw new Error('Mapping not loaded. Call loadMapping() first.');
      }

      if (!response || !response.values) {
        console.warn('[QualtricsTransformer] Invalid response structure:', response);
        return null;
      }

      // Extract student-id (which contains the Core ID without "C" prefix in Qualtrics)
      let studentId = this.extractValue(response.values, fieldMapping['student-id']);
      
      // Normalize to coreId format: Add "C" prefix if it starts with digits
      let coreId = '';
      if (studentId && /^\d/.test(studentId)) {
        coreId = 'C' + studentId;
        console.log(`[QualtricsTransformer] Normalized coreId: added "C" prefix → ${coreId}`);
      } else if (studentId) {
        coreId = studentId;
      }
      
      const result = {
        // Core identifiers - coreId is the primary key for merging
        coreId: coreId,
        'student-id': studentId,
        'school-id': this.extractValue(response.values, fieldMapping['school-id']),
        
        // Metadata
        _meta: {
          source: 'qualtrics',
          qualtricsResponseId: response.responseId,
          retrievedAt: new Date().toISOString(),
          startDate: response.values.startDate,
          endDate: response.values.endDate,
          recordedDate: response.values.recordedDate,
          status: response.values.status,
          progress: response.values.progress,
          duration: response.values.duration,
          finished: response.values.finished
        }
      };

      // Transform all mapped fields
      for (const [fieldName, qidSpec] of Object.entries(fieldMapping)) {
        // Skip fields we've already handled
        if (fieldName === 'sessionkey' || 
            fieldName === 'student-id' || 
            fieldName === 'school-id') {
          continue;
        }

        // Extract and set value
        const value = this.extractValue(response.values, qidSpec);
        if (value !== '') {
          result[fieldName] = value;
        }
      }

      return result;
    }

    /**
     * Transform array of Qualtrics responses
     * @param {Array} responses - Array of raw Qualtrics responses
     * @param {Object} mapping - Optional mapping (uses loaded if not provided)
     * @returns {Array} Transformed records
     */
    transformBatch(responses, mapping = null) {
      if (!Array.isArray(responses)) {
        console.error('[QualtricsTransformer] Invalid responses array:', responses);
        return [];
      }

      console.log(`[QualtricsTransformer] Transforming ${responses.length} responses...`);
      
      const transformed = [];
      let skipped = 0;

      for (const response of responses) {
        try {
          const record = this.transformResponse(response, mapping);
          
          if (record && record.coreId) {
            transformed.push(record);
          } else {
            console.warn('[QualtricsTransformer] Skipping response without coreId:', response.responseId);
            skipped++;
          }
        } catch (error) {
          console.error('[QualtricsTransformer] Failed to transform response:', response.responseId, error);
          skipped++;
        }
      }

      console.log(`[QualtricsTransformer] Transformed ${transformed.length} responses (${skipped} skipped)`);
      return transformed;
    }

    /**
     * Extract TGMD-specific fields from mapping
     * @param {Object} mapping - Field mapping
     * @returns {Array} Array of unique TGMD QIDs
     */
    extractTGMDQIds(mapping = null) {
      const fieldMapping = mapping || this.mapping;
      
      if (!fieldMapping) {
        throw new Error('Mapping not loaded. Call loadMapping() first.');
      }

      const tgmdQids = new Set();

      for (const [fieldName, qidSpec] of Object.entries(fieldMapping)) {
        // Only process TGMD fields
        if (!fieldName.startsWith('TGMD_')) {
          continue;
        }

        // Extract base QID (before # for matrix questions)
        const baseQid = qidSpec.split('#')[0];
        
        // Only add if it's a QID (not embedded data)
        if (baseQid.startsWith('QID')) {
          tgmdQids.add(baseQid);
        }
      }

      const qidArray = Array.from(tgmdQids);
      console.log(`[QualtricsTransformer] Found ${qidArray.length} unique TGMD QIDs`);
      
      return qidArray;
    }

    /**
     * Validate transformed record has required fields
     * @param {Object} record - Transformed record
     * @returns {boolean} True if valid
     */
    validateRecord(record) {
      if (!record) {
        return false;
      }

      // Must have coreId
      if (!record.coreId) {
        console.warn('[QualtricsTransformer] Record missing coreId');
        return false;
      }

      // Should have at least one TGMD field
      const hasTGMDData = Object.keys(record).some(key => key.startsWith('TGMD_'));
      if (!hasTGMDData) {
        console.warn('[QualtricsTransformer] Record has no TGMD data:', record.coreId);
      }

      return true;
    }

    /**
     * Get transformation statistics
     * @param {Array} transformedRecords - Array of transformed records
     * @returns {Object} Statistics object
     */
    getStatistics(transformedRecords) {
      if (!Array.isArray(transformedRecords)) {
        return { total: 0, withCoreId: 0, withTGMD: 0, tgmdFields: {} };
      }

      const stats = {
        total: transformedRecords.length,
        withCoreId: 0,
        withTGMD: 0,
        tgmdFields: {}
      };

      for (const record of transformedRecords) {
        if (record.coreId) {
          stats.withCoreId++;
        }

        let hasTGMD = false;
        for (const [key, value] of Object.entries(record)) {
          if (key.startsWith('TGMD_') && value) {
            hasTGMD = true;
            stats.tgmdFields[key] = (stats.tgmdFields[key] || 0) + 1;
          }
        }

        if (hasTGMD) {
          stats.withTGMD++;
        }
      }

      return stats;
    }
  }

  // Expose globally
  window.QualtricsTransformer = QualtricsTransformer;
  console.log('[QualtricsTransformer] Module loaded');
})();
