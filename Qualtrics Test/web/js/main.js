// Global variable to store the full survey list
let allSurveys = [];
// Global variable to store the ID of the selected survey
let selectedSurveyId = null;

document.addEventListener('DOMContentLoaded', function() {
    // Export Tab Survey Search
    const exportSearchInput = document.getElementById('survey-search');
    if (exportSearchInput) {
        exportSearchInput.addEventListener('input', function() {
            if (typeof filterAndDisplaySurveys === 'function') {
                filterAndDisplaySurveys();
            }
        });
    }

    // Online View Survey Search
    const onlineViewSearchInput = document.getElementById('online-survey-search');
    if (onlineViewSearchInput) {
        onlineViewSearchInput.addEventListener('input', function() {
            displayFilteredSurveyListOnlineView(onlineViewSearchInput.value);
        });
    }

    // --- Tab Switching Logic ---
    const exportTab = document.getElementById('tab-export');
    const onlineViewTab = document.getElementById('tab-online-view');
    const exportSection = document.getElementById('export-section');
    const onlineViewSection = document.getElementById('online-view-section');

    exportTab.addEventListener('click', function() {
        exportTab.classList.add('active');
        onlineViewTab.classList.remove('active');
        exportSection.style.display = '';
        onlineViewSection.style.display = 'none';
    });

    onlineViewTab.addEventListener('click', function() {
        onlineViewTab.classList.add('active');
        exportTab.classList.remove('active');
        onlineViewSection.style.display = '';
        exportSection.style.display = 'none';
        loadSurveyListOnlineView();
    });

    // Attach for whichever tab is visible on load
    if (exportSection.style.display !== 'none') {
    } else {
        loadSurveyListOnlineView();
    }
});

// Check if Eel is available and populate surveys table
window.onload = function() {
    console.log("window.onload triggered.");
    if (typeof eel === 'undefined') {
        console.log("Eel is undefined, showing status.");
        document.getElementById('eel-status').classList.remove('hidden');
        document.getElementById('main-content').classList.add('hidden');
    } else {
        console.log("Eel is defined, proceeding.");
        document.getElementById('eel-status').classList.add('hidden');
        document.getElementById('main-content').classList.remove('hidden');
        
        // If Eel is ready, load the survey list into the table
        fetchAndDisplaySurveys(); 
    }
};

// Fetches survey list from Python and calls display function
async function fetchAndDisplaySurveys() {
    const loadingMessage = document.getElementById('survey-loading-message');
    const tableContainer = document.getElementById('survey-table-container');
    const searchInput = document.getElementById('survey-search');
    loadingMessage.textContent = 'Loading surveys...';
    loadingMessage.classList.remove('hidden');
    tableContainer.innerHTML = ''; // Clear previous table
    searchInput.disabled = true;

    try {
        console.log("Requesting survey list...");
        const result = await eel.get_surveys()();
        
        if (result.success) {
            console.log("Surveys received:", result.surveys);
            allSurveys = result.surveys; // Store the full list
            displaySurveyTable(allSurveys); // Display initial table
            loadingMessage.classList.add('hidden');
            searchInput.disabled = false;
        } else {
            console.error("Failed to load surveys:", result.message);
            loadingMessage.textContent = 'Error loading surveys.';
            showStatus(result.message || 'Failed to load survey list.', 'error');
        }
    } catch (error) {
        console.error("Error calling get_surveys:", error);
        loadingMessage.textContent = 'Error loading surveys.';
        showStatus('An error occurred while loading the survey list: ' + error, 'error');
    }
}

// Filters the global allSurveys based on search input and calls display
function filterAndDisplaySurveys() {
    const searchTerm = document.getElementById('survey-search').value.toLowerCase();
    const filteredSurveys = allSurveys.filter(survey => {
        const nameMatch = survey.name.toLowerCase().includes(searchTerm);
        const idMatch = survey.id.toLowerCase().includes(searchTerm);
        return nameMatch || idMatch;
    });
    displaySurveyTable(filteredSurveys);
}

