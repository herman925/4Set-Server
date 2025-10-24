# 4Set System Development Agenda

**Project:** KeySteps@JC (Phase Two) - 4Set System 2025/26  
**Organization:** The Education University of Hong Kong  
**Last Updated:** October 2025

---

## Executive Summary

The 4Set System is a comprehensive web-based assessment data processing pipeline that automates the collection, validation, processing, and monitoring of educational survey data. It replaces legacy desktop workflows with an unsupervised, cloud-integrated solution that handles PDF form uploads, data validation, enrichment, and submission to JotForm while providing real-time monitoring dashboards for quality assurance.

### Key Objectives
1. **Automated Pipeline**: Eliminate manual intervention in PDF processing workflow
2. **Data Quality**: Enforce validation rules and detect inconsistencies automatically
3. **Real-Time Monitoring**: Provide live dashboards for upload status and data completeness
4. **Security First**: Maintain AES-256-GCM encryption for all sensitive data
5. **Scalability**: Process 20+ PDFs per minute with minimal resource requirements

---

## System Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      OneDrive (Cloud Storage)                    │
│                  Shared Upload Folder + Sync                     │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│               Processor Agent (Windows/Synology)                 │
│  • File Watcher (Debounced)                                     │
│  • Two-Phase Validation                                          │
│  • PDF Parsing & Field Extraction                               │
│  • Data Enrichment & Termination Calculation                    │
│  • JotForm Upload with Retry Logic                              │
│  • Filing Protocol (Success → schoolId / Failure → Unsorted)    │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    JotForm (Cloud Database)                      │
│              Submission Storage & Management                     │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              Monitoring Dashboard (GitHub Pages)                 │
│  • Upload Status & Queue Health                                 │
│  • Checking System (Data Completeness Validation)               │
│  • Multi-Level Drilldowns (District→School→Class→Student)       │
│  • Rejection & Error Reporting                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. Processor Agent (`processor_agent.ps1`)
**Purpose**: Autonomous Windows/Synology service for PDF ingestion and processing

**Capabilities**:
- **Folder Watcher**: Monitors OneDrive sync folder with debounce logic
- **Phase 1 Validation**: Filename format verification (`xxxxx_YYYYMMDD_HH_MM.pdf`)
- **Phase 2 Validation**: Cross-field consistency via encrypted mappings
- **PDF Parser Integration**: Extracts form fields using Python tools
- **Data Enrichment**: Adds sessionkey, computerno, child-name, class-id
- **Termination Calculation**: Applies threshold rules (ERV, CM, CWR, FM)
- **Data Overwrite Protection**: Prevents accidental data corruption on re-uploads
  - Validates that existing assessment answers won't be overwritten
  - Exception list allows administrative fields to be updated
  - Conflicts logged with `DATA_OVERWRITE_DIFF` and filed to Unsorted/
- **JotForm Upload**: Idempotent upsert with exponential backoff retry
- **Filing Protocol**: Archives to `schoolId/` or `Unsorted/` folder
- **Telemetry API**: Exposes queue status via localhost:48500

**Configuration**:
- `config/agent.json` - Path resolution, polling, logging
- `config/jotform_config.json` - Rate limits, retry schedules, log levels
- `config/host_identity.json` - Computer number override (optional)

#### 2. Upload Interface (`upload.html`)
**Purpose**: Web-based drag-and-drop PDF submission interface

**Features**:
- Multi-file drag-and-drop support
- Real-time upload progress tracking
- OneDrive integration for file staging
- Browser-based PDF validation
- Session management and error handling

#### 3. Checking System (`checking_system_*.html`)
**Purpose**: Multi-level data quality and completeness monitoring

**Views**:
- **Home Dashboard**: System-wide statistics and recent activity
- **District View**: Aggregate completion by geographic region
- **Group View**: Project group performance metrics
- **School View**: Individual school progress tracking
- **Class View**: Per-class completion heatmaps
- **Student View**: Detailed task validation with answer verification

