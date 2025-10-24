/**
 * ⚠️ DEPRECATED - DO NOT USE IN NEW CODE
 * 
 * This file contains legacy validation logic that has been superseded by
 * TaskValidator.js (assets/js/task-validator.js). All pages now use TaskValidator
 * as the single source of truth for validation.
 * 
 * This file is kept for historical reference only and should not be included
 * in new pages.
 * 
 * WHY DEPRECATED:
 * - TaskValidator.js is the single source of truth
 * - More comprehensive termination rules in TaskValidator
 * - Better post-termination answer detection
 * - Consistent validation across all pages (student, class, school)
 * - All current pages use JotFormCache + TaskValidator pattern
 * 
 * MIGRATION GUIDE:
 * Instead of StudentDataProcessor, use:
 * 
 * For student page:
 *   const validation = await window.TaskValidator.validateAllTasks(mergedAnswers);
 * 
 * For class/school pages:
 *   const cache = await window.JotFormCache.buildStudentValidationCache(students, surveyStructure);
 * 
 * @deprecated Since 2024-10-16 - Use TaskValidator.js instead
 * @see assets/js/task-validator.js - Single source of truth for validation
 * @see assets/js/jotform-cache.js - Caching layer for class/school aggregation
 */

/**
 * Student Data Processor for 4Set Checking System (LEGACY)
 * Fetches, merges, validates, and displays student assessment data
 * 
 * @deprecated This class is no longer used. See deprecation notice above.
 */

class StudentDataProcessor {
    constructor() {
        this.coreId = null;
        this.qidMapping = null;
        this.taskDefinitions = {};
        this.mergedData = null;
        this.jotformApiBase = 'https://api.jotform.com';
        this.cacheKey = 'studentData';
    }

    async getTasksFromSurveyStructure() {
        try {
            const response = await fetch('assets/tasks/survey-structure.json');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const files = [];

            data.sets?.forEach(set => {
                set.sections?.forEach(section => {
                    if (section.file && section.file !== 'background.json') {
                        // Strip .json extension if present (we'll add it back during fetch)
                        const fileName = section.file.replace(/\.json$/i, '');
                        files.push(fileName);
                    }
                });
            });

            return Array.from(new Set(files));
        } catch (error) {
            console.warn('[StudentData] Failed to parse survey structure, falling back to defaults:', error.message);
            return [
                'ERV', 'CCM', 'CM', 'ChineseWordReading', 'EPN', 'FineMotor',
                'HeadToeKneeShoulder', 'MF', 'MathPattern', 'NONSYM', 'SYM',
                'TEC_Female', 'TEC_Male', 'TGMD', 'TheoryofMind'
            ];
        }
    }

    /**
     * Initialize the processor with a CoreID
     */
    async initialize(coreId) {
        this.coreId = coreId;
        
        // Load QID mapping
        await this.loadQIDMapping();
        
        // Load all task definitions
        await this.loadTaskDefinitions();
        
        // Try to load from cache first
        const cached = this.loadFromCache(coreId);
        if (cached && this.isCacheValid(cached)) {
            console.log('[StudentData] Using cached data');
            this.mergedData = cached.data;
            return cached.data;
        }
        
        // Fetch and merge data from Jotform
        console.log('[StudentData] Fetching from Jotform API');
        const submissions = await this.fetchJotformData(coreId);
        this.mergedData = this.mergeSubmissions(submissions);
        
        // Validate answers and apply termination rules
        this.processValidation();
        
        // Cache the result
        this.saveToCache(coreId, this.mergedData);
        
        return this.mergedData;
    }

    /**
     * Load QID to field name mapping from jotformquestions.json
     */
    async loadQIDMapping() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

            const response = await fetch('assets/jotformquestions.json', {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            this.qidMapping = await response.json();
            console.log('[StudentData] Loaded QID mapping:', Object.keys(this.qidMapping).length, 'fields');
        } catch (error) {
            console.error('[StudentData] Failed to load QID mapping:', error);
            // Provide empty mapping as fallback to keep UI responsive
            this.qidMapping = {};
        }
    }

