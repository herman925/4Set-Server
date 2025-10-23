/**
 * Qualtrics Response Transformer
 * 
 * Purpose: Transform Qualtrics QID-based responses to standard field format
 * Handles: Matrix questions, text entries, embedded data
 * 
 * Based on: PRDs/qualtrics_implementation_plan.md Section 2
 */

(() => {
  class QualtricsTransformer {
    constructor() {
      this.mapping = null;
    }

    /**
     * Load field mapping from qualtrics-mapping.json
     * @returns {Promise<Object>} Mapping configuration
     */
    async loadMapping() {
      if (this.mapping) {
        return this.mapping; // Already loaded
      }

      try {
        const response = await fetch('assets/qualtrics-mapping.json');
        if (!response.ok) {
          throw new Error(`Failed to load mapping: ${response.status}`);
        }
        this.mapping = await response.json();
        console.log('[QualtricsTransformer] Loaded field mapping');
        return this.mapping;
      } catch (error) {
        console.error('[QualtricsTransformer] Failed to load mapping:', error);
        throw error;
      }
    }

    /**
     * Transform single Qualtrics response to standard format
     * @param {Object} response - Raw Qualtrics response
     * @param {Object} mapping - Field mapping configuration
     * @returns {Object} Transformed record
     */
    transformResponse(response, mapping) {
      const result = {
        // Extract sessionkey and basic identifiers
        sessionkey: response.values.sessionkey || '',
        'student-id': response.values['student-id'] || '',
        'school-id': response.values['school-id'] || '',
        'class-id': response.values['class-id'] || response.values.classid || '',
        'child-name': response.values.studentname || '',
        district: response.values.district || '',
        
        // Add metadata
        _meta: {
          source: 'qualtrics',
          qualtricsResponseId: response.responseId,
          retrievedAt: new Date().toISOString(),
          recordedDate: response.values.recordedDate || '',
          status: response.values.status || ''
        }
      };

      // Transform each mapped field
      for (const [fieldName, qidSpec] of Object.entries(mapping)) {
        // Skip fields we've already handled
        if (['sessionkey', 'student-id', 'school-id', 'class-id', 'child-name', 'district', 
             'studentname', 'classid', 'classname'].includes(fieldName)) {
          continue;
        }

        // Skip metadata fields
        if (['Start Date', 'End Date', 'Recorded Date', 'Response ID', 'Response Type'].includes(fieldName)) {
          continue;
        }

        // Transform based on QID spec pattern
        const value = this.extractValue(response.values, qidSpec);
        if (value !== null && value !== undefined) {
          result[fieldName] = value;
        }
      }

      return result;
    }

    /**
     * Extract value from response based on QID specification
     * @param {Object} values - Response values object
     * @param {string} qidSpec - QID specification (e.g., "QID123" or "QID123#1_1" or "QID123_TEXT")
     * @returns {*} Extracted value
     */
    extractValue(values, qidSpec) {
      if (!qidSpec || typeof qidSpec !== 'string') {
        return null;
      }

      // Handle matrix sub-questions: "QID126166420#1_1"
      if (qidSpec.includes('#')) {
        const [qid, subKey] = qidSpec.split('#');
        const matrixData = values[qid];
        
        if (matrixData && typeof matrixData === 'object') {
          return matrixData[subKey] || '';
        }
        return '';
      }

      // Handle text entry sub-fields: "QID125287935_TEXT"
      if (qidSpec.endsWith('_TEXT')) {
        const qid = qidSpec.replace('_TEXT', '');
        const data = values[qid];
        
        if (typeof data === 'object' && data.text !== undefined) {
          return data.text;
        }
        return data || '';
      }

      // Handle special metadata fields with time zone info
      if (qidSpec.includes(';')) {
        const [field] = qidSpec.split(';');
        return values[field] || '';
      }

      // Handle embedded data fields (direct field name, no QID)
      if (!qidSpec.startsWith('QID') && !qidSpec.startsWith('SC_')) {
        return values[qidSpec] || '';
      }

      // Simple field: Direct QID mapping
      const value = values[qidSpec];
      
      // If value is an object with specific structure, extract the actual value
      if (value && typeof value === 'object') {
        // Check for common Qualtrics response structures
        if (value.text !== undefined) {
          return value.text;
        }
        // For choice questions, the value might be the choice number
        // Return as-is if it's a simple object
      }
      
      return value !== undefined ? value : '';
    }

    /**
     * Transform batch of Qualtrics responses
     * @param {Array} responses - Array of raw Qualtrics responses
     * @param {Object} mapping - Field mapping configuration (optional, will load if not provided)
     * @returns {Promise<Array>} Array of transformed records
     */
    async transformBatch(responses, mapping = null) {
      // Load mapping if not provided
      if (!mapping) {
        mapping = await this.loadMapping();
      }

      console.log(`[QualtricsTransformer] Transforming ${responses.length} responses...`);

      const transformed = responses.map(response => {
        try {
          return this.transformResponse(response, mapping);
        } catch (error) {
          console.error('[QualtricsTransformer] Failed to transform response:', response.responseId, error);
          return null;
        }
      }).filter(r => r !== null); // Remove failed transformations

      console.log(`[QualtricsTransformer] Successfully transformed ${transformed.length} responses`);
      return transformed;
    }

    /**
     * Extract TGMD-specific question IDs from mapping
     * @param {Object} mapping - Field mapping configuration
     * @returns {Array} Array of unique TGMD QIDs
     */
    extractTGMDQuestionIds(mapping) {
      const tgmdQids = new Set();

      for (const [fieldName, qidSpec] of Object.entries(mapping)) {
        if (fieldName.startsWith('TGMD_')) {
          // Extract base QID (remove # suffix for matrix questions)
          const baseQid = qidSpec.split('#')[0];
          if (baseQid.startsWith('QID')) {
            tgmdQids.add(baseQid);
          }
        }
      }

      return Array.from(tgmdQids);
    }

    /**
     * Validate transformed response has required fields
     * @param {Object} record - Transformed record
     * @returns {boolean} True if valid
     */
    validateRecord(record) {
      // Must have sessionkey for merging
      if (!record.sessionkey) {
        console.warn('[QualtricsTransformer] Record missing sessionkey:', record);
        return false;
      }

      // Should have at least some TGMD data
      const hasTGMD = Object.keys(record).some(key => key.startsWith('TGMD_'));
      if (!hasTGMD) {
        console.warn('[QualtricsTransformer] Record has no TGMD data:', record.sessionkey);
        return false;
      }

      return true;
    }
  }

  // Expose globally
  window.QualtricsTransformer = QualtricsTransformer;
  console.log('[QualtricsTransformer] Module loaded');
})();