**Validation Functions**:
- **Display Uploaded Data**: Show exactly what was submitted to JotForm
- **Recalculate & Validate**: Compare administrator records vs. system calculations
- **Missing Data Detection**: Identify unanswered questions and incomplete tasks
- **Termination Rule Verification**: Flag mismatches between recorded and calculated terminations
- **Visual Indicators**: ✅ Verified, ⚠️ Mismatch, 🔴 Terminated, ⚪ Missing

#### 4. Parser Module (`parser/`)
**Purpose**: PDF field extraction and JSON generation

**Components**:
- `parse_pdf_cli.py` - Command-line interface for parsing
- `pdf_tools.py` - Core extraction engine using pypdf/PyPDF2
- Field mapping via `assets/jotformquestions.json`
- Score helper extraction (`_Sc` fields for termination calculation)

---

## Development Roadmap

### ✅ Phase 1: Foundation (Completed)
- [x] Design system architecture and component interactions
- [x] Create comprehensive PRD documentation suite
- [x] Implement AES-256-GCM encryption for sensitive assets
- [x] Build processor agent with file watcher and validation pipeline
- [x] Develop PDF parser with field extraction and mapping
- [x] Implement two-phase validation (filename + cross-field)

### ✅ Phase 2: Core Pipeline (Completed)
- [x] Data enrichment engine (sessionkey, computerno, class-id)
- [x] Termination rule calculation (ERV, CM, CWR, FM)
- [x] JotForm integration with upsert workflow
- [x] Retry logic with exponential backoff and jitter
- [x] Filing protocol (success → schoolId, failure → Unsorted)
- [x] Queue manifest for restart recovery

### ✅ Phase 3: Monitoring & Quality Assurance (Completed)
- [x] Upload status API and telemetry endpoints
- [x] Checking System dashboard suite
- [x] Multi-level drilldowns (5 levels: district → student)
- [x] Task completion calculation logic
- [x] Termination rule validation and mismatch detection
- [x] Visual status indicators and filtering
- [x] **Radio_text validation with priority-based scoring (Oct 2025)**
- [x] **_TEXT field display support for ToM questions (Oct 2025)**
- [x] **Gender branching verification across all pages (Oct 2025)**
- [x] **Adaptive batch sizing documentation (Oct 2025)**
- [x] **Comprehensive PRDs/calculation_bible.md updates (Oct 2025)**

### 🔄 Phase 4: Production Deployment (In Progress)
- [x] Upload interface with drag-and-drop support
- [x] OneDrive auto-detection and path resolution
- [x] Host identity configuration for containers
- [ ] **Windows Service installation and configuration**
- [ ] **Synology Docker container deployment**
- [ ] **Production credential management setup**
- [ ] **Rate limiting and performance tuning**
- [ ] **Logging infrastructure and rotation**

### 📋 Phase 5: Operational Excellence (Planned)
- [ ] Automated alert system for upload failures
- [ ] Batch processing optimization for large uploads
- [ ] Historical trend analysis and reporting
- [ ] API documentation and developer guides
- [ ] Operator training materials and SOPs
- [ ] Disaster recovery and backup procedures
- [ ] Performance benchmarking and optimization
- [ ] Security audit and penetration testing

### 🔮 Phase 6: Future Enhancements (Backlog)
- [ ] Real-time Server-Sent Events for dashboard updates
- [ ] Advanced filtering and search capabilities
- [ ] Data export and report generation tools
- [ ] Integration with additional data sources (Qualtrics, Supabase)
- [ ] Mobile-responsive dashboard improvements
- [ ] Automated data quality scoring
- [ ] Machine learning for error prediction
- [ ] API rate limiting management dashboard

---

## Current Priorities

### High Priority (Immediate Action Required)
1. **Production Deployment Testing**
   - Validate Windows Service installation on target machines
   - Test Synology Docker container with Cloud Sync integration
   - Verify OneDrive path resolution across environments

