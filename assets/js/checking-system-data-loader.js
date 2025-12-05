/**
 * Data Loader for Checking System
 * Handles decryption and parsing of schoolid.enc, classid.enc, coreid.enc
 */
(() => {
  /**
   * Parse CSV text into array of objects
   * @param {string} csvText - CSV content
   * @returns {Array<Object>} - Array of row objects
   */
  function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length !== headers.length) continue; // Skip malformed rows

      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index]?.trim() || '';
      });
      rows.push(row);
    }

    return rows;
  }

  /**
   * Parse a CSV line handling quoted values
   * @param {string} line - CSV line
   * @returns {Array<string>} - Array of values
   */
  function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);

    return values;
  }

  /**
   * Normalize district name to curated list
   * @param {string} district - Original district name
   * @returns {string} - Normalized district name
   */
  function normalizeDistrict(district) {
    const normalized = district.trim();
    const districtMap = {
      '沙田': 'Shatin',
      'Sha Tin': 'Shatin',
      'Shatin': 'Shatin',
      '屯門': 'Tuen Mun',
      'Tuen Mun': 'Tuen Mun',
      '深水埗': 'Sham Shui Po',
      'Sham Shui Po': 'Sham Shui Po',
      '九龍城': 'Kowloon City',
      'Kowloon City': 'Kowloon City',
      '元朗': 'Yuen Long',
      'Yuen Long': 'Yuen Long'
    };

    return districtMap[normalized] || 'Others';
  }

  /**
   * Load and parse all encrypted data files
   * @param {string} systemPassword - System password for decryption
   * @returns {Promise<Object>} - Parsed data with schools, classes, students
   */
  async function loadAllData(systemPassword) {
    try {
      // Load all four files in parallel (identity CSVs + credentials)
      const [schoolCSV, classCSV, coreCSV, credentials] = await Promise.all([
        window.Encryption.loadEncryptedCSV('assets/schoolid.enc', systemPassword),
        window.Encryption.loadEncryptedCSV('assets/classid.enc', systemPassword),
        window.Encryption.loadEncryptedCSV('assets/coreid.enc', systemPassword),
        window.Encryption.loadEncryptedFile('assets/credentials.enc', systemPassword)
      ]);

      // Note: loadEncryptedFile already returns parsed JSON object, no need to parse again

      // Parse CSV data
      const schools = parseCSV(schoolCSV);
      const classes = parseCSV(classCSV);
      const students = parseCSV(coreCSV);

      // Build lookup tables
      const schoolsMap = new Map();
      const classesMap = new Map();
      const studentsMap = new Map();
      const schoolIdMap = new Map(); // By School ID
      const classIdMap = new Map(); // By Class ID
      const studentIdMap = new Map(); // By Student ID
      const coreIdMap = new Map(); // By Core ID

      // Process schools
      schools.forEach(school => {
        const schoolId = school['School ID'];
        const schoolData = {
          schoolId,
          schoolName: school['School Name'],
          schoolNameChinese: school['School Name (Chinese)'],
          group: parseInt(school['Group']) || 0,
          district: normalizeDistrict(school['District Cleaned'] || school['District (Chinese)'] || ''),
          contact: school['Contact'] || '',
          email: school['e-Mail'] || '',
          displayName: `${school['School Name (Chinese)']} · ${school['School Name']}`
        };
        
        schoolsMap.set(schoolId, schoolData);
        schoolIdMap.set(schoolId, schoolData);
      });

      // Process classes (use current year: Teacher Names 25/26)
      classes.forEach(classItem => {
        const classId = classItem['Class ID'];
        const schoolId = classItem['School ID'];
        
        // Normalize grade from K1/K2/K3/Other to numeric 1/2/3/0
        const rawGrade = classItem['Grade'] || '';
        let normalizedGrade = 0; // Default to 0 for "Other"
        
        if (rawGrade.toString().toUpperCase().includes('K1') || rawGrade.toString().toUpperCase().includes('N1')) {
          normalizedGrade = 1;
        } else if (rawGrade.toString().toUpperCase().includes('K2') || rawGrade.toString().toUpperCase().includes('N2')) {
          normalizedGrade = 2;
        } else if (rawGrade.toString().toUpperCase().includes('K3') || rawGrade.toString().toUpperCase().includes('N3')) {
          normalizedGrade = 3;
        }
        
        const classData = {
          classId,
          schoolId,
          schoolName: classItem['School Name'],
          actualClassName: classItem['Actual Class Name'],
          teacherNames: classItem['Teacher Names 25/26'] || classItem['Teacher Names 24/25'] || '',
          grade: normalizedGrade, // Store normalized numeric grade
          gradeDisplay: rawGrade, // Keep original for display if needed
          displayName: classItem['Actual Class Name']
        };
        
        // Fix 無班級 classes without grade suffix in the name
        // If classId ends with -99 (not -99-K1/K2/K3) and actualClassName is 無班級 without grade
        if (classId.match(/-99$/) && classData.actualClassName === '無班級' && normalizedGrade > 0) {
          const gradeLabel = normalizedGrade === 1 ? 'K1' : normalizedGrade === 2 ? 'K2' : 'K3';
          classData.actualClassName = `無班級 (${gradeLabel})`;
          classData.displayName = `無班級 (${gradeLabel})`;
        }
        
        classesMap.set(classId, classData);
        classIdMap.set(classId, classData);
      });

      // Process students - create entries for all years (23/24, 24/25, 25/26)
      // Students without class IDs will be assigned to grade-specific 無班級 classes
      const yearStats = { K1: { total: 0, unassigned: 0 }, K2: { total: 0, unassigned: 0 }, K3: { total: 0, unassigned: 0 } };
      
      students.forEach(student => {
        const coreId = student['Core ID'];
        const studentId = student['Student ID'];
        const schoolId = student['School ID'];
        
        // Check all three years and create student records for each
        const years = [
          { key: 'Class ID 23/24', grade: 1, label: 'K1' },  // 無班級 (K1)
          { key: 'Class ID 24/25', grade: 2, label: 'K2' },  // 無班級 (K2)
          { key: 'Class ID 25/26', grade: 3, label: 'K3' }   // 無班級 (K3)
        ];
        
        years.forEach(year => {
          const originalClassId = student[year.key];
          let classId = originalClassId || '';
          
          // Track statistics for each year
          if (originalClassId !== undefined && originalClassId !== null && originalClassId !== '') {
            yearStats[year.label].total++;
          }
          
          // Auto-assign to grade-specific 無班級 if no classId for this year
          if (!classId && schoolId) {
            classId = `C-${schoolId}-99-${year.label}`;
            yearStats[year.label].unassigned++;
          }
          
          // Only create student record if there's a valid classId
          if (classId) {
            const studentData = {
              coreId,
              studentId,
              studentName: student['Student Name'],
              schoolId,
              classId,
              group: parseInt(student['Group']) || 0,
              gender: student['Gender'] || '',
              displayName: `${student['Student Name']} (${studentId})`,
              year: year.label  // Track which year this record is for
            };
            
            // Use a composite key to allow same coreId in different years
            const compositeKey = `${coreId}-${year.label}`;
            studentsMap.set(compositeKey, studentData);
            
            // Keep coreIdMap for backward compatibility (will have latest year)
            coreIdMap.set(coreId, studentData);
            studentIdMap.set(studentId, studentData);
          }
        });
      });

      // Create grade-specific class 99 (無班級) entries for schools with unassigned students
      // Collect unique school IDs and grades that need class 99 entries
      const schoolsNeedingClass99 = new Map(); // schoolId -> Set of grade labels
      
      Array.from(studentsMap.values()).forEach(student => {
        if (student.classId && student.classId.includes('-99-')) {
          if (!schoolsNeedingClass99.has(student.schoolId)) {
            schoolsNeedingClass99.set(student.schoolId, new Set());
          }
          // Extract grade label from classId (e.g., C-S001-99-K1 -> K1)
          const match = student.classId.match(/-99-([KN]\d)$/);
          if (match) {
            schoolsNeedingClass99.get(student.schoolId).add(match[1]);
          }
        }
      });
      
      // Create class 99 entries for each school-grade combination
      schoolsNeedingClass99.forEach((gradeLabels, schoolId) => {
        gradeLabels.forEach(gradeLabel => {
          const classId = `C-${schoolId}-99-${gradeLabel}`;
          
          // Only create if it doesn't already exist
          if (!classesMap.has(classId)) {
            const school = schoolsMap.get(schoolId);
            // Map K1->1, K2->2, K3->3 for grade
            const gradeNum = gradeLabel === 'K1' ? 1 : gradeLabel === 'K2' ? 2 : 3;
            
            const classData = {
              classId,
              schoolId,
              schoolName: school?.schoolName || '',
              actualClassName: `無班級 (${gradeLabel})`,
              teacherNames: '',
              grade: gradeNum,
              gradeDisplay: gradeLabel,
              displayName: `無班級 (${gradeLabel})`
            };
            
            classesMap.set(classId, classData);
            classIdMap.set(classId, classData);
          }
        });
      });

      // Get unique districts and groups
      // Custom district order: Shatin, Kowloon City, Sham Shui Po, Yuen Long, Tuen Mun, Others
      const districtOrder = ['Shatin', 'Kowloon City', 'Sham Shui Po', 'Yuen Long', 'Tuen Mun', 'Others'];
      const uniqueDistricts = [...new Set(
        Array.from(schoolsMap.values()).map(s => s.district)
      )].filter(d => d);
      
      // Sort by custom order
      const districts = uniqueDistricts.sort((a, b) => {
        const indexA = districtOrder.indexOf(a);
        const indexB = districtOrder.indexOf(b);
        
        // If both are in the order list, sort by order
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        // If only A is in the list, A comes first
        if (indexA !== -1) return -1;
        // If only B is in the list, B comes first
        if (indexB !== -1) return 1;
        // If neither is in the list, sort alphabetically
        return a.localeCompare(b);
      });

      const groups = [...new Set(
        Array.from(schoolsMap.values()).map(s => s.group)
      )].filter(g => g > 0).sort((a, b) => a - b);

      return {
        schools: Array.from(schoolsMap.values()),
        classes: Array.from(classesMap.values()),
        students: Array.from(studentsMap.values()),
        // Lookup maps
        schoolsMap,
        classesMap,
        studentsMap,
        schoolIdMap,
        classIdMap,
        studentIdMap,
        coreIdMap,
        // Filter options
        districts,
        groups,
        // Jotform credentials (decrypted once on home page)
        credentials,
        metadata: {
          recordCounts: {
            schools: schools.length,
            classes: classes.length,
            students: students.length
          },
          lastLoadTime: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('Error loading encrypted data:', error);
      throw error;
    }
  }

  /**
   * Store data in session storage
   * @param {Object} data - Data to store
   */
  function cacheData(data) {
    try {
      // Store core arrays and credentials (not Maps)
      const cacheData = {
        schools: data.schools,
        classes: data.classes,
        students: data.students,
        districts: data.districts,
        groups: data.groups,
        credentials: data.credentials, // Include Jotform API credentials
        metadata: data.metadata,
        version: '1.4' // Cache version updated for multi-year student records
      };
      sessionStorage.setItem('checking_system_data', JSON.stringify(cacheData));
    } catch (error) {
      console.warn('Failed to cache data in sessionStorage:', error);
    }
  }

  /**
   * Load data from session storage
   * @returns {Object|null} - Cached data or null
   */
  function getCachedData() {
    try {
      const cached = sessionStorage.getItem('checking_system_data');
      if (!cached) return null;

      const data = JSON.parse(cached);
      
      // Check cache version - invalidate if outdated
      if (data.version !== '1.4') {
        sessionStorage.removeItem('checking_system_data');
        return null;
      }
      
      // Rebuild lookup maps
      const schoolsMap = new Map(data.schools.map(s => [s.schoolId, s]));
      const classesMap = new Map(data.classes.map(c => [c.classId, c]));
      // Use composite key (coreId-year) for studentsMap to support multi-year records
      const studentsMap = new Map(data.students.map(s => [`${s.coreId}-${s.year}`, s]));
      // Keep coreIdMap for backward compatibility (maps to most recent/last entry)
      const coreIdMap = new Map(data.students.map(s => [s.coreId, s]));
      
      return {
        ...data, // Includes schools, classes, students, districts, groups, credentials, metadata, version
        schoolsMap,
        classesMap,
        studentsMap,
        schoolIdMap: schoolsMap,
        classIdMap: classesMap,
        studentIdMap: new Map(data.students.map(s => [s.studentId, s])),
        coreIdMap
      };
    } catch (error) {
      console.warn('Failed to load cached data:', error);
      return null;
    }
  }

  // Export to global scope
  window.CheckingSystemData = {
    loadAllData,
    cacheData,
    getCachedData,
    parseCSV,
    normalizeDistrict
  };
})();
