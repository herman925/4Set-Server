/**
 * Task Validator for 4Set Checking System
 * 
 * ============================================================================
 * SINGLE SOURCE OF TRUTH for all task validation logic across the entire system
 * ============================================================================
 * 
 * PURPOSE:
 * Acts as an auditor determining:
 * - Task completion status (all questions answered up to termination/timeout)
 * - Termination detection (stage-based, consecutive incorrect, threshold-based)
 * - Timeout detection (SYM/NONSYM 2-minute timer with proper vs missing data)
 * - Question-level correctness (with answer mapping for radio/image-choice)
 * - Task-level statistics (answered/correct/total counts with termination exclusion)
 * 
 * CRITICAL CALCULATION RULE (Per PRD):
 * When termination or timeout occurs, questions AFTER that point are COMPLETELY 
 * EXCLUDED from total count. This ensures:
 * - CWR terminated at Q24: total=24, answered=24 → 100% complete ✅
 * - SYM timed out at Q53: total=53, answered=53 → 100% complete ✅
 * - CM terminated at Q7: total=9 (P1,P2,Q1-Q7), answered=9 → 100% complete ✅
 * 
 * TERMINATION TYPES (Centralized in TERMINATION_RULES):
 * 1. Stage-based: ERV (3 stages), CM (4 stages + 1 non-terminating)
 * 2. Consecutive incorrect: CWR (10 consecutive threshold)
 * 3. Threshold-based: Fine Motor (square-cutting items)
 * 4. Timeout-based: SYM/NONSYM (2-minute timer for SYM and 2-minute timer for NONSYM, special handling)
 * 
 * ARCHITECTURE:
 * - ID-based termination (robust against practice items like P1, P2, P3)
 * - Generic handler functions (no task-specific duplication)
 * - Uniform recalculation logic for all termination types
 * 
 * SCOPE: Operates at ALL hierarchical levels:
 * - Student: validateAllTasks(mergedAnswers) for individual student
 * - Class: Call validateAllTasks() for each student, aggregate results
 * - School: Aggregate across classes (accounting for gender-conditional tasks)
 * - Group/District: Further aggregation
 * 
 * NO OTHER FILE should implement validation logic - all pages must use TaskValidator.
 */