2. **Credential Management**
   - Set up Windows Credential Manager entries on production machines
   - Configure DSM Docker Secrets for Synology deployment
   - Test credential rotation procedures

3. **Performance Validation**
   - Benchmark PDF processing throughput (target: 20/min)
   - Test JotForm rate limiting with concurrent uploads
   - Validate retry logic under various failure scenarios

### Medium Priority (Next 2-4 Weeks)
1. **Operational Procedures**
   - Document service installation and configuration
   - Create troubleshooting guides for common issues
   - Establish monitoring and alerting workflows

2. **Quality Assurance**
   - Comprehensive testing of termination rule calculations
   - Validation of cross-field mapping consistency
   - End-to-end data integrity verification

3. **Documentation Enhancement**
   - API documentation for telemetry endpoints
   - Configuration guide for all JSON files
   - Security best practices handbook

### Low Priority (Future Iterations)
1. **Feature Enhancements**
   - Advanced analytics and reporting
   - Bulk data operations and batch management
   - Enhanced search and filtering capabilities

2. **Platform Extensions**
   - Additional data source integrations
   - Mobile app development
   - Automated quality scoring

---

## Technical Decisions

### Architecture Choices

#### PowerShell 7+ for Processor Agent
**Decision**: Use PowerShell 7 instead of Python or Node.js  
**Rationale**:
- Native AES-GCM support via System.Security.Cryptography
- Excellent Windows integration (Credential Manager, registry, environment)
- Built-in file system watcher capabilities
- Cross-platform support (Windows + Synology via Docker)

#### Static GitHub Pages for Dashboard
**Decision**: Use static HTML/JS hosted on GitHub Pages  
**Rationale**:
- Zero hosting costs
- No server maintenance overhead
- Fast global CDN delivery
- Version control integration
- Simple deployment workflow

#### JotForm as Primary Database
**Decision**: Store submissions in JotForm instead of self-hosted DB  
**Rationale**:
- No database administration overhead
- Built-in form management and validation
- Native API with good rate limits
- Existing organizational subscription
- Reduced security attack surface

#### Flask Proxy for Local Development CORS
**Decision**: Use Flask (Python) proxy server instead of Node.js for local development  
**Date**: October 22, 2025  
**Rationale**:
- **Ecosystem Alignment**: Project already uses Python (parser/, upload.py, requirements.txt)
- **Zero New Dependencies**: Users already have Python installed for PDF parsing
- **Cross-Platform**: Flask works on Windows, Linux, macOS with consistent behavior
- **Production Simplicity**: Proxy only needed for localhost - GitHub Pages works directly
- **One-Click Startup**: Batch/shell scripts (`start_dev.bat`, `start_dev.sh`) auto-install deps and open browser
- **Auto-Detection**: JavaScript code automatically switches between proxy (local) and direct API (production)

**Alternative Considered**: Node.js + Express proxy  
**Why Rejected**: Would introduce new runtime dependency (Node.js) to an otherwise Python-based project

**Implementation**:
- `proxy_server.py` - Flask app with CORS headers, routes `/api/jotform/*` to `api.jotform.com`
- `jotform-cache.js` - Auto-detects hostname and uses `http://localhost:3000/api/jotform` locally
- `requirements.txt` - Added Flask, Flask-CORS, requests to existing pypdf dependency

#### Adaptive Batch Sizing for JotForm Fetches
**Decision**: Implement adaptive batch sizing for browser-based JotForm data fetching  
**Date**: October 22, 2025  
**Rationale**:
- **JotForm API Bug**: Large responses (1000 records = ~4.16 MB) get truncated mid-JSON at character 4,361,577
- **Dynamic Response**: Automatically reduces batch size on errors (504 timeout, JSON parse errors)
- **Gradual Recovery**: Increases batch size after consecutive successes (like processor_agent.ps1)
- **Configurable**: All settings in `config/jotform_config.json` for easy adjustment

