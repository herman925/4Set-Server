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
    // EXCEPT: ToM_Q3_TEXT and ToM_Q4a_ins1_TEXT are instruction questions (not assessment) and should be excluded
    return id.endsWith('_Date') || 
           id.includes('_Memo_') ||
           id.includes('_Ter') || // Exclude all termination records (ERV_Ter1, CM_Ter2, etc.)
           id.endsWith('_timeout') || // Exclude timeout fields (SYM_timeout, NONSYM_timeout)
           /_P\d+/.test(id) || // Exclude practice questions (e.g., ERV_P1, ToM_P2, CM_P1, etc.)
           /^SYM_S[1-3]$/.test(id) || // Exclude SYM sample items (treated like practice questions)
           /^NONSYM_S[1-3]$/.test(id) || // Exclude NONSYM sample items (treated like practice questions)
           id === 'ToM_Q3_TEXT' || // Instruction question: "What do you think is in the box?" (before revealing)
           id === 'ToM_Q4a_ins1_TEXT'; // Instruction question: "What do you think is in the band-aid box?" (before revealing)
  }

  /**
   * Map answer value for option-based questions (image-choice, radio, radio_text)
   * @param {string} answer - The raw answer (might be an index like "1", "2")
   * @param {Object} question - The question definition with options
   * @returns {string} - The mapped value or original answer
   */
  function mapAnswerValue(answer, question) {
    // CRITICAL: Allow 0 as valid answer (TGMD "Not Observed")
    if (answer === null || answer === undefined) return null;
    
    // CRITICAL: Filter out Qualtrics placeholders
    // Qualtrics API sometimes returns the question ID as the "answer" for unanswered questions
    // E.g., MPT_1_r_Q1 = "MPT_1_r_Q1" means the question was not answered
    // Treat these as null to prevent cache poisoning
    if (answer === question.id) {
      return null;
    }
    
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
      let correctAnswer = question.scoring?.correctAnswer;

      const questionOptions = Array.isArray(question.options) ? question.options : [];
      const optionValues = questionOptions
        .map(opt => opt && opt.value !== undefined ? String(opt.value).trim() : '')
        .filter(val => val !== '');
      const normalizedOptionValues = optionValues.map(val => val.toLowerCase());
      const isYesNoOptions = optionValues.length === 2 && normalizedOptionValues.every(val => (
        val === 'y' || val === 'n' || val === 'yes' || val === 'no'
      ));
      const numericOptions = questionOptions
        .map(opt => {
          const numericValue = Number(opt?.value);
          return Number.isFinite(numericValue) ? { ...opt, numericValue } : null;
        })
        .filter(Boolean);
      const isOrdinalScale = numericOptions.length > 0 && numericOptions.length === questionOptions.length;

      // Normalize correct answer (handles stored option indices)
      if (correctAnswer !== undefined && correctAnswer !== null) {
        correctAnswer = mapAnswerValue(correctAnswer, question);
      }

      // Derive fallback for yes/no questions when scoring metadata is absent
      let displayCorrectAnswer = null;
      if (correctAnswer !== undefined && correctAnswer !== null) {
        const matchedOption = questionOptions.find(opt => String(opt?.value).trim() === String(correctAnswer).trim());
        // For image-choice questions, show the value instead of label
        // Labels in image-choice are descriptive text for administrators, not display values
        if (question.type === 'image-choice') {
          displayCorrectAnswer = correctAnswer; // Use the numeric value (e.g., "4")
        } else {
          displayCorrectAnswer = matchedOption?.label || correctAnswer;
        }
      } else if (isYesNoOptions) {
        correctAnswer = 'Y';
        displayCorrectAnswer = 'Y';
      } else if (isOrdinalScale) {
        const bestOption = numericOptions.reduce((prev, current) => {
          if (!prev) return current;
          return current.numericValue > prev.numericValue ? current : prev;
        }, null);
        displayCorrectAnswer = bestOption?.label || (bestOption ? String(bestOption.numericValue) : null);
      }

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
          // Check if associated text field (textId) has data
          let hasTextData = false;
          let textFieldId = null;
          if (question.options) {
            for (const option of question.options) {
              if (option.textId) {
                textFieldId = option.textId;
                const textAnswer = mergedAnswers[option.textId]?.answer || 
                                  mergedAnswers[option.textId]?.text || 
                                  null;
                if (textAnswer && String(textAnswer).trim() !== '') {
                  hasTextData = true;
                  break;
                }
              }
            }
          }
          
          // Check if correct answer was selected
          if (studentAnswer !== null && String(studentAnswer).trim() === String(correctAnswer).trim()) {
            isCorrect = true;
            // Note: Even if associated _TEXT field has data, we ignore it as mistyped input
          } else if (studentAnswer !== null) {
            // Radio has an answer (but it's incorrect)
            isCorrect = false;
          } else if (hasTextData) {
            // Radio is blank but text field is filled
            // Per user: treat this as an incorrect answer attempt
            // Mark the radio question as answered incorrectly
            studentAnswer = '[TEXT_ONLY_ATTEMPT]'; // Special marker to indicate text-only attempt
            isCorrect = false;
          } else {
            // Radio blank and no text data
            isCorrect = false;
          }
        } else {
          // Standard correctAnswer comparison for non-radio_text questions
          isCorrect = studentAnswer !== null && String(studentAnswer).trim() === String(correctAnswer).trim();
        }
      } else if (question.type === 'matrix-cell') {
        // Matrix cell: 1 = performed correctly, 0 = not performed
        isCorrect = studentAnswer === '1' || studentAnswer === 1;
      } else if (isYesNoOptions) {
        // Y/N fallback: treat "Y" as correct when no explicit scoring metadata exists
        isCorrect = studentAnswer !== null && String(studentAnswer).trim().toLowerCase() === 'y';
      } else {
        isCorrect = false;
      }
      
      // Check if this is an unscored preference question (no correctAnswer at all)
      // HTKS and Fine Motor use scoring systems (0/1/2 or 0/1) without a "correct answer", so exclude them
      const isScoringTask = taskId === 'headtoekneeshoulder' || taskId === 'finemotor';
      const isUnscoredQuestion = !isScoringTask && correctAnswer === undefined && question.type !== 'matrix-cell' && !['Y', 'y', 'N', 'n'].includes(studentAnswer);
      
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
            if (studentAnswer !== null && String(studentAnswer).trim() !== '') {
              // Text field has content
              textFieldStatus = 'answered';
            } else {
              // Radio answered but text empty - show "—" (dash), not "not-answered"
              // Per user: "not answered" for TEXT ONLY when radio is ALSO not answered
              textFieldStatus = null;
            }
          } else {
            // Radio has NO answer (blank/missing)
            if (studentAnswer !== null && String(studentAnswer).trim() !== '') {
              // Student attempted to answer via text only (incorrect attempt)
              // Per user: if radio blank and text filled, it means incorrect answer was assumed
              // The _TEXT field should NOT be displayed to avoid revealing the incorrect attempt
              textFieldStatus = null; // Hide _TEXT field
            } else {
              // Both radio and text are empty - show "not-answered"
              // Per user: "not answered for TEXT only happens if radio is also not answered"
              textFieldStatus = 'not-answered';
            }
          }
        } else if (studentAnswer !== null && String(studentAnswer).trim() !== '') {
          // No associated radio question, just check if answered
          textFieldStatus = 'answered';
        }
      }
      
      validatedQuestions.push({
        id: questionId,
        studentAnswer: studentAnswer,
        correctAnswer: correctAnswer, // Will remain undefined for rubric-style questions without explicit scoring metadata
        displayCorrectAnswer: displayCorrectAnswer,
        isCorrect: isCorrect,
        label: question.label?.answer || question.label?.zh || questionId,
        isYNQuestion: isYesNoOptions,
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

    const result = {
      taskId,
      title: taskDef.title,
      questions: validatedQuestions, // Include ALL questions (including _TEXT for display)
      totalQuestions, // Only scored questions
      answeredQuestions: answeredCount, // Only scored questions
      correctAnswers: correctCount,
      completionPercentage: totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0,
      accuracyPercentage: answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0
    };

    // Post-process TGMD tasks for matrix-radio scoring with trial summation
    if (taskId === 'tgmd') {
      return processTGMDScoring(result, taskDef);
    }

    return result;
  }

  /**
   * Process TGMD scoring to aggregate trial results and group by task
   * 
   * TGMD uses matrix-radio questions where:
   * - Each row represents a performance criterion
   * - Each column represents a trial (t1, t2)
   * - Values are 0 (not performed) or 1 (performed correctly)
   * 
   * This function:
   * 1. Groups trial cells (t1, t2) by row (criterion)
   * 2. Calculates row score = t1 + t2 (max 2 per criterion)
   * 3. Groups criteria by task field (hop, long_jump, slide, etc.)
   * 4. Calculates task totals and overall score
   * 
   * @param {Object} validationResult - Standard validation result from validateTask
   * @param {Object} taskDef - TGMD task definition with matrix-radio questions
   * @returns {Object} Enhanced validation result with TGMD scoring structure
   */
  function processTGMDScoring(validationResult, taskDef) {
    console.log('[TaskValidator] Processing TGMD matrix-radio scoring');
    
    // Group questions by row ID (e.g., TGMD_111_Hop_t1 and TGMD_111_Hop_t2 → TGMD_111_Hop)
    const rowMap = new Map();
    
    for (const q of validationResult.questions) {
      // Only process matrix-cell questions (skip TGMD_Leg, TGMD_Hand, etc.)
      if (q.id.includes('_t1') || q.id.includes('_t2')) {
        const rowId = q.id.replace(/_t[12]$/, ''); // Remove _t1 or _t2 suffix
        
        if (!rowMap.has(rowId)) {
          rowMap.set(rowId, { 
            rowId: rowId,
            t1: null, 
            t2: null, 
            task: null,
            description: null,
            matrixQuestionId: null
          });
        }
        
        const row = rowMap.get(rowId);
        
        // Get trial value - keep null for unanswered, convert valid answers to number
        let trialValue = null;
        if (q.studentAnswer !== null && q.studentAnswer !== undefined && q.studentAnswer !== '') {
          trialValue = parseInt(q.studentAnswer, 10);
          if (isNaN(trialValue) || trialValue < 0 || trialValue > 1) {
            console.warn(`[TaskValidator] Invalid TGMD trial value for ${q.id}: ${q.studentAnswer} (expected 0 or 1)`);
            trialValue = 0; // Treat invalid as 0
          }
        }
        
        if (q.id.endsWith('_t1')) {
          row.t1 = trialValue;
        } else {
          row.t2 = trialValue;
        }
      }
    }
    
    // Find task field and description for each row from task definition
    for (const [rowId, row] of rowMap) {
      // Find the matrix question that contains this row
      for (const matrixQ of taskDef.questions) {
        if (matrixQ.type === 'matrix-radio' && matrixQ.rows) {
          const rowDef = matrixQ.rows.find(r => r.id === rowId);
          if (rowDef) {
            row.task = matrixQ.task; // e.g., "hop", "long_jump"
            row.description = rowDef.description; // e.g., "離地腳有自然彎曲..."
            row.matrixQuestionId = matrixQ.id; // e.g., "Hop"
            row.taskLabel = matrixQ.label?.zh || matrixQ.id; // e.g., "1.單腳跳..."
            break;
          }
        }
      }
    }
    
    // Create aggregated TGMD questions with row scores
    const tgmdRows = [];
    for (const [rowId, row] of rowMap) {
      // Keep trials as-is (null if unanswered, 0 or 1 if answered)
      const t1 = row.t1;
      const t2 = row.t2;
      
      // Calculate rowScore: only count answered trials (null contributes 0)
      const rowScore = (t1 !== null ? t1 : 0) + (t2 !== null ? t2 : 0);
      
      tgmdRows.push({
        id: rowId,
        rowScore: rowScore,
        maxScore: 2,
        trials: { t1: t1, t2: t2 }, // Preserve null for unanswered
        task: row.task,
        taskLabel: row.taskLabel,
        description: row.description || rowId,
        matrixQuestionId: row.matrixQuestionId
      });
    }
    
    // Group rows by task
    const taskGroups = {};
    for (const row of tgmdRows) {
      if (!taskGroups[row.task]) {
        taskGroups[row.task] = {
          taskName: row.task,
          taskLabel: row.taskLabel,
          matrixQuestionId: row.matrixQuestionId,
          criteria: []
        };
      }
      taskGroups[row.task].criteria.push({
        id: row.id,
        description: row.description,
        trials: row.trials,
        rowScore: row.rowScore,
        maxScore: row.maxScore
      });
    }
    
    // Calculate task totals
    for (const task of Object.values(taskGroups)) {
      task.taskScore = task.criteria.reduce((sum, c) => sum + c.rowScore, 0);
      task.taskMaxScore = task.criteria.length * 2;
    }
    
    // Calculate overall totals
    const totalScore = tgmdRows.reduce((sum, row) => sum + row.rowScore, 0);
    const maxScore = tgmdRows.length * 2;
    
    console.log(`[TaskValidator] TGMD scoring complete: ${totalScore}/${maxScore} (${Object.keys(taskGroups).length} tasks)`);
    
    return {
      ...validationResult,
      tgmdScoring: {
        byTask: taskGroups,
        totalScore: totalScore,
        maxScore: maxScore,
        percentage: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0
      }
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
      questionIds: ['FM_slide_1', 'FM_slide_2', 'FM_slide_3', 'FM_squ_1', 'FM_squ_2', 'FM_squ_3'],
      threshold: 1, // At least 1 must be correct (score > 0)
      description: 'All sliding and square-cutting items must score 0 to terminate'
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
      console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()}: Not all threshold questions answered yet - no termination`);
      return { terminationIndex: -1 };
    }
    
    // Count correct (score > 0)
    const correctCount = targetQuestions.filter(q => q.isCorrect).length;
    
    console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()} threshold check: ${correctCount} correct out of ${targetQuestions.length}, threshold=${config.threshold}`);
    
    // If below threshold, terminate at last question in the set
    if (correctCount < config.threshold) {
      const lastQuestion = targetQuestions[targetQuestions.length - 1];
      const terminationIndex = taskResult.questions.findIndex(q => q.id === lastQuestion.id);
      console.log(`[TaskValidator] ✂️ ${taskResult.taskId.toUpperCase()} TERMINATED: ${correctCount} < ${config.threshold} (need ≥${config.threshold})`);
      return { terminationIndex };
    }
    
    console.log(`[TaskValidator] ✅ ${taskResult.taskId.toUpperCase()} PASSED: ${correctCount} ≥ ${config.threshold} - NO termination`);
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
   * 4. Detect post-termination answers (data quality issue - yellow flag indicates post-termination activity OR termination mismatch)
   * 5. Return adjusted validation result with termination metadata
   * 
   * This ensures task completion is calculated correctly:
   * - Before: CWR 24/55 = 43% incomplete ❌
   * - After:  CWR 24/24 = 100% complete ✅
   * 
   * @param {Object} taskResult - Validation result from validateTask()
   * @param {Object} config - Termination configuration from TERMINATION_RULES
   * @param {Object} mergedAnswers - Full student answers with JotForm termination fields
   * @param {string} taskId - Task identifier
   * @returns {Object} Adjusted validation result with termination applied
   */
  function applyTerminationRules(taskResult, config, mergedAnswers, taskId) {
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
    let hasTerminationMismatch = false;
    
    console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()} terminationIndex=${terminationIndex}`);
    
    // TERMINATION MISMATCH DETECTION
    // Compare JotForm recorded termination vs system calculated termination
    const calculatedTerminated = terminationIndex >= 0;
    
    if (config.type === 'stage_based') {
      // For ERV and CM: check each stage's termination field
      // CRITICAL: Only check stages that were actually reached (have at least one answered question)
      // Unreached stages should not be checked as their termination fields are not recorded
      for (let i = 0; i < config.stages.length; i++) {
        const stage = config.stages[i];
        const terminationFieldId = taskId === 'erv' 
          ? `ERV_Ter${stage.stageNum}`
          : `CM_Ter${stage.stageNum}`;
        
        const terminationField = mergedAnswers[terminationFieldId];
        const recordedValue = terminationField?.answer || terminationField?.text || '0';
        const recordedTriggered = recordedValue === '1' || recordedValue === 1;
        
        // Calculate what system expects for THIS stage
        const startIdx = taskResult.questions.findIndex(q => q.id === stage.startId);
        const endIdx = taskResult.questions.findIndex(q => q.id === stage.endId);
        
        if (startIdx !== -1 && endIdx !== -1) {
          const stageQuestions = taskResult.questions.slice(startIdx, endIdx + 1);
          const answeredInStage = stageQuestions.filter(q => q.studentAnswer !== null).length;
          
          // CRITICAL FIX: Skip stages that were never reached (no answered questions)
          // This prevents false mismatches for unreached stages where CM_Ter3/CM_Ter4 are not recorded
          if (answeredInStage === 0) {
            console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()} Stage ${stage.stageNum} not reached (0 answers) - skipping mismatch check`);
            break; // Stop checking further stages
          }
          
          const correctInStage = stageQuestions.filter(q => q.isCorrect).length;
          const systemShouldTerminate = correctInStage < stage.threshold;
          
          // Detect mismatch: JotForm says terminated BUT system says should pass (or vice versa)
          if (recordedTriggered !== systemShouldTerminate) {
            hasTerminationMismatch = true;
            console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()} TERMINATION MISMATCH at ${terminationFieldId}: JotForm=${recordedTriggered}, System=${systemShouldTerminate}`);
            break; // One mismatch is enough
          }
          
          // If this stage terminated, stop checking further stages
          if (recordedTriggered) {
            console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()} Stage ${stage.stageNum} terminated - stopping mismatch checks`);
            break;
          }
        }
      }
    } else if (config.type === 'consecutive_incorrect') {
      // For CWR: CWR_10Incorrect is a LEGACY field that is NEVER recorded in JotForm
      // Therefore, we SKIP termination mismatch detection for CWR
      // Yellow/Orange status will ONLY be triggered by post-termination answers (hasPostTerminationAnswers)
      // This allows proper terminations to show GREEN
      console.log(`[TaskValidator] CWR termination mismatch check skipped (CWR_10Incorrect is legacy field, never recorded)`);
      
      // Note: Mis-termination (stopped early without hitting 10 consecutive wrongs) will be detected
      // by the incomplete status logic (answered > 0 but not complete and not terminated)
    } else if (config.type === 'threshold_based') {
      // For Fine Motor: check FM_Ter field
      const terminationField = mergedAnswers['FM_Ter'];
      const recordedValue = terminationField?.answer || terminationField?.text || '0';
      const recordedTriggered = recordedValue === '1' || recordedValue === 1;
      
      if (recordedTriggered !== calculatedTerminated) {
        hasTerminationMismatch = true;
        console.log(`[TaskValidator] FM TERMINATION MISMATCH: JotForm=${recordedTriggered}, System=${calculatedTerminated}`);
      }
      
      // INCOMPLETE DATA DETECTION for Fine Motor:
      // If ANY side_1-3 is successful (value = 1) BUT ALL squ_1-3 are unsuccessful (value = 0),
      // this indicates incomplete or wrong input data
      if (taskResult.taskId === 'finemotor' || taskResult.taskId === 'fm') {
        const sideQuestions = ['FM_side_1', 'FM_side_2', 'FM_side_3'];
        const squQuestions = ['FM_squ_1', 'FM_squ_2', 'FM_squ_3'];
        
        // Check if any side question is successful
        const anySideSuccessful = sideQuestions.some(qid => {
          const q = taskResult.questions.find(question => question.id === qid);
          return q && (q.studentAnswer === '1' || q.studentAnswer === 1);
        });
        
        // Check if ALL squ questions are unsuccessful
        const allSquUnsuccessful = squQuestions.every(qid => {
          const q = taskResult.questions.find(question => question.id === qid);
          return q && (q.studentAnswer === '0' || q.studentAnswer === 0);
        });
        
        if (anySideSuccessful && allSquUnsuccessful) {
          hasTerminationMismatch = true; // Use termination mismatch flag to trigger yellow status
          console.log(`[TaskValidator] FM INCOMPLETE DATA: side_1-3 has successful but ALL squ_1-3 are unsuccessful`);
          
          // Mark the squ questions for special display
          squQuestions.forEach(qid => {
            const q = taskResult.questions.find(question => question.id === qid);
            if (q) {
              q.hasIncompleteData = true;
            }
          });
        }
        
        // HIERARCHICAL CONSISTENCY VALIDATION for Fine Motor:
        // FM_side_1-3 are progressive thresholds (10-49%, 50-89%, 90-100%) for the SAME first edge
        // FM_squ_1-3 are progressive thresholds (10-49%, 50-89%, 90-100%) for the SAME entire square
        // Higher thresholds REQUIRE lower thresholds to be marked (cumulative/hierarchical)
        // Example: If side_3=1, then side_2 and side_1 MUST also = 1
        
        // Get side values
        const side1 = taskResult.questions.find(q => q.id === 'FM_side_1');
        const side2 = taskResult.questions.find(q => q.id === 'FM_side_2');
        const side3 = taskResult.questions.find(q => q.id === 'FM_side_3');
        
        const side1Val = side1 && (side1.studentAnswer === '1' || side1.studentAnswer === 1) ? 1 : 0;
        const side2Val = side2 && (side2.studentAnswer === '1' || side2.studentAnswer === 1) ? 1 : 0;
        const side3Val = side3 && (side3.studentAnswer === '1' || side3.studentAnswer === 1) ? 1 : 0;
        
        // Check side_1-3 hierarchical consistency
        let sideViolation = false;
        if (side3Val === 1 && (side1Val === 0 || side2Val === 0)) {
          sideViolation = true; // side_3 requires side_1 AND side_2
        } else if (side2Val === 1 && side1Val === 0) {
          sideViolation = true; // side_2 requires side_1
        }
        
        if (sideViolation) {
          hasTerminationMismatch = true; // Trigger yellow warning
          console.log(`[TaskValidator] FM HIERARCHICAL VIOLATION: side thresholds [${side1Val},${side2Val},${side3Val}] - higher threshold marked without lower ones`);
          
          // Mark all side questions with violation flag
          sideQuestions.forEach(qid => {
            const q = taskResult.questions.find(question => question.id === qid);
            if (q) {
              q.hasHierarchicalViolation = true;
            }
          });
        }
        
        // Get squ values
        const squ1 = taskResult.questions.find(q => q.id === 'FM_squ_1');
        const squ2 = taskResult.questions.find(q => q.id === 'FM_squ_2');
        const squ3 = taskResult.questions.find(q => q.id === 'FM_squ_3');
        
        const squ1Val = squ1 && (squ1.studentAnswer === '1' || squ1.studentAnswer === 1) ? 1 : 0;
        const squ2Val = squ2 && (squ2.studentAnswer === '1' || squ2.studentAnswer === 1) ? 1 : 0;
        const squ3Val = squ3 && (squ3.studentAnswer === '1' || squ3.studentAnswer === 1) ? 1 : 0;
        
        // Check squ_1-3 hierarchical consistency
        let squViolation = false;
        if (squ3Val === 1 && (squ1Val === 0 || squ2Val === 0)) {
          squViolation = true; // squ_3 requires squ_1 AND squ_2
        } else if (squ2Val === 1 && squ1Val === 0) {
          squViolation = true; // squ_2 requires squ_1
        }
        
        if (squViolation) {
          hasTerminationMismatch = true; // Trigger yellow warning
          console.log(`[TaskValidator] FM HIERARCHICAL VIOLATION: square thresholds [${squ1Val},${squ2Val},${squ3Val}] - higher threshold marked without lower ones`);
          
          // Mark all squ questions with violation flag
          squQuestions.forEach(qid => {
            const q = taskResult.questions.find(question => question.id === qid);
            if (q) {
              q.hasHierarchicalViolation = true;
            }
          });
        }
        
        // CROSS-SECTION DEPENDENCY VALIDATION for Fine Motor (GRADUATED):
        // The first edge (side_1-3) is PART of the entire square (squ_1-3)
        // Higher squ thresholds = Higher confidence about which side thresholds should exist
        // Confidence levels: 'high' (RED pill) or 'medium' (YELLOW pill)
        
        // Check if ALL side questions are unanswered (null)
        const allSideUnanswered = sideQuestions.every(qid => {
          const q = taskResult.questions.find(question => question.id === qid);
          return !q || q.studentAnswer === null || q.studentAnswer === undefined;
        });
        
        const side1Null = !side1 || side1.studentAnswer === null || side1.studentAnswer === undefined;
        const side2Null = !side2 || side2.studentAnswer === null || side2.studentAnswer === undefined;
        
        // Case 1: squ_3 = 1 (90-100% square) - VERY HIGH confidence
        if (squ3Val === 1 && allSideUnanswered) {
          hasTerminationMismatch = true;
          console.log(`[TaskValidator] FM CROSS-SECTION VIOLATION (HIGH): squ_3=1 but ALL sides unanswered`);
          
          // Flag side_1, side_2, side_3 with HIGH confidence (RED pills)
          [side1, side2, side3].forEach(q => {
            if (q) {
              q.hasCrossSectionViolation = true;
              q.crossSectionConfidence = 'high'; // RED "Missing Data"
            }
          });
        }
        
        // Case 2: squ_2 = 1 (50-89% square) - HIGH confidence
        else if (squ2Val === 1) {
          if (allSideUnanswered) {
            hasTerminationMismatch = true;
            console.log(`[TaskValidator] FM CROSS-SECTION VIOLATION (HIGH): squ_2=1 but ALL sides unanswered`);
            
            // Flag side_1, side_2 with HIGH confidence (RED pills)
            [side1, side2].forEach(q => {
              if (q) {
                q.hasCrossSectionViolation = true;
                q.crossSectionConfidence = 'high'; // RED "Missing Data"
              }
            });
          } else if (!side1Null && side2Null) {
            // Partial answer: side_1 answered but side_2 missing
            hasTerminationMismatch = true;
            console.log(`[TaskValidator] FM CROSS-SECTION VIOLATION (MEDIUM): squ_2=1, side_1 answered, but side_2 unanswered`);
            
            // Flag side_2 only with MEDIUM confidence (YELLOW pill)
            if (side2) {
              side2.hasCrossSectionViolation = true;
              side2.crossSectionConfidence = 'medium'; // YELLOW "Possible Missing Data"
            }
          }
        }
        
        // Case 3: squ_1 = 1 (10-49% square) - MEDIUM confidence
        else if (squ1Val === 1 && allSideUnanswered) {
          hasTerminationMismatch = true;
          console.log(`[TaskValidator] FM CROSS-SECTION VIOLATION (MEDIUM): squ_1=1 but ALL sides unanswered`);
          
          // Flag side_1 only with MEDIUM confidence (YELLOW pill)
          if (side1) {
            side1.hasCrossSectionViolation = true;
            side1.crossSectionConfidence = 'medium'; // YELLOW "Possible Missing Data"
          }
        }
      }
    }
    
    if (terminationIndex >= 0) {
      // Only count questions up to and including termination point
      adjustedTotal = terminationIndex + 1;
      adjustedAnswered = taskResult.questions.slice(0, terminationIndex + 1).filter(q => q.studentAnswer !== null).length;
      
      console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()} checking post-termination answers (questions ${terminationIndex + 1} to ${taskResult.questions.length - 1})...`);
      
      // Check for post-termination answers
      for (let i = terminationIndex + 1; i < taskResult.questions.length; i++) {
        if (taskResult.questions[i].studentAnswer !== null) {
          hasPostTerminationAnswers = true;
          console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()} POST-TERMINATION ANSWER detected at question ${i}: ${taskResult.questions[i].id} = ${taskResult.questions[i].studentAnswer}`);
          break;
        }
      }
      
      if (!hasPostTerminationAnswers) {
        console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()} no post-termination answers found`);
      }
    } else {
      console.log(`[TaskValidator] ${taskResult.taskId.toUpperCase()} no termination - hasPostTerminationAnswers stays false`);
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
      hasPostTerminationAnswers,
      hasTerminationMismatch
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
        results[taskId] = applyTerminationRules(taskResult, TERMINATION_RULES[taskId], mergedAnswers, taskId);
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