// Builds and displays the survey table HTML
function displaySurveyTable(surveysToDisplay) {
    const tableContainer = document.getElementById('survey-table-container');
    const loadFieldsButton = document.getElementById('load-fields-button');
    tableContainer.innerHTML = ''; // Clear previous content
    selectedSurveyId = null; // Reset selection
    loadFieldsButton.disabled = true; // Disable button initially

    if (!surveysToDisplay || surveysToDisplay.length === 0) {
        tableContainer.innerHTML = '<p>No surveys match your search.</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'survey-select-table field-select-table'; // Reuse field table styles
    
    // Add table header
    const thead = table.createTHead();
    const headerRow = thead.insertRow();
    headerRow.innerHTML = '<th class="col-check">Select</th><th class="col-name">Survey Name</th><th class="col-id">Survey ID</th>';

    // Add table body
    const tbody = table.createTBody();
    surveysToDisplay.forEach(survey => {
        const row = tbody.insertRow();
        const radioId = `survey-radio-${survey.id}`;
        
        // Radio button cell
        const cellCheck = row.insertCell();
        cellCheck.className = 'col-check';
        // Use radio buttons with a common name for single selection
        cellCheck.innerHTML = `<input type="radio" id="${radioId}" name="surveySelection" value="${survey.id}">`;

        // Name cell
        const cellName = row.insertCell();
        cellName.className = 'col-name';
        // Add label linked to radio button for better UX
        cellName.innerHTML = `<label for="${radioId}" style="cursor: pointer;">${survey.name}</label>`; 

        // ID cell
        const cellId = row.insertCell();
        cellId.className = 'col-id';
        cellId.innerHTML = `<label for="${radioId}" style="cursor: pointer;">${survey.id}</label>`;

        // Add event listener to the radio button itself
        const radioInput = cellCheck.querySelector('input[type="radio"]');
        radioInput.addEventListener('change', function() {
            if (this.checked) {
                selectedSurveyId = this.value;
                console.log("Selected Survey ID:", selectedSurveyId);
                loadFieldsButton.disabled = false;
                // Clear previously loaded fields when selection changes
                document.getElementById('field-selection-area').classList.add('hidden');
                document.getElementById('fields-content').innerHTML = '';
            }
        });
    });

    tableContainer.appendChild(table);
}

// --- Modified loadSurveyFields --- 
async function loadSurveyFields() {
    // Get surveyId from the global variable set by radio button selection
    const surveyId = selectedSurveyId; 

    if (!surveyId) {
        showStatus('Please select a Survey from the table first.', 'error');
        return;
    }

    const fieldArea = document.getElementById('field-selection-area');
    const loadingIndicator = document.getElementById('fields-loading');
    const fieldsContent = document.getElementById('fields-content');

    // Clear previous fields and show loading
    fieldsContent.innerHTML = '';
    fieldArea.classList.remove('hidden');
    loadingIndicator.classList.remove('hidden');
    showStatus(''); // Clear previous status messages

    try {
        console.log(`Requesting fields for selected survey ${surveyId}`);
        const result = await eel.get_survey_fields(surveyId)(); 
        loadingIndicator.classList.add('hidden');

        if (result.success) {
            console.log("Fields received:", result.fields);
            populateFieldCheckboxes(fieldsContent, result.fields);
        } else {
            showStatus(result.message || 'Failed to load survey fields.', 'error');
            fieldArea.classList.add('hidden'); 
        }
    } catch (error) {
        console.error("Error loading fields:", error);
        loadingIndicator.classList.add('hidden');
        showStatus('An error occurred while loading fields: ' + error, 'error');
        fieldArea.classList.add('hidden');
    }
}

function populateFieldCheckboxes(container, fields) {
    container.innerHTML = ''; // Clear previous content

    const createTable = (title, fieldList, groupName) => {
        if (fieldList && fieldList.length > 0) {
            const section = document.createElement('div');
            section.className = 'field-table-section';
            section.innerHTML = `<h4>${title}</h4>`;

            const table = document.createElement('table');
            table.className = 'field-select-table';
            
            // Add table header
            const thead = table.createTHead();
            const headerRow = thead.insertRow();
            headerRow.innerHTML = '<th class="col-check">Select</th><th class="col-name">Field Name</th><th class="col-id">Field ID</th>';

            // Add table body
            const tbody = table.createTBody();
            fieldList.forEach(field => {
                const row = tbody.insertRow();
                const checkboxId = `${groupName}-${field.id}`;
                
                // Checkbox cell
                const cellCheck = row.insertCell();
                cellCheck.className = 'col-check';
                cellCheck.innerHTML = `<input type="checkbox" id="${checkboxId}" name="${groupName}" value="${field.id}" checked>`;

                // Name cell
                const cellName = row.insertCell();
                cellName.className = 'col-name';
                cellName.textContent = field.name; // Use textContent for safety

                // ID cell
                const cellId = row.insertCell();
                cellId.className = 'col-id';
                cellId.textContent = field.id;
            });

            section.appendChild(table);
            container.appendChild(section);
        }
    };

    createTable('Questions', fields.questions, 'questionIds');
    createTable('Embedded Data', fields.embeddedData, 'embeddedDataIds');
    createTable('Metadata', fields.metadata, 'surveyMetadataIds');

    if (container.innerHTML === '') {
        container.innerHTML = '<p>No fields found or returned for this survey.</p>';
    }
}

// --- Modified extractSurveyData --- 
async function extractSurveyData() {
    // Get surveyId from the global variable
    const surveyId = selectedSurveyId;
    
    // Get base export options
    let exportOptions = {
        format: document.getElementById('format').value,
        useLabels: document.getElementById('use-labels').checked,
        compress: document.getElementById('compress').checked,
        // Add other static options if needed in the future
    };

    // Get selected field IDs if the area is visible
    const fieldArea = document.getElementById('field-selection-area');
    if (!fieldArea.classList.contains('hidden')) {
        const selectedFields = {};
        const groups = ['questionIds', 'embeddedDataIds', 'surveyMetadataIds'];
        groups.forEach(groupName => {
            const checkboxes = document.querySelectorAll(`#fields-content input[name="${groupName}"]:checked`);
            if (checkboxes.length > 0) {
                selectedFields[groupName] = Array.from(checkboxes).map(cb => cb.value);
            }
        });
        // If NO checkboxes are selected for a group, Qualtrics defaults to ALL fields.
        // If we want to export ONLY selected fields, we need to pass the arrays.
        // If arrays are passed, only those fields are included.
        exportOptions = { ...exportOptions, ...selectedFields }; 
    }

    // Validate Survey ID selection
    if (!surveyId) {
        showStatus('Please select a survey from the table first.', 'error');
        return;
    }
    
    // Show loading spinner
    const statusContainer = document.getElementById('status');
    const spinner = document.querySelector('#status .spinner'); // Target spinner within status
    const statusMessage = document.getElementById('status-message');
    
    statusContainer.className = 'status-container'; // Reset classes
    spinner.classList.remove('hidden');
    statusMessage.textContent = 'Starting data export, please wait...';
    
    try {
        // Call the Python function, passing selected survey ID and options
        console.log("Sending export options to Python:", exportOptions);
        const result = await eel.get_survey_data(surveyId, exportOptions)();
        
        // Hide spinner
        spinner.classList.add('hidden');
        
        // Show result
        if (result.success) {
            statusContainer.className = 'status-container success';
            // Modify message slightly as download isn't immediate
            statusMessage.textContent = result.message || 'Export process started successfully.';
        } else {
            statusContainer.className = 'status-container error';
            statusMessage.textContent = result.message || 'Export process failed.';
        }
    } catch (error) {
        // Hide spinner
        spinner.classList.add('hidden');
        
        // Show error
        console.error("Export error:", error);
        statusContainer.className = 'status-container error';
        statusMessage.textContent = 'An error occurred during export: ' + error;
    }
}

function showStatus(message, type = '') {
    const statusContainer = document.getElementById('status');
    const statusMessage = document.getElementById('status-message');
    
    statusContainer.classList.remove('hidden');
    statusContainer.className = 'status-container ' + type;
    statusMessage.textContent = message;
}

// --- Online View Integration with Eel Backend ---
let allSurveysOnline = [];

function renderSurveyListOnlineView(surveys) {
    allSurveysOnline = surveys.slice();
    displayFilteredSurveyListOnlineView('');
}

function displayFilteredSurveyListOnlineView(query) {
    const listElem = document.getElementById('online-survey-list');
    const searchVal = (query || '').toLowerCase();
    console.log('[SurveySearch] Query:', searchVal);
    console.log('[SurveySearch] Surveys available:', allSurveysOnline.length);
    const filtered = allSurveysOnline.filter(survey =>
        (survey.name || '').toLowerCase().includes(searchVal)
    );
    console.log('[SurveySearch] Surveys after filtering:', filtered.length, filtered.map(s => s.name));
    let html = '';
    filtered.forEach(survey => {
        html += `<div class="survey-list-item" data-id="${survey.id}">${survey.name}</div>`;
    });
    listElem.innerHTML = html;
    // Reattach event listeners for selecting a survey
    Array.from(listElem.querySelectorAll('.survey-list-item')).forEach(item => {
        item.addEventListener('click', function() {
            selectSurveyOnlineView(item.getAttribute('data-id'));
        });
    });
    // Add event listeners for sorting
    Array.from(listElem.querySelectorAll('th.col-data')).forEach(th => {
        th.addEventListener('click', function() {
            const col = th.getAttribute('data-col');
            sortResponsesTableBy(col);
        });
    });
}

function loadSurveyListOnlineView() {
    const listElem = document.getElementById('online-survey-list');
    listElem.innerHTML = '<li>Loading...</li>';
    eel.get_survey_list_online()(function(result) {
        if (result && result.success) {
            renderSurveyListOnlineView(result.surveys);
        } else {
            listElem.innerHTML = `<li class='error'>${result && result.message ? result.message : 'Failed to load survey list.'}</li>`;
        }
    });
}

function selectSurveyOnlineView(surveyId) {
    document.getElementById('online-survey-title').textContent = '';
    const container = document.getElementById('online-survey-table-container');
    container.innerHTML = '<p>Loading responses...</p>';
    eel.get_survey_responses_online(surveyId)((result) => {
        if (result && result.success) {
            renderSurveyResponsesTable(result.responses);
        } else {
            container.innerHTML = `<p class='error'>${result && result.message ? result.message : 'Failed to load responses.'}</p>`;
        }
    });
}

let currentResponses = [];
let filteredResponses = [];
let currentSort = { col: null, dir: 'asc' };

function renderSurveyResponsesTable(responses) {
    filteredResponses = responses.slice(); // Save for search
    const container = document.getElementById('online-survey-table-container');
    if (!responses.length) {
        container.innerHTML = '<p>No responses found for this survey.</p>';
        return;
    }
    // Build table with index column
    const columns = Object.keys(responses[0]);
    let html = '<table class="responses-table"><thead><tr>';
    html += `<th class="col-index">#</th>`;
    columns.forEach(col => {
        let sortClass = '';
        if (col === currentSort.col) {
            sortClass = currentSort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc';
        }
        html += `<th class="col-data ${sortClass}" data-col="${col}">${col}</th>`;
    });
    html += '<th>Details</th></tr></thead><tbody>';
    responses.forEach((row, idx) => {
        html += '<tr>';
        html += `<td class="col-index">${idx + 1}</td>`;
        columns.forEach(col => {
            html += `<td>${row[col]}</td>`;
        });
        html += `<td><button class="view-detail-btn" data-row="${idx}">View</button></td>`;
        html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
    // Add event listeners for detail buttons
    Array.from(container.querySelectorAll('.view-detail-btn')).forEach(btn => {
        btn.addEventListener('click', function() {
            const idx = parseInt(btn.getAttribute('data-row'));
            showResponseDetailModal(responses[idx]);
        });
    });
    // Add event listeners for sorting
    Array.from(container.querySelectorAll('th.col-data')).forEach(th => {
        th.addEventListener('click', function() {
            const col = th.getAttribute('data-col');
            sortResponsesTableBy(col);
        });
    });
}

function sortResponsesTableBy(col) {
    if (!col) return;
    // Toggle sort direction if same column
    if (currentSort.col === col) {
        currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.col = col;
        currentSort.dir = 'asc';
    }
    // Sort the filtered responses
    const sorted = filteredResponses.slice().sort((a, b) => {
        let valA = a[col];
        let valB = b[col];
        // Try numeric sort if both values are numbers
        if (!isNaN(parseFloat(valA)) && !isNaN(parseFloat(valB))) {
            valA = parseFloat(valA);
            valB = parseFloat(valB);
        } else {
            valA = (valA || '').toString().toLowerCase();
            valB = (valB || '').toString().toLowerCase();
        }
        if (valA < valB) return currentSort.dir === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.dir === 'asc' ? 1 : -1;
        return 0;
    });
    renderSurveyResponsesTable(sorted);
}

function showResponseDetailModal(response) {
    const modal = document.getElementById('response-detail-modal');
    const content = document.getElementById('response-detail-content');
    let html = '<h3>Response Details</h3><ul>';
    for (const key in response) {
        html += `<li><strong>${key}:</strong> ${response[key]}</li>`;
    }
    html += '</ul>';
    content.innerHTML = html;
    modal.style.display = 'block';

    // Always attach the close event after showing the modal
    const closeBtn = document.getElementById('close-detail-modal');
    if (closeBtn) {
        closeBtn.onclick = function() {
            modal.style.display = 'none';
        };
    }
}

// Optional: search/filter logic for sidebar
const onlineSurveySearch = document.getElementById('online-survey-search');
if (onlineSurveySearch) {
    // Removed event listener
}

// Initial data load for Online View
if (document.getElementById('online-survey-list')) {
    loadSurveyListOnlineView();
}
