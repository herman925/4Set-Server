#!/bin/bash
# Verification script to check if all required assets exist for test-pipeline-core-id.html

echo "Checking required assets for test-pipeline-core-id.html..."
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

errors=0

# Check function
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1"
    else
        echo -e "${RED}✗${NC} $1 (MISSING)"
        ((errors++))
    fi
}

# Required files from test page perspective (relative to TEMP/)
echo "Required JavaScript files:"
check_file "../assets/js/jotform-cache.js"
check_file "../assets/js/qualtrics-api.js"
check_file "../assets/js/qualtrics-transformer.js"
check_file "../assets/js/data-merger.js"
check_file "../assets/js/task-validator.js"

echo ""
echo "Required asset files (loaded by JS modules):"
check_file "assets/qualtrics-mapping.json"
check_file "assets/tasks/survey-structure.json"

echo ""
echo "Optional files (recommended but not strictly required):"
check_file "../assets/credentials.json"

echo ""
echo "Task definition files:"
task_count=$(ls assets/tasks/*.json 2>/dev/null | wc -l)
echo "  Found $task_count task definition files in assets/tasks/"

echo ""
if [ $errors -eq 0 ]; then
    echo -e "${GREEN}All required files are present!${NC}"
    exit 0
else
    echo -e "${RED}$errors required file(s) missing!${NC}"
    exit 1
fi
