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
    // Exclude date fields, text memo fields, and other non-question fields
    return id.endsWith('_Date') || id.endsWith('_TEXT') || id.includes('_Memo_');
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
      
      // Map JotForm option indices (1, 2) to actual values for image-choice questions
      if (studentAnswer && question.type === 'image-choice' && question.options) {
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
      
      validatedQuestions.push({
        id: questionId,
        studentAnswer: studentAnswer,
        correctAnswer: correctAnswer, // Will be undefined for Y/N tasks and matrix cells
        isCorrect: isCorrect,
        label: question.label?.answer || question.label?.zh || questionId,
        isYNQuestion: correctAnswer === undefined // Flag for UI (includes Y/N and matrix cells)
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
      taskIds.add(metadata.id);
    }
    
    for (const taskId of taskIds) {
      results[taskId] = await validateTask(taskId, mergedAnswers);
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
