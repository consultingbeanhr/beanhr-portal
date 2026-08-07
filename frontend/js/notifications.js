// ─────────────────────────────────────────────────────────
// BeanHR Portal — Shared Notifications System (Admin & Manager)
// ─────────────────────────────────────────────────────────
// NOTE: db.js declares `const db = (()=>{...})()` which lives
// in the global lexical scope but NOT on `window`. We must
// access it as `db` directly, never `window.db`.
// ─────────────────────────────────────────────────────────
(function() {
    function _dbReady() {
        return typeof db !== 'undefined' && db;
    }

    function _getNotifBody() {
        return document.getElementById('notifDropdownBody') || document.getElementById('notifDropdownList');
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    function formatTime(ts) {
        if (!ts) return '';
        const diff = Date.now() - new Date(ts).getTime();
        const mins  = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days  = Math.floor(diff / 86400000);
        if (mins  < 1)  return 'Just now';
        if (mins  < 60) return `${mins}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days  <  7) return `${days}d ago`;
        return new Date(ts).toLocaleDateString();
    }

    if (!window.formatTime) {
        window.formatTime = formatTime;
    }

    window.toggleNotifDropdown = function(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const dropdown = document.getElementById('notifDropdown');
        if (dropdown) dropdown.classList.toggle('open');
    };

    document.addEventListener('click', function(e) {
        const dropdown = document.getElementById('notifDropdown');
        const btn = document.querySelector('.notif-btn') || document.getElementById('notifBtn');
        if (dropdown && dropdown.classList.contains('open')) {
            if (e && e.target && (dropdown.contains(e.target) || (btn && btn.contains(e.target)))) {
                return;
            }
            dropdown.classList.remove('open');
        }
    });

    window.dismissNotif = async function(e, notificationId) {
        let id = notificationId;
        let eventObj = e;
        if (typeof e === 'string' && !notificationId) {
            id = e;
            eventObj = null;
        }
        if (eventObj && eventObj.stopPropagation) eventObj.stopPropagation();

        let item = null;
        if (eventObj && eventObj.target) {
            item = eventObj.target.closest('.notif-item');
        }
        if (!item && id) {
            item = document.getElementById('notif-' + id);
        }
        if (item) item.remove();

        const body  = _getNotifBody();
        const badge = document.getElementById('notifBadge');
        if (body && !body.querySelector('.notif-item')) {
            body.innerHTML = '<div class="notif-empty">No notifications</div>';
        }
        if (badge && body) {
            const unreadCount = body.querySelectorAll('.notif-item.unread').length;
            if (unreadCount > 0) {
                badge.textContent = unreadCount;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }

        if (id && _dbReady() && db.markNotificationAsRead) {
            try { await db.markNotificationAsRead(id); } catch(err) {}
        }
    };

    window.markAllRead = async function(e) {
        if (e && e.preventDefault) e.preventDefault();
        const body  = _getNotifBody();
        const badge = document.getElementById('notifBadge');
        if (body) body.innerHTML = '<div class="notif-empty">No notifications</div>';
        if (badge) badge.style.display = 'none';
        if (window.showToast) showToast('All notifications marked as read', 'success');
        if (_dbReady() && db.markAllNotificationsRead) {
            try { await db.markAllNotificationsRead(); } catch(err){}
        }
    };

    function _renderNotifList(notifs) {
        const unreadNotifs = (notifs || []).filter(n => !n.read);
        const body   = _getNotifBody();
        const badge  = document.getElementById('notifBadge');
        if (!body) return;

        if (unreadNotifs.length === 0) {
            body.innerHTML = '<div class="notif-empty">No notifications</div>';
            if (badge) badge.style.display = 'none';
            return;
        }

        if (badge) {
            badge.textContent  = unreadNotifs.length;
            badge.style.display = 'flex';
        }

        body.innerHTML = unreadNotifs.map(n => {
            const notifId = n.notificationId || n.id || '';
            const timeVal = n.timestamp || n.createdAt || n.time;
            return `
            <div class="notif-item unread" id="notif-${notifId}">
                <div style="flex:1;min-width:0;">
                    <div class="notif-title">${escapeHtml(n.title || 'Notification')}</div>
                    <div class="notif-msg">${escapeHtml(n.message || '')}</div>
                    <div class="notif-time">${formatTime(timeVal)}</div>
                </div>
                <button class="notif-dismiss" onclick="dismissNotif(event, '${notifId}')" title="Dismiss">&#x2715;</button>
            </div>
        `;
        }).join('');
    }

    window.renderAdminNotifications = async function() {
        try {
            if (!_dbReady() || typeof db.getAdminNotifications !== 'function') return;
            const notifs = await db.getAdminNotifications();
            _renderNotifList(notifs);
        } catch (err) {
            console.error('Error loading admin notifications:', err);
        }
    };

    window.renderManagerNotifications = async function() {
        try {
            if (!_dbReady() || typeof db.getManagerNotifications !== 'function') return;
            const notifs = await db.getManagerNotifications();
            _renderNotifList(notifs);
        } catch (err) {
            console.error('Error loading manager notifications:', err);
        }
    };
})();
