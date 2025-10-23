/**
 * Qualtrics API Module
 * 
 * Purpose: Wrapper for Qualtrics API to fetch survey responses
 * Based on: Qualtrics Test/qualtrics_api.py reference implementation
 * 
 * Workflow:
 * 1. Start export request (POST /export-responses)
 * 2. Poll progress until complete (GET /export-responses/{progressId})
 * 3. Download file (GET /export-responses/{fileId}/file)
 */

(() => {
  /**
   * Sleep utility for polling delays
   */
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * Qualtrics API Client
   */
  class QualtricsAPI {
    /**
     * Build base URL from credentials
     * @param {Object} credentials - { qualtricsDatacenter, qualtricsSurveyId, qualtricsApiKey }
     * @returns {string} Base URL
     */
    getBaseUrl(credentials) {
      return `https://${credentials.qualtricsDatacenter}.qualtrics.com/API/v3`;
    }

    /**
     * Start response export
     * @param {Object} credentials - Qualtrics credentials
     * @param {Array} questionIds - Array of QIDs to include (optional)
     * @returns {Promise<string>} Progress ID
     */
    async startExport(credentials, questionIds = null) {
      const baseUrl = this.getBaseUrl(credentials);
      const endpoint = `${baseUrl}/surveys/${credentials.qualtricsSurveyId}/export-responses`;

      // Build payload
      const payload = {
        format: 'json',
        compress: false,
        useLabels: false
      };

      // Add filters if provided
      if (questionIds && questionIds.length > 0) {
        payload.questionIds = questionIds;
      }

      // Always include embedded data and metadata
      payload.embeddedDataIds = ['student-id', 'sessionkey', 'school-id', 'class-id', 'studentname', 'district', 'classid', 'classname'];
      payload.surveyMetadataIds = ['startDate', 'endDate', 'recordedDate', 'status'];

      console.log('[QualtricsAPI] Starting export...', payload);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'X-API-TOKEN': credentials.qualtricsApiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        const progressId = result.result.progressId;
        
        console.log('[QualtricsAPI] Export started, progressId:', progressId);
        return progressId;
      } catch (error) {
        console.error('[QualtricsAPI] Failed to start export:', error);
        throw new Error(`Failed to start Qualtrics export: ${error.message}`);
      }
    }

    /**
     * Poll export progress until complete
     * @param {Object} credentials - Qualtrics credentials
     * @param {string} progressId - Progress ID from startExport
     * @param {number} maxAttempts - Maximum polling attempts (default: 60)
     * @param {number} pollInterval - Polling interval in ms (default: 2000)
     * @returns {Promise<string>} File ID
     */
    async pollProgress(credentials, progressId, maxAttempts = 60, pollInterval = 2000) {
      const baseUrl = this.getBaseUrl(credentials);
      const endpoint = `${baseUrl}/surveys/${credentials.qualtricsSurveyId}/export-responses/${progressId}`;

      console.log('[QualtricsAPI] Polling progress...');

      let attempts = 0;
      
      // First poll after 3 seconds (give it time to start)
      await sleep(3000);

      while (attempts < maxAttempts) {
        try {
          const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
              'X-API-TOKEN': credentials.qualtricsApiKey
            }
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error ${response.status}: ${errorText}`);
          }

          const result = await response.json();
          const status = result.result.status;
          const percentComplete = result.result.percentComplete;

          console.log(`[QualtricsAPI] Progress: ${percentComplete}% (${status})`);

          if (status === 'complete') {
            const fileId = result.result.fileId;
            console.log('[QualtricsAPI] Export complete, fileId:', fileId);
            return fileId;
          } else if (status === 'failed') {
            throw new Error('Qualtrics export failed');
          }

          // Wait before next poll
          await sleep(pollInterval);
          attempts++;

        } catch (error) {
          console.error('[QualtricsAPI] Polling error:', error);
          throw new Error(`Failed to poll export progress: ${error.message}`);
        }
      }

      throw new Error(`Export timeout after ${maxAttempts * pollInterval / 1000} seconds`);
    }

    /**
     * Download export file
     * @param {Object} credentials - Qualtrics credentials
     * @param {string} fileId - File ID from pollProgress
     * @returns {Promise<Object>} Export data (parsed JSON)
     */
    async downloadFile(credentials, fileId) {
      const baseUrl = this.getBaseUrl(credentials);
      const endpoint = `${baseUrl}/surveys/${credentials.qualtricsSurveyId}/export-responses/${fileId}/file`;

      console.log('[QualtricsAPI] Downloading file...');

      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'X-API-TOKEN': credentials.qualtricsApiKey
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error ${response.status}: ${errorText}`);
        }

        // Check content type
        const contentType = response.headers.get('Content-Type');
        
        if (contentType && contentType.includes('application/json')) {
          // Direct JSON response
          const data = await response.json();
          console.log('[QualtricsAPI] Downloaded JSON data');
          return data;
        } else if (contentType && contentType.includes('application/zip')) {
          // ZIP file - would need JSZip library
          throw new Error('ZIP files not yet supported. Use compress: false in export options.');
        } else {
          // Try parsing as JSON anyway
          const data = await response.json();
          return data;
        }
      } catch (error) {
        console.error('[QualtricsAPI] Failed to download file:', error);
        throw new Error(`Failed to download Qualtrics file: ${error.message}`);
      }
    }

    /**
     * Complete workflow: Start export, poll until ready, download
     * @param {Object} credentials - Qualtrics credentials
     * @param {Array} questionIds - Optional array of QIDs to include
     * @param {Function} progressCallback - Optional callback(message, percent)
     * @returns {Promise<Array>} Array of response objects
     */
    async fetchAllResponses(credentials, questionIds = null, progressCallback = null) {
      try {
        if (progressCallback) progressCallback('Starting Qualtrics export...', 5);
        
        // Step 1: Start export
        const progressId = await this.startExport(credentials, questionIds);
        
        if (progressCallback) progressCallback('Export started, polling progress...', 15);
        
        // Step 2: Poll until complete
        const fileId = await this.pollProgress(credentials, progressId);
        
        if (progressCallback) progressCallback('Export complete, downloading...', 80);
        
        // Step 3: Download file
        const exportData = await this.downloadFile(credentials, fileId);
        
        if (progressCallback) progressCallback('Download complete', 95);
        
        // Extract responses array
        const responses = exportData.responses || [];
        console.log(`[QualtricsAPI] Successfully fetched ${responses.length} responses`);
        
        return responses;
      } catch (error) {
        console.error('[QualtricsAPI] Complete workflow failed:', error);
        throw error;
      }
    }
  }

  // Expose globally
  window.QualtricsAPI = QualtricsAPI;
  console.log('[QualtricsAPI] Module loaded');
})();