**Discovery Process**:
- Test 1-3 (10 records, form access, basic API): ✅ Pass
- Test 4 (1000 records): ❌ Fail - JSON truncated at 4.16 MB
- Test 5 (100 records): ✅ Pass - Recommended production size

**Implementation** (mirrors `processor_agent.ps1` adaptive chunk sizing):
- `config/jotform_config.json` - Added `webFetch` section with batch size reductions `[1.0, 0.5, 0.3, 0.2, 0.1]`
- `jotform-cache.js` - Adaptive fetch loop with:
  - **Fall-off on error**: Reduces batch size by stepping through reduction array
  - **Gradual increase**: After 2 consecutive successes, increases one step
  - **Min/max bounds**: Enforces `minBatchSize: 10`, `maxBatchSize: 500`
- `TEMP/test_jotform_api.py` - Diagnostic tool to test JotForm API health (10/100/1000 record tests)

**Behavior**:
```
Start: 100 records/batch → Success
  ↓
2 successes → Try 100 (baseline)
  ↓
Error (504/truncation) → Reduce to 50 (50%)
  ↓
Success → Success → Try 100 again (gradual increase)
```

### Data Flow Principles

#### Absolute Certainty Principle for Terminations
Termination values are calculated **only when mathematically certain**:
- Set `"0"` (continued) if: `correct ≥ threshold` (already passed)
- Set `"1"` (terminated) if: `correct + unanswered < threshold` (impossible to pass)
- Otherwise: **Don't set** - still possible to pass with remaining questions

This ensures we never incorrectly mark terminations based on incomplete data.

#### Upsert-by-SessionKey Pattern
All JotForm uploads use `sessionkey` as the unique identifier:
1. Search for existing submission by sessionkey
2. Update if found (excluding immutable sessionkey field)
3. Create new submission if not found (including sessionkey)
4. Write back jotformsubmissionid to local JSON

This ensures idempotency and prevents duplicate submissions.

#### Failed Upload Handling Strategy
Files with failed uploads after retry exhaustion:
- Automatically filed to `Unsorted/` folder
- Logs contain complete error details
- Empty `jotformsubmissionid` field serves as detection flag
- Operators can identify and retry manually

---

## Security Architecture

### Encryption Standards
- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Derivation**: PBKDF2-SHA256, 100,000 iterations, 16-byte salt
- **IV Generation**: 12-byte random IV per encryption operation
- **Bundle Format**: `[16B salt][12B IV][N-B ciphertext][16B auth tag]`

### Protected Assets
1. **credentials.enc** - API keys, system password, service tokens
2. **coreid.enc** - Student ID mappings (Core ID → School, Class, Name)
3. **schoolid.enc** - School metadata (ID → Name, District, Group)
4. **classid.enc** - Class mappings (Class ID → Actual Class Name)

### Access Controls
- **System Password**: Stored in OS-protected keystores (Windows Credential Manager / DSM Docker Secrets)
- **In-Memory Only**: Secrets decrypted on demand, never written to disk in plaintext
- **Buffer Clearing**: Cryptographic buffers wiped after use
- **HTTPS Only**: All API communications over TLS
- **Loopback Binding**: Telemetry API restricted to localhost

### Credential Rotation Procedures
Documented in `PRDs/processor_agent_runbook_prd.md`:
1. Generate new credentials.json with updated keys
2. Encrypt using latest systemPassword
3. Deploy new credentials.enc to production
4. Restart processor agent services
5. Verify successful decryption in logs
6. Archive old credentials with timestamp

---

## Configuration Reference

### Agent Configuration (`config/agent.json`)
```json
{
  "oneDrive": {
    "autoDetect": true,
    "relativePath": "\\The Education University of Hong Kong\\...",
    "fallbackRoot": "C:\\Users\\[Username]"
  },
  "watchFolders": ["incoming"],
  "pollingIntervalSeconds": 5,
  "maxConcurrentWorkers": 2,
  "logRetentionDays": 30
}
```

