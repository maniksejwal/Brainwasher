// Chart Data Injected Here
const timeSeriesData = "__TIME_SERIES_DATA__";
const aiTimeSeries = "__AI_TIME_SERIES__";
const humanTimeSeries = "__HUMAN_TIME_SERIES__";

const definedPersonasMap = "__DEFINED_PERSONAS_MAP__";
const totalDefinedPersonas = "__PERSONA_COUNT__";

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    event.currentTarget.classList.add('active');
}

// Interactive modal functions
function showPersonasList() {
    // Use the injected variable
    const personaCategories = definedPersonasMap;

    let contentHtml = '';
    for (const [category, personas] of Object.entries(personaCategories)) {
        contentHtml += `<h4 style="margin: 10px 0 5px; color: #2c3e50;">${category} (${personas.length})</h4>`;
        contentHtml += '<ul style="list-style: none; padding: 0; margin-bottom: 15px;">' +
            personas.map(p => '<li style="padding: 6px; border-bottom: 1px solid #eee; font-size: 0.9em;">' + p + '</li>').join('') +
            '</ul>';
    }

    document.getElementById('modalTitle').textContent = 'Defined Personas (' + totalDefinedPersonas + ')';
    document.getElementById('modalContent').innerHTML = contentHtml;
    document.getElementById('listModal').style.display = 'flex';
}

function showScenariosList() {
    // Not fully implemented on server side object yet for list viewing, placeholder
    document.getElementById('modalTitle').textContent = 'Unique Scenarios';
    document.getElementById('modalContent').innerHTML = '<p>List of unique scenarios detected in this analysis run.</p>';
    document.getElementById('listModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('listModal').style.display = 'none';
}

// Charts initialization
window.onload = function () {
    const ctxScore = document.getElementById('scoreChart').getContext('2d');
    new Chart(ctxScore, {
        type: 'line',
        data: {
            labels: timeSeriesData.map(t => t.date),
            datasets: [
                {
                    label: 'AI Simulation Score',
                    data: timeSeriesData.map(t => t.source === 'simulation' ? t.score : null),
                    borderColor: '#3498db',
                    spanGaps: true,
                    tension: 0.3
                },
                {
                    label: 'Production Score',
                    data: timeSeriesData.map(t => t.source === 'production' ? t.score : null),
                    borderColor: '#2ecc71',
                    spanGaps: true,
                    tension: 0.3
                }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    const ctxStats = document.getElementById('statsChart').getContext('2d');
    new Chart(ctxStats, {
        type: 'bar',
        data: {
            labels: timeSeriesData.map(t => t.date),
            datasets: [{
                label: 'Interactions',
                data: timeSeriesData.map(t => t.interactionCount),
                backgroundColor: '#9b59b6'
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    const ctxLen = document.getElementById('lengthChart').getContext('2d');
    new Chart(ctxLen, {
        type: 'line',
        data: {
            labels: timeSeriesData.map(t => t.date),
            datasets: [
                {
                    label: 'Avg Msg Length',
                    data: timeSeriesData.map(t => t.avgMsgLen),
                    borderColor: '#e67e22'
                },
                {
                    label: 'Avg Response Length',
                    data: timeSeriesData.map(t => t.avgRespLen),
                    borderColor: '#f1c40f'
                }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
};
