import { switchView, loadCircleInfo, loadMyCirclesData, loadPatientsData, loadFeedbackData, loadConversationsData, loadServerLogs, loadBusinessData, loadBusinessSectionData } from './dataLoaders.js';
import { loadConversationLogs } from './simulationLogsUI.js';
import { generateAndShowReport } from './reportUI.js';
import { initBenchmarksDashboard, refreshBenchmarksDashboard, loadInlineReport, initConversationViewer } from './benchmarksDashboard.js';

export function setupNavigationHandlers(api, state) {
    // Listen for circle view refresh events
    window.addEventListener('refreshCircleView', () => {
        loadCircleInfo(api, state.userId);
    });

    document.getElementById('circle-btn').addEventListener('click', () => {
        switchView('circle');
        loadCircleInfo(api, state.userId);
    });

    document.getElementById('mycircles-btn').addEventListener('click', () => {
        switchView('mycircles');
        loadMyCirclesData(api, state.userId);
    });

    document.getElementById('patients-btn').addEventListener('click', () => {
        switchView('patients');
        loadPatientsData(api, state.userId);
    });

    document.getElementById('business-btn').addEventListener('click', () => {
        switchView('business');
        loadBusinessData(api, state.userId);
    });

    document.getElementById('feedback-btn').addEventListener('click', () => {
        switchView('feedback');
        loadFeedbackData(api, state.userId);
        loadConversationsData(api, state.userId);
    });

    document.getElementById('view-selector').addEventListener('click', () => {
        switchView('chat');
    });

    document.getElementById('back-to-chat').addEventListener('click', () => {
        switchView('chat');
    });

    document.getElementById('back-to-chat-mycircles').addEventListener('click', () => {
        switchView('chat');
    });

    document.getElementById('back-to-chat-patients').addEventListener('click', () => {
        switchView('chat');
    });

    document.getElementById('back-to-chat-business').addEventListener('click', () => {
        switchView('chat');
    });

    // ====== BUSINESS TAB SWITCHING ======
    document.addEventListener('click', (e) => {
        if (e.target.matches('.business-tabs .tab-button')) {
            // Remove active class from all business tabs
            document.querySelectorAll('.business-tabs .tab-button').forEach(tab => {
                tab.classList.remove('active');
            });
            
            // Hide all business sections
            document.querySelectorAll('.business-section').forEach(section => {
                section.classList.remove('active');
            });
            
            // Activate clicked tab and corresponding section
            e.target.classList.add('active');
            const sectionId = e.target.dataset.tab + '-section';
            document.getElementById(sectionId).classList.add('active');
            
            // Load data for the active section
            const sectionType = e.target.dataset.tab;
            loadBusinessSectionData(api, state.userId, sectionType);
        }
    });

    // ====== FEEDBACK TAB SWITCHING ======
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;

            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(tabName).classList.add('active');

            // Load data when switching tabs
            if (tabName === 'my-feedback' && state.userId) {
                loadFeedbackData(api, state.userId);
            } else if (tabName === 'conversations' && state.userId) {
                loadConversationsData(api, state.userId);
            } else if (tabName === 'logs') {
                loadServerLogs(api);
            } else if (tabName === 'training') {
                // Training dashboard is already initialized
            } else if (tabName === 'prompts') {
                // Prompt comparison is already initialized
            } else if (tabName === 'simulation-logs') {
                loadConversationLogs(api);
            } else if (tabName === 'reports') {
                // Auto-load existing report inline; generate is manual via button
                loadInlineReport('report-inline-frame');
                // Wire reload button each time the tab is opened
                const reloadBtn = document.getElementById('reload-report-btn');
                if (reloadBtn) reloadBtn.onclick = async () => {
                    reloadBtn.disabled = true;
                    reloadBtn.textContent = '⏳ Reloading…';
                    try {
                        await loadInlineReport('report-inline-frame');
                    } finally {
                        reloadBtn.disabled = false;
                        reloadBtn.textContent = '↻ Reload';
                    }
                };
                const genBtn = document.getElementById('generate-report-btn');
                if (genBtn) genBtn.onclick = () => generateAndShowReport();
            } else if (tabName === 'benchmarks') {
                // Re-render benchmarks fresh on every tab activation
                initBenchmarksDashboard();
                initConversationViewer();

                // Wire the refresh button: re-fetch all data then re-render (same as a page reload
                // of just this tab, but without logging the user out)
                const refreshBtn = document.getElementById('bench-refresh-btn');
                if (refreshBtn) {
                    refreshBtn.onclick = async () => {
                        refreshBtn.disabled = true;
                        refreshBtn.textContent = '⏳';
                        try { await refreshBenchmarksDashboard(); }
                        finally { refreshBtn.disabled = false; refreshBtn.textContent = '↻ Refresh'; }
                    };
                }
            }
        });
    });

    document.getElementById('refresh-logs').addEventListener('click', () => {
        loadServerLogs(api);
    });
}