window.TaskValidator = (() => {
  // Task metadata loaded from survey-structure.json
  let taskMetadata = null;
  let taskFiles = {}; // Will be built from taskMetadata

  // Cache loaded task definitions
  const taskCache = {};

  /**
   * Load task metadata from survey-structure.json
   */
  async function loadTaskMetadata() {
    if (taskMetadata) return taskMetadata;
    
    try {
      const response = await fetch('assets/tasks/survey-structure.json');
      const surveyStructure = await response.json();
      taskMetadata = surveyStructure.taskMetadata || {};
      
      // Build taskFiles map from metadata
      // Key: canonical ID, Value: file path
      for (const [filename, metadata] of Object.entries(taskMetadata)) {
        const canonicalId = metadata.id;
        taskFiles[canonicalId] = `assets/tasks/${filename}.json`;
        
        // Also map aliases to the same file
        if (metadata.aliases) {
          for (const alias of metadata.aliases) {
            taskFiles[alias] = `assets/tasks/${filename}.json`;
          }
        }
      }
      
      console.log('[TaskValidator] Task metadata loaded:', Object.keys(taskMetadata).length, 'tasks');
      return taskMetadata;
    } catch (error) {
      console.error('[TaskValidator] Failed to load task metadata:', error);
      taskMetadata = {};
      taskFiles = {};
      return {};
    }
  }

  /**
   * Load a task definition from JSON file
   */
  async function loadTaskDefinition(taskId) {
    // Ensure metadata is loaded first
    await loadTaskMetadata();
    
    const normalizedTaskId = taskId.toLowerCase();
    
    if (taskCache[normalizedTaskId]) {
      return taskCache[normalizedTaskId];
    }

    const filePath = taskFiles[normalizedTaskId];
    if (!filePath) {
      console.warn(`[TaskValidator] No task file found for: ${taskId}`);
      return null;
    }

    try {
      const response = await fetch(filePath);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const taskDef = await response.json();
      taskCache[normalizedTaskId] = taskDef;
      
      console.log(`[TaskValidator] Loaded task definition: ${taskId}`, {
        id: taskDef.id,
        title: taskDef.title,
        questionCount: extractQuestions(taskDef).length
      });
      
      return taskDef;
    } catch (error) {
      console.error(`[TaskValidator] Failed to load task ${taskId}:`, error);
      return null;
    }
  }

  /**
   * Extract all questions from task definition (handles nested multi-question and multi-step blocks)
   */
  function extractQuestions(taskDef) {
    const questions = [];
    
    if (!taskDef || !taskDef.questions) return questions;
    
    for (const item of taskDef.questions) {
      if ((item.type === 'multi-question' || item.type === 'multi-step') && item.questions) {
        // Nested questions (recursively extract in case of deeper nesting)
        questions.push(...extractQuestionsFromArray(item.questions));
      } else if (item.type === 'matrix-radio' && item.rows && item.columns) {
        // Matrix questions: expand into individual row×column questions
        for (const row of item.rows) {
          for (const col of item.columns) {
            questions.push({
              id: `${row.id}_${col.id}`, // e.g., "TGMD_111_Hop_t1"
              type: 'matrix-cell',
              matrixType: item.type,
              label: { zh: `${item.label?.zh || item.id} - ${col.label}` }
            });
          }
        }
      } else if (item.type !== 'instruction' && item.type !== 'completion' && item.id && !isExcludedField(item.id)) {
        // Include all questions (with or without scoring)
        // Y/N tasks don't have scoring.correctAnswer, but Y=correct, N=incorrect
        // INCLUDE _TEXT fields for display purposes (but mark them as display-only)
        const questionItem = {...item};
        if (item.id.endsWith('_TEXT')) {
          questionItem.isTextDisplay = true; // Mark as text display field
        }
        questions.push(questionItem);
      }
    }
    
    return questions;
  }
  
  /**
   * Recursively extract questions from an array (helper for nested structures)
   */
  function extractQuestionsFromArray(items) {
    const questions = [];
    for (const item of items) {
      if ((item.type === 'multi-question' || item.type === 'multi-step') && item.questions) {
        questions.push(...extractQuestionsFromArray(item.questions));
      } else if (item.type !== 'instruction' && item.type !== 'completion' && item.id && !isExcludedField(item.id)) {
        // INCLUDE _TEXT fields for display purposes (but mark them as display-only)
        const questionItem = {...item};
        if (item.id.endsWith('_TEXT')) {
          questionItem.isTextDisplay = true; // Mark as text display field
        }
        questions.push(questionItem);
      }
    }
    return questions;
  }
  
  /**
   * Check if a field ID should be excluded from question counting
   */
  function isExcludedField(id) {
    // Exclude date fields, memo fields, termination records, practice questions, and other non-question fields
    // NOTE: _TEXT fields are now INCLUDED for display purposes (handled separately in validation)
    return id.endsWith('_Date') || 
           id.includes('_Memo_') ||
           id.includes('_Ter') || // Exclude all termination records (ERV_Ter1, CM_Ter2, etc.)
           id.endsWith('_timeout') || // Exclude timeout fields (SYM_timeout, NONSYM_timeout)
           /_P\d+/.test(id); // Exclude practice questions (e.g., ERV_P1, ToM_P2, CM_P1, etc.)
  }

  /**
   * Map answer value for option-based questions (image-choice, radio, radio_text)
   * @param {string} answer - The raw answer (might be an index like "1", "2")
   * @param {Object} question - The question definition with options
   * @returns {string} - The mapped value or original answer
   */
  function mapAnswerValue(answer, question) {
    if (!answer) return null;
    
    // Map JotForm option indices (1, 2, 3) to actual values for option-based questions
    if ((question.type === 'image-choice' || question.type === 'radio' || question.type === 'radio_text') && question.options) {
      const optionIndex = parseInt(answer);
      if (!isNaN(optionIndex) && optionIndex >= 1 && optionIndex <= question.options.length) {
        return question.options[optionIndex - 1].value;
      }
    }
    
    return answer;
  }

  /**
   * Evaluate if a showIf condition is met based on student answers
   * @param {Object} showIf - The showIf condition object (e.g., { "ToM_Q1a": "紅蘿蔔" })
   * @param {Object} answers - The merged student answers
   * @param {Map} questionMap - Map of question IDs to question definitions
   * @returns {boolean} - True if condition is met or no condition exists
   */
  function evaluateShowIfCondition(showIf, answers, questionMap) {
    if (!showIf) return true; // No condition = always show
    
    // Handle gender conditions (static, evaluated at task selection level)
    if (showIf.gender) {
      return true; // Assume already filtered at task level
    }
    
    // Handle answer-based conditions (e.g., { "ToM_Q1a": "紅蘿蔔" })
    for (const [questionId, expectedValue] of Object.entries(showIf)) {
      if (questionId === 'gender') continue;
      
      let studentAnswer = answers[questionId]?.answer || 
                          answers[questionId]?.text || 
                          null;
      
      if (studentAnswer === null) {
        return false; // No answer to the condition question = condition not met
      }
      
      // Map option index to value if the referenced question has options
      const referencedQuestion = questionMap.get(questionId);
      if (referencedQuestion) {
        studentAnswer = mapAnswerValue(studentAnswer, referencedQuestion);
      }
      
      if (String(studentAnswer).trim() !== String(expectedValue).trim()) {
        return false; // Condition not met
      }
    }
    
    return true; // All conditions met
  }

  /**
   * Filter questions based on showIf conditions and handle duplicates
   * @param {Array} questions - All extracted questions
   * @param {Object} answers - The merged student answers
   * @returns {Array} - Filtered questions with only applicable branches
   */
  function filterQuestionsByConditions(questions, answers) {
    // Build a map of question IDs to question definitions for option mapping
    const questionMap = new Map();
    for (const question of questions) {
      questionMap.set(question.id, question);
    }
    
    const applicable = [];
    const seenIds = new Map(); // Track question IDs we've already added
    
    for (const question of questions) {
      const questionId = question.id;
      
      // Evaluate showIf condition
      if (question.showIf) {
        const conditionMet = evaluateShowIfCondition(question.showIf, answers, questionMap);
        if (!conditionMet) {
          continue; // Skip this question - condition not met
        }
      }
      
      // Handle duplicate IDs: prefer questions with matching showIf conditions
      if (seenIds.has(questionId)) {
        const existingQuestion = seenIds.get(questionId);
        
        // If existing has no showIf and current has a matching showIf, replace it
        if (!existingQuestion.showIf && question.showIf) {
          const existingIndex = applicable.findIndex(q => q.id === questionId);
          if (existingIndex >= 0) {
            applicable.splice(existingIndex, 1);
            applicable.push(question);
            seenIds.set(questionId, question);
          }
        }
        // Otherwise keep the first one that passed the condition check
        continue;
      }
      
      applicable.push(question);
      seenIds.set(questionId, question);
    }
    
    return applicable;
  }

  /**
   * Validate student answers for a task
   */
  async function validateTask(taskId, mergedAnswers) {
    const taskDef = await loadTaskDefinition(taskId);
    if (!taskDef) {
      return {
        taskId,
        error: 'Task definition not found',
        questions: []
      };
    }

    const allQuestions = extractQuestions(taskDef);
    
    // Filter questions based on showIf conditions (handles conditional branching)
    const questions = filterQuestionsByConditions(allQuestions, mergedAnswers);
    
    const validatedQuestions = [];

    for (const question of questions) {
      const questionId = question.id;
      const correctAnswer = question.scoring?.correctAnswer;
      
      // Get student answer from merged Jotform data
      let studentAnswer = mergedAnswers[questionId]?.answer || 
                          mergedAnswers[questionId]?.text || 
                          null;
      
      // Map JotForm option indices to actual values using helper function
      studentAnswer = mapAnswerValue(studentAnswer, question);
      
      // Determine if answer is correct
      let isCorrect = false;
      if (correctAnswer !== undefined) {
        // Standard question with scoring.correctAnswer
        
        // SPECIAL HANDLING for radio_text questions with textId
        // Rule: If correct answer is picked → CORRECT (even if associated text field has data)
        // If other option OR text field is filled → WRONG
        // Priority: correct answer check comes first, text is treated as mistyped input and ignored
        if (question.type === 'radio_text' && question.options) {
          // Check if correct answer was selected
          if (studentAnswer !== null && String(studentAnswer).trim() === String(correctAnswer).trim()) {
            isCorrect = true;
            // Note: Even if associated _TEXT field has data, we ignore it as mistyped input
          } else {
            // Check if any other option was selected OR if text field has data
            const hasOtherOption = studentAnswer !== null && String(studentAnswer).trim() !== String(correctAnswer).trim();
            
            // Check if associated text field (textId) has data
            let hasTextData = false;
            if (question.options) {
              for (const option of question.options) {
                if (option.textId) {
                  const textAnswer = mergedAnswers[option.textId]?.answer || 
                                    mergedAnswers[option.textId]?.text || 
                                    null;
                  if (textAnswer && textAnswer.trim() !== '') {
                    hasTextData = true;
                    break;
                  }
                }
              }
            }
            
            // If either other option selected OR text filled → incorrect
            isCorrect = false;
          }
        } else {
          // Standard correctAnswer comparison for non-radio_text questions
          isCorrect = studentAnswer !== null && String(studentAnswer).trim() === String(correctAnswer).trim();
        }
      } else if (question.type === 'matrix-cell') {
        // Matrix cell: 1 = performed correctly, 0 = not performed
        isCorrect = studentAnswer === '1' || studentAnswer === 1;
      } else {
        // Y/N question: Y = correct, N = incorrect
        isCorrect = studentAnswer === 'Y' || studentAnswer === 'y';
      }
      
      // Check if this is an unscored preference question (no correctAnswer at all)
      const isUnscoredQuestion = correctAnswer === undefined && question.type !== 'matrix-cell' && !['Y', 'y', 'N', 'n'].includes(studentAnswer);
      
      // SPECIAL HANDLING for _TEXT display fields
      let isTextDisplay = question.isTextDisplay || false;
      let textFieldStatus = null; // 'answered', 'na', 'not-answered', or null (hide)
      
      if (isTextDisplay && questionId.endsWith('_TEXT')) {
        // Find the associated radio_text question (e.g., ToM_Q3a for ToM_Q3a_TEXT)
        const radioQuestionId = questionId.replace('_TEXT', '');
        const radioQuestion = questions.find(q => q.id === radioQuestionId);
        
        if (radioQuestion && radioQuestion.type === 'radio_text') {
          // Check if the correct answer was selected on the radio question
          const radioAnswer = mergedAnswers[radioQuestionId]?.answer || 
                              mergedAnswers[radioQuestionId]?.text || 
                              null;
          const mappedRadioAnswer = mapAnswerValue(radioAnswer, radioQuestion);
          const radioCorrectAnswer = radioQuestion.scoring?.correctAnswer;
          
          const isRadioCorrect = radioCorrectAnswer && mappedRadioAnswer !== null && 
                                 String(mappedRadioAnswer).trim() === String(radioCorrectAnswer).trim();
          
          if (isRadioCorrect) {
            // Correct answer was selected - this text field is N/A
            textFieldStatus = 'na';
          } else if (mappedRadioAnswer !== null) {
            // Radio answer exists (but is incorrect)
            if (studentAnswer !== null && studentAnswer.trim() !== '') {
              // Text field has content
              textFieldStatus = 'answered';
            } else {
              // Radio answered but text empty - show "—" (dash), not "not-answered"
              // Per user: "not answered" for TEXT ONLY when radio is ALSO not answered
              textFieldStatus = null;
            }
          } else {
            // Radio has NO answer (blank/missing)
            if (studentAnswer !== null && studentAnswer.trim() !== '') {
              // Student attempted to answer via text only
              textFieldStatus = 'answered';
            } else {
              // Both radio and text are empty - show "not-answered"
              // Per user: "not answered for TEXT only happens if radio is also not answered"
              textFieldStatus = 'not-answered';
            }
          }
        } else if (studentAnswer !== null && studentAnswer.trim() !== '') {
          // No associated radio question, just check if answered
          textFieldStatus = 'answered';
        }
      }
      
      validatedQuestions.push({
        id: questionId,
        studentAnswer: studentAnswer,
        correctAnswer: correctAnswer, // Will be undefined for Y/N tasks, matrix cells, and unscored questions
        isCorrect: isCorrect,
        label: question.label?.answer || question.label?.zh || questionId,
        isYNQuestion: correctAnswer === undefined, // Flag for UI (includes Y/N, matrix cells, and unscored questions)
        isUnscored: isUnscoredQuestion, // Flag for preference questions with no scoring
        isTextDisplay: isTextDisplay, // Flag for _TEXT display fields
        textFieldStatus: textFieldStatus // Status for _TEXT fields: 'answered', 'na', or null
      });
    }

    // Calculate counts excluding _TEXT display fields (they don't count towards completion)
    const scoredQuestions = validatedQuestions.filter(q => !q.isTextDisplay);
    const answeredCount = scoredQuestions.filter(q => q.studentAnswer !== null).length;
    const correctCount = scoredQuestions.filter(q => q.isCorrect).length;
    const totalQuestions = scoredQuestions.length;

    return {
      taskId,
      title: taskDef.title,
      questions: validatedQuestions, // Include ALL questions (including _TEXT for display)
      totalQuestions, // Only scored questions
      answeredQuestions: answeredCount, // Only scored questions
      correctAnswers: correctCount,
      completionPercentage: totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0,
      accuracyPercentage: answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0
    };
  }

  /**
   * ============================================================================
   * CENTRALIZED TERMINATION RULES CONFIGURATION
   * ============================================================================
   * 
   * Single source of truth for all task termination logic.
   * Uses QUESTION IDs (not array indices) for robustness against task changes.
   * 
   * To add a new task with termination:
   * 1. Add entry to this config object
   * 2. Specify type: 'stage_based', 'consecutive_incorrect', or 'threshold_based'
   * 3. Define parameters (stages with question ID ranges, or thresholds)
   * 4. Generic handlers will automatically apply the rules
   * 
   * Note: Practice items (P1, P2, P3) are automatically handled by ID-based lookup.
   */
  const TERMINATION_RULES = {
    'erv': {
      type: 'stage_based',
      stages: [
        { startId: 'ERV_Q1', endId: 'ERV_Q12', threshold: 5, stageNum: 1 },
        { startId: 'ERV_Q13', endId: 'ERV_Q24', threshold: 5, stageNum: 2 },
        { startId: 'ERV_Q25', endId: 'ERV_Q36', threshold: 5, stageNum: 3 }
      ]
    },
    'cm': {
      type: 'stage_based',
      stages: [
        { startId: 'CM_Q1', endId: 'CM_Q7', threshold: 4, stageNum: 1 },
        { startId: 'CM_Q8', endId: 'CM_Q12', threshold: 4, stageNum: 2 },
        { startId: 'CM_Q13', endId: 'CM_Q17', threshold: 4, stageNum: 3 },
        { startId: 'CM_Q18', endId: 'CM_Q22', threshold: 4, stageNum: 4 }
        // Stage 5 (CM_Q23-CM_Q27) has no termination
      ]
    },
    'chinesewordreading': {
      type: 'consecutive_incorrect',
      consecutiveThreshold: 10
    },
    'finemotor': {
      type: 'threshold_based',
      questionIds: ['FM_squ_1', 'FM_squ_2', 'FM_squ_3'],
      threshold: 1, // At least 1 must be correct (score > 0)
      description: 'All square-cutting items must score 0 to terminate'
    }
  };

  /**
   * Apply stage-based termination (ERV, CM)
   * 
   * Stage-based tasks require a minimum number of correct answers in each stage
   * to proceed to the next stage. If the threshold is not met, the task terminates.
   * 
   * Logic:
   * 1. Find stage start/end questions by ID (robust against practice items)
   * 2. Count correct answers in stage
   * 3. Check if threshold can still be reached (accounting for unanswered)
   * 4. Terminate if: (correct < threshold) AND (all stage questions answered OR impossible to reach)
   * 
   * @param {Object} taskResult - Validation result from validateTask()
   * @param {Object} config - Stage configuration from TERMINATION_RULES
   * @returns {Object} { terminationIndex, terminationStage }
   */
  function applyStageBasedTermination(taskResult, config) {
    let terminationIndex = -1;
    let terminationStage = -1;
    
    for (const stage of config.stages) {
      // Find actual indices in questions array by ID
      const startIdx = taskResult.questions.findIndex(q => q.id === stage.startId);
      const endIdx = taskResult.questions.findIndex(q => q.id === stage.endId);
      
      if (startIdx === -1 || endIdx === -1) {
        console.warn(`[TaskValidator] Stage ${stage.stageNum} questions not found (${stage.startId} - ${stage.endId})`);
        continue;
      }
      
      const stageQuestions = taskResult.questions.slice(startIdx, endIdx + 1);
      
      // Count correct answers in this stage
      const correctCount = stageQuestions.filter(q => q.isCorrect).length;
      const answeredCount = stageQuestions.filter(q => q.studentAnswer !== null).length;
      const unansweredCount = stageQuestions.length - answeredCount;
      const maxPossible = correctCount + unansweredCount;
      
      // Check if termination is certain (can't reach threshold even if all remaining are correct)
      if (maxPossible < stage.threshold) {
        terminationIndex = endIdx;
        terminationStage = stage.stageNum;
        console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()} terminated at Stage ${terminationStage} (${stage.endId}): ${correctCount} correct, need ≥${stage.threshold}`);
        break;
      }
      
      // If stage not fully answered, check if already failed
      if (answeredCount < stageQuestions.length) {
        if (correctCount < stage.threshold && unansweredCount === 0) {
          terminationIndex = endIdx;
          terminationStage = stage.stageNum;
          console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()} terminated at Stage ${terminationStage} (${stage.endId}): ${correctCount} correct, need ≥${stage.threshold}`);
          break;
        }
        // Otherwise, can't determine termination yet
        break;
      }
      
      // Stage fully answered - check if passed
      if (correctCount < stage.threshold) {
        terminationIndex = endIdx;
        terminationStage = stage.stageNum;
        console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()} terminated at Stage ${terminationStage} (${stage.endId}): ${correctCount} correct, need ≥${stage.threshold}`);
        break;
      }
    }
    
    return { terminationIndex, terminationStage };
  }

  /**
   * Apply consecutive incorrect termination (CWR - Chinese Word Reading)
   * 
   * Terminates after N consecutive incorrect responses (default: 10).
   * Streak resets when student answers correctly or skips a question.
   * 
   * Logic:
   * 1. Iterate through questions in order
   * 2. Increment counter for each consecutive incorrect answer
   * 3. Reset counter on correct answer or unanswered question
   * 4. Terminate when counter reaches threshold
   * 
   * @param {Object} taskResult - Validation result from validateTask()
   * @param {Object} config - Configuration with consecutiveThreshold
   * @returns {Object} { terminationIndex }
   */
  function applyConsecutiveIncorrectTermination(taskResult, config) {
    let consecutiveIncorrect = 0;
    let terminationIndex = -1;
    
    for (let i = 0; i < taskResult.questions.length; i++) {
      const q = taskResult.questions[i];
      
      if (q.studentAnswer === null) {
        consecutiveIncorrect = 0;
      } else if (q.isCorrect) {
        consecutiveIncorrect = 0;
      } else {
        consecutiveIncorrect++;
        
        if (consecutiveIncorrect >= config.consecutiveThreshold && terminationIndex === -1) {
          terminationIndex = i;
          console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()} terminated at question ${i + 1} (${q.id}) after ${config.consecutiveThreshold} consecutive incorrect`);
          break;
        }
      }
    }
    
    return { terminationIndex };
  }

  /**
   * Apply threshold-based termination (Fine Motor - Square Cutting)
   * 
   * Terminates if a specific set of questions fails to meet a threshold.
   * Used for FM: if all square-cutting items score 0, tree-cutting is skipped.
   * 
   * Logic:
   * 1. Find target questions by ID (e.g., FM_squ_1, FM_squ_2, FM_squ_3)
   * 2. Check if all are answered
   * 3. Count correct (score > 0)
   * 4. Terminate at last target question if below threshold
   * 
   * @param {Object} taskResult - Validation result from validateTask()
   * @param {Object} config - Configuration with questionIds and threshold
   * @returns {Object} { terminationIndex }
   */
  function applyThresholdBasedTermination(taskResult, config) {
    // Find the specified questions by ID
    const targetQuestions = taskResult.questions.filter(q => config.questionIds.includes(q.id));
    
    if (targetQuestions.length === 0) {
      console.warn(`[TaskValidator] Threshold questions not found: ${config.questionIds.join(', ')}`);
      return { terminationIndex: -1 };
    }
    
    // Check if all are answered
    const allAnswered = targetQuestions.every(q => q.studentAnswer !== null);
    if (!allAnswered) {
      return { terminationIndex: -1 };
    }
    
    // Count correct (score > 0)
    const correctCount = targetQuestions.filter(q => q.isCorrect).length;
    
    // If below threshold, terminate at last question in the set
    if (correctCount < config.threshold) {
      const lastQuestion = targetQuestions[targetQuestions.length - 1];
      const terminationIndex = taskResult.questions.findIndex(q => q.id === lastQuestion.id);
      console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()} terminated: ${correctCount} correct in ${config.questionIds.join(', ')}, need ≥${config.threshold}`);
      return { terminationIndex };
    }
    
    return { terminationIndex: -1 };
  }

  /**
   * Apply termination rules and recalculate totals
   * 
   * CRITICAL: This function implements the PRD-mandated exclusion rule:
   * "Questions after termination point are COMPLETELY EXCLUDED from ALL calculations"
   * 
   * Process:
   * 1. Route to appropriate handler based on config.type
   * 2. Get terminationIndex from handler
   * 3. Recalculate totals: only count questions up to terminationIndex + 1
   * 4. Detect post-termination answers (data quality issue - yellow flag)
   * 5. Return adjusted validation result with termination metadata
   * 
   * This ensures task completion is calculated correctly:
   * - Before: CWR 24/55 = 43% incomplete ❌
   * - After:  CWR 24/24 = 100% complete ✅
   * 
   * @param {Object} taskResult - Validation result from validateTask()
   * @param {Object} config - Termination configuration from TERMINATION_RULES
   * @returns {Object} Adjusted validation result with termination applied
   */
  function applyTerminationRules(taskResult, config) {
    let terminationData = {};
    
    if (config.type === 'stage_based') {
      terminationData = applyStageBasedTermination(taskResult, config);
    } else if (config.type === 'consecutive_incorrect') {
      terminationData = applyConsecutiveIncorrectTermination(taskResult, config);
    } else if (config.type === 'threshold_based') {
      terminationData = applyThresholdBasedTermination(taskResult, config);
    }
    
    const { terminationIndex, terminationStage } = terminationData;
    
    // Recalculate totals excluding ignored questions after termination
    let adjustedTotal = taskResult.totalQuestions;
    let adjustedAnswered = taskResult.answeredQuestions;
    let hasPostTerminationAnswers = false;
    
    if (terminationIndex >= 0) {
      // Only count questions up to and including termination point
      adjustedTotal = terminationIndex + 1;
      adjustedAnswered = taskResult.questions.slice(0, terminationIndex + 1).filter(q => q.studentAnswer !== null).length;
      
      // Check for post-termination answers
      for (let i = terminationIndex + 1; i < taskResult.questions.length; i++) {
        if (taskResult.questions[i].studentAnswer !== null) {
          hasPostTerminationAnswers = true;
          break;
        }
      }
    }
    
    return {
      ...taskResult,
      totalQuestions: adjustedTotal,
      answeredQuestions: adjustedAnswered,
      completionPercentage: adjustedTotal > 0 ? Math.round((adjustedAnswered / adjustedTotal) * 100) : 0,
      terminated: terminationIndex >= 0,
      terminationIndex,
      terminationStage,
      terminationType: config.type,
      hasPostTerminationAnswers
    };
  }

  /**
   * Validate all tasks for a student
   */
  async function validateAllTasks(mergedAnswers) {
    // Ensure metadata is loaded first
    await loadTaskMetadata();
    
    const results = {};
    
    // Get all unique canonical task IDs (not aliases)
    const taskIds = new Set();
    for (const [filename, metadata] of Object.entries(taskMetadata)) {
      // Skip tasks that should be merged with others
      if (metadata.displayWith) {
        console.log(`[TaskValidator] Skipping ${metadata.id} - will be merged with ${metadata.displayWith}`);
        continue;
      }
      taskIds.add(metadata.id);
    }
    
    for (const taskId of taskIds) {
      // Special handling for SYM: merge with NONSYM
      if (taskId === 'sym') {
        // ========================================================================
        // SPECIAL HANDLING: SYM/NONSYM Timeout Detection
        // ========================================================================
        // SYM and NONSYM are merged into a single task with independent 2-minute timers.
        // Must distinguish between:
        // - Proper timeout: Continuous progress then timer expired (green ✅)
        // - Missing data: Non-continuous gaps indicating data quality issue (red ❌)
        
        const symResult = await validateTask('sym', mergedAnswers);
        const nonsymResult = await validateTask('nonsym', mergedAnswers);
        
        // Timeout detection: continuous sequence of answers then all empty
        // Missing data: non-continuous gaps (answered, gap, answered again)
        const analyzeCompletionPattern = (questions) => {
          // Find index of last answered question
          let lastAnsweredIndex = -1;
          for (let i = questions.length - 1; i >= 0; i--) {
            if (questions[i].studentAnswer !== null) {
              lastAnsweredIndex = i;
              break;
            }
          }
          
          // If no answers at all, not started
          if (lastAnsweredIndex === -1) {
            return { timedOut: false, hasMissingData: false, complete: false };
          }
          
          // If last question is answered, completed
          if (lastAnsweredIndex === questions.length - 1) {
            return { timedOut: false, hasMissingData: false, complete: true };
          }
          
          // Check if all questions after the last answered are empty (consecutive gap to end)
          let hasConsecutiveGapToEnd = false;
          for (let i = lastAnsweredIndex + 1; i < questions.length; i++) {
            if (questions[i].studentAnswer !== null) {
              // Found an answer after the gap → not a timeout, just incomplete
              hasConsecutiveGapToEnd = false;
              break;
            }
            hasConsecutiveGapToEnd = true;
          }
          
          // If there's a consecutive gap from lastAnswered to the end → TIMED OUT
          if (hasConsecutiveGapToEnd) {
            // Check for gaps in the middle (like Q19 blank but Q20 has answer)
            let hasGapsInMiddle = false;
            for (let i = 0; i < lastAnsweredIndex; i++) {
              if (questions[i].studentAnswer === null) {
                hasGapsInMiddle = true;
                break;
              }
            }
            
            // Return timeout WITH hasMissingData flag if there are gaps in middle
            return { 
              timedOut: true, 
              hasMissingData: hasGapsInMiddle, 
              complete: false, 
              lastAnsweredIndex 
            };
          }
          
          // No consecutive gap to end, so check if there are ANY gaps (missing data)
          for (let i = 0; i < lastAnsweredIndex; i++) {
            if (questions[i].studentAnswer === null) {
              // Gap found in the middle → missing data (not timed out)
              return { timedOut: false, hasMissingData: true, complete: false };
            }
          }
          
          // All questions before lastAnswered are filled, no gap to end → complete (shouldn't reach here)
          return { timedOut: false, hasMissingData: false, complete: true };
        };
        
        const symAnalysis = analyzeCompletionPattern(symResult.questions);
        const nonsymAnalysis = analyzeCompletionPattern(nonsymResult.questions);
        
        // Recalculate totals based on timeout (same exclusion logic as termination)
        // This ensures timeout is treated identically to termination:
        // - Before timeout adjustment: 53/68 = 78% incomplete ❌
        // - After timeout adjustment:  53/53 = 100% complete ✅
        let adjustedSymTotal = symResult.totalQuestions;
        let adjustedSymAnswered = symResult.answeredQuestions;
        let adjustedNonsymTotal = nonsymResult.totalQuestions;
        let adjustedNonsymAnswered = nonsymResult.answeredQuestions;
        
        if (symAnalysis.timedOut && symAnalysis.lastAnsweredIndex !== undefined) {
          // Only count questions up to timeout point
          adjustedSymTotal = symAnalysis.lastAnsweredIndex + 1;
          adjustedSymAnswered = symResult.questions.slice(0, symAnalysis.lastAnsweredIndex + 1)
                                .filter(q => q.studentAnswer !== null).length;
        }
        
        if (nonsymAnalysis.timedOut && nonsymAnalysis.lastAnsweredIndex !== undefined) {
          // Only count questions up to timeout point
          adjustedNonsymTotal = nonsymAnalysis.lastAnsweredIndex + 1;
          adjustedNonsymAnswered = nonsymResult.questions.slice(0, nonsymAnalysis.lastAnsweredIndex + 1)
                                   .filter(q => q.studentAnswer !== null).length;
        }
        
        const totalAdjusted = adjustedSymTotal + adjustedNonsymTotal;
        const answeredAdjusted = adjustedSymAnswered + adjustedNonsymAnswered;
        const totalCorrect = symResult.correctAnswers + nonsymResult.correctAnswers;
        
        // Merge NONSYM into SYM
        results[taskId] = {
          taskId: 'sym',
          title: `${symResult.title} / ${nonsymResult.title}`, // "SYM / NONSYM"
          questions: [...symResult.questions, ...nonsymResult.questions],
          totalQuestions: totalAdjusted,
          answeredQuestions: answeredAdjusted,
          correctAnswers: totalCorrect,
          completionPercentage: totalAdjusted > 0 ? Math.round((answeredAdjusted / totalAdjusted) * 100) : 0,
          accuracyPercentage: answeredAdjusted > 0 ? Math.round((totalCorrect / answeredAdjusted) * 100) : 0,
          // Store individual results and analysis
          symResult,
          nonsymResult,
          symAnalysis,
          nonsymAnalysis,
          // Legacy flags for compatibility
          symTimedOut: symAnalysis.timedOut,
          nonsymTimedOut: nonsymAnalysis.timedOut,
          timedOut: symAnalysis.timedOut || nonsymAnalysis.timedOut,
          hasMissingData: symAnalysis.hasMissingData || nonsymAnalysis.hasMissingData
        };
        
        console.log(`[TaskValidator] SYM: timeout=${symAnalysis.timedOut}, missingData=${symAnalysis.hasMissingData}`);
        console.log(`[TaskValidator] NONSYM: timeout=${nonsymAnalysis.timedOut}, missingData=${nonsymAnalysis.hasMissingData}`);
      } else if (TERMINATION_RULES[taskId]) {
        // Apply centralized termination rules
        const taskResult = await validateTask(taskId, mergedAnswers);
        results[taskId] = applyTerminationRules(taskResult, TERMINATION_RULES[taskId]);
      } else {
        // No termination rules - standard validation
        results[taskId] = await validateTask(taskId, mergedAnswers);
      }
    }
    
    return results;
  }

  // Public API
  return {
    loadTaskDefinition,
    validateTask,
    validateAllTasks,
    extractQuestions
  };
})();
