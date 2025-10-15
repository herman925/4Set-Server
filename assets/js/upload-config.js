// Upload Configuration and State Management

// State
const state = {
    oneDrivePath: null,
    pcNumber: null,
    watchPath: null,
    uploadQueue: [],
    isUploading: false
};

// Initialize
async function init() {
    await detectSystemPaths();
    setupEventListeners();
    lucide.createIcons();
}
