/**
 * Student UI Renderer for 4Set Checking System
 * Populates the student detail page with processed data
 */

class StudentUIRenderer {
    constructor(dataProcessor) {
        this.dataProcessor = dataProcessor;
        this.data = null;
        this.validation = null;
        this.taskVisibility = this.loadTaskVisibility();
    }

    /**
     * Initialize and render the page
     */
    async initialize(coreId) {
        try {
            // Show loading state
            this.showLoading();
            
            // Initialize data processor
            this.data = await this.dataProcessor.initialize(coreId);
            this.validation = this.dataProcessor.getValidation();
            
            // Render all sections
            this.renderBreadcrumb();
            this.renderStudentProfile();
            this.renderTaskOverview();
            this.renderTaskProgress();
            this.applyQuestionFilter('all');
            this.applyTaskVisibility();

            // Hide loading state
            this.hideLoading();
            
            // Initialize icons
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
            
            console.log('[UI] Rendering complete');
        } catch (error) {
            console.error('[UI] Initialization failed:', error);
            this.showError('Failed to load student data: ' + error.message);
        }
    }

    loadTaskVisibility() {
        try {
            const stored = localStorage.getItem('studentTaskVisibility');
            if (!stored) return {};
            return JSON.parse(stored);
        } catch (error) {
            console.warn('[UI] Failed to load task visibility:', error);
            return {};
        }
    }

    saveTaskVisibility() {
        try {
            localStorage.setItem('studentTaskVisibility', JSON.stringify(this.taskVisibility));
        } catch (error) {
            console.warn('[UI] Failed to save task visibility:', error);
        }
    }

    /**
     * Show loading spinner
     */
    showLoading() {
        const main = document.querySelector('main');
        if (main) {
            main.insertAdjacentHTML('afterbegin', `
                <div id="loading-overlay" class="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div class="text-center">
                        <div class="w-12 h-12 border-4 border-[color:var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                        <p class="text-[color:var(--muted-foreground)] text-sm">Loading student data...</p>
                    </div>
                </div>
            `);
            
            // Failsafe: Remove loading overlay after 15 seconds no matter what
            setTimeout(() => {
                const overlay = document.getElementById('loading-overlay');
                if (overlay) {
                    console.warn('[UI] Loading timeout - removing overlay');
                    overlay.remove();
                }
            }, 15000);
        }
    }