### JotForm Configuration (`config/jotform_config.json`)
```json
{
  "maxConcurrent": 2,
  "batchSize": 25,
  "perMinuteQuota": 120,
  "retryScheduleSeconds": [10, 30, 90],
  "burstCooldownSeconds": 60
}
```

### Host Identity Override (`config/host_identity.json`)
```json
{
  "computerno": "095",
  "hostName": "KS095"
}
```
*Note: Optional - used for Synology/containers where $env:COMPUTERNAME unavailable*

---

## Performance Metrics

### Target KPIs
- **Processing Throughput**: ≥ 20 PDFs/minute (validated environment)
- **Upload Success Rate**: ≥ 99% (including retries)
- **Validation Pass Rate**: ≥ 95% (well-formed submissions)
- **Dashboard Latency**: < 5 seconds (near real-time updates)
- **Queue Recovery Time**: < 60 seconds (after service restart)

### Current Status
- **Processor Agent**: ✅ Production-ready
- **Upload Interface**: ✅ Functional
- **Checking System**: ✅ Fully operational
- **OneDrive Integration**: ✅ Auto-detection working
- **JotForm API**: ✅ Upsert workflow stable
- **Telemetry API**: ✅ Endpoints responding

---

## Operational Procedures

### Daily Operations
1. **Morning Health Check**
   - Verify processor agent service is running
   - Check OneDrive sync status (green checkmark)
   - Review dashboard for overnight uploads
   - Clear any files in `Unsorted/` folder

2. **Upload Processing**
   - Monitor queue via telemetry API or status JSON
   - Investigate rejections with detailed logs
   - Retry failed uploads after fixing issues
   - Verify data completeness in Checking System

3. **End-of-Day Review**
   - Check upload success rates and error patterns
   - Review daily CSV logs for anomalies
   - Back up queue manifest and critical logs
   - Update operational log with issues/resolutions

### Weekly Maintenance
- Review and archive old log files
- Check disk space on filing directories
- Validate encrypted asset integrity (SHA-256 hashes)
- Test credential rotation procedures (dry run)

### Monthly Tasks
- Performance benchmarking and trend analysis
- Security audit of access logs
- Update documentation for process changes
- Stakeholder reporting on completion rates

---

## Troubleshooting Guide

### Common Issues

#### Agent Not Processing Files
**Symptoms**: Files accumulate in `incoming/` folder  
**Diagnosis**:
1. Check service status: `Get-Service -Name "4SetProcessor"`
2. Verify OneDrive sync: Look for green checkmarks
3. Review logs: `logs/YYYYMMDD_processing_agent.csv`

**Solutions**:
- Restart service if hung
- Verify OneDrive path resolution in logs
- Check file permissions on processing directories

#### Upload Failures
**Symptoms**: Files moved to `Unsorted/` folder  
**Diagnosis**:
1. Check JSON for empty `jotformsubmissionid`
2. Search logs by sessionkey for error details
3. Verify JotForm API rate limits not exceeded

**Solutions**:
- Wait for rate limit cooldown (60+ seconds)
- Retry manually after fixing data issues
- Check network connectivity to JotForm API

#### Validation Rejections
**Symptoms**: Files rejected with reason codes  
**Diagnosis**:
1. Review rejection reason in logs
2. Check PDF filename format
3. Verify student ID exists in coreid.enc

**Common Rejection Codes**:
- `pdf_extraction_failed` - Corrupted PDF or parsing error
- `coreid_missing_in_mapping` - Student not in database
- `coreid_schoolid_mismatch` - School IDs don't match

**Solutions**:
- Re-scan PDF with correct settings
- Add missing student to coreid.enc and re-encrypt
- Verify correct school ID in PDF form

