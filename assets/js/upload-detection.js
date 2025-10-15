// System Detection - OneDrive Path and PC Number

// Detect OneDrive path and PC number
async function detectSystemPaths() {
    try {
        // Fetch agent config
        const response = await fetch('config/agent.json');
        const config = await response.json();
        
        // Extract PC number from various sources
        state.pcNumber = await detectPCNumber();
        
        // Detect OneDrive path
        state.oneDrivePath = await detectOneDrivePath(config);
        
        // Check if this is a GitHub Pages deployment (no local path detection possible)
        const isRemoteDeployment = window.location.protocol === 'https:' || window.location.hostname !== 'localhost';
        const isFirstRun = !localStorage.getItem('onedrive_base_path') && !localStorage.getItem('setup_complete');
        
        // If remote deployment and first run, prompt for setup
        if (isRemoteDeployment && isFirstRun) {
            console.log('[Setup] First run detected on remote deployment');
            
            // Show setup prompt after a short delay
            setTimeout(() => {
                const setupPath = prompt(
                    '🔧 First-Time Setup\n\n' +
                    'This PC needs to be configured with the OneDrive base path.\n\n' +
                    'Please enter the full path to your 4Set-Server folder:\n' +
                    '(Example: C:\\Users\\YourName\\The Education University of Hong Kong\\o365grp_KeySteps@JC - General\\98 - IT Support\\04 - Homemade Apps\\4Set-Server)',
                    state.oneDrivePath
                );
                
                if (setupPath) {
                    const cleanPath = setupPath.replace(/\\+$/, '');
                    localStorage.setItem('onedrive_base_path', cleanPath);
                    localStorage.setItem('setup_complete', 'true');
                    state.oneDrivePath = cleanPath;
                    alert('✓ Setup complete! Path saved for this PC.\n\nYou can change it later using the "Override Path" button.');
                    location.reload();
                } else {
                    localStorage.setItem('setup_complete', 'true'); // Mark as seen even if skipped
                }
            }, 1000);
        }
        
        // Build watch path (oneDrivePath is the base, append watchPath folder)
        const watchFolder = config.watchPath.replace('./', '').replace(/\\/g, '');
        state.watchPath = `${state.oneDrivePath}\\${watchFolder}`;
        
        // Update UI
        updatePCNumberDisplay(state.pcNumber);
        updateOneDriveStatus();
        lucide.createIcons();
        
    } catch (error) {
        console.error('Failed to detect system paths:', error);
        document.getElementById('pc-number').textContent = '???';
        document.getElementById('onedrive-status').textContent = 'Detection failed';
        lucide.createIcons();
    }
}

// Detect PC number from multiple sources
async function detectPCNumber() {
    // Strategy 1: Check manually configured PC number
    const savedPCNumber = localStorage.getItem('pc_number');
    if (savedPCNumber) {
        console.log('[PC Detection] Using configured PC number:', savedPCNumber);
        return savedPCNumber;
    }
    
    // Strategy 2: Check cached OneDrive path
    const cachedPath = localStorage.getItem('onedrive_base_path');
    if (cachedPath) {
        // Look for computer name patterns
        const pathMatch = cachedPath.match(/(?:KS|LAPTOP|PC|WORKSTATION)(\d+)/i);
        if (pathMatch) {
            console.log('[PC Detection] Found in cached path:', pathMatch[1]);
            const pcNum = pathMatch[1].padStart(3, '0');
            localStorage.setItem('pc_number', pcNum);
            return pcNum;
        }
        
        // Extract from username in cached path
        const userMatch = cachedPath.match(/Users[\\\/]([^\\\/]+)/i);
        if (userMatch) {
            const username = userMatch[1];
            const numMatch = username.match(/(\d+)/);
            if (numMatch) {
                console.log('[PC Detection] Extracted from username:', numMatch[1]);
                const pcNum = numMatch[1].padStart(3, '0');
                localStorage.setItem('pc_number', pcNum);
                return pcNum;
            }
        }
    }
    
    // Strategy 3: Try to extract from current URL path
    const path = window.location.pathname;
    const pathMatch = path.match(/(?:KS|LAPTOP|PC|WORKSTATION)(\d+)/i);
    if (pathMatch) {
        console.log('[PC Detection] Found in URL:', pathMatch[1]);
        const pcNum = pathMatch[1].padStart(3, '0');
        localStorage.setItem('pc_number', pcNum);
        return pcNum;
    }
    
    // Strategy 4: Auto-detection failed
    console.warn('[PC Detection] Could not auto-detect PC number - user needs to set manually');
    return '000';  // Will show as red badge
}

// OneDrive path detection (browser-compatible only)
async function detectOneDrivePath(config) {
    console.log('[OneDrive Detection] Starting...');
    
    // Strategy 1: Check localStorage cache (primary for HTTP deployments)
    const savedPath = localStorage.getItem('onedrive_base_path');
    if (savedPath) {
        console.log('[OneDrive Detection] ✓ Using cached path:', savedPath);
        return savedPath;
    }
    
    // Strategy 2: Parse from file:// protocol (only works when opened directly)
    if (window.location.protocol === 'file:') {
        console.log('[OneDrive Detection] Detecting from file:// protocol...');
        
        let fullPath = window.location.href;
        fullPath = fullPath.replace('file:///', '');
        fullPath = decodeURIComponent(fullPath);
        
        const serverIndex = fullPath.indexOf('4Set-Server');
        if (serverIndex > 0) {
            let basePath = fullPath.substring(0, serverIndex + '4Set-Server'.length);
            basePath = basePath.replace(/\//g, '\\');
            
            // Ensure drive letter format
            if (basePath.match(/^[A-Z]\\/i) && !basePath.match(/^[A-Z]:/i)) {
                basePath = basePath.charAt(0) + ':' + basePath.substring(1);
            }
            
            console.log('[OneDrive Detection] ✓ Extracted from file path:', basePath);
            localStorage.setItem('onedrive_base_path', basePath);
            return basePath;
        }
    }
    
    // Strategy 3: Use config fallback (for HTTP deployments or when file:// fails)
    console.log('[OneDrive Detection] Using config fallback...');
    if (config.oneDrive?.fallbackRoot && config.oneDrive?.relativePath) {
        const fallbackPath = config.oneDrive.fallbackRoot + config.oneDrive.relativePath;
        console.log('[OneDrive Detection] Config fallback:', fallbackPath);
        // Don't save to localStorage - let first-run setup handle it
        return fallbackPath;
    }
    
    // Final fallback
    const hardcodedFallback = 'C:\\Users\\KeySteps\\The Education University of Hong Kong\\o365grp_KeySteps@JC - General\\98 - IT Support\\04 - Homemade Apps\\4Set-Server';
    console.warn('[OneDrive Detection] Using hardcoded fallback');
    return hardcodedFallback;
}
