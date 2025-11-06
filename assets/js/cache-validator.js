/**
 * Cache vs Display Validator for 4Set Checking System
 * 
 * ============================================================================
 * PURPOSE: Compare IndexedDB cache data with displayed DOM values
 * ============================================================================
 * 
 * This module provides validation across all drilldown pages:
 * - Student: Raw answers, task completion, termination status, COR fields
 * - Class: Student-level aggregations (handles 'by set/class' and 'by task' modes)
 * - School: Class-level aggregations (handles 'by set/class' and 'by task' modes)
 * - District: School-level aggregations
 * - Group: School-level aggregations
 * 
 * VALIDATION SCOPE:
 * - Raw answer values (cache QID → DOM display)
 * - Computed fields (COR percentages, totals, averages)
 * - Status indicators (light colors, completion badges)
 * - Aggregated statistics (student counts, completion rates)
 * 
 * USAGE:
 * const validator = CacheValidator.create('student', { coreId: 'C12345', grade: 'K3' });
 * const results = await validator.validate();
 * CacheValidator.showResults(results);
 */
window.CacheValidator = (() => {
  console.log('[CacheValidator] ===== MODULE LOADING =====');
  
  // ============================================================================
  // IndexedDB Utilities (using localForage)
  // ============================================================================
  
  // Initialize localForage instances (same as jotform-cache.js)
  const storage = localforage.createInstance({
    name: 'JotFormCacheDB',
    storeName: 'cache'
  });
  
  const validationStorage = localforage.createInstance({
    name: 'JotFormCacheDB',
    storeName: 'student_validation'
  });
  
  async function getMergedCache() {
    const data = await storage.getItem('merged_jotform_qualtrics_cache');
    return data?.submissions || [];
  }
  
  async function getValidationCache() {
    const data = await validationStorage.getItem('student_task_validation_cache');
    return data || {};
  }
  
  // ============================================================================
  // DOM Extraction Utilities
  // ============================================================================
  
  function extractTableData(tableSelector) {
    const table = document.querySelector(tableSelector);
    if (!table) return null;
    
    const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
    const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => {
      const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
      return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
    });
    
    return { headers, rows };
  }
  
  function extractStatusLight(element) {
    if (!element) return null;
    const classList = element.classList;
    if (classList.contains('status-green')) return 'green';
    if (classList.contains('status-yellow')) return 'yellow';
    if (classList.contains('status-red')) return 'red';
    if (classList.contains('status-grey')) return 'grey';
    return 'unknown';
  }
  
  function extractCompletionPercentage(text) {
    const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
    return match ? parseFloat(match[1]) : null;
  }
  
  // ============================================================================
  // Student Page Validator
  // ============================================================================
  
  class StudentValidator {
    constructor(coreId, grade, options = {}) {
      this.coreId = coreId;
      this.grade = grade;
      this.useDom = options.useDom !== false; // Default to true for backward compatibility
    }

    async validate() {
      console.log('[StudentValidator] ===== VALIDATE CALLED =====');
      console.log('[StudentValidator] Validating', this.coreId, this.grade);
      console.log('[StudentValidator] Mode:', this.useDom ? 'DOM-based' : 'Cache-only');
      console.log('[StudentValidator] this:', this);
      
      const results = {
        pageType: 'student',
        timestamp: new Date().toISOString(),
        params: { coreId: this.coreId, grade: this.grade },
        sections: []
      };
      
      // Get merged cache from JotFormCache
      console.log('[StudentValidator] Getting merged cache...');
      const cacheData = await window.JotFormCache.loadFromCache();
      const mergedCache = cacheData?.submissions || [];
      console.log('[StudentValidator] mergedCache length:', mergedCache?.length);
      
      if (!mergedCache || mergedCache.length === 0) {
        results.error = 'No merged cache found for this student';
        return results;
      }
      
      // Filter by coreId and grade to get the specific student submission
      const studentSubmissions = mergedCache.filter(s => 
        s.coreId === this.coreId && s.grade === this.grade
      );
      
      if (studentSubmissions.length === 0) {
        results.error = `No submission found for coreId ${this.coreId}, grade ${this.grade}`;
        return results;
      }
      
      const submission = studentSubmissions[0]; // Get the student's submission
      
      console.log('[StudentValidator] Submission structure:', {
        coreId: submission.coreId,
        studentId: submission.studentId,
        studentName: submission.studentName,
        hasAnswers: !!submission.answers,
        answerCount: submission.answers ? Object.keys(submission.answers).length : 0
      });
      
      // Validate profile fields
      const profileSection = await this.validateProfileFields(submission);
      results.sections.push(profileSection);
      
      // Validate task questions
      if (this.useDom) {
        // DOM-based validation (student page)
        const taskSection = await this.validateAllTaskQuestions(submission);
        results.sections.push(taskSection);
      } else {
        // Cache-only validation (class page)
        const taskSection = await this.validateTasksViaTaskValidator(submission);
        results.sections.push(taskSection);
      }
      
      return results;
    }
    
    async validateProfileFields(submission) {
      const section = {
        name: 'Profile Fields',
        mismatches: [],
        validated: 0,
        failed: 0
      };
      
      // Build fieldName → answer map from answers object
      const fieldNameMap = {};
      if (submission.answers) {
        for (const [qid, answerObj] of Object.entries(submission.answers)) {
          if (answerObj.name) {
            fieldNameMap[answerObj.name] = answerObj.answer;
          }
        }
      }
      
      // Helper to get cache value - checks top-level properties AND answers object
      const getCacheValue = (possibleNames) => {
        for (const name of possibleNames) {
          // Check top-level properties first
          if (submission[name] !== undefined) return submission[name];
          // Check answers object by field name
          if (fieldNameMap[name] !== undefined) return fieldNameMap[name];
        }
        return undefined;
      };
      
      const fields = [
        { cacheNames: ['coreId', 'core-id'], domId: 'student-core-id', label: 'Core ID' },
        { cacheNames: ['child-name', 'studentName', 'student-name'], domId: 'student-name', label: 'Student Name' },
        { cacheNames: ['class-id', 'classId'], domId: 'student-class-id', label: 'Class ID' },
        { cacheNames: ['gender'], domId: 'student-gender', label: 'Gender', normalize: (v) => v === 'M' ? 'Male' : v === 'F' ? 'Female' : v },
        { 
          cacheNames: ['school-id', 'schoolId'], 
          domId: 'student-school-id', 
          label: 'School ID',
          normalize: (v) => {
            // Normalize school IDs: "84" → "S084", "S084" → "S084"
            if (!v) return v;
            const str = String(v);
            if (str.startsWith('S')) return str; // Already has S prefix
            return 'S' + str.padStart(3, '0'); // Add S and pad to 3 digits
          }
        }
      ];
      
      for (const field of fields) {
        let cacheValue = getCacheValue(field.cacheNames);
        if (field.normalize && cacheValue) {
          cacheValue = field.normalize(cacheValue);
        }
        
        const domElement = document.getElementById(field.domId);
        const domValue = domElement?.textContent.trim();
        
        section.validated++;
        
        // Pass field name for special mappings (e.g., Gender)
        const fieldName = field.cacheNames[0]; // Use first cache name as identifier
        const match = this.normalizeValue(cacheValue, fieldName) === this.normalizeValue(domValue, fieldName);
        
        section.mismatches.push({
          field: field.label,
          cacheRaw: cacheValue !== undefined ? cacheValue : 'undefined',
          displayValue: domValue,
          status: match ? '✅ Match' : '❌ Mismatch'
        });
        
        if (!match) {
          section.failed++;
        }
      }
      
      return section;
    }
    
    async validateAllTaskQuestions(submission) {
      console.log('[CacheValidator] ===== validateAllTaskQuestions CALLED =====');
      console.log('[CacheValidator] submission:', submission);
      console.log('[CacheValidator] submission.answers exists:', !!submission.answers);
      
      if (!submission.answers) {
        console.warn('[StudentValidator] No answers object in submission');
        return {
          name: 'Task Questions - Raw Answers',
          error: 'No answers object in submission',
          sets: []
        };
      }
      
      // Load task metadata to get question definitions for option mapping
      const taskMetadata = await this.loadTaskMetadata();
      console.log('[CacheValidator] Task metadata result:', taskMetadata ? `${taskMetadata.length} tasks` : 'null');
      
      const questionDefMap = new Map();
      if (taskMetadata && taskMetadata.length > 0) {
        for (const task of taskMetadata) {
          console.log('[CacheValidator] Processing task:', task.id || task.title);
          
          // Load the actual task file to get question definitions
          try {
            const taskResponse = await fetch(`assets/tasks/${task.id.toUpperCase()}.json`);
            const taskData = await taskResponse.json();
            
            if (taskData.questions) {
              for (const q of taskData.questions) {
                questionDefMap.set(q.id, q);
                // Handle multi-question groups
                if (q.questions) {
                  console.log(`[CacheValidator]   Multi-question group ${q.id} has ${q.questions.length} sub-questions`);
                  for (const subQ of q.questions) {
                    questionDefMap.set(subQ.id, subQ);
                  }
                }
              }
              console.log(`[CacheValidator]   Loaded ${taskData.questions.length} questions for ${task.id}`);
            }
          } catch (error) {
            console.warn(`[CacheValidator] Failed to load task file for ${task.id}:`, error);
          }
        }
      } else {
        console.warn('[CacheValidator] No task metadata available, cannot map answer values');
      }
      console.log('[CacheValidator] Loaded', questionDefMap.size, 'question definitions');
      
      // Debug: Check if ToM_Q1a was loaded
      const tomQ1a = questionDefMap.get('ToM_Q1a');
      console.log('[CacheValidator] ToM_Q1a definition:', tomQ1a ? `type=${tomQ1a.type}, options=${tomQ1a.options?.length}` : 'NOT FOUND');
      
      // Build fieldName → answer map for efficient lookups
      // Store both raw and mapped values for transparency
      const fieldNameMap = {};
      for (const [qid, answerObj] of Object.entries(submission.answers)) {
        if (answerObj.name) {
          // CRITICAL: Check BOTH answer and text fields, just like TaskValidator
          // Some questions store answers in .text instead of .answer
          const rawAnswer = answerObj.answer || answerObj.text || null;
          
          // Apply the SAME option mapping logic as TaskValidator
          let mappedAnswer = rawAnswer;
          let questionDef = questionDefMap.get(answerObj.name);
          
          // SPECIAL HANDLING for TGMD matrix questions
          // Cache stores: TGMD_111_Hop_t1, TGMD_111_Hop_t2
          // Task file defines: TGMD_111_Hop (matrix row)
          if (!questionDef && answerObj.name && answerObj.name.includes('_t')) {
            // Try to find the base matrix row definition
            const baseName = answerObj.name.replace(/_t\d+$/, '');
            questionDef = questionDefMap.get(baseName);
            
            if (questionDef && questionDef.type === 'matrix-radio') {
              // For matrix questions, use the base row definition
              console.log(`[CacheValidator] Matrix question: ${answerObj.name} -> base ${baseName}`);
            }
          }
          
          if (questionDef) {
            mappedAnswer = this.mapAnswerValue(rawAnswer, questionDef);
          } else if (answerObj.name && answerObj.name.startsWith('NONSYM')) {
            console.warn('[CacheValidator] NONSYM question definition NOT FOUND:', answerObj.name);
          }
          fieldNameMap[answerObj.name] = {
            raw: rawAnswer,
            mapped: mappedAnswer
          };
        }
      }
      
      console.log('[CacheValidator] Built fieldNameMap with', Object.keys(fieldNameMap).length, 'entries');
      console.log('[CacheValidator] Sample fields:', Object.keys(fieldNameMap).slice(0, 10));
      
      // Group results by set → task
      const setResults = [];
      
      // FUCK THE SET CONTAINERS. Just find all tasks directly and group them ourselves.
      const allTasks = document.querySelectorAll('[data-task][data-set]');
      console.log('[CacheValidator] Found', allTasks.length, 'total tasks in DOM');
      
      // Group tasks by their data-set attribute
      const tasksBySet = {};
      for (const taskElement of allTasks) {
        const setName = taskElement.getAttribute('data-set');
        const taskId = taskElement.getAttribute('data-task');
        
        if (!tasksBySet[setName]) {
          tasksBySet[setName] = [];
        }
        tasksBySet[setName].push(taskElement);
      }
      
      console.log('[CacheValidator] Grouped into sets:', Object.keys(tasksBySet));
      
      // Now process each set
      for (const [setName, taskElements] of Object.entries(tasksBySet)) {
        const taskResults = [];
        console.log('[CacheValidator] Processing set', setName, 'with', taskElements.length, 'tasks');
        
        for (const taskElement of taskElements) {
          const taskId = taskElement.getAttribute('data-task');
          const tbody = taskElement.querySelector('tbody');
          console.log('[CacheValidator] Task', taskId, 'tbody found:', !!tbody);
          if (!tbody) {
            console.log('[CacheValidator] No tbody for task', taskId, '- skipping');
            continue;
          }
          
          const questionMismatches = [];
          let validated = 0;
          let failed = 0;
          
          const rows = tbody.querySelectorAll('tr');
          console.log('[CacheValidator] Task', taskId, 'has', rows.length, 'rows');
          
          if (rows.length === 0) {
            console.log('[CacheValidator] Task', taskId, 'has NO ROWS - skipping');
            continue;
          }
          
          let processedCount = 0;
          let skippedCount = 0;
          
          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 4) {
              console.log('[CacheValidator] Row has only', cells.length, 'cells, skipping');
              continue;
            }
            
            const questionId = cells[0]?.textContent.trim();
            const displayAnswer = cells[1]?.textContent.trim();
            
            // Extract clean question ID for TGMD matrix questions
            // DOM shows: "TGMD_111_Hop\n離地腳有自然彎曲並向前擺動以提供動力"
            // Cache stores: "TGMD_111_Hop_t1", "TGMD_111_Hop_t2"
            let cleanQuestionId = questionId;
            if (questionId && questionId.includes('\n')) {
              // Extract just the first line (the actual question ID)
              cleanQuestionId = questionId.split('\n')[0].trim();
            }
            
            // For TGMD matrix questions, we need to find the individual column entries
            // The DOM shows the base question ID, but cache has _t1, _t2 variants
            let matchingCacheEntries = [];
            if (cleanQuestionId && cleanQuestionId.startsWith('TGMD_')) {
              // Find all cache entries that match this TGMD base question
              Object.keys(fieldNameMap).forEach(cacheKey => {
                if (cacheKey.startsWith(cleanQuestionId + '_t')) {
                  matchingCacheEntries.push({
                    key: cacheKey,
                    data: fieldNameMap[cacheKey]
                  });
                }
              });
            }
            
            // Look up answer in cache using fieldName
            // NOTE: Cache values are now pre-mapped using mapAnswerValue() above
            let cacheData = fieldNameMap[cleanQuestionId];
            
            // SPECIAL HANDLING for TGMD matrix questions
            // Try exact match first, then try matrix base name for fallback
            if (!cacheData && cleanQuestionId && cleanQuestionId.includes('_t')) {
              const baseName = cleanQuestionId.replace(/_t\d+$/, '');
              cacheData = fieldNameMap[baseName];
              if (cacheData) {
                console.log(`[CacheValidator] Matrix fallback: ${cleanQuestionId} -> base ${baseName}`);
              }
            }
            
            // For TGMD matrix questions, combine all trial data
            let finalCacheAnswer = cacheData?.mapped;
            let finalCacheRaw = cacheData?.raw;
            
            if (matchingCacheEntries.length > 0) {
              // CRITICAL: Check if ANY trial has actual data before processing
              // Don't fabricate "0, 0" when TGMD fields are completely absent (Qualtrics-only records)
              const hasAnyData = matchingCacheEntries.some(entry => {
                const raw = entry.data.raw;
                return raw !== null && raw !== undefined && raw !== '' && raw !== cleanQuestionId;
              });
              
              if (hasAnyData) {
                // Process TGMD raw trial data into scores like the student page
                const trialValues = matchingCacheEntries.map(entry => {
                  const value = entry.data.raw;
                  // Convert to number, treating non-numeric/empty values as 0
                  if (value === null || value === undefined || value === '' || value === cleanQuestionId) {
                    return 0;
                  }
                  return parseInt(value, 10) || 0;
                });
                
                // Calculate score: count of successful trials / total trials
                const successfulTrials = trialValues.reduce((sum, val) => sum + val, 0);
                const totalTrials = trialValues.length;
                const score = `${successfulTrials}/${totalTrials}`;
                
                finalCacheRaw = trialValues.join(', ');
                finalCacheAnswer = score;
                console.log(`[CacheValidator] TGMD matrix: ${cleanQuestionId} trials [${trialValues.join(', ')}] -> score ${score}`);
              } else {
                // No actual TGMD data - don't fabricate "0, 0"
                finalCacheRaw = null;
                finalCacheAnswer = null;
                console.log(`[CacheValidator] TGMD matrix: ${cleanQuestionId} has NO data (Qualtrics-only?) -> null`);
              }
            }
            
            // CRITICAL: Filter Qualtrics placeholders (same logic as TaskValidator)
            // If cache value equals question ID, it's a placeholder = treat as empty
            if (finalCacheAnswer === cleanQuestionId || finalCacheRaw === cleanQuestionId) {
              finalCacheAnswer = null;
              finalCacheRaw = null;
            }
            
            processedCount++;
            
            validated++;
            
            // For TGMD questions, we need special handling to compare trial data
            let expectedDisplay = displayAnswer;
            
            if (cleanQuestionId && cleanQuestionId.startsWith('TGMD_')) {
              // Extract trial values from TGMD scoring data instead of display text
              // The display shows icons, but we need the actual trial values for comparison
              const validation = window.StudentPage?.currentValidation;
              const tgmdScoring = validation?.tgmd?.tgmdScoring?.byTask;
              if (tgmdScoring) {
                // Find the criterion in TGMD scoring data
                for (const [taskName, taskData] of Object.entries(tgmdScoring)) {
                  const criterion = taskData.criteria?.find(c => c.id === cleanQuestionId);
                  if (criterion && criterion.trials) {
                    // CRITICAL: Check if trials have actual data before formatting
                    // If trials are undefined/null, this means no TGMD data exists (e.g., Qualtrics-only record)
                    // Show "—" instead of fabricating "0, 0" from undefined values
                    const t1Val = criterion.trials.t1;
                    const t2Val = criterion.trials.t2;
                    
                    if (t1Val === undefined || t1Val === null) {
                      // No TGMD data - show dash instead of "0, 0"
                      expectedDisplay = '—';
                      console.log(`[CacheValidator] TGMD ${cleanQuestionId}: No trial data (t1=${t1Val}, t2=${t2Val}) -> "—"`);
                    } else {
                      // Has trial data - format as "t1, t2"
                      expectedDisplay = `${t1Val === 1 ? '1' : t1Val === 0 ? '0' : ''}, ${t2Val === 1 ? '1' : t2Val === 0 ? '0' : ''}`;
                      console.log(`[CacheValidator] TGMD scoring for ${cleanQuestionId}: t1=${t1Val}, t2=${t2Val} -> "${expectedDisplay}"`);
                    }
                    break;
                  }
                }
              } else {
                console.log(`[CacheValidator] TGMD scoring data not found for ${cleanQuestionId}. Available validation:`, validation);
              }
            }
            
            // For TGMD, use raw trial data for comparison (not processed score)
            const cacheValueForComparison = cleanQuestionId && cleanQuestionId.startsWith('TGMD_') ? finalCacheRaw : finalCacheAnswer;
            
            // Normalize values for comparison (null/"—"/empty all normalize to empty string)
            const normalizedCache = cacheValueForComparison === null || cacheValueForComparison === '—' ? '' : String(cacheValueForComparison).trim();
            const normalizedDisplay = expectedDisplay === null || expectedDisplay === '—' ? '' : String(expectedDisplay).trim();
            
            console.log(`[CacheValidator] Comparing ${cleanQuestionId}: cache="${normalizedCache}" vs display="${normalizedDisplay}"`);
            
            // Determine match status
            let status = '✅ Match';
            if (normalizedCache !== normalizedDisplay) {
              status = '❌ Mismatch';
              failed++;
            }
            
            // Get provenance data if available
            const provenance = submission._fieldProvenance ? submission._fieldProvenance[cleanQuestionId] : null;
            
            // Store mismatch details with provenance
            questionMismatches.push({
              field: cleanQuestionId,
              cacheRaw: cacheValueForComparison, // Show raw trial data for TGMD, processed score for others
              displayValue: cleanQuestionId && cleanQuestionId.startsWith('TGMD_') ? expectedDisplay : displayAnswer,
              status: status,
              provenance: provenance // Include provenance metadata
            });
          }
          
          console.log('[CacheValidator] Task', taskId, 'summary: processed=', processedCount, 'skipped=', skippedCount, 'validated=', validated);
          
          if (validated > 0) {
            taskResults.push({
              taskId,
              validated,
              failed,
              questions: questionMismatches
            });
          } else {
            console.log('[CacheValidator] Task', taskId, 'skipped - no validated questions');
          }
        }
        
        console.log('[CacheValidator] Set', setName, 'total tasks added:', taskResults.length);
        
        if (taskResults.length > 0) {
          setResults.push({
            setName,
            tasks: taskResults
          });
        }
      }
      
      // Calculate totals
      let totalValidated = 0;
      let totalFailed = 0;
      for (const set of setResults) {
        for (const task of set.tasks) {
          totalValidated += task.validated;
          totalFailed += task.failed;
        }
      }
      
      console.log('[CacheValidator] FINAL SUMMARY: sets=', setResults.length, 'totalValidated=', totalValidated, 'totalFailed=', totalFailed);
      
      return {
        name: 'Task Questions - Raw Answers',
        validated: totalValidated,
        failed: totalFailed,
        sets: setResults
      };
    }
    
    async validateTasksViaTaskValidator(submission) {
      console.log('[CacheValidator] ===== validateTasksViaTaskValidator CALLED =====');
      console.log('[CacheValidator] Using TaskValidator to transform answers');
      
      if (!submission.answers) {
        return {
          name: 'Task Questions - Cache Validation',
          error: 'No answers object in submission',
          tasks: {}
        };
      }
      
      // Run TaskValidator to get transformed/validated answers
      console.log('[CacheValidator] Calling TaskValidator.validateAllTasks...');
      const validation = await window.TaskValidator.validateAllTasks(submission.answers);
      console.log('[CacheValidator] TaskValidator complete:', validation);
      
      // Now compare validation results with stored cache
      const taskResults = {};
      let totalValidated = 0;
      let totalFailed = 0;
      
      for (const [taskId, taskValidation] of Object.entries(validation)) {
        if (!taskValidation.questions) continue;
        
        const questionMismatches = [];
        
        for (const question of taskValidation.questions) {
          // Get validated answer from TaskValidator
          const validatedAnswer = question.studentAnswer;
          
          // Get stored answer from cache
          const answerObj = submission.answers[question.id] || 
                           Object.values(submission.answers).find(a => a.name === question.id);
          let cachedAnswer = answerObj?.answer || answerObj?.text;
          
          // SPECIAL HANDLING for TGMD matrix questions
          // Cache stores: TGMD_111_Hop_t1, TGMD_111_Hop_t2
          // TaskValidator shows: TGMD_111_Hop with processed score
          if (question.id && question.id.startsWith('TGMD_') && !cachedAnswer) {
            // Find all TGMD trial entries for this question
            const trialEntries = Object.entries(submission.answers).filter(([key, obj]) => {
              return obj.name && obj.name.startsWith(question.id + '_t');
            });
            
            if (trialEntries.length > 0) {
              // Process trial data into score like before
              const trialValues = trialEntries.map(([key, obj]) => {
                const value = obj.answer || obj.text || '0';
                return parseInt(value, 10) || 0;
              });
              
              const successfulTrials = trialValues.reduce((sum, val) => sum + val, 0);
              const totalTrials = trialValues.length;
              cachedAnswer = `${successfulTrials}/${totalTrials}`;
              console.log(`[CacheValidator] TGMD cache processing: ${question.id} trials [${trialValues.join(', ')}] -> ${cachedAnswer}`);
            }
          }
          
          totalValidated++;
          const match = this.normalizeValue(validatedAnswer, question.id) === this.normalizeValue(cachedAnswer, question.id);
          
          questionMismatches.push({
            field: question.id,
            taskValidatorValue: validatedAnswer !== undefined && validatedAnswer !== null ? validatedAnswer : 'Not found',
            cachedValue: cachedAnswer !== undefined && cachedAnswer !== null ? cachedAnswer : 'Not found',
            status: match ? '✅ Match' : '❌ Mismatch'
          });
          
          if (!match) {
            totalFailed++;
          }
        }
        
        taskResults[taskId] = {
          taskName: taskValidation.title || taskId,
          validated: taskValidation.questions.length,
          failed: questionMismatches.filter(q => q.status.includes('❌')).length,
          mismatches: questionMismatches
        };
      }
      
      console.log('[CacheValidator] FINAL SUMMARY: tasks=', Object.keys(taskResults).length, 'totalValidated=', totalValidated, 'totalFailed=', totalFailed);
      
      return {
        name: 'Task Questions - Cache Validation',
        validated: totalValidated,
        failed: totalFailed,
        tasks: taskResults
      };
    }
    
    // Helper methods
    async loadTaskMetadata() {
      try {
        // Load survey structure to get list of task files
        const structureResponse = await fetch('assets/tasks/survey-structure.json');
        const structure = await structureResponse.json();
        
        // Extract tasks from the structure - convert taskMetadata object to array
        if (structure && structure.taskMetadata) {
          const tasks = Object.values(structure.taskMetadata);
          console.log('[CacheValidator] Loaded task metadata:', tasks.length, 'tasks');
          return tasks;
        } else {
          console.warn('[CacheValidator] Invalid task metadata structure:', structure);
          return [];
        }
      } catch (error) {
        console.warn('[CacheValidator] Failed to load task metadata:', error);
        return [];
      }
    }
    
    mapAnswerValue(answer, question) {
      if (!answer) return null;
      
      // Map JotForm option indices (1, 2, 3) to actual values for option-based questions
      if ((question.type === 'image-choice' || question.type === 'radio' || question.type === 'radio_text' || question.type === 'radio-largechar') && question.options) {
        // CRITICAL: Check if answer is ALREADY a valid option value
        // This handles cases where cache stores actual values instead of indices
        const answerStr = String(answer);
        const isAlreadyValue = question.options.some(opt => String(opt.value) === answerStr);
        if (isAlreadyValue) {
          return answer; // Already mapped, don't map again
        }
        
        // Answer is not a valid option value, try to map as index
        const optionIndex = parseInt(answer);
        if (!isNaN(optionIndex) && optionIndex >= 1 && optionIndex <= question.options.length) {
          const mappedValue = question.options[optionIndex - 1].value;
          console.log(`[CacheValidator] Mapped ${question.id}: ${answer} (index) → ${mappedValue} (value)`);
          return mappedValue;
        }
      }
      
      return answer;
    }
    
    getQIDForField(fieldName) {
      // This would need to reference jotformquestions.json mapping
      // For now, return a placeholder
      return null;
    }
    
    findQIDForCORField(submission, fieldName) {
      // Search through answers to find matching field name
      for (const [qid, answerObj] of Object.entries(submission.answers || {})) {
        if (answerObj.name === fieldName) {
          return qid;
        }
      }
      return null;
    }
    
    mapCriterionToField(criterionName) {
      // Map display name back to TGMD field base
      // e.g., "111: Hop" → "TGMD_111_Hop"
      const match = criterionName.match(/(\d{3}):\s*(\w+)/);
      if (match) {
        return `TGMD_${match[1]}_${match[2]}`;
      }
      return null;
    }
    
    normalizeValue(value, questionId = null) {
      if (value === null || value === undefined) return '';
      const normalized = String(value).trim().toLowerCase();
      
      // Treat "not answered" indicators as empty
      if (normalized === '—' || normalized === 'not answered' || normalized === '') {
        return '';
      }
      
      // Field-specific mappings for coded values
      if (questionId === 'FM_Hand') {
        const handMappings = { '1': 'left', '2': 'right' };
        return handMappings[normalized] || normalized;
      }
      
      if (questionId === 'Gender' || questionId === 'gender') {
        const genderMappings = { '1': 'male', '2': 'female', 'm': 'male', 'f': 'female' };
        return genderMappings[normalized] || normalized;
      }
      
      return normalized;
    }
  }
  
  // ============================================================================
  // Class Page Validator
  // ============================================================================
  
  class ClassValidator {
    constructor(params) {
      this.schoolId = params.schoolId;
      this.classId = params.classId;
      this.grade = params.grade;
      this.viewMode = params.viewMode || 'by-set'; // 'by-set' or 'by-task'
    }
    
    async validate() {
      console.log(`[ClassValidator] Validating ${this.classId} (${this.viewMode} mode)`);
      
      const results = {
        pageType: 'class',
        classId: this.classId,
        grade: this.grade,
        viewMode: this.viewMode,
        timestamp: new Date().toISOString(),
        sections: []
      };
      
      // Get cache data for all students in this class
      const mergedCache = await getMergedCache();
      const classStudents = mergedCache.filter(s => 
        s['class-id'] === this.classId && s.grade === this.grade
      );
      
      if (classStudents.length === 0) {
        results.error = 'No students found in cache for this class';
        return results;
      }
      
      const validationCache = await getValidationCache();
      
      // Section 1: Student Count
      results.sections.push(await this.validateStudentCount(classStudents));
      
      // Section 2: Aggregated Statistics (depends on view mode)
      if (this.viewMode === 'by-set') {
        results.sections.push(await this.validateBySetView(classStudents, validationCache));
      } else {
        results.sections.push(await this.validateByTaskView(classStudents, validationCache));
      }
      
      return results;
    }
    
    async validateStudentCount(classStudents) {
      const section = {
        name: 'Student Count',
        mismatches: [],
        validated: 1,
        failed: 0
      };
      
      const cacheCount = classStudents.length;
      const domElement = document.getElementById('total-students');
      const domCount = parseInt(domElement?.textContent.trim() || '0');
      
      if (cacheCount !== domCount) {
        section.failed++;
        section.mismatches.push({
          field: 'Total Students',
          cache: cacheCount,
          display: domCount
        });
      }
      
      return section;
    }
    
    async validateBySetView(classStudents, validationCache) {
      const section = {
        name: 'By Set/Class View',
        mismatches: [],
        validated: 0,
        failed: 0
      };
      
      // Each row shows: Student Name, Set, Overall %, Status Light
      const tableData = extractTableData('#students-table');
      if (!tableData) {
        section.error = 'Table not found in DOM';
        return section;
      }
      
      for (const domRow of tableData.rows) {
        const coreId = domRow['Core ID']; // Assuming Core ID is in table
        const student = classStudents.find(s => s.coreId === coreId);
        
        if (!student) continue;
        
        const studentValidation = validationCache[coreId];
        if (!studentValidation) continue;
        
        // Validate overall completion percentage
        const cacheOverall = studentValidation.overallCompletion || 0;
        const domOverall = extractCompletionPercentage(domRow['Completion']);
        
        section.validated++;
        if (Math.abs(cacheOverall - domOverall) > 0.1) {
          section.failed++;
          section.mismatches.push({
            field: `${coreId} Overall Completion`,
            cache: `${cacheOverall.toFixed(1)}%`,
            display: `${domOverall.toFixed(1)}%`
          });
        }
      }
      
      return section;
    }
    
    async validateByTaskView(classStudents, validationCache) {
      const section = {
        name: 'By Task View',
        mismatches: [],
        validated: 0,
        failed: 0
      };
      
      // Each row shows: Student Name, Task1 %, Task2 %, ..., Overall %
      const tableData = extractTableData('#students-table');
      if (!tableData) {
        section.error = 'Table not found in DOM';
        return section;
      }
      
      // Extract task columns from headers (skip first few columns)
      const taskHeaders = tableData.headers.filter(h => h.match(/^[A-Z]{2,4}$/)); // ERV, CM, etc.
      
      for (const domRow of tableData.rows) {
        const coreId = domRow['Core ID'];
        const student = classStudents.find(s => s.coreId === coreId);
        
        if (!student) continue;
        
        const studentValidation = validationCache[coreId];
        if (!studentValidation) continue;
        
        // Validate each task completion
        for (const taskId of taskHeaders) {
          const taskValidation = studentValidation.tasks?.[taskId];
          if (!taskValidation) continue;
          
          const cacheCompletion = taskValidation.completionPercentage || 0;
          const domCompletion = extractCompletionPercentage(domRow[taskId]);
          
          section.validated++;
          if (Math.abs(cacheCompletion - domCompletion) > 0.1) {
            section.failed++;
            section.mismatches.push({
              field: `${coreId} ${taskId}`,
              cache: `${cacheCompletion.toFixed(1)}%`,
              display: `${domCompletion.toFixed(1)}%`
            });
          }
        }
      }
      
      return section;
    }
  }
  
  // ============================================================================
  // School Page Validator
  // ============================================================================
  
  class SchoolValidator {
    constructor(params) {
      this.schoolId = params.schoolId;
      this.viewMode = params.viewMode || 'by-set'; // 'by-set' or 'by-task'
    }
    
    async validate() {
      console.log(`[SchoolValidator] Validating ${this.schoolId} (${this.viewMode} mode)`);
      
      const results = {
        pageType: 'school',
        schoolId: this.schoolId,
        viewMode: this.viewMode,
        timestamp: new Date().toISOString(),
        sections: []
      };
      
      // Get cache data for all students in this school
      const mergedCache = await getMergedCache();
      const schoolStudents = mergedCache.filter(s => s['school-id'] === this.schoolId);
      
      if (schoolStudents.length === 0) {
        results.error = 'No students found in cache for this school';
        return results;
      }
      
      // Section 1: School-level aggregates
      results.sections.push(await this.validateSchoolAggregates(schoolStudents));
      
      // Section 2: Class-level aggregates (depends on view mode)
      if (this.viewMode === 'by-set') {
        results.sections.push(await this.validateBySetView(schoolStudents));
      } else {
        results.sections.push(await this.validateByTaskView(schoolStudents));
      }
      
      return results;
    }
    
    async validateSchoolAggregates(schoolStudents) {
      const section = {
        name: 'School Aggregates',
        mismatches: [],
        validated: 0,
        failed: 0
      };
      
      // Total students
      const cacheTotalStudents = schoolStudents.length;
      const domTotalStudents = parseInt(document.getElementById('total-students')?.textContent.trim() || '0');
      
      section.validated++;
      if (cacheTotalStudents !== domTotalStudents) {
        section.failed++;
        section.mismatches.push({
          field: 'Total Students',
          cache: cacheTotalStudents,
          display: domTotalStudents
        });
      }
      
      // Total classes (unique class-id values)
      const uniqueClasses = [...new Set(schoolStudents.map(s => s['class-id']))];
      const cacheTotalClasses = uniqueClasses.length;
      const domTotalClasses = parseInt(document.getElementById('total-classes')?.textContent.trim() || '0');
      
      section.validated++;
      if (cacheTotalClasses !== domTotalClasses) {
        section.failed++;
        section.mismatches.push({
          field: 'Total Classes',
          cache: cacheTotalClasses,
          display: domTotalClasses
        });
      }
      
      return section;
    }
    
    async validateBySetView(schoolStudents) {
      const section = {
        name: 'By Set/Class View',
        mismatches: [],
        validated: 0,
        failed: 0
      };
      
      // Group students by class
      const classCounts = {};
      for (const student of schoolStudents) {
        const classId = student['class-id'];
        if (!classCounts[classId]) {
          classCounts[classId] = 0;
        }
        classCounts[classId]++;
      }
      
      // Compare with DOM table
      const tableData = extractTableData('#classes-table');
      if (!tableData) {
        section.error = 'Table not found in DOM';
        return section;
      }
      
      for (const domRow of tableData.rows) {
        const classId = domRow['Class ID'] || domRow['Class'];
        const domCount = parseInt(domRow['Students'] || '0');
        const cacheCount = classCounts[classId] || 0;
        
        section.validated++;
        if (cacheCount !== domCount) {
          section.failed++;
          section.mismatches.push({
            field: `${classId} Student Count`,
            cache: cacheCount,
            display: domCount
          });
        }
      }
      
      return section;
    }
    
    async validateByTaskView(schoolStudents) {
      const section = {
        name: 'By Task View',
        mismatches: [],
        validated: 0,
        failed: 0
      };
      
      // Similar to by-set but with task-level aggregations
      // Implementation depends on exact DOM structure
      section.error = 'By-task validation not fully implemented yet';
      
      return section;
    }
  }
  
  // ============================================================================
  // District Page Validator
  // ============================================================================
  
  class DistrictValidator {
    constructor(params) {
      this.district = params.district;
    }
    
    async validate() {
      console.log(`[DistrictValidator] Validating ${this.district}`);
      
      const results = {
        pageType: 'district',
        district: this.district,
        timestamp: new Date().toISOString(),
        sections: []
      };
      
      // Get all schools in this district
      const mergedCache = await getMergedCache();
      // Would need schoolid mapping to filter by district
      
      results.sections.push({
        name: 'District Aggregates',
        error: 'District validation not fully implemented yet'
      });
      
      return results;
    }
  }
  
  // ============================================================================
  // Group Page Validator
  // ============================================================================
  
  class GroupValidator {
    constructor(params) {
      this.group = params.group;
    }
    
    async validate() {
      console.log(`[GroupValidator] Validating ${this.group}`);
      
      const results = {
        pageType: 'group',
        group: this.group,
        timestamp: new Date().toISOString(),
        sections: []
      };
      
      results.sections.push({
        name: 'Group Aggregates',
        error: 'Group validation not fully implemented yet'
      });
      
      return results;
    }
  }
  
  // ============================================================================
  // Results Display Modal
  // ============================================================================
  
  function showResults(results) {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };
    
    // Create modal content
    const content = document.createElement('div');
    content.className = 'bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col';
    
    // Header
    const header = document.createElement('div');
    header.className = 'p-6 border-b border-gray-200 flex items-center justify-between';
    header.innerHTML = `
      <div>
        <h2 class="text-2xl font-bold text-gray-900">Cache Validation Results</h2>
        <p class="text-sm text-gray-600 mt-1">
          ${results.pageType} · ${results.timestamp}
          ${results.error ? '<span class="text-red-600 font-semibold ml-2">⚠️ ' + results.error + '</span>' : ''}
        </p>
      </div>
      <button class="text-gray-400 hover:text-gray-600 transition-colors" onclick="this.closest('.fixed').remove()">
        <i data-lucide="x" class="w-6 h-6"></i>
      </button>
    `;
    
    // Body
    const body = document.createElement('div');
    body.className = 'p-6 overflow-y-auto flex-1';
    
    // Summary
    const totalValidated = results.sections.reduce((sum, s) => sum + (s.validated || 0), 0);
    const totalFailed = results.sections.reduce((sum, s) => sum + (s.failed || 0), 0);
    const passRate = totalValidated > 0 ? ((totalValidated - totalFailed) / totalValidated * 100).toFixed(1) : 0;
    
    const summary = document.createElement('div');
    summary.className = `p-4 rounded-lg mb-6 ${totalFailed === 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`;
    summary.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <h3 class="font-semibold ${totalFailed === 0 ? 'text-green-900' : 'text-red-900'}">
            ${totalFailed === 0 ? '✅ All Checks Passed' : '⚠️ Mismatches Found'}
          </h3>
          <p class="text-sm ${totalFailed === 0 ? 'text-green-700' : 'text-red-700'} mt-1">
            ${totalValidated - totalFailed} / ${totalValidated} validated correctly (${passRate}%)
          </p>
        </div>
        <button class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm font-medium" onclick="CacheValidator.exportResults(${JSON.stringify(results).replace(/"/g, '&quot;')})">
          Export Results
        </button>
      </div>
    `;
    body.appendChild(summary);
    
    // Sections
    for (const section of results.sections) {
      const sectionDiv = document.createElement('details');
      sectionDiv.className = 'mb-4 border border-gray-200 rounded-lg';
      sectionDiv.open = false; // All sections collapsed by default
      
      const sectionHeader = document.createElement('summary');
      sectionHeader.className = 'p-4 cursor-pointer hover:bg-gray-50 transition-colors flex items-center justify-between';
      sectionHeader.innerHTML = `
        <div class="flex items-center gap-3">
          <span class="text-lg font-semibold text-gray-900">${section.name}</span>
          ${section.error ? '<span class="text-xs text-gray-500">' + section.error + '</span>' : ''}
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm ${section.failed === 0 ? 'text-green-600' : 'text-red-600'} font-medium">
            ${section.validated - section.failed} / ${section.validated} passed
          </span>
          <i data-lucide="chevron-down" class="w-4 h-4 text-gray-400"></i>
        </div>
      `;
      
      sectionDiv.appendChild(sectionHeader);
      
      // Handle hierarchical set/task structure for Task Questions
      if (section.sets && section.sets.length > 0) {
        const setsContainer = document.createElement('div');
        setsContainer.className = 'p-4 pt-0 space-y-4';
        
        for (const set of section.sets) {
          const setDiv = document.createElement('div');
          setDiv.className = 'border border-gray-300 rounded-lg overflow-hidden';
          
          // Set header
          const setHeader = document.createElement('div');
          setHeader.className = 'bg-blue-50 px-4 py-2 border-b border-gray-300';
          setHeader.innerHTML = `<h4 class="font-semibold text-blue-900">Set: ${set.setName}</h4>`;
          setDiv.appendChild(setHeader);
          
          // Tasks within set
          const tasksDiv = document.createElement('div');
          tasksDiv.className = 'divide-y divide-gray-200';
          
          for (const task of set.tasks) {
            const taskDiv = document.createElement('details');
            taskDiv.className = 'bg-white';
            taskDiv.open = false; // All tasks collapsed by default
            
            const taskSummary = document.createElement('summary');
            taskSummary.className = 'px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors flex items-center justify-between';
            taskSummary.innerHTML = `
              <span class="font-medium text-gray-900">${task.taskId}</span>
              <span class="text-sm ${task.failed === 0 ? 'text-green-600' : 'text-red-600'} font-medium">
                ${task.validated - task.failed} / ${task.validated} passed
              </span>
            `;
            taskDiv.appendChild(taskSummary);
            
            // Question table
            const questionTable = document.createElement('div');
            questionTable.className = 'px-4 pb-4';
            
            const rowsHtml = task.questions.map(q => {
              // Generate provenance button if available
              let provenanceButton = '';
              if (q.provenance && q.provenance.sources && q.provenance.sources.length > 0) {
                // Properly escape HTML attributes to prevent XSS
                const provenanceJson = escapeHtmlAttribute(JSON.stringify(q.provenance));
                const fieldEscaped = escapeHtml(q.field);
                provenanceButton = `<button class="provenance-trigger" data-provenance="${provenanceJson}" title="Show data source provenance" aria-label="Show data source provenance for ${fieldEscaped}">
                  <i data-lucide="info" class="w-3 h-3"></i>
                </button>`;
              }
              
              return `
                <tr class="hover:bg-gray-50 ${q.status.includes('Mismatch') ? 'bg-red-50' : ''}">
                  <td class="px-3 py-2 font-medium text-gray-900">
                    <div class="flex items-center">
                      <span>${q.field}</span>
                      ${provenanceButton}
                    </div>
                  </td>
                  <td class="px-3 py-2 text-blue-600 font-mono text-sm">${escapeHtml(String(q.cacheRaw || q.cachedValue || 'Not found'))}</td>
                  <td class="px-3 py-2 text-purple-600 font-mono text-sm">${escapeHtml(String(q.displayValue || q.taskValidatorValue || 'Not found'))}</td>
                  <td class="px-3 py-2 text-sm">${q.status}</td>
                </tr>
              `;
            }).join('');
            
            questionTable.innerHTML = `
              <table class="w-full text-sm mt-2">
                <thead class="bg-gray-100 text-gray-700 uppercase text-xs">
                  <tr>
                    <th class="px-3 py-2 text-left">Question ID</th>
                    <th class="px-3 py-2 text-left">Cache Value</th>
                    <th class="px-3 py-2 text-left">Display Value</th>
                    <th class="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                  ${rowsHtml}
                </tbody>
              </table>
            `;
            taskDiv.appendChild(questionTable);
            tasksDiv.appendChild(taskDiv);
          }
          
          setDiv.appendChild(tasksDiv);
          setsContainer.appendChild(setDiv);
        }
        
        sectionDiv.appendChild(setsContainer);
      }
      // Handle flat mismatches structure for other sections (Profile, Correctness)
      else if (section.mismatches && section.mismatches.length > 0) {
        const mismatchTable = document.createElement('div');
        mismatchTable.className = 'p-4 pt-0';
        
        // Determine columns based on data structure
        const hasStatus = section.mismatches[0]?.status !== undefined;
        const hasCacheRaw = section.mismatches[0]?.cacheRaw !== undefined;
        
        let headerHtml = '';
        if (hasCacheRaw) {
          // Profile fields format
          headerHtml = `
            <thead class="bg-gray-50 text-gray-700 uppercase text-xs">
              <tr>
                <th class="px-3 py-2 text-left">Field</th>
                <th class="px-3 py-2 text-left">Cache Value</th>
                <th class="px-3 py-2 text-left">Display Value</th>
                <th class="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
          `;
        } else {
          // Standard format
          headerHtml = `
            <thead class="bg-gray-50 text-gray-700 uppercase text-xs">
              <tr>
                <th class="px-3 py-2 text-left">Field</th>
                <th class="px-3 py-2 text-left">Cache Value</th>
                <th class="px-3 py-2 text-left">Display Value</th>
              </tr>
            </thead>
          `;
        }
        
        const rowsHtml = section.mismatches.map(m => {
          if (hasCacheRaw) {
            return `
              <tr class="hover:bg-gray-50">
                <td class="px-3 py-2 font-medium text-gray-900">${m.field}</td>
                <td class="px-3 py-2 text-blue-600 font-mono">${escapeHtml(String(m.cacheRaw))}</td>
                <td class="px-3 py-2 text-purple-600 font-mono">${escapeHtml(String(m.displayValue))}</td>
                <td class="px-3 py-2">${m.status}</td>
              </tr>
            `;
          } else {
            return `
              <tr class="hover:bg-gray-50">
                <td class="px-3 py-2 font-medium text-gray-900">${m.field}</td>
                <td class="px-3 py-2 text-blue-600 font-mono">${escapeHtml(String(m.cache))}</td>
                <td class="px-3 py-2 text-orange-600 font-mono">${escapeHtml(String(m.display))}</td>
              </tr>
            `;
          }
        }).join('');
        
        mismatchTable.innerHTML = `
          <table class="w-full text-sm">
            ${headerHtml}
            <tbody class="divide-y divide-gray-200">
              ${rowsHtml}
            </tbody>
          </table>
        `;
        sectionDiv.appendChild(mismatchTable);
      }
      
      body.appendChild(sectionDiv);
    }
    
    content.appendChild(header);
    content.appendChild(body);
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    // Re-initialize Lucide icons
    if (window.lucide) {
      lucide.createIcons();
    }
    
    // Set up provenance tooltips
    setupProvenanceTooltips(modal);
  }
  
  /**
   * Set up provenance tooltip handlers
   * @param {HTMLElement} container - The container element (modal) with provenance triggers
   */
  function setupProvenanceTooltips(container) {
    // Create tooltip element if it doesn't exist
    let tooltip = document.getElementById('provenance-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'provenance-tooltip';
      tooltip.className = 'provenance-tooltip';
      tooltip.setAttribute('role', 'status');
      tooltip.setAttribute('aria-live', 'polite');
      document.body.appendChild(tooltip);
    }
    
    let activeButton = null;
    
    // Function to format timestamp
    const formatTimestamp = (timestamp) => {
      if (!timestamp) return 'Unknown';
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    };
    
    // Function to show tooltip
    const showTooltip = (button) => {
      try {
        const provenanceJson = button.getAttribute('data-provenance');
        if (!provenanceJson) return;
        
        const provenance = JSON.parse(provenanceJson);
        
        // Build tooltip content
        let content = `<div class="font-semibold mb-2 text-blue-300">Data Provenance: ${provenance.field}</div>`;
        content += `<div class="text-xs text-gray-300 mb-2">Grade: ${provenance.grade}</div>`;
        
        if (provenance.sources && provenance.sources.length > 0) {
          content += `<div class="mb-2"><strong class="text-blue-200">Sources:</strong></div>`;
          
          // Sort sources by timestamp (earliest first)
          const sortedSources = [...provenance.sources].sort((a, b) => {
            const dateA = a.timestamp ? new Date(a.timestamp) : new Date(0);
            const dateB = b.timestamp ? new Date(b.timestamp) : new Date(0);
            return dateA - dateB;
          });
          
          sortedSources.forEach((source, index) => {
            const isWinner = provenance.winner && 
              ((source.type === 'JotForm' && provenance.winner === 'jotform') ||
               (source.type === 'Qualtrics' && provenance.winner === 'qualtrics'));
            
            const winnerBadge = isWinner ? ' <span class="px-1 py-0.5 bg-green-500 text-white rounded text-xs">✓ WINNER</span>' : '';
            
            content += `<div class="mb-2 p-2 rounded ${isWinner ? 'bg-green-900/30' : 'bg-gray-700/30'}">`;
            content += `<div class="font-medium text-yellow-300">${index + 1}. ${source.type}${winnerBadge}</div>`;
            
            if (source.type === 'JotForm') {
              content += `<div class="text-xs text-gray-300 mt-1">Submission ID: ${source.submissionId || 'N/A'}</div>`;
              if (source.sessionKey) {
                content += `<div class="text-xs text-gray-300">Session Key: ${source.sessionKey}</div>`;
              }
            } else if (source.type === 'Qualtrics') {
              content += `<div class="text-xs text-gray-300 mt-1">Response ID: ${source.responseId || 'N/A'}</div>`;
            }
            
            content += `<div class="text-xs text-gray-300">Timestamp: ${formatTimestamp(source.timestamp)}</div>`;
            content += `<div class="text-xs ${source.found ? 'text-green-400' : 'text-gray-400'}">Data: ${source.found ? 'Found ✓' : 'Not found'}</div>`;
            content += `</div>`;
          });
        }
        
        // Winner explanation
        if (provenance.winner && provenance.winnerReason) {
          content += `<div class="mt-2 p-2 bg-blue-900/30 rounded">`;
          content += `<div class="font-semibold text-blue-200">Resolution:</div>`;
          content += `<div class="text-xs text-gray-300">${provenance.winnerReason}</div>`;
          if (provenance.winnerTimestamp) {
            content += `<div class="text-xs text-gray-400 mt-1">Selected: ${formatTimestamp(provenance.winnerTimestamp)}</div>`;
          }
          content += `</div>`;
        }
        
        // Handle single-source cases
        if (!provenance.sources || provenance.sources.length === 1) {
          const source = provenance.sources ? provenance.sources[0] : null;
          if (source) {
            content += `<div class="mt-2 text-xs text-gray-400 italic">${source.type} only (no merge needed)</div>`;
          }
        }
        
        tooltip.innerHTML = content;
        
        // Position tooltip
        const rect = button.getBoundingClientRect();
        let top = rect.top - 12;
        let translateY = '-100%';
        
        // If too close to top, show below
        if (top < 12) {
          top = rect.bottom + 12;
          translateY = '0';
        }
        
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.top = `${top}px`;
        tooltip.style.transform = `translate(-50%, ${translateY})`;
        tooltip.classList.add('visible');
        
        if (activeButton && activeButton !== button) {
          activeButton.classList.remove('is-active');
        }
        button.classList.add('is-active');
        activeButton = button;
        
      } catch (error) {
        console.error('[CacheValidator] Error showing provenance tooltip:', error);
      }
    };
    
    // Function to hide tooltip
    const hideTooltip = (button) => {
      if (button && button !== activeButton) return;
      
      tooltip.classList.remove('visible');
      if (activeButton) {
        activeButton.classList.remove('is-active');
        activeButton = null;
      }
    };
    
    // Attach event listeners to all provenance buttons
    const buttons = container.querySelectorAll('.provenance-trigger');
    buttons.forEach(button => {
      button.addEventListener('mouseenter', () => showTooltip(button));
      button.addEventListener('focus', () => showTooltip(button));
      button.addEventListener('mouseleave', () => hideTooltip(button));
      button.addEventListener('blur', () => hideTooltip(button));
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeButton === button) {
          hideTooltip(button);
        } else {
          showTooltip(button);
        }
      });
    });
    
    // Hide on scroll or window events (with throttling for performance)
    let scrollTimeout;
    window.addEventListener('scroll', () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      scrollTimeout = setTimeout(() => hideTooltip(), 100);
    }, true);
    
    let resizeTimeout;
    window.addEventListener('resize', () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = setTimeout(() => hideTooltip(), 100);
    });
    
    // Hide when clicking outside
    document.addEventListener('click', (e) => {
      if (!activeButton) return;
      if (e.target.closest('.provenance-trigger') === activeButton) return;
      hideTooltip();
    });
    
    // Hide on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideTooltip();
      }
    });
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  /**
   * Escape HTML attribute value to prevent XSS
   * Properly handles quotes, ampersands, and other special characters
   * @param {string} text - Text to escape
   * @returns {string} Escaped text safe for use in HTML attributes
   */
  function escapeHtmlAttribute(text) {
    if (text === null || text === undefined) {
      return '';
    }
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  
  function exportResults(results) {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `validation_${results.pageType}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  
  // ============================================================================
  // Factory Function
  // ============================================================================
  
  function create(pageType, params) {
    console.log('[CacheValidator] create() called with pageType:', pageType, 'params:', params);
    switch (pageType) {
      case 'student':
        const validator = new StudentValidator(params.coreId, params.grade, params.options || {});
        console.log('[CacheValidator] Created StudentValidator:', validator);
        return validator;
      case 'class':
        return new ClassValidator(params);
      case 'school':
        return new SchoolValidator(params);
      case 'district':
        return new DistrictValidator(params);
      case 'group':
        return new GroupValidator(params);
      default:
        throw new Error(`Unknown page type: ${pageType}`);
    }
  }
  
  // ============================================================================
  // Public API
  // ============================================================================
  
  console.log('[CacheValidator] ===== MODULE LOADED SUCCESSFULLY =====');
  
  return {
    create,
    showResults,
    exportResults
  };
})();