#### Checking System Mismatches
**Symptoms**: Orange warning icons (⚠️) in dashboard  
**Diagnosis**:
1. Compare "Recorded" vs "Calculated" termination values
2. Review actual question responses
3. Check for missing or incorrect answer data

**Solutions**:
- If calculation is correct: Update PDF and re-upload
- If data is missing: Complete assessment and re-submit
- If edge case: Document and escalate to development team

---

## Development Guidelines

### Code Standards
- **PowerShell**: Follow PSScriptAnalyzer recommendations
- **JavaScript**: ES6+ with strict mode enabled
- **Python**: PEP 8 compliant, type hints where applicable
- **HTML/CSS**: Semantic markup, Tailwind CSS utilities

### Test Environment Isolation
**CRITICAL REQUIREMENT**: Test environment files **must always be isolated** from production checking system files.

#### Isolation Principles
1. **Separate Test Files**: Test pages and utilities must use test-specific versions of shared modules
   - Example: `TEMP/task-validator-test.js` instead of `assets/js/task-validator.js`
   - Example: `TEMP/jotform-cache-test.js` instead of `assets/js/jotform-cache.js`

2. **Dedicated Test Assets**: All supporting files (JSON, configuration) must be copied to test directories
   - Test task definitions: `TEMP/assets/tasks/*.json` (16 files)
   - Test mappings and configurations isolated in `TEMP/` folder

3. **No Production File Modification**: Test code must never modify or depend on production checking system files
   - Prevents accidental corruption of production validation logic
   - Ensures test changes don't impact live monitoring dashboards
   - Maintains clear separation of concerns

4. **Documentation Requirements**: All test-specific files must be clearly marked
   - Comments indicating "TEST VERSION" at the top of files
   - README files explaining the isolation strategy
   - Maintenance instructions for syncing test files when production changes

#### Implementation Example
```javascript
// ❌ INCORRECT - Test file loading production validator
<script src="../assets/js/task-validator.js"></script>

// ✅ CORRECT - Test file loading isolated test validator
<script src="task-validator-test.js"></script>
```

#### Benefits
- **Safety**: Production system remains stable during testing
- **Independence**: Tests can be modified without affecting production
- **Clarity**: Clear distinction between test and production code
- **Maintainability**: Easier to track test-specific changes

### Testing Requirements
- Unit tests for all data transformation functions
- Integration tests for end-to-end pipeline flows
- Security tests for encryption/decryption workflows
- Performance tests for throughput benchmarks
- **Test isolation compliance**: All test files must follow isolation principles above

### Git Workflow
- Feature branches: `feature/description`
- Bug fixes: `fix/issue-number`
- Documentation: `docs/topic`
- Pull requests require review before merge
- Commit messages follow conventional commits format

### Deployment Process
1. Test changes in development environment
2. Update relevant documentation (PRDs, README, Agent)
3. Create pull request with detailed description
4. Code review by at least one team member
5. Merge to main branch
6. Deploy to production with rollback plan
7. Monitor for 24 hours post-deployment

---

## Support & Resources

