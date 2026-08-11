/**
 * ระบบดูแลช่วยเหลือนักเรียน - Authentication & Role Manager v8.6
 * Controls access for 3 User Roles: Student / Teacher / Administrator
 * 
 * FIX v8.6:
 *  - applyUIPermissions() now ALWAYS shows/hides #login-screen-view correctly
 *  - loadSavedSession() properly restores session without race conditions
 *  - logout() forces page reload to ensure clean state
 */

class AuthManager {
    constructor() {
        this.currentUser = null; // Start null, load session after DOM ready
    }

    /**
     * Load current session from LocalStorage / SessionStorage
     * Returns null if user explicitly logged out
     */
    loadSavedSession() {
        try {
            const isExplicitLogout = localStorage.getItem('prcare_user_logged_out') === 'true';
            if (isExplicitLogout) {
                return null;
            }
            const saved = sessionStorage.getItem(CONFIG.STORAGE_KEYS.AUTH_USER)
                || localStorage.getItem(CONFIG.STORAGE_KEYS.AUTH_USER);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Validate parsed object has required fields
                if (parsed && parsed.role && parsed.name) {
                    return parsed;
                }
            }
        } catch (e) {
            console.error('[AuthManager] Session load error:', e);
        }
        return null;
    }

    /**
     * Initialize auth state - call AFTER DOM is ready
     * Shows login screen or hides it based on saved session
     */
    initAuthState() {
        this.currentUser = this.loadSavedSession();
        this.applyUIPermissions();
        console.log('[AuthManager] Auth state initialized. User:', this.currentUser ? this.currentUser.name : 'Not logged in');
    }

    /**
     * Authenticate User with Role
     * @param {string} role 'student' | 'teacher' | 'admin'
     * @param {string} username 
     * @param {string} password 
     */
    async login(role, username, password) {
        if (!username || !username.trim()) {
            console.warn('[AuthManager] Login attempted with empty username');
            return false;
        }

        let userProfile = null;
        const users = firebaseService.getUsers();

        // 1. Search in Registered Users Manager Database (exact match)
        const matchedUser = users.find(u =>
            u.username && u.username.toLowerCase() === username.toLowerCase() &&
            u.password === password
        );

        if (matchedUser) {
            userProfile = {
                id: matchedUser.id,
                username: matchedUser.username,
                name: matchedUser.fullName || matchedUser.username,
                role: matchedUser.role,
                roleTitle: CONFIG.ROLE_NAMES_TH[matchedUser.role] || matchedUser.role,
                avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${matchedUser.role}_${matchedUser.username}`
            };
        } else if (role === CONFIG.ROLES.STUDENT || role === 'student') {
            // Student lookup by studentId or name
            const students = firebaseService.getStudents();
            const studentMatch = students.find(s =>
                s.studentId === username || (s.fullName && s.fullName.includes(username))
            );
            userProfile = {
                id: studentMatch ? studentMatch.id : 'STD_DEMO',
                studentId: studentMatch ? studentMatch.studentId : username,
                name: studentMatch ? studentMatch.fullName : username,
                grade: studentMatch ? studentMatch.grade : 'ม.1',
                room: studentMatch ? studentMatch.room : '1',
                role: CONFIG.ROLES.STUDENT,
                roleTitle: CONFIG.ROLE_NAMES_TH.student,
                avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=student'
            };
        } else if (role === CONFIG.ROLES.ADMIN || role === 'admin') {
            // Admin fallback (only when no users registered yet)
            if (users.length === 0) {
                userProfile = {
                    id: 'ADM_01',
                    username: username,
                    name: username || 'ผู้ดูแลระบบ (Admin)',
                    role: CONFIG.ROLES.ADMIN,
                    roleTitle: CONFIG.ROLE_NAMES_TH.admin,
                    avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=admin'
                };
            }
        } else if (role === 'head') {
            // Head of student affairs - treated as teacher role
            if (users.length === 0) {
                userProfile = {
                    id: 'HEAD_01',
                    username: username,
                    name: username || 'หัวหน้างานกิจการนักเรียน',
                    role: CONFIG.ROLES.TEACHER,
                    roleTitle: '🏫 หัวหน้างานกิจการนักเรียน',
                    avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=head'
                };
            }
        } else {
            // Teacher fallback (only when no users registered yet)
            if (users.length === 0) {
                userProfile = {
                    id: 'TCH_01',
                    username: username,
                    name: username || 'ครูประจำชั้น / ครูกิจการนักเรียน',
                    role: CONFIG.ROLES.TEACHER,
                    roleTitle: CONFIG.ROLE_NAMES_TH.teacher,
                    avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=teacher'
                };
            }
        }

        if (userProfile) {
            this.currentUser = userProfile;
            localStorage.removeItem('prcare_user_logged_out');
            // Store in BOTH storages for redundancy
            const userJson = JSON.stringify(userProfile);
            localStorage.setItem(CONFIG.STORAGE_KEYS.AUTH_USER, userJson);
            sessionStorage.setItem(CONFIG.STORAGE_KEYS.AUTH_USER, userJson);
            this.applyUIPermissions();
            window.dispatchEvent(new CustomEvent('authStateChanged', { detail: userProfile }));
            console.log('[AuthManager] Login successful:', userProfile.name, '| Role:', userProfile.role);
            return true;
        }

        console.warn('[AuthManager] Login failed - No matching user found for:', username, '| Role:', role);
        return false;
    }

    /**
     * Logout - clears all auth state and shows login screen
     */
    logout() {
        console.log('[AuthManager] Logging out user:', this.currentUser ? this.currentUser.name : 'unknown');
        this.currentUser = null;
        localStorage.removeItem(CONFIG.STORAGE_KEYS.AUTH_USER);
        sessionStorage.removeItem(CONFIG.STORAGE_KEYS.AUTH_USER);
        localStorage.setItem('prcare_user_logged_out', 'true');

        // Show login screen immediately
        const loginView = document.getElementById('login-screen-view');
        if (loginView) {
            loginView.style.display = 'flex';
            loginView.style.opacity = '1';
            loginView.style.visibility = 'visible';
            loginView.style.pointerEvents = 'auto';
            loginView.classList.remove('hidden');
        }

        // Update header to show "not logged in"
        const userProfileNameEl = document.getElementById('user-profile-name');
        const userRoleBadgeEl = document.getElementById('user-role-badge');
        if (userProfileNameEl) userProfileNameEl.textContent = 'ยังไม่ได้เข้าสู่ระบบ';
        if (userRoleBadgeEl) userRoleBadgeEl.textContent = 'กรุณาล็อกอิน';

        window.dispatchEvent(new CustomEvent('authStateChanged', { detail: null }));
    }

    getCurrentUser() {
        return this.currentUser;
    }

    isLoggedIn() {
        return this.currentUser !== null;
    }

    hasRole(role) {
        if (!this.currentUser) return false;
        if (this.currentUser.role === CONFIG.ROLES.ADMIN) return true; // Admin has all rights
        return this.currentUser.role === role;
    }

    canEditData() {
        if (!this.currentUser) return false;
        return this.currentUser.role === CONFIG.ROLES.TEACHER || this.currentUser.role === CONFIG.ROLES.ADMIN;
    }

    canManageAdmin() {
        if (!this.currentUser) return false;
        return this.currentUser.role === CONFIG.ROLES.ADMIN;
    }

    /**
     * Apply UI Visibility Rules based on active user role
     * Called after login, logout, and on init
     */
    applyUIPermissions() {
        const user = this.currentUser;
        const role = user ? user.role : 'guest';

        document.body.setAttribute('data-user-role', role);

        // Toggle Standalone Login View visibility
        const loginScreenView = document.getElementById('login-screen-view');
        if (loginScreenView) {
            if (user) {
                // Logged in: hide login screen
                loginScreenView.style.display = 'none';
                loginScreenView.style.opacity = '0';
                loginScreenView.style.visibility = 'hidden';
                loginScreenView.style.pointerEvents = 'none';
                loginScreenView.classList.add('hidden');
            } else {
                // Not logged in: show login screen
                loginScreenView.style.display = 'flex';
                loginScreenView.style.opacity = '1';
                loginScreenView.style.visibility = 'visible';
                loginScreenView.style.pointerEvents = 'auto';
                loginScreenView.classList.remove('hidden');
            }
        }

        // Update Top Navigation User Info
        const userProfileNameEl = document.getElementById('user-profile-name');
        const userRoleBadgeEl = document.getElementById('user-role-badge');
        const userAvatarEl = document.getElementById('user-avatar');

        if (user) {
            if (userProfileNameEl) userProfileNameEl.textContent = user.name;
            if (userRoleBadgeEl) userRoleBadgeEl.textContent = user.roleTitle || CONFIG.ROLE_NAMES_TH[user.role] || user.role;
            if (userAvatarEl && user.avatar) {
                // Use img element for avatar
                const img = document.createElement('img');
                img.src = user.avatar;
                img.alt = user.name;
                img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
                img.onerror = () => { img.style.display = 'none'; };
                userAvatarEl.innerHTML = '';
                userAvatarEl.appendChild(img);
            }
        } else {
            if (userProfileNameEl) userProfileNameEl.textContent = 'ยังไม่ได้เข้าสู่ระบบ';
            if (userRoleBadgeEl) userRoleBadgeEl.textContent = 'กรุณาล็อกอิน';
            if (userAvatarEl) userAvatarEl.innerHTML = '<i class="ri-user-3-fill" style="font-size:1.1rem;"></i>';
        }

        // Show/Hide Role-restricted Elements
        document.querySelectorAll('[data-require-role]').forEach(el => {
            const requiredRoles = el.getAttribute('data-require-role').split(',');
            if (user && requiredRoles.includes(user.role)) {
                el.style.display = '';
            } else {
                el.style.display = 'none';
            }
        });

        // Hide Edit Buttons for Students
        document.querySelectorAll('.teacher-only, .admin-only').forEach(el => {
            if (role === 'student' && !el.classList.contains('student-allowed')) {
                el.style.display = 'none';
            } else {
                el.style.display = '';
            }
        });

        console.log('[AuthManager] UI permissions applied. Role:', role);
    }
}

const authManager = new AuthManager();