    /**
     * Hide loading spinner
     */
    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.remove();
        }
    }

    /**
     * Show error message
     */
    showError(message) {
        this.hideLoading();
        const main = document.querySelector('main');
        if (main) {
            main.innerHTML = `
                <div class="entry-card p-8 text-center border-l-4 border-l-red-500">
                    <i data-lucide="alert-circle" class="w-16 h-16 text-red-500 mx-auto mb-4"></i>
                    <h2 class="text-xl font-semibold text-[color:var(--foreground)] mb-2">Error Loading Data</h2>
                    <p class="text-[color:var(--muted-foreground)] mb-6">${message}</p>
                    <button onclick="location.reload()" class="hero-button btn-primary px-6 py-2 text-sm">
                        Retry
                    </button>
                </div>
            `;
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }
    }

    /**
     * Render breadcrumb navigation
     */
    renderBreadcrumb() {
        const studentName = this.data?.['child-name']?.value || 'Unknown Student';
        const schoolName = this.getSchoolName();
        const district = this.data?.['district']?.value || '未知地區';
        
        const breadcrumbNav = document.querySelector('header nav');
        if (breadcrumbNav) {
            // Update student name in breadcrumb
            const studentSpan = breadcrumbNav.querySelector('span.font-medium');
            if (studentSpan) {
                studentSpan.textContent = studentName;
            }
        }
        
        // Update page title
        document.title = `Student Detail · ${studentName} · 4Set Checking System`;
    }

    /**
     * Render student profile section
     */
    renderStudentProfile() {
        const profileSection = document.querySelector('details summary h2');
        if (!profileSection) return;
        
        const studentName = this.data?.['child-name']?.value || 'Unknown Student';
        profileSection.textContent = `Profile of ${studentName}`;
        
        // Update profile cards
        this.updateProfileCard(0, this.data?.['student-id']?.value || '—', 'St' + (this.data?.['student-id']?.value || '—'));
        this.updateProfileCard(1, 'Gender', this.getGender());
        this.updateProfileCard(2, 'School', this.getSchoolName());
        this.updateProfileCard(3, 'District', this.data?.['district']?.value || '—');
        this.updateProfileCard(4, 'Class (25/26)', this.data?.['class-name']?.value || '—');
        this.updateProfileCard(5, 'Group', this.getGroup());
    }

    /**
     * Update individual profile card
     */
    updateProfileCard(index, label, value) {
        const cards = document.querySelectorAll('details .grid > div');
        if (cards[index]) {
            const valueP = cards[index].querySelector('p:last-child');
            if (valueP) {
                valueP.innerHTML = value;
            }
        }
    }

    /**
     * Render task status overview
     */
    renderTaskOverview() {
        if (!this.validation) return;
        
        const completionRate = parseFloat(this.validation.completionRate);
        const totalQuestions = this.validation.totalQuestions;
        const answeredQuestions = this.validation.answeredQuestions;
        
        // Update completion card
        this.updateMetricCard(0, completionRate.toFixed(1) + '%', 'Completion');
        
        // Update answered card
        this.updateMetricCard(2, `${answeredQuestions} / ${totalQuestions} questions`, 'Answered');
        
        // Update termination status
        const activeTerminations = this.getActiveTerminations();
        this.updateTerminationCard(activeTerminations);
        
        // Update outstanding focus
        this.updateOutstandingFocus();
    }

    /**
     * Update individual metric card
     */
    updateMetricCard(index, value, label) {
        const cards = document.querySelectorAll('details:nth-of-type(2) .grid > div');
        if (cards[index]) {
            const valueSpan = cards[index].querySelector('.text-2xl, .text-sm');
            if (valueSpan) {
                valueSpan.innerHTML = value;
            }
        }
    }

    /**
     * Update termination status card
     */
    updateTerminationCard(activeTerminations) {
        const terminationCard = document.querySelector('details:nth-of-type(2) .grid > div:nth-child(2)');
        if (!terminationCard) return;
        
        const badgeSpan = terminationCard.querySelector('.badge-pill');
        const textSpan = terminationCard.querySelector('span.text-\\[color\\:var\\(--muted-foreground\\)\\]');
        
        if (activeTerminations.length === 0) {
            if (badgeSpan) {
                badgeSpan.className = 'badge-pill bg-emerald-100 text-emerald-700';
                badgeSpan.innerHTML = '<i data-lucide="check" class="w-3 h-3"></i> No active termination';
            }
        } else {
            if (badgeSpan) {
                badgeSpan.className = 'badge-pill bg-amber-100 text-amber-700';
                badgeSpan.innerHTML = `<i data-lucide="alert-triangle" class="w-3 h-3"></i> ${activeTerminations.length} active`;
            }
            if (textSpan) {
                textSpan.textContent = `Last triggered · ${activeTerminations[0]} on ${this.getLatestTerminationDate()}`;
            }
        }
    }

    /**
     * Update outstanding focus
     */
    updateOutstandingFocus() {
        const outstandingCard = document.querySelector('details:nth-of-type(2) .grid > div:nth-child(4)');
        if (!outstandingCard || !this.validation) return;
        
        const incompleteTask = this.getFirstIncompleteTask();
        const focusP = outstandingCard.querySelector('p.mt-1');
        
        if (focusP && incompleteTask) {
            focusP.textContent = incompleteTask;
        }
    }

    /**
     * Render task progress section
     */
    renderTaskProgress() {
        if (!this.validation || !this.validation.tasks) return;
        
        const taskContainer = document.querySelector('details[open] .divide-y');
        if (!taskContainer) return;
        
        // Clear existing mock data
        taskContainer.innerHTML = '';
        
        // Group tasks by set
        const set1Tasks = ['erv', 'sym', 'nonsym', 'theoryofmind', 'chinesewordreading'];
        const set2Tasks = ['tec_female', 'tec_male', 'mathpattern', 'ccm'];
        
        // Render Set 1
        this.renderTaskSet(taskContainer, 'set1', 'Set 1 · 第一組', set1Tasks);
        
        // Render Set 2
        this.renderTaskSet(taskContainer, 'set2', 'Set 2 · 第二組', set2Tasks);
    }

    /**
     * Render a set of tasks
     */
    renderTaskSet(container, setId, setTitle, taskIds) {
        const setHTML = `
            <details class="group" data-set="${setId}">
                <summary class="px-4 py-3 cursor-pointer flex items-center justify-between gap-4 hover:bg-[color:var(--muted)]/30 transition-colors">
                    <div>
                        <h3 class="text-sm font-semibold text-[color:var(--foreground)]">${setTitle}</h3>
                        <p class="text-xs text-[color:var(--muted-foreground)] mt-0.5">${this.getSetDescription(setId)}</p>
                    </div>
                    <div class="flex items-center gap-3 text-xs text-[color:var(--muted-foreground)]" id="${setId}-summary">
                        <!-- Will be populated dynamically -->
                    </div>
                </summary>
                <div class="divide-y divide-[color:var(--border)] bg-[color:var(--muted)]/20" id="${setId}-tasks">
                    <!-- Tasks will be populated here -->
                </div>
            </details>
        `;
        
        container.insertAdjacentHTML('beforeend', setHTML);
        
        // Populate tasks
        const tasksContainer = document.getElementById(`${setId}-tasks`);
        const summaryContainer = document.getElementById(`${setId}-summary`);
        
        let greenCount = 0, yellowCount = 0, redCount = 0, greyCount = 0;
        
        taskIds.forEach(taskId => {
            const taskValidation = this.validation.tasks[taskId];
            if (!taskValidation) {
                greyCount++;
                return;
            }
            
            const taskHTML = this.generateTaskHTML(taskId, taskValidation);
            if (taskHTML) {
                tasksContainer.insertAdjacentHTML('beforeend', taskHTML);
                
                // Count status
                const status = this.getTaskStatus(taskValidation);
                if (status === 'green') greenCount++;
                else if (status === 'yellow') yellowCount++;
                else if (status === 'red') redCount++;
                else greyCount++;
            }
        });
        
        // Update set summary
        let summaryHTML = '';
        if (yellowCount > 0) summaryHTML += `<span class="inline-flex items-center gap-1"><span class="status-circle status-yellow"></span>${yellowCount} post-term</span>`;
        if (redCount > 0) summaryHTML += `<span class="inline-flex items-center gap-1"><span class="status-circle status-red"></span>${redCount} incomplete</span>`;
        if (greenCount > 0) summaryHTML += `<span class="inline-flex items-center gap-1"><span class="status-circle status-green"></span>${greenCount} complete</span>`;
        if (greyCount > 0) summaryHTML += `<span class="inline-flex items-center gap-1"><span class="status-circle status-grey"></span>${greyCount} not started</span>`;
        
        summaryContainer.innerHTML = summaryHTML;
    }

    /**
     * Generate HTML for a single task
     */
    generateTaskHTML(taskId, taskValidation) {
        const taskDef = this.dataProcessor.taskDefinitions[taskId];
        if (!taskDef) return '';
        
        const status = this.getTaskStatus(taskValidation);
        const statusClass = `status-${status}`;
        const terminationInfo = this.validation.termination[taskId];
        
        const html = `
            <details class="task-expand" data-task="${taskId}">
                <summary class="px-4 py-3 grid gap-2 sm:grid-cols-[minmax(0,220px)_minmax(0,200px)_minmax(0,120px)_minmax(0,1fr)] sm:items-center cursor-pointer hover:bg-white/60 transition-colors">
                    <div class="flex items-center gap-2">
                        <span class="status-circle ${statusClass}" title="${this.getStatusTitle(status)}"></span>
                        <strong class="text-[color:var(--foreground)] text-sm">${taskDef.title || taskId}</strong>
                    </div>
                    <div class="flex flex-wrap items-center gap-1 text-xs">
                        ${this.generateTerminationChips(terminationInfo)}
                    </div>
                    <span class="text-xs text-[color:var(--muted-foreground)] font-mono">${taskValidation.answeredQuestions} / ${taskValidation.totalQuestions}</span>
                    <div class="flex flex-wrap gap-2 text-xs text-[color:var(--muted-foreground)] sm:justify-end">
                        ${this.generateStatusBadge(status, taskValidation)}
                        <span>Updated · ${this.getTaskLastUpdate(taskId)}</span>
                    </div>
                </summary>
                <div class="bg-white/80 border-t border-[color:var(--border)] px-4 py-3 space-y-3">
                    ${this.generateTaskDetails(taskId, taskValidation, terminationInfo)}
                </div>
            </details>
        `;
        
        return html;
    }

    applyQuestionFilter(filterValue = 'all') {
        const tables = document.querySelectorAll('table tbody tr[data-state]');
        tables.forEach(row => {
            const state = row.getAttribute('data-state');
            let show = true;

            switch (filterValue) {
                case 'correct':
                    show = state === 'correct';
                    break;
                case 'incorrect':
                    show = state === 'incorrect';
                    break;
                case 'missing':
                    show = row.getAttribute('data-missing') === 'true';
                    break;
                case 'completed':
                    show = state === 'correct' || state === 'incorrect';
                    break;
                case 'all':
                default:
                    show = true;
                    break;
            }

            row.style.display = show ? '' : 'none';
        });

        console.log('[UI] Question filter applied:', filterValue);
    }

    applyTaskVisibility() {
        const visibleTasks = this.taskVisibility || {};
        const taskDetails = document.querySelectorAll('details.task-expand');
        taskDetails.forEach(detail => {
            const taskId = detail.getAttribute('data-task');
            const isHidden = visibleTasks && visibleTasks[taskId] === false;
            detail.style.display = isHidden ? 'none' : '';
        });

        const setDetails = document.querySelectorAll('details.group');
        setDetails.forEach(setDetail => {
            const tasks = setDetail.querySelectorAll('details.task-expand');
            const hasVisibleTask = Array.from(tasks).some(task => task.style.display !== 'none');
            setDetail.style.display = hasVisibleTask ? '' : 'none';
        });
    }

    openTaskConfig() {
        const modal = document.getElementById('task-config-modal');
        if (!modal) return;

        const list = document.getElementById('task-config-list');
        if (list) {
            list.innerHTML = '';
            const tasks = this.validation?.tasks || {};
            Object.keys(tasks).forEach(taskId => {
                const taskDef = this.dataProcessor.taskDefinitions[taskId] || {};
                const checked = this.taskVisibility[taskId] !== false;
                list.insertAdjacentHTML('beforeend', `
                    <label class="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--border)] bg-white px-3 py-2 text-sm">
                        <span class="font-medium text-[color:var(--foreground)]">${taskDef.title || taskId}</span>
                        <input type="checkbox" data-task-id="${taskId}" ${checked ? 'checked' : ''} class="accent-[color:var(--primary)]">
                    </label>
                `);
            });
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');

        const closeModal = () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        };

        const closeButton = document.getElementById('task-config-close');
        const cancelButton = document.getElementById('task-config-cancel');
        const applyButton = document.getElementById('task-config-apply');

        if (closeButton) closeButton.onclick = closeModal;
        if (cancelButton) cancelButton.onclick = closeModal;
        if (applyButton) {
            applyButton.onclick = () => {
                const checkboxes = list.querySelectorAll('input[type="checkbox"]');
                checkboxes.forEach(cb => {
                    this.taskVisibility[cb.dataset.taskId] = cb.checked;
                });
                this.saveTaskVisibility();
                this.applyTaskVisibility();
                closeModal();
            };
        }
    }

    /**
     * Generate termination chips
     */
    generateTerminationChips(terminationInfo) {
        if (!terminationInfo || !terminationInfo.rules) {
            return '<span class="stage-chip">No termination</span>';
        }
        
        return terminationInfo.rules.map(rule => {
            const isTriggered = rule.triggered === true;
            const chipClass = isTriggered ? 'stage-chip highlight' : 'stage-chip';
            const label = rule.ruleId.replace(/_/g, ' ');
            return `<span class="${chipClass}">${label} · ${isTriggered ? 'Y' : 'N'}</span>`;
        }).join('');
    }

    /**
     * Generate status badge
     */
    generateStatusBadge(status, taskValidation) {
        const badges = {
            green: '<span class="answer-pill correct"><i data-lucide="check" class="w-3.5 h-3.5"></i>Complete</span>',
            yellow: '<span class="answer-pill correct"><i data-lucide="badge-check" class="w-3.5 h-3.5"></i>Post-termination responses</span>',
            red: '<span class="answer-pill incorrect"><i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i>Incomplete</span>',
            grey: '<span class="answer-pill incorrect"><i data-lucide="circle" class="w-3.5 h-3.5"></i>Not started</span>'
        };
        
        return badges[status] || '';
    }

    /**
     * Generate task details (termination checklist + question table)
     */
    generateTaskDetails(taskId, taskValidation, terminationInfo) {
        let html = '';
        
        // Termination checklist
        if (terminationInfo && terminationInfo.rules && terminationInfo.rules.length > 0) {
            html += `
                <div class="flex flex-col gap-2">
                    <span class="text-xs font-semibold text-[color:var(--primary)] uppercase tracking-wide">Termination checklist · ${taskId.toUpperCase()}</span>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        ${terminationInfo.rules.map(rule => `
                            <div class="border border-[color:var(--border)] rounded-lg p-2 bg-white shadow-sm">
                                <p class="font-medium text-[color:var(--foreground)]">${rule.ruleId}</p>
                                <p class="text-[color:var(--muted-foreground)] mt-0.5">${rule.range} (≥${rule.threshold} needed)</p>
                                <p class="text-xs mt-1">Status: ${rule.correctCount}/${rule.total} correct</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        
        // Question table
        if (taskValidation.questions && taskValidation.questions.length > 0) {
            html += `
                <div class="overflow-x-auto">
                    <table class="min-w-full text-sm">
                        <thead class="text-xs text-[color:var(--muted-foreground)] uppercase bg-[color:var(--muted)]/60">
                            <tr>
                                <th class="text-left font-medium pb-2 px-2">Question</th>
                                <th class="text-left font-medium pb-2 px-2">Student Answer</th>
                                <th class="text-left font-medium pb-2 px-2">Correct Answer</th>
                                <th class="text-left font-medium pb-2 px-2">Result</th>
                                <th class="text-left font-medium pb-2 px-2">Last Updated</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-[color:var(--border)]">
                            ${taskValidation.questions.map(q => `
                                <tr data-state="${q.isCorrect ? 'correct' : 'incorrect'}" class="hover:bg-[color:var(--muted)]/30">
                                    <td class="py-2 px-2 text-[color:var(--foreground)] font-mono">${q.id}</td>
                                    <td class="py-2 px-2 text-[color:var(--muted-foreground)]">${q.studentAnswer || '—'}</td>
                                    <td class="py-2 px-2 text-[color:var(--muted-foreground)]">${q.correctAnswer || '—'}</td>
                                    <td class="py-2 px-2">${q.isCorrect 
                                        ? '<span class="answer-pill correct"><i data-lucide="check" class="w-3 h-3"></i>Correct</span>'
                                        : '<span class="answer-pill incorrect"><i data-lucide="x" class="w-3 h-3"></i>Incorrect</span>'
                                    }</td>
                                    <td class="py-2 px-2 text-xs text-[color:var(--muted-foreground)]">${this.formatDateTime(q.sessionKey)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        return html;
    }

    // Helper methods
    getSchoolName() {
        return this.data?.['school-id']?.value || 'Unknown School';
    }

    getGender() {
        // Extract from data or infer from TEC version
        return 'F'; // Placeholder
    }

    getGroup() {
        return this.data?.['group']?.value || '—';
    }

    getTaskStatus(taskValidation) {
        if (!taskValidation || taskValidation.answeredQuestions === 0) return 'grey';
        
        // Post-term detection or termination mismatch (yellow): Data quality issue
        // Yellow indicates EITHER post-termination activity OR termination mismatch
        if (taskValidation.hasPostTerminationAnswers) return 'yellow';
        
        // Complete (green): All questions answered
        if (taskValidation.answeredQuestions === taskValidation.totalQuestions) {
            return 'green';
        }
        
        // Complete (green): Properly terminated with at least 1 answer
        if (taskValidation.terminated && taskValidation.answeredQuestions > 0) {
            return 'green';
        }
        
        // Complete (green): Properly timed out with at least 1 answer
        if (taskValidation.timedOut && taskValidation.answeredQuestions > 0) {
            return 'green';
        }
        
        // Incomplete (red): Started but not complete
        if (taskValidation.answeredQuestions > 0) return 'red';
        
        // Not started (grey): No answers yet
        return 'grey';
    }

    getStatusTitle(status) {
        const titles = {
            green: 'Complete',
            yellow: 'Post-termination activity or termination mismatch',
            red: 'Incomplete',
            grey: 'Not started'
        };
        return titles[status] || '';
    }

    getActiveTerminations() {
        if (!this.validation || !this.validation.termination) return [];
        
        const active = [];
        Object.values(this.validation.termination).forEach(term => {
            if (term.activeTerminations && term.activeTerminations.length > 0) {
                active.push(...term.activeTerminations);
            }
        });
        
        return active;
    }

    getLatestTerminationDate() {
        // Extract from session keys
        return '2025-10-05'; // Placeholder
    }

    getFirstIncompleteTask() {
        if (!this.validation || !this.validation.tasks) return 'None';
        
        for (const [taskId, taskData] of Object.entries(this.validation.tasks)) {
            if (taskData.answeredQuestions < taskData.totalQuestions) {
                return `${taskData.title} (${taskData.answeredQuestions}/${taskData.totalQuestions})`;
            }
        }
        
        return 'All tasks complete';
    }

    getSetDescription(setId) {
        const descriptions = {
            set1: 'ERV 英語詞彙 · SYM / NONSYM (符號/非符號關係) · Theory of Mind 心理理論 · 中文詞語閱讀',
            set2: 'Math Pattern 數學模式 · CCM 改錯字遊戲 · 情緒劇場 TEC（女 / 男）'
        };
        return descriptions[setId] || '';
    }

    getTaskLastUpdate(taskId) {
        // Get latest session key for this task
        return '2025-10-08 11:45'; // Placeholder
    }

    formatDateTime(sessionKey) {
        if (!sessionKey) return '—';
        // Extract from sessionKey format: coreid_yyyymmdd_hh_mm
        const parts = sessionKey.split('_');
        if (parts.length < 4) return sessionKey;
        
        const dateStr = parts[parts.length - 3];
        const hour = parts[parts.length - 2];
        const min = parts[parts.length - 1];
        
        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6);
        const day = dateStr.substring(6, 8);
        
        return `${year}-${month}-${day} ${hour}:${min}`;
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StudentUIRenderer;
}