### Documentation
- **PRDs/** - Detailed product requirement documents
- **README.md** - Quick start guide and technical overview
- **Agent.md** - This file (roadmap and strategic planning)

### Key PRD Files
- `overview_prd.md` - System architecture and user journeys
- `processor_agent_prd.md` - Agent specification and requirements
- `checking_system_prd.md` - Quality assurance and validation rules
- `data_security_prd.md` - Encryption and credential management
- `termination-rules.md` - Assessment termination logic
- `upload_monitoring_prd.md` - Upload failure detection and retry

### External References
- JotForm API Documentation: https://api.jotform.com/docs/
- PowerShell 7 Docs: https://docs.microsoft.com/powershell/
- Synology DSM Guide: https://www.synology.com/en-us/dsm

### Contact & Escalation
- **Development Team**: Technical issues and feature requests
- **Security Engineering**: Credential issues and security incidents
- **Project Maintainers**: Strategic decisions and priority changes
- **End Users**: Training requests and operational support

---

## Changelog

### October 2025 - Initial Release & Phase 3 Enhancements
- Completed core processor agent with full pipeline
- Deployed checking system with 5-level drilldowns
- Implemented upload interface with drag-and-drop
- Established security architecture and encryption standards
- Created comprehensive documentation suite

**Phase 3 Enhancements (October 22, 2025):**
- ✅ **Data Overwrite Protection**: Implemented conflict detection for update operations
  - Prevents accidental data corruption from re-uploaded PDFs
  - Exception list allows administrative fields (student-id, child-name, etc.) to be updated
  - Protected fields (assessment answers) reject overwrites of existing non-empty values
  - Conflicts logged with `DATA_OVERWRITE_DIFF` level and filed to Unsorted/
  - Comprehensive test suite: `tools/test_data_overwrite_protection.ps1` (10/10 tests passing)
  - Performance impact: < 1% (uses existing search result, no additional API calls)
- ✅ **Radio_text Validation Logic**: Implemented priority-based scoring for ToM questions
  - If correct answer picked → CORRECT (text field ignored as mistyped input)
  - If other option OR text filled → INCORRECT
  - Comprehensive test suite with 100% pass rate
- ✅ **_TEXT Field Display Support**: New feature for Theory of Mind questions
  - Display text answers with smart status indicators (N/A, Answered, Not answered, —)
  - "Not answered" status ONLY appears when radio answer is incorrect
  - _TEXT fields NEVER counted in completion percentage
  - 4-state status system with contextual display
- ✅ **Gender Branching Verification**: Documented across all drilldown pages
  - TEC_Male/TEC_Female conditional logic verified
  - Gender normalization (M→male, F→female) across all hierarchy levels
- ✅ **Adaptive Batch Sizing**: Comprehensive documentation
  - JotForm API bug documentation (4.16 MB truncation)
  - Fall-off on error, gradual recovery algorithm
  - Configuration parameters and testing methodology
- ✅ **Calculation Bible Updates**: Major documentation enhancements
  - Added 5 new sections (~350 lines)
  - Radio-text validation with examples
  - Text display fields with status rules
  - Gender branching implementation
  - JotForm caching architecture
  - Adaptive batch sizing algorithm
- ✅ **Test Scripts**: Created comprehensive validation test suite
  - `TEMP/test_radio_text_validation.py` - 6/6 tests passing
  - `TEMP/test_text_field_display.py` - 6/6 tests passing
  - Visual mockup: `TEMP/text_field_display_example.html`

### Future Updates
This section will track major system updates, feature additions, and architectural changes as they occur.

---

## Appendix

### Glossary
- **Session Key**: Unique identifier for each assessment submission (`xxxxx_YYYYMMDD_HH_MM`)
- **Core ID**: Student identifier format (`C#####`)
- **School ID**: School identifier format (`S###`)
- **Termination**: Early assessment exit based on threshold rules
- **Upsert**: Update existing record or insert new if not found
- **Debounce**: Delay processing until file modifications stabilize

### Acronyms
- **AES-GCM**: Advanced Encryption Standard - Galois/Counter Mode
- **API**: Application Programming Interface
- **CSV**: Comma-Separated Values
- **DSM**: DiskStation Manager (Synology OS)
- **IV**: Initialization Vector
- **JSON**: JavaScript Object Notation
- **PBKDF2**: Password-Based Key Derivation Function 2
- **PDF**: Portable Document Format
- **PRD**: Product Requirements Document
- **QID**: Question ID (JotForm field identifier)
- **SHA**: Secure Hash Algorithm
- **SOP**: Standard Operating Procedure
- **TLS**: Transport Layer Security

---

**Document Status**: Active - Regularly updated to reflect current priorities and system state  
**Next Review Date**: November 2025 (Monthly review cycle)
