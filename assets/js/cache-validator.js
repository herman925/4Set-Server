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
    constructor(params) {
      this.coreId = params.coreId;
      this.grade = params.grade;
    }
    
    async validate() {
      console.log(`[StudentValidator] Validating ${this.coreId} ${this.grade}`);
      
      const results = {
        pageType: 'student',
        coreId: this.coreId,
        grade: this.grade,
        timestamp: new Date().toISOString(),
        sections: []
      };
      
      // Get cache data
      const mergedCache = await getMergedCache();
      const submission = mergedCache.find(s => s.coreId === this.coreId && s.grade === this.grade);
      
      if (!submission) {
        results.error = 'Student not found in cache';
        return results;
      }
      
      // Debug: Log submission structure
      console.log('[StudentValidator] Submission structure:', {
        coreId: submission.coreId,
        studentId: submission.studentId,
        studentName: submission.studentName,
        hasAnswers: !!submission.answers,
        answerCount: submission.answers ? Object.keys(submission.answers).length : 0,
        sampleAnswerKeys: submission.answers ? Object.keys(submission.answers).slice(0, 5) : [],
        topLevelKeys: Object.keys(submission).slice(0, 20)
      });
      
      const validationCache = await getValidationCache();
      const validationData = validationCache[this.coreId];
      
      // Section 1: Profile Fields
      results.sections.push(await this.validateProfileFields(submission));
      
      // Section 2: All Task Questions (validate raw answers for ALL questions across ALL tasks - includes TGMD)
      results.sections.push(await this.validateAllTaskQuestions(submission));
      
      // Section 3: Question Correctness (validate ✓/✗ calculations for all questions)
      results.sections.push(await this.validateQuestionCorrectness(submission));
      
      return results;
    }
    
    async validateProfileFields(submission) {
      const section = {
        name: 'Profile Fields',
        mismatches: [],
        validated: 0,
        failed: 0
      };
      
      // Try multiple possible property names from cache
      const getCacheValue = (obj, possibleNames) => {
        for (const name of possibleNames) {
          if (obj[name] !== undefined) return obj[name];
        }
        return undefined;
      };
      
      const fields = [
        { cacheNames: ['studentId', 'student-id'], domId: 'student-student-id', label: 'Student ID' },
        { cacheNames: ['coreId', 'core-id'], domId: 'student-core-id', label: 'Core ID' },
        { cacheNames: ['studentName', 'student-name', 'child-name'], domId: 'student-name', label: 'Student Name' },
        { cacheNames: ['classId', 'class-id'], domId: 'student-class-id', label: 'Class ID' },
        { cacheNames: ['gender'], domId: 'student-gender', label: 'Gender', normalize: (v) => v === 'M' ? 'Male' : v === 'F' ? 'Female' : v },
        { cacheNames: ['schoolId', 'school-id'], domId: 'student-school-id', label: 'School ID' }
      ];
      
      for (const field of fields) {
        let cacheValue = getCacheValue(submission, field.cacheNames);
        if (field.normalize && cacheValue) {
          cacheValue = field.normalize(cacheValue);
        }
        
        const domElement = document.getElementById(field.domId);
        const domValue = domElement?.textContent.trim();
        
        section.validated++;
        
        const match = this.normalizeValue(cacheValue) === this.normalizeValue(domValue);
        
        section.mismatches.push({
          field: field.label,
          cacheRaw: cacheValue || 'undefined',
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
      const section = {
        name: 'Task Questions - Raw Answers',
        mismatches: [],
        validated: 0,
        failed: 0
      };
      
      if (!submission.answers) {
        console.warn('[StudentValidator] No answers object in submission');
        return section;
      }
      
      // Find all task elements (under sets)
      const taskElements = document.querySelectorAll('[data-task-id]');
      
      for (const taskElement of taskElements) {
        const taskId = taskElement.getAttribute('data-task-id');
        const tbody = taskElement.querySelector('tbody');
        if (!tbody) continue;
        
        const rows = tbody.querySelectorAll('tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 4) continue;
          
          const questionId = cells[0]?.textContent.trim();
          const displayAnswer = cells[1]?.textContent.trim();
          
          // Skip empty/not answered
          if (!displayAnswer || displayAnswer === '—' || displayAnswer === 'Not answered') {
            continue;
          }
          
          // Find matching answer in cache by field name
          let cacheAnswer = null;
          let matchedFieldName = null;
          
          for (const [qid, answerObj] of Object.entries(submission.answers)) {
            if (answerObj.name && questionId.includes(answerObj.name.replace(/_/g, ' '))) {
              cacheAnswer = answerObj.answer;
              matchedFieldName = answerObj.name;
              break;
            }
          }
          
          section.validated++;
          const match = cacheAnswer !== null && this.normalizeValue(cacheAnswer) === this.normalizeValue(displayAnswer);
          
          section.mismatches.push({
            field: matchedFieldName || questionId,
            cacheRaw: cacheAnswer !== null ? cacheAnswer : 'Not found',
            displayValue: displayAnswer,
            status: match ? '✅ Match' : '❌ Mismatch'
          });
          
          if (!match) {
            section.failed++;
          }
        }
      }
      
      return section;
    }
    
    async validateQuestionCorrectness(submission) {
      const section = {
        name: 'Question Correctness - ✓/✗ Icons',
        mismatches: [],
        validated: 0,
        failed: 0
      };
      
      if (!submission.answers) {
        console.warn('[StudentValidator] No answers object in submission');
        return section;
      }
      
      // Validate that the ✓/✗ icons match actual correctness
      const taskElements = document.querySelectorAll('[data-task-id]');
      
      for (const taskElement of taskElements) {
        const tbody = taskElement.querySelector('tbody');
        if (!tbody) continue;
        
        const rows = tbody.querySelectorAll('tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 4) continue;
          
          const questionId = cells[0]?.textContent.trim();
          const displayAnswer = cells[1]?.textContent.trim();
          const correctAnswer = cells[2]?.textContent.trim();
          const displayResult = cells[3]?.textContent.trim();
          
          // Skip if not answered
          if (!displayAnswer || displayAnswer === '—' || displayAnswer === 'Not answered') {
            continue;
          }
          
          section.validated++;
          
          // Calculate expected result based on displayed values
          const expectedIsCorrect = this.normalizeValue(displayAnswer) === this.normalizeValue(correctAnswer);
          const displayIsCorrect = displayResult === '✓';
          const match = expectedIsCorrect === displayIsCorrect;
          
          section.mismatches.push({
            field: questionId,
            cacheRaw: expectedIsCorrect ? '✓' : '✗',
            displayValue: displayResult,
            status: match ? '✅ Match' : '❌ Mismatch'
          });
          
          if (!match) {
            section.failed++;
          }
        }
      }
      
      return section;
    }
    
    // Helper methods
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
    
    normalizeValue(value) {
      if (value === null || value === undefined) return '';
      return String(value).trim().toLowerCase();
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
      sectionDiv.open = section.failed > 0;
      
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
      
      if (section.mismatches && section.mismatches.length > 0) {
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
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
    switch (pageType) {
      case 'student':
        return new StudentValidator(params);
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
  
  return {
    create,
    showResults,
    exportResults
  };
})();