    /**
     * Load all task definition files
     */
    async loadTaskDefinitions() {
        const tasks = await this.getTasksFromSurveyStructure();
        
        const loadPromises = tasks.map(async (taskName) => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout per file
                
                const response = await fetch(`assets/tasks/${taskName}.json`, {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const taskData = await response.json();
                this.taskDefinitions[taskData.id || taskName.toLowerCase()] = taskData;
            } catch (error) {
                console.warn(`[StudentData] Could not load task ${taskName}:`, error.message);
            }
        });
        
        await Promise.all(loadPromises);
        console.log('[StudentData] Loaded task definitions:', Object.keys(this.taskDefinitions));
        
        if (Object.keys(this.taskDefinitions).length === 0) {
            console.warn('[StudentData] No task definitions loaded - validation will not work');
        }
    }

    /**
     * Fetch all submissions for a given CoreID from Jotform API
     * Now uses global cache to avoid redundant API calls
     */
    async fetchJotformData(coreId) {
        try {
            // Get credentials from cached data (already decrypted on home page)
            const cachedData = window.CheckingSystemData?.getCachedData();
            if (!cachedData || !cachedData.credentials) {
                throw new Error('Credentials not found in cached data');
            }

            const credentials = cachedData.credentials;

            console.log('[StudentData] ========== JOTFORM FETCH (GLOBAL CACHE) ==========');
            console.log('[StudentData] Core ID:', coreId);
            console.log('[StudentData] Form ID:', credentials.formId);

            // Use global cache manager
            if (!window.JotFormCache) {
                throw new Error('JotFormCache not initialized');
            }

            // Get all submissions from cache or API
            const allSubmissions = await window.JotFormCache.getAllSubmissions({
                formId: credentials.formId,
                apiKey: credentials.apiKey
            });

            console.log('[StudentData] Total submissions in cache:', allSubmissions.length);

            // Filter by CoreID client-side (using default STUDENT_ID_QID from JotFormCache)
            const filteredSubmissions = window.JotFormCache.filterByCoreId(allSubmissions, coreId);

            console.log('[StudentData] Filtered submissions for', coreId + ':', filteredSubmissions.length);

            if (filteredSubmissions.length === 0) {
                console.warn('[StudentData] ⚠️ No submissions found for CoreID:', coreId);
            } else {
                console.log('[StudentData] ✓ Found', filteredSubmissions.length, 'submission(s)');
            }

            // Return in same format as original API response
            return {
                responseCode: 200,
                content: filteredSubmissions,
                limit: filteredSubmissions.length,
                offset: 0
            };
            
        } catch (error) {
            console.error('[StudentData] Failed to fetch from Jotform:', error);
            throw error;
        }
    }

    /**
     * Mock submissions for testing
     */
    getMockSubmissions(coreId) {
        return {
            content: [
                {
                    id: '123456',
                    answers: {
                        '3': { answer: `${coreId}_20251005_10_30` }, // sessionkey
                        '20': { answer: 'St10001' }, // student-id
                        '21': { answer: '黃子晴 (Chloe Wong)' }, // child-name
                        '22': { answer: 'S001' }, // school-id
                        '24': { answer: 'C001' }, // class-id
                        '30': { answer: '4' }, // ERV_Q1
                        '31': { answer: '2' }, // ERV_Q2
                        // ... more answers
                    }
                },
                {
                    id: '123457',
                    answers: {
                        '3': { answer: `${coreId}_20251005_15_45` }, // sessionkey - later time
                        '20': { answer: 'St10001' },
                        '40': { answer: '1' }, // ERV_Q11
                        '41': { answer: '3' }, // ERV_Q12
                        // ... more answers (potentially overlapping)
                    }
                }
            ]
        };
    }

