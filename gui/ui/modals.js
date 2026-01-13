export function setupModals(api, sendMessageCallback) {
    // ====== HELP MODAL ======
    document.getElementById('help-btn').addEventListener('click', () => {
        document.getElementById('help-modal').classList.add('active');
    });

    document.getElementById('close-help').addEventListener('click', () => {
        document.getElementById('help-modal').classList.remove('active');
    });

    // ====== ADD MEMBER MODAL ======
    let currentMemberType = null;

    // Watch for add member button (dynamically added in circle view)
    document.addEventListener('click', (e) => {
        if (e.target.id === 'add-member-btn') {
            document.getElementById('add-member-modal').classList.add('active');
        }
    });

    document.getElementById('add-caregiver-btn').addEventListener('click', () => {
        currentMemberType = 'caregiver';
        document.getElementById('caregiver-form').style.display = 'block';
        document.getElementById('doctor-form').style.display = 'none';
    });

    document.getElementById('add-doctor-btn').addEventListener('click', () => {
        currentMemberType = 'doctor';
        document.getElementById('doctor-form').style.display = 'block';
        document.getElementById('caregiver-form').style.display = 'none';
    });

    document.getElementById('submit-add-member').addEventListener('click', async () => {
        let command = '';

        if (currentMemberType === 'caregiver') {
            const username = document.getElementById('caregiver-username').value.trim();
            const relationship = document.getElementById('caregiver-relationship').value.trim();

            if (!username || !relationship) {
                alert('Please fill in both username and relationship');
                return;
            }

            command = `/care ${username} as ${relationship}`;
        } else if (currentMemberType === 'doctor') {
            const username = document.getElementById('doctor-username').value.trim();
            const specialty = document.getElementById('doctor-specialty').value.trim();

            if (!username) {
                alert('Please enter doctor username');
                return;
            }

            command = specialty
                ? `/doc ${username} as ${specialty}`
                : `/doc ${username}`;
        } else {
            alert('Please select member type first');
            return;
        }

        await sendMessageCallback(command);

        // Close modal and reset
        document.getElementById('add-member-modal').classList.remove('active');
        document.getElementById('caregiver-form').style.display = 'none';
        document.getElementById('doctor-form').style.display = 'none';
        document.getElementById('caregiver-username').value = '';
        document.getElementById('caregiver-relationship').value = '';
        document.getElementById('doctor-username').value = '';
        document.getElementById('doctor-specialty').value = ''; // FIX: Added this (missing in original?)
        currentMemberType = null;

        // Reload circle view after adding member
        // Dispatch event for refresh
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('refreshCircleView'));
        }, 1000); // Wait 1 second for command to process
    });

    document.getElementById('cancel-add-member').addEventListener('click', () => {
        document.getElementById('add-member-modal').classList.remove('active');
        document.getElementById('caregiver-form').style.display = 'none';
        document.getElementById('doctor-form').style.display = 'none';
        document.getElementById('caregiver-username').value = '';
        document.getElementById('caregiver-relationship').value = '';
        document.getElementById('doctor-username').value = '';
        document.getElementById('doctor-specialty').value = '';
        currentMemberType = null;
    });
}
