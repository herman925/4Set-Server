/**
 * Qualtrics API Module
 * 
 * Purpose: Centralized Qualtrics API wrapper for fetching TGMD survey responses
 * Pattern: Follows same architecture as jotform-cache.js
 * 
 * API Flow:
 * 1. Start export request (POST /export-responses)
 * 2. Poll progress (GET /export-responses/{progressId})
 * 3. Download file (GET /export-responses/{fileId}/file)
 */

(() => {
  /**
   * Qualtrics API Manager
   */
  class QualtricsAPI {
    constructor() {
      this.progressCallback = null;
    }

    /**
     * Set progress callback for UI updates
     * @param {Function} callback - Called with (message, progress) where progress is 0-100
     */
    setProgressCallback(callback) {
      this.progressCallback = callback;
    }

    /**
     * Emit progress update
     * @param {string} message - Progress message
     * @param {number} progress - Progress percentage (0-100)
     */
    emitProgress(message, progress) {
      if (this.progressCallback) {
        this.progressCallback(message, progress);
      }
    }

    /**
     * Build Qualtrics API base URL
     * @param {string} datacenter - Datacenter region (e.g., 'au1')
     * @returns {string} Base URL
     */
    getBaseUrl(datacenter) {
      return `https://${datacenter}.qualtrics.com/API/v3`;
    }

    /**
     * Start Qualtrics response export
     * @param {Object} credentials - { qualtricsApiToken, qualtricsDatacenter, qualtricsSurveyId }
     * @param {Array} questionIds - Array of QIDs to include (optional, defaults to all)
     * @returns {Promise<string>} progressId
     */
    async startExport(credentials, questionIds = null) {
      const { qualtricsApiToken, qualtricsDatacenter, qualtricsSurveyId } = credentials;
      const baseUrl = this.getBaseUrl(qualtricsDatacenter);
      
      console.log('[QualtricsAPI] Starting export for survey:', qualtricsSurveyId);
      this.emitProgress('Starting Qualtrics export...', 5);

      // Build export payload
      const exportPayload = {
        format: 'json',
        compress: false,
        useLabels: false, // Use QIDs, not labels
        surveyMetadataIds: ['startDate', 'endDate', 'recordedDate', 'status', 'ipAddress', 'progress', 'duration', 'finished']
      };

      // If specific question IDs provided, include only those
      if (questionIds && questionIds.length > 0) {
        exportPayload.questionIds = questionIds;
        console.log(`[QualtricsAPI] Filtering to ${questionIds.length} questions`);
      }

      try {
        const response = await fetch(
          `${baseUrl}/surveys/${qualtricsSurveyId}/export-responses`,
          {
            method: 'POST',
            headers: {
              'X-API-TOKEN': qualtricsApiToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(exportPayload)
          }
        );

        if (!response.ok) {
          // Try to get detailed error message from response body
          let errorDetail = '';
          try {
            const errorData = await response.json();
            errorDetail = errorData.meta?.error?.errorMessage || JSON.stringify(errorData);
          } catch (e) {
            errorDetail = await response.text();
          }

          if (response.status === 401) {
            throw new Error(`Invalid Qualtrics API token. Please check credentials. Details: ${errorDetail}`);
          }
          if (response.status === 404) {
            throw new Error(`TGMD survey not found. Please verify survey ID in credentials. Details: ${errorDetail}`);
          }
          if (response.status === 429) {
            throw new Error(`Qualtrics API rate limit exceeded. Please try again later. Details: ${errorDetail}`);
          }
          if (response.status === 400) {
            throw new Error(`Bad request to Qualtrics API. URL: ${baseUrl}/surveys/${qualtricsSurveyId}/export-responses. Details: ${errorDetail}`);
          }
          throw new Error(`Qualtrics API error: ${response.status}. Details: ${errorDetail}`);
        }

        const data = await response.json();
        const progressId = data.result.progressId;
        
        console.log('[QualtricsAPI] Export started, progress ID:', progressId);
        this.emitProgress('Export request accepted...', 10);
        
        return progressId;
      } catch (error) {
        console.error('[QualtricsAPI] Failed to start export:', error);
        throw error;
      }
    }

    /**
     * Poll export progress until complete
     * @param {Object} credentials - Qualtrics credentials
     * @param {string} progressId - Progress ID from startExport
     * @returns {Promise<string>} fileId when complete
     */
    async pollProgress(credentials, progressId) {
      const { qualtricsApiToken, qualtricsDatacenter, qualtricsSurveyId } = credentials;
      const baseUrl = this.getBaseUrl(qualtricsDatacenter);
      
      console.log('[QualtricsAPI] Polling progress:', progressId);
      
      let fileId = null;
      let attempts = 0;
      const maxAttempts = 60; // 2 minutes (2 seconds per attempt)
      const pollInterval = 2000; // 2 seconds

      // Helper function to sleep
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

      while (!fileId && attempts < maxAttempts) {
        // Wait before polling (3s for first attempt, then 2s)
        await sleep(attempts === 0 ? 3000 : pollInterval);
        attempts++;

        try {
          const response = await fetch(
            `${baseUrl}/surveys/${qualtricsSurveyId}/export-responses/${progressId}`,
            {
              method: 'GET',
              headers: {
                'X-API-TOKEN': qualtricsApiToken
              }
            }
          );

          if (!response.ok) {
            throw new Error(`Qualtrics API error: ${response.status}`);
          }

          const data = await response.json();
          const result = data.result;
          
          const percentComplete = result.percentComplete || 0;
          console.log(`[QualtricsAPI] Progress: ${percentComplete}%`);
          
          // Update progress (10-40% range for polling phase)
          const progress = 10 + Math.floor(percentComplete * 0.3);
          this.emitProgress(`Export progress: ${percentComplete}%...`, progress);

          if (result.status === 'complete') {
            fileId = result.fileId;
            console.log('[QualtricsAPI] Export complete, file ID:', fileId);
            this.emitProgress('Export complete, downloading...', 45);
          } else if (result.status === 'failed') {
            throw new Error('Qualtrics export failed. Please try again.');
          }
        } catch (error) {
          console.error('[QualtricsAPI] Poll attempt', attempts, 'failed:', error);
          if (attempts >= maxAttempts) {
            throw error;
          }
          // Continue polling on non-fatal errors
        }
      }

      if (!fileId) {
        throw new Error('Qualtrics export timed out after 2 minutes. Please try again.');
      }

      return fileId;
    }

    /**
     * Download completed export file
     * @param {Object} credentials - Qualtrics credentials
     * @param {string} fileId - File ID from pollProgress
     * @returns {Promise<Array>} Raw Qualtrics responses
     */
    async downloadFile(credentials, fileId) {
      const { qualtricsApiToken, qualtricsDatacenter, qualtricsSurveyId } = credentials;
      const baseUrl = this.getBaseUrl(qualtricsDatacenter);
      
      console.log('[QualtricsAPI] Downloading file:', fileId);
      this.emitProgress('Downloading export file...', 50);

      try {
        const response = await fetch(
          `${baseUrl}/surveys/${qualtricsSurveyId}/export-responses/${fileId}/file`,
          {
            method: 'GET',
            headers: {
              'X-API-TOKEN': qualtricsApiToken
            }
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to download export: ${response.status}`);
        }

        const data = await response.json();
        const responses = data.responses || [];
        
        console.log(`[QualtricsAPI] Downloaded ${responses.length} responses`);
        this.emitProgress(`Downloaded ${responses.length} responses`, 60);
        
        return responses;
      } catch (error) {
        console.error('[QualtricsAPI] Failed to download file:', error);
        throw error;
      }
    }

    /**
     * Complete export workflow (start → poll → download)
     * @param {Object} credentials - Qualtrics credentials
     * @param {Array} questionIds - Optional array of QIDs to filter
     * @returns {Promise<Array>} Raw Qualtrics responses
     */
    async fetchAllResponses(credentials, questionIds = null) {
      console.log('[QualtricsAPI] ========== FETCHING ALL QUALTRICS RESPONSES ==========');
      console.log('[QualtricsAPI] Survey ID:', credentials.qualtricsSurveyId);
      console.log('[QualtricsAPI] Datacenter:', credentials.qualtricsDatacenter);

      try {
        // Step 1: Start export
        const progressId = await this.startExport(credentials, questionIds);

        // Step 2: Poll until complete
        const fileId = await this.pollProgress(credentials, progressId);

        // Step 3: Download file
        const responses = await this.downloadFile(credentials, fileId);

        console.log('[QualtricsAPI] ========== FETCH COMPLETE ==========');
        return responses;
      } catch (error) {
        console.error('[QualtricsAPI] Fetch failed:', error);
        throw error;
      }
    }

    /**
     * Get survey definition (questions, structure)
     * @param {Object} credentials - Qualtrics credentials
     * @returns {Promise<Object>} Survey definition
     */
    async getSurveyDefinition(credentials) {
      const { qualtricsApiToken, qualtricsDatacenter, qualtricsSurveyId } = credentials;
      const baseUrl = this.getBaseUrl(qualtricsDatacenter);
      
      console.log('[QualtricsAPI] Fetching survey definition:', qualtricsSurveyId);

      try {
        const response = await fetch(
          `${baseUrl}/surveys/${qualtricsSurveyId}`,
          {
            method: 'GET',
            headers: {
              'X-API-TOKEN': qualtricsApiToken
            }
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch survey definition: ${response.status}`);
        }

        const data = await response.json();
        return data.result;
      } catch (error) {
        console.error('[QualtricsAPI] Failed to get survey definition:', error);
        throw error;
      }
    }
  }

  // Expose globally
  window.QualtricsAPI = QualtricsAPI;
  console.log('[QualtricsAPI] Module loaded');
})();