    /**
     * Merge multiple submissions into a single record
     * For overlapping fields, prefer the value from the earlier session
     */
    mergeSubmissions(apiResponse) {
        const submissions = apiResponse.content || apiResponse;
        
        // Ensure submissions is an array
        if (!Array.isArray(submissions)) {
            console.warn('[StudentData] Invalid submissions format:', typeof submissions);
            return {};
        }
        
        if (submissions.length === 0) {
            console.warn('[StudentData] No submissions found');
            return {};
        }
        
        // Sort submissions by session key datetime (earliest first)
        const sorted = submissions.sort((a, b) => {
            const timeA = this.extractDatetime(a.answers['3']?.answer || '');
            const timeB = this.extractDatetime(b.answers['3']?.answer || '');
            return timeA - timeB;
        });
        
        console.log('[StudentData] Merging', sorted.length, 'submissions');
        
        // Merge answers: earlier values take precedence
        const merged = {};
        const metadata = {
            submissionCount: sorted.length,
            sessionKeys: [],
            mergeTimestamp: new Date().toISOString()
        };
        
        // Reverse iterate so earlier submissions overwrite later ones
        for (let i = sorted.length - 1; i >= 0; i--) {
            const submission = sorted[i];
            const sessionKey = submission.answers['3']?.answer || '';
            metadata.sessionKeys.push(sessionKey);
            
            // Merge all answers
            Object.entries(submission.answers || {}).forEach(([qid, answer]) => {
                const fieldName = this.getFieldNameFromQID(qid);
                if (fieldName && !merged[fieldName]) {
                    merged[fieldName] = {
                        value: answer.answer || answer.text || '',
                        qid: qid,
                        sessionKey: sessionKey,
                        submissionId: submission.id
                    };
                }
            });
        }
        
        merged._metadata = metadata;
        console.log('[StudentData] Merged result:', Object.keys(merged).length, 'fields');
        
        return merged;
    }

    /**
     * Extract datetime from session key format: coreid_yyyymmdd_hh_mm
     */
    extractDatetime(sessionKey) {
        if (!sessionKey || typeof sessionKey !== 'string') return new Date(0);
        
        const parts = sessionKey.split('_');
        if (parts.length < 4) return new Date(0);
        
        const dateStr = parts[parts.length - 3]; // yyyymmdd
        const hour = parts[parts.length - 2];
        const min = parts[parts.length - 1];
        
        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6);
        const day = dateStr.substring(6, 8);
        
