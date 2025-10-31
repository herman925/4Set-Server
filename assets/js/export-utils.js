/**
 * Shared Export Utilities
 * Common functions for generating markdown exports across student, class, and school pages
 */

const ExportUtils = (() => {
  
  /**
   * Format set status with emoji
   * @param {Object} setData - Set data object with status property
   * @returns {string} Formatted status string with emoji
   */
  function formatSetStatus(setData) {
    if (!setData || !setData.status) return '⚪ Not Started';
    
    switch (setData.status) {
      case 'complete':
        return '✅ Complete';
      case 'incomplete':
        return '⚠️ Incomplete';
      case 'notstarted':
      default:
        return '⚪ Not Started';
    }
  }
  
  /**
   * Format set status emoji only (without text)
   * @param {Object} setData - Set data object with status property
   * @returns {string} Status emoji
   */
  function formatSetStatusEmoji(setData) {
    if (!setData || !setData.status) return '⚪';
    
    switch (setData.status) {
      case 'complete':
        return '✅';
      case 'incomplete':
        return '⚠️';
      case 'notstarted':
      default:
        return '⚪';
    }
  }
  
  /**
   * Generate set status summary table (used by student page)
   * @param {Object} setStatus - Set status object from validation cache
   * @returns {string} Markdown table
   */
  function generateSetStatusTable(setStatus) {
    let markdown = `## Set Status Summary\n\n`;
    markdown += `| Set | Status | Tasks Complete |\n`;
    markdown += `|-----|--------|----------------|\n`;
    
    for (let i = 1; i <= 4; i++) {
      const setData = setStatus[`set${i}`];
      const statusText = formatSetStatus(setData);
      const tasksInfo = setData ? `${setData.tasksComplete}/${setData.tasksTotal}` : '0/0';
      markdown += `| Set ${i} | ${statusText} | ${tasksInfo} |\n`;
    }
    
    return markdown;
  }
  
  /**
   * Generate set status table for class export (without task counts)
   * @param {Object} setStatus - Set status object from validation cache
   * @returns {string} Markdown table
   */
  function generateClassSetStatusTable(setStatus) {
    let markdown = `### Set Status\n\n`;
    markdown += `| Set | Status |\n`;
    markdown += `|-----|--------|\n`;
    
    for (let i = 1; i <= 4; i++) {
      const setData = setStatus[`set${i}`];
      const statusText = formatSetStatus(setData);
      markdown += `| Set ${i} | ${statusText} |\n`;
    }
    
    return markdown;
  }
  
  /**
   * Generate inline set status for school export
   * @param {Object} setStatus - Set status object from validation cache
   * @returns {string} Inline status string
   */
  function generateInlineSetStatus(setStatus) {
    const setStatuses = [];
    for (let i = 1; i <= 4; i++) {
      const setData = setStatus[`set${i}`];
      const statusEmoji = formatSetStatusEmoji(setData);
      setStatuses.push(`Set ${i}: ${statusEmoji}`);
    }
    return setStatuses.join(' | ');
  }
  
  /**
   * Calculate status light color for a task
   * @param {Object} taskData - Task validation data
   * @returns {string} Status light indicator (emoji + text)
   */
  function calculateTaskStatusLight(taskData) {
    if (!taskData || taskData.error) return '⚪ Not Started';
    
    const answered = taskData.answeredQuestions || 0;
    const total = taskData.totalQuestions || 0;
    
    // No data yet
    if (total === 0 || answered === 0) {
      return '⚪ Not Started';
    }
    
    // Warning: Post-termination data OR termination mismatch detected (yellow)
    if (taskData.hasPostTerminationAnswers || taskData.hasTerminationMismatch) {
      return '🟡 Warning';
    }
    
    // Properly terminated/timed out (green)
    if ((taskData.terminated || taskData.timedOut) && answered > 0) {
      return '🟢 Complete';
    }
    
    // All questions answered (green)
    if (answered === total) {
      return '🟢 Complete';
    }
    
    // Started but not complete (red)
    if (answered > 0) {
      return '🔴 Incomplete';
    }
    
    // Not started (grey)
    return '⚪ Not Started';
  }

  /**
   * Generate task validation summary table (ANS/COR/TOT format)
   * @param {Object} taskValidation - Task validation object
   * @returns {string} Markdown table
   */
  function generateTaskSummaryTable(taskValidation) {
    let markdown = `### Task Validation Summary\n\n`;
    markdown += `| Task | Status Light | ANS | COR | TOT | Completion | Accuracy | Terminated |\n`;
    markdown += `|------|--------------|-----|-----|-----|------------|----------|------------|\n`;
    
    const tasks = Object.entries(taskValidation).sort((a, b) => a[0].localeCompare(b[0]));
    
    for (const [taskId, taskData] of tasks) {
      if (!taskData || taskData.error) continue;
      
      const statusLight = calculateTaskStatusLight(taskData);
      const ans = taskData.answeredQuestions || 0;
      const cor = taskData.correctAnswers || 0;
      const tot = taskData.totalQuestions || 0;
      const completion = taskData.completionPercentage || 0;
      const accuracy = taskData.accuracyPercentage || 0;
      const terminated = taskData.terminated ? `✅ Q${(taskData.terminationIndex || 0) + 1}` : '—';
      
      markdown += `| ${taskId.toUpperCase()} | ${statusLight} | ${ans} | ${cor} | ${tot} | ${completion}% | ${accuracy}% | ${terminated} |\n`;
    }
    
    return markdown;
  }
  
  /**
   * Format termination information for detailed task view
   * @param {string} taskId - Task ID
   * @param {Object} taskData - Task validation data
   * @returns {string} Formatted termination info
   */
  function formatTerminationInfo(taskId, taskData) {
    if (!taskData) return `**Termination:** No data  \n`;
    
    // Special handling for SYM/NONSYM timeout
    if (taskId === 'sym') {
      if (taskData.timedOut) {
        let info = `**Termination:** ✅ Timed Out (2-minute timer)  \n`;
        if (taskData.symTimedOut) info += `  - SYM (Symbolic): Timed out  \n`;
        if (taskData.nonsymTimedOut) info += `  - NONSYM (Non-symbolic): Timed out  \n`;
        return info;
      } else if (taskData.hasMissingData) {
        return `**Termination:** ⚠️ Missing Data (non-continuous gaps)  \n`;
      } else {
        return `**Termination:** No timeout  \n`;
      }
    }
    
    // Standard termination handling
    if (taskData.terminated) {
      let info = `**Termination:** ✅ Terminated at Q${(taskData.terminationIndex || 0) + 1}`;
      if (taskData.terminationStage) info += ` (Stage ${taskData.terminationStage})`;
      if (taskData.terminationType) info += ` [${taskData.terminationType}]`;
      info += `  \n`;
      
      if (taskData.hasPostTerminationAnswers) {
        info += `**⚠️ Post-Termination Data:** Answers detected after termination point  \n`;
      }
      return info;
    }
    
    return `**Termination:** No termination  \n`;
  }
  
  /**
   * Download markdown content as file
   * @param {string} content - Markdown content
   * @param {string} filename - Filename for download
   */
  function downloadMarkdown(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  /**
   * Master export orchestrator - handles all page types
   * @param {Object} config - Export configuration
   * @param {string} config.type - Export type: 'student', 'class', or 'school'
   * @param {Object} config.data - Page-specific data object
   * @param {Function} config.loadValidationCache - Function to load validation cache
   * @returns {Promise<void>}
   */
  async function exportReport(config) {
    try {
      const { type, data, loadValidationCache } = config;
      
      console.log(`[ExportUtils] Exporting ${type} validation report...`);
      
      // Load validation cache
      const validationCache = await loadValidationCache();
      if (!validationCache) {
        alert('No validation data available for export');
        return;
      }
      
      let markdown = '';
      let filename = '';
      
      // Build report based on type
      switch (type) {
        case 'student':
          ({ markdown, filename } = await buildStudentReport(data, validationCache));
          break;
        case 'class':
          ({ markdown, filename } = await buildClassReport(data, validationCache));
          break;
        case 'school':
          ({ markdown, filename } = await buildSchoolReport(data, validationCache));
          break;
        case 'group':
          ({ markdown, filename } = await buildGroupReport(data, validationCache));
          break;
        case 'district':
          ({ markdown, filename } = await buildDistrictReport(data, validationCache));
          break;
        default:
          throw new Error(`Unknown export type: ${type}`);
      }
      
      // Download the report
      downloadMarkdown(markdown, filename);
      
      console.log(`[ExportUtils] Export complete: ${filename}`);
    } catch (error) {
      console.error('[ExportUtils] Export failed:', error);
      alert('Export failed: ' + error.message);
      throw error;
    }
  }
  
  /**
   * Build student page export
   * Exports ALL available grades' data for the student
   */
  async function buildStudentReport(data, validationCache) {
    const { studentData, allStudentRecords, availableGrades, selectedGrade } = data;
    const coreId = studentData.coreId;
    
    // Header with student info
    let markdown = `# Student Validation Report (All Grades)\n\n`;
    markdown += `**Student:** ${studentData.studentName} (${studentData.studentId})  \n`;
    markdown += `**Core ID:** ${coreId}  \n`;
    markdown += `**Available Grades:** ${availableGrades?.join(', ') || 'N/A'}  \n`;
    markdown += `**Currently Viewing:** ${selectedGrade || studentData.year || 'N/A'}  \n`;
    markdown += `**Export Time:** ${new Date().toLocaleString()}  \n\n`;
    markdown += `---\n\n`;
    
    // If we have multiple grade records, export each one
    const studentRecords = allStudentRecords || [studentData];
    const uniqueGrades = [...new Set(studentRecords.map(s => s.year))].filter(y => y).sort().reverse();
    
    if (uniqueGrades.length === 0) {
      // Fallback to single record export (original behavior)
      const studentValidation = validationCache.get(coreId);
      
      if (!studentValidation || !studentValidation.taskValidation) {
        throw new Error('No validation data available for this student');
      }
      
      markdown += await buildSingleGradeReport(studentData, studentValidation);
    } else {
      // Export data for each grade
      for (const grade of uniqueGrades) {
        const gradeRecord = studentRecords.find(s => s.year === grade);
        if (!gradeRecord) continue;
        
        markdown += `# ${grade} Data\n\n`;
        markdown += `**Class:** ${gradeRecord.classId}  \n`;
        markdown += `**School:** ${gradeRecord.schoolId}  \n`;
        markdown += `**Year:** ${grade}  \n\n`;
        
        // Get validation data for this student
        // Note: The validation cache is keyed by coreId, and includes the merged data
        // We need to check if there's grade-specific validation available
        const studentValidation = validationCache.get(coreId);
        
        if (!studentValidation || !studentValidation.taskValidation) {
          markdown += `⚠️ No validation data available for this grade  \n\n`;
          markdown += `---\n\n`;
          continue;
        }
        
        // Add grade-specific validation report
        markdown += await buildSingleGradeReport(gradeRecord, studentValidation);
        markdown += `\n---\n\n`;
      }
    }
    
    const gradesSuffix = uniqueGrades.length > 1 ? `_${uniqueGrades.join('-')}` : `_${selectedGrade || studentData.year || ''}`;
    const filename = `student-report_${coreId}${gradesSuffix}_${new Date().toISOString().slice(0, 10)}.md`;
    return { markdown, filename };
  }
  
  /**
   * Build validation report for a single grade
   */
  async function buildSingleGradeReport(studentRecord, studentValidation) {
    let markdown = '';
    
    // Set Status Summary
    markdown += generateSetStatusTable(studentValidation.setStatus);
    markdown += `\n---\n\n`;
    markdown += `## Task Validation Details (Organized by Set)\n\n`;
    
    // Organize tasks by set
    const tasksBySet = { set1: [], set2: [], set3: [], set4: [] };
    for (const setId in studentValidation.setStatus) {
      const setData = studentValidation.setStatus[setId];
      for (const task of setData.tasks || []) {
        const taskData = studentValidation.taskValidation[task.taskId];
        if (taskData) {
          tasksBySet[setId].push([task.taskId, taskData]);
        }
      }
    }
    
    // Render tasks grouped by set
    const setNames = { set1: 'Set 1', set2: 'Set 2', set3: 'Set 3', set4: 'Set 4' };
    
    for (const setId of ['set1', 'set2', 'set3', 'set4']) {
      const tasks = tasksBySet[setId];
      if (tasks.length === 0) continue;
      
      const setData = studentValidation.setStatus[setId];
      const statusEmoji = formatSetStatusEmoji(setData);
      
      markdown += `### ${statusEmoji} ${setNames[setId]} (${setData.tasksComplete}/${setData.tasksTotal} tasks complete)\n\n`;
      
      for (const [taskId, taskData] of tasks) {
        const statusLight = calculateTaskStatusLight(taskData);
        markdown += `#### ${taskData.title || taskId.toUpperCase()}\n\n`;
        markdown += `**Task ID:** \`${taskId}\`  \n`;
        markdown += `**Status Light:** ${statusLight}  \n`;
        markdown += `**Total Questions:** ${taskData.totalQuestions}  \n`;
        markdown += `**Answered (ANS):** ${taskData.answeredQuestions}/${taskData.totalQuestions} (${taskData.completionPercentage}%)  \n`;
        markdown += `**Correct (COR):** ${taskData.correctAnswers}/${taskData.answeredQuestions} (${taskData.accuracyPercentage}%)  \n`;
        markdown += formatTerminationInfo(taskId, taskData);
        markdown += `\n`;
        
        // Question details table
        if (taskData.questions && taskData.questions.length > 0) {
          markdown += `**Question Details**\n\n`;
          markdown += `| # | Question ID | Student Answer | Correct Answer | Result |\n`;
          markdown += `|---|-------------|----------------|----------------|--------|\n`;
          
          taskData.questions.forEach((q, idx) => {
            const qNum = idx + 1;
            const studentAns = q.studentAnswer !== null ? q.studentAnswer : '—';
            const correctAns = q.isTextDisplay
              ? '—'
              : (q.displayCorrectAnswer ?? q.correctAnswer ?? (q.isYNQuestion ? 'Y/N' : '—'));
            const result = q.studentAnswer === null ? '⚪ Unanswered' : (q.isCorrect ? '✅ Correct' : '❌ Incorrect');
            
            // Mark ignored questions (after termination or timeout)
            let isIgnored = false;
            let ignoreReason = '';
            
            if (taskId === 'sym' && taskData.timedOut && q.studentAnswer === null) {
              isIgnored = true;
              ignoreReason = 'Timed Out';
            } else if (taskData.terminated && idx > (taskData.terminationIndex || -1)) {
              isIgnored = true;
              ignoreReason = 'Terminated';
            }
            
            const qId = isIgnored ? `~~${q.id}~~` : q.id;
            const finalResult = isIgnored ? `🔵 Ignored (${ignoreReason})` : result;
            
            markdown += `| ${qNum} | ${qId} | ${studentAns} | ${correctAns} | ${finalResult} |\n`;
          });
          
          markdown += `\n`;
        }
        
        markdown += `\n`;
      }
      
      markdown += `---\n\n`;
    }
    
    return markdown;
  }
  
  /**
   * Build class page export
   */
  async function buildClassReport(data, validationCache) {
    const { classData, schoolData, students } = data;
    
    if (!classData || students.length === 0) {
      throw new Error('No class data to export');
    }
    
    // Helper function to get grade label
    const getGradeLabel = (gradeNumber) => {
      if (gradeNumber === 1) return 'K1';
      if (gradeNumber === 2) return 'K2';
      if (gradeNumber === 3) return 'K3';
      if (gradeNumber === 0) return 'Other';
      return 'N/A';
    };
    
    // Header
    let markdown = `# Class Validation Report\n\n`;
    markdown += `**Class:** ${classData.actualClassName} (${classData.classId})  \n`;
    markdown += `**Grade:** ${getGradeLabel(classData.grade)}  \n`;
    markdown += `**School:** ${schoolData?.schoolNameChinese || classData.schoolId}  \n`;
    markdown += `**Teacher:** ${classData.teacherChinese || '—'}  \n`;
    markdown += `**Total Students:** ${students.length}  \n`;
    markdown += `**Export Time:** ${new Date().toLocaleString()}  \n\n`;
    markdown += `---\n\n`;
    
    // Sort students by name
    const sortedStudents = [...students].sort((a, b) => a.studentName.localeCompare(b.studentName));
    
    for (const student of sortedStudents) {
      const validation = validationCache.get(student.coreId);
      
      markdown += `## ${student.studentName} (${student.studentId})\n\n`;
      markdown += `**Core ID:** ${student.coreId}  \n`;
      markdown += `**Year:** ${student.year || 'N/A'}  \n`;
      
      if (!validation || !validation.taskValidation) {
        markdown += `**Status:** ⚠️ No validation data available  \n\n`;
        markdown += `---\n\n`;
        continue;
      }
      
      // Set Status Summary
      markdown += `\n${generateClassSetStatusTable(validation.setStatus)}\n`;
      
      // Task Validation Summary Table
      markdown += `${generateTaskSummaryTable(validation.taskValidation)}`;
      
      markdown += `\n---\n\n`;
    }
    
    const filename = `class-report_${classData.classId}_${getGradeLabel(classData.grade)}_${new Date().toISOString().slice(0, 10)}.md`;
    return { markdown, filename };
  }
  
  /**
   * Build school page export
   */
  async function buildSchoolReport(data, validationCache) {
    const { schoolData, classes, students } = data;
    
    if (!schoolData) {
      throw new Error('No school data to export');
    }
    
    // Header
    let markdown = `# School Validation Report\n\n`;
    markdown += `**School:** ${schoolData.schoolNameChinese} (${schoolData.schoolId})  \n`;
    markdown += `**District:** ${schoolData.district || '—'}  \n`;
    markdown += `**Group:** ${schoolData.group || '—'}  \n`;
    markdown += `**Total Classes:** ${classes.length}  \n`;
    markdown += `**Total Students:** ${students.length}  \n`;
    markdown += `**Export Time:** ${new Date().toLocaleString()}  \n\n`;
    markdown += `---\n\n`;
    
    // Group students by class
    const studentsByClass = new Map();
    for (const student of students) {
      if (!studentsByClass.has(student.classId)) {
        studentsByClass.set(student.classId, []);
      }
      studentsByClass.get(student.classId).push(student);
    }
    
    // Process each class
    for (const classData of classes) {
      const classStudents = studentsByClass.get(classData.classId) || [];
      
      markdown += `## ${classData.actualClassName} (${classData.classId})\n\n`;
      markdown += `**Teacher:** ${classData.teacherChinese || '—'}  \n`;
      markdown += `**Students:** ${classStudents.length}  \n\n`;
      
      // Student validation summaries
      markdown += `### Students in ${classData.actualClassName}\n\n`;
      
      for (const student of classStudents) {
        const validation = validationCache.get(student.coreId);
        
        markdown += `#### ${student.studentName} (${student.studentId})\n\n`;
        
        if (!validation || !validation.taskValidation) {
          markdown += `⚠️ No validation data available  \n\n`;
          continue;
        }
        
        // Student Set Status
        markdown += `**Set Status:** ${generateInlineSetStatus(validation.setStatus)}  \n\n`;
        
        // Task Summary Table
        markdown += generateTaskSummaryTable(validation.taskValidation);
        markdown += `\n`;
      }
      
      markdown += `\n`;
    }
    
    const filename = `school-report_${schoolData.schoolId}_${new Date().toISOString().slice(0, 10)}.md`;
    return { markdown, filename };
  }
  
  /**
   * Build group page export
   */
  async function buildGroupReport(data, validationCache) {
    const { groupData, schools, classes, students } = data;
    
    if (!groupData) {
      throw new Error('No group data to export');
    }
    
    // Header
    let markdown = `# Group Validation Report\n\n`;
    markdown += `**Group:** ${groupData.group}  \n`;
    markdown += `**Total Schools:** ${schools?.length || 0}  \n`;
    markdown += `**Total Classes:** ${classes?.length || 0}  \n`;
    markdown += `**Total Students:** ${students?.length || 0}  \n`;
    markdown += `**Export Time:** ${new Date().toLocaleString()}  \n\n`;
    markdown += `---\n\n`;
    
    // Group schools by school
    const schoolsSorted = [...(schools || [])].sort((a, b) => 
      (a.schoolNameChinese || a.schoolId).localeCompare(b.schoolNameChinese || b.schoolId)
    );
    
    // Group classes and students by school
    const classesBySchool = new Map();
    const studentsBySchool = new Map();
    
    for (const cls of classes || []) {
      if (!classesBySchool.has(cls.schoolId)) {
        classesBySchool.set(cls.schoolId, []);
      }
      classesBySchool.get(cls.schoolId).push(cls);
    }
    
    for (const student of students || []) {
      if (!studentsBySchool.has(student.schoolId)) {
        studentsBySchool.set(student.schoolId, []);
      }
      studentsBySchool.get(student.schoolId).push(student);
    }
    
    // Process each school
    for (const schoolData of schoolsSorted) {
      const schoolClasses = classesBySchool.get(schoolData.schoolId) || [];
      const schoolStudents = studentsBySchool.get(schoolData.schoolId) || [];
      
      markdown += `## ${schoolData.schoolNameChinese} (${schoolData.schoolId})\n\n`;
      markdown += `**District:** ${schoolData.district || '—'}  \n`;
      markdown += `**Total Classes:** ${schoolClasses.length}  \n`;
      markdown += `**Total Students:** ${schoolStudents.length}  \n\n`;
      
      // School-level aggregation (complete/incomplete/not started counts per set)
      markdown += `### School Set Status Summary\n\n`;
      markdown += `| Set | Complete | Incomplete | Not Started |\n`;
      markdown += `|-----|----------|------------|-------------|\n`;
      
      for (let i = 1; i <= 4; i++) {
        const setKey = `set${i}`;
        let complete = 0, incomplete = 0, notStarted = 0;
        
        for (const student of schoolStudents) {
          const validation = validationCache.get(student.coreId);
          if (validation?.setStatus?.[setKey]) {
            const status = validation.setStatus[setKey].status;
            if (status === 'complete') complete++;
            else if (status === 'incomplete') incomplete++;
            else notStarted++;
          }
        }
        
        markdown += `| Set ${i} | ${complete} | ${incomplete} | ${notStarted} |\n`;
      }
      
      markdown += `\n`;
    }
    
    const filename = `group-report_${groupData.group.replace(/\s+/g, '-')}_${new Date().toISOString().slice(0, 10)}.md`;
    return { markdown, filename };
  }
  
  /**
   * Build district page export
   */
  async function buildDistrictReport(data, validationCache) {
    const { districtData, groups, schools, classes, students } = data;
    
    if (!districtData) {
      throw new Error('No district data to export');
    }
    
    // Header
    let markdown = `# District Validation Report\n\n`;
    markdown += `**District:** ${districtData.district}  \n`;
    markdown += `**Total Groups:** ${groups?.length || 0}  \n`;
    markdown += `**Total Schools:** ${schools?.length || 0}  \n`;
    markdown += `**Total Classes:** ${classes?.length || 0}  \n`;
    markdown += `**Total Students:** ${students?.length || 0}  \n`;
    markdown += `**Export Time:** ${new Date().toLocaleString()}  \n\n`;
    markdown += `---\n\n`;
    
    // Group schools by group
    const schoolsByGroup = new Map();
    const studentsByGroup = new Map();
    
    for (const school of schools || []) {
      const groupKey = school.group || 'Ungrouped';
      if (!schoolsByGroup.has(groupKey)) {
        schoolsByGroup.set(groupKey, []);
      }
      schoolsByGroup.get(groupKey).push(school);
    }
    
    for (const student of students || []) {
      // Find student's school to determine group
      const school = schools?.find(s => s.schoolId === student.schoolId);
      const groupKey = school?.group || 'Ungrouped';
      if (!studentsByGroup.has(groupKey)) {
        studentsByGroup.set(groupKey, []);
      }
      studentsByGroup.get(groupKey).push(student);
    }
    
    // Sort groups
    const groupsSorted = Array.from(schoolsByGroup.keys()).sort();
    
    // Process each group
    for (const groupName of groupsSorted) {
      const groupSchools = schoolsByGroup.get(groupName) || [];
      const groupStudents = studentsByGroup.get(groupName) || [];
      
      markdown += `## Group: ${groupName}\n\n`;
      markdown += `**Schools:** ${groupSchools.length}  \n`;
      markdown += `**Students:** ${groupStudents.length}  \n\n`;
      
      // Group-level aggregation
      markdown += `### Group Set Status Summary\n\n`;
      markdown += `| Set | Complete | Incomplete | Not Started |\n`;
      markdown += `|-----|----------|------------|-------------|\n`;
      
      for (let i = 1; i <= 4; i++) {
        const setKey = `set${i}`;
        let complete = 0, incomplete = 0, notStarted = 0;
        
        for (const student of groupStudents) {
          const validation = validationCache.get(student.coreId);
          if (validation?.setStatus?.[setKey]) {
            const status = validation.setStatus[setKey].status;
            if (status === 'complete') complete++;
            else if (status === 'incomplete') incomplete++;
            else notStarted++;
          }
        }
        
        markdown += `| Set ${i} | ${complete} | ${incomplete} | ${notStarted} |\n`;
      }
      
      markdown += `\n`;
      
      // List schools in this group
      markdown += `### Schools in ${groupName}\n\n`;
      const groupSchoolsSorted = groupSchools.sort((a, b) => 
        (a.schoolNameChinese || a.schoolId).localeCompare(b.schoolNameChinese || b.schoolId)
      );
      
      for (const school of groupSchoolsSorted) {
        const schoolStudents = students?.filter(s => s.schoolId === school.schoolId) || [];
        markdown += `- **${school.schoolNameChinese}** (${school.schoolId}): ${schoolStudents.length} students  \n`;
      }
      
      markdown += `\n`;
    }
    
    const filename = `district-report_${districtData.district.replace(/\s+/g, '-')}_${new Date().toISOString().slice(0, 10)}.md`;
    return { markdown, filename };
  }
  
  // Public API
  return {
    // Formatting utilities
    formatSetStatus,
    formatSetStatusEmoji,
    generateSetStatusTable,
    generateClassSetStatusTable,
    generateInlineSetStatus,
    generateTaskSummaryTable,
    formatTerminationInfo,
    downloadMarkdown,
    
    // Master export orchestrator
    exportReport
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.ExportUtils = ExportUtils;
}
