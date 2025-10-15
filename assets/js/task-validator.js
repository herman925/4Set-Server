/**
 * Task Validator for 4Set Checking System
 * Loads task definitions and validates student answers
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
        questions.push(item);
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
        questions.push(item);
      }
    }
    return questions;
  }
  
  /**
   * Check if a field ID should be excluded from question counting
   */
  function isExcludedField(id) {
    // Exclude date fields, text memo fields, termination records, and other non-question fields
    return id.endsWith('_Date') || 
           id.endsWith('_TEXT') || 
           id.includes('_Memo_') ||
           id.includes('_Ter') || // Exclude all termination records (ERV_Ter1, CM_Ter2, etc.)
           id.endsWith('_timeout'); // Exclude timeout fields (SYM_timeout, NONSYM_timeout)
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

    const questions = extractQuestions(taskDef);
    const validatedQuestions = [];

    for (const question of questions) {
      const questionId = question.id;
      const correctAnswer = question.scoring?.correctAnswer;
      
      // Get student answer from merged Jotform data
      let studentAnswer = mergedAnswers[questionId]?.answer || 
                          mergedAnswers[questionId]?.text || 
                          null;
      
      // Map JotForm option indices (1, 2, 3) to actual values for image-choice, radio, and radio_text questions
      if (studentAnswer && (question.type === 'image-choice' || question.type === 'radio' || question.type === 'radio_text') && question.options) {
        const optionIndex = parseInt(studentAnswer);
        if (!isNaN(optionIndex) && optionIndex >= 1 && optionIndex <= question.options.length) {
          const mappedValue = question.options[optionIndex - 1].value;
          console.log(`[TaskValidator] Mapped ${questionId}: ${studentAnswer} → ${mappedValue}`);
          studentAnswer = mappedValue;
        }
      }
      
      // Determine if answer is correct
      let isCorrect = false;
      if (correctAnswer !== undefined) {
        // Standard question with scoring.correctAnswer
        isCorrect = studentAnswer !== null && String(studentAnswer).trim() === String(correctAnswer).trim();
      } else if (question.type === 'matrix-cell') {
        // Matrix cell: 1 = performed correctly, 0 = not performed
        isCorrect = studentAnswer === '1' || studentAnswer === 1;
      } else {
        // Y/N question: Y = correct, N = incorrect
        isCorrect = studentAnswer === 'Y' || studentAnswer === 'y';
      }
      
      // Check if this is an unscored preference question (no correctAnswer at all)
      const isUnscoredQuestion = correctAnswer === undefined && question.type !== 'matrix-cell' && !['Y', 'y', 'N', 'n'].includes(studentAnswer);
      
      validatedQuestions.push({
        id: questionId,
        studentAnswer: studentAnswer,
        correctAnswer: correctAnswer, // Will be undefined for Y/N tasks, matrix cells, and unscored questions
        isCorrect: isCorrect,
        label: question.label?.answer || question.label?.zh || questionId,
        isYNQuestion: correctAnswer === undefined, // Flag for UI (includes Y/N, matrix cells, and unscored questions)
        isUnscored: isUnscoredQuestion // Flag for preference questions with no scoring
      });
    }

    const answeredCount = validatedQuestions.filter(q => q.studentAnswer !== null).length;
    const correctCount = validatedQuestions.filter(q => q.isCorrect).length;
    const totalQuestions = validatedQuestions.length;

    return {
      taskId,
      title: taskDef.title,
      questions: validatedQuestions,
      totalQuestions,
      answeredQuestions: answeredCount,
      correctAnswers: correctCount,
      completionPercentage: totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0,
      accuracyPercentage: answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0
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
        const symResult = await validateTask('sym', mergedAnswers);
        const nonsymResult = await validateTask('nonsym', mergedAnswers);
        
        // Detect timeout vs missing data
        // Timeout: continuous sequence of answers then all empty
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
          
          // Check if all questions after the last answered are empty (continuous gap)
          let hasGapAfter = false;
          for (let i = lastAnsweredIndex + 1; i < questions.length; i++) {
            if (questions[i].studentAnswer !== null) {
              // Found an answer after gap → non-continuous, missing data problem
              return { timedOut: false, hasMissingData: true, complete: false };
            }
            hasGapAfter = true;
          }
          
          // Check for gaps BEFORE last answered (spotty pattern)
          for (let i = 0; i < lastAnsweredIndex; i++) {
            if (questions[i].studentAnswer === null) {
              // Gap found before last answer → missing data
              return { timedOut: false, hasMissingData: true, complete: false };
            }
          }
          
          // Continuous from start to lastAnswered, then all empty → proper timeout
          if (hasGapAfter) {
            return { timedOut: true, hasMissingData: false, complete: false, lastAnsweredIndex };
          }
          
          return { timedOut: false, hasMissingData: false, complete: true };
        };
        
        const symAnalysis = analyzeCompletionPattern(symResult.questions);
        const nonsymAnalysis = analyzeCompletionPattern(nonsymResult.questions);
        
        // Merge NONSYM into SYM
        results[taskId] = {
          taskId: 'sym',
          title: `${symResult.title} / ${nonsymResult.title}`, // "SYM / NONSYM"
          questions: [...symResult.questions, ...nonsymResult.questions],
          totalQuestions: symResult.totalQuestions + nonsymResult.totalQuestions,
          answeredQuestions: symResult.answeredQuestions + nonsymResult.answeredQuestions,
          correctAnswers: symResult.correctAnswers + nonsymResult.correctAnswers,
          completionPercentage: Math.round(
            ((symResult.answeredQuestions + nonsymResult.answeredQuestions) / 
             (symResult.totalQuestions + nonsymResult.totalQuestions)) * 100
          ),
          accuracyPercentage: Math.round(
            ((symResult.correctAnswers + nonsymResult.correctAnswers) / 
             (symResult.answeredQuestions + nonsymResult.answeredQuestions)) * 100
          ),
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
      } else if (taskId === 'chinesewordreading') {
        // Special handling for CWR: detect 10 consecutive incorrect responses
        const cwrResult = await validateTask(taskId, mergedAnswers);
        
        // Detect 10 consecutive incorrect
        let consecutiveIncorrect = 0;
        let terminationIndex = -1;
        
        for (let i = 0; i < cwrResult.questions.length; i++) {
          const q = cwrResult.questions[i];
          
          if (q.studentAnswer === null) {
            // No answer - break streak
            consecutiveIncorrect = 0;
          } else if (q.isCorrect) {
            // Correct answer - reset streak
            consecutiveIncorrect = 0;
          } else {
            // Incorrect answer - increment streak
            consecutiveIncorrect++;
            
            if (consecutiveIncorrect >= 10 && terminationIndex === -1) {
              // Found termination point
              terminationIndex = i;
              console.log(`[TaskValidator] CWR terminated at question ${i + 1} (${q.id}) after 10 consecutive incorrect`);
              break;
            }
          }
        }
        
        results[taskId] = {
          ...cwrResult,
          terminated: terminationIndex >= 0,
          terminationIndex,
          terminationType: 'consecutive_incorrect'
        };
      } else {
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