        return new Date(`${year}-${month}-${day}T${hour}:${min}:00`);
    }

    /**
     * Get field name from QID using jotformquestions.json mapping
     */
    getFieldNameFromQID(qid) {
        if (!this.qidMapping) return null;
        
        for (const [fieldName, mappedQid] of Object.entries(this.qidMapping)) {
            if (mappedQid === qid || mappedQid === qid.toString()) {
                return fieldName;
            }
        }
        return null;
    }

    /**
     * Get QID from field name
     */
    getQIDFromFieldName(fieldName) {
        return this.qidMapping?.[fieldName] || null;
    }

    /**
     * Process validation and termination rules
     */
    processValidation() {
        if (!this.mergedData) return;
        
        // Validate answers against task definitions
        this.mergedData._validation = {
            tasks: {},
            termination: {},
            completionRate: 0,
            totalQuestions: 0,
            answeredQuestions: 0
        };
        
        // Process each task
        Object.values(this.taskDefinitions).forEach(task => {
            const taskResult = this.validateTask(task);
            this.mergedData._validation.tasks[task.id] = taskResult;
            
            // Apply termination rules
            const terminationResult = this.applyTerminationRules(task, taskResult);
            if (terminationResult) {
                this.mergedData._validation.termination[task.id] = terminationResult;
            }
        });
        
        // Calculate overall completion rate
        const validation = this.mergedData._validation;
        validation.completionRate = validation.totalQuestions > 0 
            ? (validation.answeredQuestions / validation.totalQuestions * 100).toFixed(1)
            : 0;
        
        console.log('[StudentData] Validation complete:', validation.completionRate + '%', 'completion');
    }

    /**
     * Validate a single task
     */
    validateTask(task) {
        const taskId = task.id;
        const questions = task.questions || [];
        const result = {
            taskId: taskId,
            title: task.title,
            questions: [],
            totalQuestions: 0,
            answeredQuestions: 0,
            correctAnswers: 0,
            incorrectAnswers: 0,
            completionRate: 0
        };
        
        questions.forEach(question => {
            // Skip instruction screens
            if (question.type === 'instruction' || !question.scoring) {
                return;
            }
            
            const questionId = question.id;
            const studentAnswer = this.mergedData[questionId]?.value;
            const correctAnswer = question.scoring?.correctAnswer;
            
            result.totalQuestions++;
            this.mergedData._validation.totalQuestions++;
            
            if (studentAnswer) {
                result.answeredQuestions++;
                this.mergedData._validation.answeredQuestions++;
                
                const isCorrect = studentAnswer === correctAnswer;
                if (isCorrect) {
                    result.correctAnswers++;
                } else {
                    result.incorrectAnswers++;
                }
                
                result.questions.push({
                    id: questionId,
                    studentAnswer: studentAnswer,
                    correctAnswer: correctAnswer,
                    isCorrect: isCorrect,
                    sessionKey: this.mergedData[questionId]?.sessionKey
                });
            }
        });
        
        result.completionRate = result.totalQuestions > 0
            ? (result.answeredQuestions / result.totalQuestions * 100).toFixed(1)
            : 0;
        
        return result;
    }

    /**
     * Apply termination rules based on PRD specifications
     */
    applyTerminationRules(task, validationResult) {
        const taskId = task.id;
        const terminationRules = this.getTerminationRulesForTask(taskId);
        
        if (!terminationRules || terminationRules.length === 0) {
            return null;
        }
        
        const result = {
            taskId: taskId,
            rules: [],
            activeTerminations: []
        };
        
        terminationRules.forEach(rule => {
            const ruleResult = this.evaluateTerminationRule(rule, validationResult);
            result.rules.push(ruleResult);
            
            if (ruleResult.triggered) {
                result.activeTerminations.push(ruleResult.ruleId);
            }
        });
        
        return result;
    }

    /**
     * Get termination rules for a specific task
     */
    getTerminationRulesForTask(taskId) {
        const rules = {
            'erv': [
                { ruleId: 'ERV_Ter1', range: 'ERV_Q1-ERV_Q12', threshold: 5, total: 12 },
                { ruleId: 'ERV_Ter2', range: 'ERV_Q13-ERV_Q24', threshold: 5, total: 12 },
                { ruleId: 'ERV_Ter3', range: 'ERV_Q25-ERV_Q36', threshold: 5, total: 12 }
            ],
            'cm': [
                { ruleId: 'CM_Ter1', range: 'CM_Q1-CM_Q7', threshold: 4, total: 7 },
                { ruleId: 'CM_Ter2', range: 'CM_Q8-CM_Q12', threshold: 4, total: 5 },
                { ruleId: 'CM_Ter3', range: 'CM_Q13-CM_Q17', threshold: 4, total: 5 },
                { ruleId: 'CM_Ter4', range: 'CM_Q18-CM_Q22', threshold: 4, total: 5 }
            ],
            'mathpattern': [
                { ruleId: 'MPT_Stage1', range: 'MPT_1_r_Q1-MPT_1_r_Q6', threshold: 5, total: 6 },
                { ruleId: 'MPT_Stage2', range: 'MPT_2_gr_Q1-MPT_2_gr_Q6', threshold: 5, total: 6 },
                { ruleId: 'MPT_Stage3', range: 'MPT_3_m_Q1-MPT_4_ge_Q4', threshold: 5, total: 8 }
            ]
        };
        
        return rules[taskId] || [];
    }

    /**
     * Evaluate a single termination rule
     */
    evaluateTerminationRule(rule, validationResult) {
        const [startId, endId] = rule.range.split('-');
        const questionsInRange = validationResult.questions.filter(q => {
            return this.isQuestionInRange(q.id, startId, endId);
        });
        
        const correctCount = questionsInRange.filter(q => q.isCorrect).length;
        const answeredCount = questionsInRange.length;
        const unansweredCount = rule.total - answeredCount;
        
        // Apply "Absolute Certainty Principle" from termination-rules.md
        let triggered = null;
        let status = 'unknown';
        
        if (correctCount >= rule.threshold) {
            // Already passed threshold
            triggered = false;
            status = 'passed';
        } else if (correctCount + unansweredCount < rule.threshold) {
            // Impossible to pass even if all remaining are correct
            triggered = true;
            status = 'triggered';
        } else {
            // Still mathematically possible to pass
            triggered = null;
            status = 'pending';
        }
        
        return {
            ruleId: rule.ruleId,
            range: rule.range,
            threshold: rule.threshold,
            correctCount: correctCount,
            answeredCount: answeredCount,
            unansweredCount: unansweredCount,
            triggered: triggered,
            status: status
        };
    }

    /**
     * Check if a question ID is within a range
     */
    isQuestionInRange(questionId, startId, endId) {
        // Simple implementation - extract numbers and compare
        const extractNum = (id) => {
            const match = id.match(/\d+$/);
            return match ? parseInt(match[0]) : 0;
        };
        
        const qNum = extractNum(questionId);
        const startNum = extractNum(startId);
        const endNum = extractNum(endId);
        
        const prefix = questionId.replace(/\d+$/, '');
        const startPrefix = startId.replace(/\d+$/, '');
        
        return prefix === startPrefix && qNum >= startNum && qNum <= endNum;
    }

    /**
     * Save data to localStorage cache
     */
    saveToCache(coreId, data) {
        try {
            const cacheEntry = {
                coreId: coreId,
                data: data,
                timestamp: Date.now()
            };
            localStorage.setItem(`${this.cacheKey}_${coreId}`, JSON.stringify(cacheEntry));
            console.log('[StudentData] Saved to cache');
        } catch (error) {
            console.warn('[StudentData] Failed to save to cache:', error);
        }
    }

    /**
     * Load data from localStorage cache
     */
    loadFromCache(coreId) {
        try {
            const cached = localStorage.getItem(`${this.cacheKey}_${coreId}`);
            if (!cached) return null;
            
            return JSON.parse(cached);
        } catch (error) {
            console.warn('[StudentData] Failed to load from cache:', error);
            return null;
        }
    }

    /**
     * Check if cache is still valid (within 1 hour)
     */
    isCacheValid(cacheEntry, maxAgeMs = 3600000) {
        if (!cacheEntry || !cacheEntry.timestamp) return false;
        return (Date.now() - cacheEntry.timestamp) < maxAgeMs;
    }

    /**
     * Clear cache for a specific student or all students
     */
    clearCache(coreId = null) {
        if (coreId) {
            localStorage.removeItem(`${this.cacheKey}_${coreId}`);
        } else {
            // Clear all student caches
            const keys = Object.keys(localStorage);
            keys.forEach(key => {
                if (key.startsWith(this.cacheKey)) {
                    localStorage.removeItem(key);
                }
            });
        }
        console.log('[StudentData] Cache cleared');
    }

    /**
     * Get processed data
     */
    getData() {
        return this.mergedData;
    }

    /**
     * Get validation results
     */
    getValidation() {
        return this.mergedData?._validation;
    }

    /**
     * Get task-specific validation
     */
    getTaskValidation(taskId) {
        return this.mergedData?._validation?.tasks[taskId];
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StudentDataProcessor;
}
