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
        
        const classData = {
          classId,
          schoolId,
          schoolName: classItem['School Name'],
          actualClassName: classItem['Actual Class Name'],
          teacherNames: classItem['Teacher Names 25/26'] || classItem['Teacher Names 24/25'] || '',
          displayName: classItem['Actual Class Name']
        };
        
        classesMap.set(classId, classData);
        classIdMap.set(classId, classData);
      });

      // Process students (use current year: Class ID 25/26)
      students.forEach(student => {
        const coreId = student['Core ID'];
        const studentId = student['Student ID'];
        const classId = student['Class ID 25/26'] || student['Class ID 24/25'] || '';
        
        const studentData = {
          coreId,
          studentId,
          studentName: student['Student Name'],
          schoolId: student['School ID'],
          classId,
          group: parseInt(student['Group']) || 0,
          gender: student['Gender'] || '',
          displayName: `${student['Student Name']} (${studentId})`
        };
        
        studentsMap.set(coreId, studentData);
        coreIdMap.set(coreId, studentData);
        studentIdMap.set(studentId, studentData);
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
        version: '1.2' // Cache version updated to include credentials
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
      if (data.version !== '1.2') {
        console.log('Cache version mismatch, clearing old cache');
        sessionStorage.removeItem('checking_system_data');
        return null;
      }
      
      // Rebuild lookup maps
      const schoolsMap = new Map(data.schools.map(s => [s.schoolId, s]));
      const classesMap = new Map(data.classes.map(c => [c.classId, c]));
      const studentsMap = new Map(data.students.map(s => [s.coreId, s]));
      
      return {
        ...data, // Includes schools, classes, students, districts, groups, credentials, metadata, version
        schoolsMap,
        classesMap,
        studentsMap,
        schoolIdMap: schoolsMap,
        classIdMap: classesMap,
        studentIdMap: new Map(data.students.map(s => [s.studentId, s])),
        coreIdMap: studentsMap
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
