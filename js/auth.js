/**
 * ระบบดูแลช่วยเหลือนักเรียน - Authentication & Role Manager v8.7
 * 
 * FIX v8.7 (CRITICAL):
 *  - login() now fetches users from Firebase FIRST before matching credentials
 *  - Added permanent hardcoded emergency admin credentials as last resort
 *  - initAuthState() properly restores session after DOM ready
 *  - logout() immediately shows login screen
 *  - applyUIPermissions() handles display:none correctly
 */

class AuthManager {
    constructor() {
        this.currentUser = null; // Always start null, restore after DOM ready
        // Hardcoded emergency admin accounts - ALWAYS work regardless of Firebase/cache state
        this._emergencyAccounts = [
            { id: 'EMG_ADM_01', username: 'jaturon',  password: '1234',      fullName: 'นายจตุรงค์ พิศวงษ์',      role: 'admin' },
            { id: 'EMG_ADM_02', username: 'admin',    password: 'admin123',  fullName: 'ผู้ดูแลระบบ (Admin)',     role: 'admin' },
            { id: 'EMG_TCH_01', username: 'teacher1', password: 'teacher123',fullName: 'ครูผู้สอน',               role: 'teacher' }
        ];
    }

    /**
     * Load current session from storage
     */
    loadSavedSession() {
        try {
            const isExplicitLogout = localStorage.getItem('prcare_user_logged_out') === 'true';
            if (isExplicitLogout) return null;

            const saved = sessionStorage.getItem(CONFIG.STORAGE_KEYS.AUTH_USER)
                || localStorage.getItem(CONFIG.STORAGE_KEYS.AUTH_USER);
            if (saved) {
                const parsed = JSON.parse(saved);
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
     */
    initAuthState() {
        this.currentUser = this.loadSavedSession();
        this.applyUIPermissions();
        console.log('[AuthManager] Auth initialized. User:', this.currentUser ? this.currentUser.name : 'Not logged in');
    }

    /**
     * Authenticate User
     * Priority: 1) Firebase/Cache users  2) Emergency hardcoded accounts
     */
    async login(role, username, password) {
        if (!username || !username.trim()) return false;
        if (!password || !password.trim()) return false;

        const uname = username.trim().toLowerCase();
        const upass = password.trim();

        console.log('[AuthManager] Login attempt:', uname, '| Role:', role);

        let userProfile = null;

        // === STEP 1: Try to fetch fresh users from Firebase ===
        let users = [];
        try {
            if (firebaseService.isOnline) {
                // Fetch directly from Firebase (bypass cache timing issues)
                const freshUsers = await firebaseService.fetchUsersFromCloud();
                if (freshUsers && freshUsers.length > 0) {
                    users = freshUsers;
                    console.log('[AuthManager] Got', users.length, 'users from Firebase');
                }
            }
        } catch (e) {
            console.warn('[AuthManager] Firebase fetch failed, using cache:', e.message);
        }

        // Fallback to cache if Firebase fetch failed or offline
        if (users.length === 0) {
            users = firebaseService.getUsers() || [];
            console.log('[AuthManager] Using cached users:', users.length);
        }

        // === STEP 2: Search in users list (Firebase/Cache) ===
        const matchedUser = users.find(u =>
            u.username && u.username.toLowerCase() === uname &&
            u.password === upass
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
            console.log('[AuthManager] Matched in users list:', userProfile.name);
        }

        // === STEP 3: Emergency Hardcoded Fallback (always works) ===
        if (!userProfile) {
            const emergency = this._emergencyAccounts.find(u =>
                u.username === uname && u.password === upass
            );
            if (emergency) {
                userProfile = {
                    id: emergency.id,
                    username: emergency.username,
                    name: emergency.fullName,
                    role: emergency.role,
                    roleTitle: CONFIG.ROLE_NAMES_TH[emergency.role] || emergency.role,
                    avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${emergency.role}_${emergency.username}`
                };
                console.log('[AuthManager] Matched in emergency accounts:', userProfile.name);
            }
        }

        // === STEP 4: Student role lookup ===
        if (!userProfile && (role === CONFIG.ROLES.STUDENT || role === 'student')) {
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
        }

        // === STEP 5: Commit login ===
        if (userProfile) {
            this.currentUser = userProfile;
            localStorage.removeItem('prcare_user_logged_out');
            const userJson = JSON.stringify(userProfile);
            localStorage.setItem(CONFIG.STORAGE_KEYS.AUTH_USER, userJson);
            sessionStorage.setItem(CONFIG.STORAGE_KEYS.AUTH_USER, userJson);
            this.applyUIPermissions();
            window.dispatchEvent(new CustomEvent('authStateChanged', { detail: userProfile }));
            console.log('[AuthManager] Login SUCCESS:', userProfile.name, '| Role:', userProfile.role);
            return true;
        }

        console.warn('[AuthManager] Login FAILED for:', uname, '| Available users:', users.map(u => u.username));
        return false;
    }

    /**
     * Logout - clears all state and shows login screen
     */
    logout() {
        console.log('[AuthManager] Logging out:', this.currentUser ? this.currentUser.name : 'unknown');
        this.currentUser = null;
        localStorage.removeItem(CONFIG.STORAGE_KEYS.AUTH_USER);
        sessionStorage.removeItem(CONFIG.STORAGE_KEYS.AUTH_USER);
        localStorage.setItem('prcare_user_logged_out', 'true');

        const loginView = document.getElementById('login-screen-view');
        if (loginView) {
            loginView.style.display = 'flex';
            loginView.style.opacity = '1';
            loginView.style.visibility = 'visible';
            loginView.style.pointerEvents = 'auto';
            loginView.classList.remove('hidden');
        }
        const userProfileNameEl = document.getElementById('user-profile-name');
        const userRoleBadgeEl = document.getElementById('user-role-badge');
        if (userProfileNameEl) userProfileNameEl.textContent = 'ยังไม่ได้เข้าสู่ระบบ';
        if (userRoleBadgeEl) userRoleBadgeEl.textContent = 'กรุณาล็อกอิน';

        window.dispatchEvent(new CustomEvent('authStateChanged', { detail: null }));
    }

    getCurrentUser() { return this.currentUser; }
    isLoggedIn() { return this.currentUser !== null; }

    hasRole(role) {
        if (!this.currentUser) return false;
        if (this.currentUser.role === CONFIG.ROLES.ADMIN) return true;
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
     */
    applyUIPermissions() {
        const user = this.currentUser;
        const role = user ? user.role : 'guest';

        document.body.setAttribute('data-user-role', role);

        // Toggle login screen
        const loginScreenView = document.getElementById('login-screen-view');
        if (loginScreenView) {
            if (user) {
                loginScreenView.style.display = 'none';
                loginScreenView.style.opacity = '0';
                loginScreenView.style.visibility = 'hidden';
                loginScreenView.style.pointerEvents = 'none';
                loginScreenView.classList.add('hidden');
            } else {
                loginScreenView.style.display = 'flex';
                loginScreenView.style.opacity = '1';
                loginScreenView.style.visibility = 'visible';
                loginScreenView.style.pointerEvents = 'auto';
                loginScreenView.classList.remove('hidden');
            }
        }

        // Update header user info
        const userProfileNameEl = document.getElementById('user-profile-name');
        const userRoleBadgeEl = document.getElementById('user-role-badge');
        const userAvatarEl = document.getElementById('user-avatar');

        if (user) {
            if (userProfileNameEl) userProfileNameEl.textContent = user.name;
            if (userRoleBadgeEl) userRoleBadgeEl.textContent = user.roleTitle || CONFIG.ROLE_NAMES_TH[user.role] || user.role;
            if (userAvatarEl && user.avatar) {
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
            el.style.display = (user && requiredRoles.includes(user.role)) ? '' : 'none';
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
