import config from '../config.js';

/**
 * NotificationCenter Component
 * Handles fetching, displaying, and managing notifications in the GUI.
 */
export default class NotificationCenter {
    constructor(userId) {
        this.userId = userId;
        this.container = null;
        this.bellIcon = null;
        this.dropdown = null;
        this.itemContainer = null;
        this.badge = null;
        this.notifications = [];
        this.unreadCount = 0;

        this.init();
    }

    init() {
        this.createDOM();
        this.attachListeners();
        this.startPolling();
    }

    createDOM() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'notification-center';

        // Bell Icon
        this.bellIcon = document.createElement('div');
        this.bellIcon.className = 'notification-bell';
        this.bellIcon.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
        `;

        // Badge
        this.badge = document.createElement('span');
        this.badge.className = 'notification-badge';
        this.badge.style.display = 'none';
        this.bellIcon.appendChild(this.badge);

        // Dropdown
        this.dropdown = document.createElement('div');
        this.dropdown.className = 'notification-dropdown hidden';
        this.dropdown.innerHTML = `
            <div class="notification-header">
                <h3>Notifications</h3>
                <button id="refresh-notifs" title="Refresh">↻</button>
            </div>
            <div class="notification-list"></div>
        `;

        this.itemContainer = this.dropdown.querySelector('.notification-list');

        this.container.appendChild(this.bellIcon);
        this.container.appendChild(this.dropdown);

        // Inject into header (assuming .header-right exists, else body)
        const header = document.querySelector('.header-right') || document.body;
        header.prepend(this.container);
    }

    attachListeners() {
        this.bellIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        this.dropdown.querySelector('#refresh-notifs').addEventListener('click', (e) => {
            e.stopPropagation();
            this.fetchNotifications();
        });

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.dropdown.classList.add('hidden');
            }
        });
    }

    toggleDropdown() {
        this.dropdown.classList.toggle('hidden');
        if (!this.dropdown.classList.contains('hidden')) {
            // Mark visible as read logic could go here
        }
    }

    async fetchNotifications() {
        if (!this.userId) return;

        try {
            const response = await fetch(config.apiUrl(`/api/notifications/history/${this.userId}?limit=10`));
            const data = await response.json();

            if (data.success) {
                this.notifications = data.history;
                this.render();
                this.updateBadge();
            }
        } catch (error) {
            console.error('Failed to fetch notifications:', error);
        }
    }

    render() {
        this.itemContainer.innerHTML = '';

        if (this.notifications.length === 0) {
            this.itemContainer.innerHTML = '<div class="empty-notifs">No notifications</div>';
            return;
        }

        this.notifications.forEach(note => {
            const item = document.createElement('div');
            item.className = `notification-item ${note.status}`;

            const date = new Date(note.timestamp).toLocaleTimeString();

            let icon = 'ℹ️';
            if (note.type === 'escalation') icon = '⚠️';
            if (note.type === 'success') icon = '✅';

            item.innerHTML = `
                <div class="notif-icon">${icon}</div>
                <div class="notif-content">
                    <div class="notif-msg">${note.content || 'Notification'}</div>
                    <div class="notif-meta">
                        <span class="notif-time">${date}</span>
                        <span class="notif-channel">${note.channel}</span>
                    </div>
                </div>
            `;
            this.itemContainer.appendChild(item);
        });
    }

    updateBadge() {
        // Simplified: Count all as unread if status != 'read' (but we don't have read tracking yet)
        // For now, just show total count of recent items
        const count = this.notifications.length;
        if (count > 0) {
            this.badge.textContent = count > 9 ? '9+' : count;
            this.badge.style.display = 'flex';
        } else {
            this.badge.style.display = 'none';
        }
    }

    startPolling() {
        this.fetchNotifications();
        setInterval(() => this.fetchNotifications(), 30000); // Poll every 30s
    }
}
