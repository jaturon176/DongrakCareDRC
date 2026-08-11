/**
 * ระบบดูแลช่วยเหลือนักเรียน - Firebase Realtime DB & LocalStorage Sync Service (v8.0)
 * Direct Cloud First Architecture (Cloud Single Source of Truth + Fast Memory/LocalStorage Cache)
 */

class FirebaseService {
    constructor() {
        this.baseUrl = CONFIG.FIREBASE.DATABASE_URL;
        this.listeners = new Map();
        this.isOnline = navigator.onLine;
        this.syncInterval = null;
        this._memoryCache = {};
        this._lastSaveTime = 0;

        // Register Online/Offline Event Listeners
        window.addEventListener('online', () => this.handleOnlineState(true));
        window.addEventListener('offline', () => this.handleOnlineState(false));

        // Start Periodic Real-time Polling/Sync
        this.initSync();
    }

    handleOnlineState(online) {
        this.isOnline = online;
        console.log(`[FirebaseService] Network status changed: ${online ? 'ONLINE' : 'OFFLINE'}`);
        const statusEl = document.getElementById('network-status');
        if (statusEl) {
            statusEl.className = online ? 'status-indicator online' : 'status-indicator offline';
            statusEl.title = online ? 'ซิงค์ข้อมูลเรียลไทม์กับ Firebase เรียบร้อย' : 'ทำงานในโหมดแคช ออฟไลน์ (LocalStorage)';
            statusEl.querySelector('.status-text').textContent = online ? 'Online (Firebase Sync)' : 'Offline (Local Cache)';
        }
        if (online) {
            this.syncAllFromCloud();
        }
    }

    initSync() {
        this._lastSaveTime = 0;
        if (this.isOnline) {
            setTimeout(() => this.syncAllFromCloud(), 1500);
        }
        this.syncInterval = setInterval(() => {
            if (this.isOnline) {
                this.syncAllFromCloud();
            }
        }, 30000);
    }

    // --- Helper: LocalStorage & In-Memory Fast Cache (0ms) ---
    getCache(key) {
        if (this._memoryCache[key] && Array.isArray(this._memoryCache[key]) && this._memoryCache[key].length > 0) {
            return this._memoryCache[key];
        }
        try {
            const data = localStorage.getItem(key);
            if (data) {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    this._memoryCache[key] = parsed;
                }
                return parsed;
            }
        } catch (e) {
            console.error(`[FirebaseService] Error reading cache ${key}:`, e);
        }
        return this._memoryCache[key] || [];
    }

    setCache(key, data) {
        this._memoryCache[key] = data;
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            console.error(`[FirebaseService] Error setting cache ${key}:`, e);
        }
    }

    // --- Core Generic REST API Callers ---
    async cloudGet(endpoint) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}.json`, {
                headers: { 'Cache-Control': 'no-cache' }
            });
            if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
            const data = await response.json();
            return data || {};
        } catch (error) {
            console.warn(`[FirebaseService] Cloud GET ${endpoint} failed:`, error.message);
            return null;
        }
    }

    async cloudPut(endpoint, data) {
        if (!this.isOnline) return false;
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return response.ok;
        } catch (error) {
            console.error(`[FirebaseService] Cloud PUT ${endpoint} failed:`, error);
            return false;
        }
    }

    async cloudPost(endpoint, item) {
        if (!this.isOnline) return false;
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}.json`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });
            if (response.ok) {
                const result = await response.json();
                return result.name;
            }
            return false;
        } catch (error) {
            console.error(`[FirebaseService] Cloud POST ${endpoint} failed:`, error);
            return false;
        }
    }

    async cloudDelete(endpoint) {
        if (!this.isOnline) return false;
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}.json`, {
                method: 'DELETE'
            });
            return response.ok;
        } catch (error) {
            console.error(`[FirebaseService] Cloud DELETE ${endpoint} failed:`, error);
            return false;
        }
    }

    /**
     * Direct Fetch from Cloud First
     */
    async fetchCollectionFromCloud(key, endpoint, eventName, idKey = 'id') {
        if (!this.isOnline) return this.getCache(key) || [];

        const cloudData = await this.cloudGet(endpoint);
        if (cloudData !== null && typeof cloudData === 'object') {
            let itemsList = [];
            if (!Array.isArray(cloudData)) {
                itemsList = Object.keys(cloudData).map(id => ({
                    id,
                    ...cloudData[id]
                }));
            } else {
                itemsList = cloudData.filter(x => x !== null);
            }

            if (itemsList.length > 0) {
                this.setCache(key, itemsList);
                if (eventName) {
                    window.dispatchEvent(new CustomEvent(eventName, { detail: itemsList }));
                }
                return itemsList;
            }
        }
        return this.getCache(key) || [];
    }

    async syncAllFromCloud() {
        const collections = [
            { key: CONFIG.STORAGE_KEYS.STUDENTS, endpoint: CONFIG.FIREBASE.ENDPOINTS.STUDENTS, event: 'studentsUpdated', idKey: 'id' },
            { key: CONFIG.STORAGE_KEYS.TEACHERS, endpoint: CONFIG.FIREBASE.ENDPOINTS.TEACHERS, event: 'teachersUpdated', idKey: 'id' },
            { key: CONFIG.STORAGE_KEYS.USERS, endpoint: CONFIG.FIREBASE.ENDPOINTS.USERS, event: 'usersUpdated', idKey: 'id' },
            { key: CONFIG.STORAGE_KEYS.SCREENINGS, endpoint: CONFIG.FIREBASE.ENDPOINTS.SCREENINGS, event: 'screeningsUpdated', idKey: 'id' },
            { key: CONFIG.STORAGE_KEYS.MERITS, endpoint: CONFIG.FIREBASE.ENDPOINTS.MERITS, event: 'meritsUpdated', idKey: 'id' },
            { key: CONFIG.STORAGE_KEYS.OFFENSES, endpoint: CONFIG.FIREBASE.ENDPOINTS.OFFENSES, event: 'offensesUpdated', idKey: 'id' },
            { key: CONFIG.STORAGE_KEYS.REFERRALS, endpoint: CONFIG.FIREBASE.ENDPOINTS.REFERRALS, event: 'referralsUpdated', idKey: 'id' },
            { key: CONFIG.STORAGE_KEYS.ACTIVITIES, endpoint: CONFIG.FIREBASE.ENDPOINTS.ACTIVITIES, event: 'activitiesUpdated', idKey: 'id' }
        ];

        const recentSave = this._lastSaveTime && (Date.now() - this._lastSaveTime < 15000);

        for (const item of collections) {
            if (recentSave && item.key === CONFIG.STORAGE_KEYS.STUDENTS) {
                continue;
            }

            const cloudData = await this.cloudGet(item.endpoint);
            if (cloudData !== null) {
                let itemsList = [];
                if (typeof cloudData === 'object' && !Array.isArray(cloudData)) {
                    itemsList = Object.keys(cloudData).map(id => ({
                        id,
                        ...cloudData[id]
                    }));
                } else if (Array.isArray(cloudData)) {
                    itemsList = cloudData.filter(x => x !== null);
                }

                const localData = this.getCache(item.key) || [];

                // Empty Cloud Guard: Never wipe local cache if cloud returns 0 items while local has items
                if (itemsList.length === 0 && localData.length > 0) {
                    if (this.isOnline) {
                        const cloudObject = {};
                        localData.forEach(s => { 
                            const safeKey = String(s.id || s.studentId || s.username || s.teacherId).replace(/[\.#\$\[\]\/]/g, '_');
                            cloudObject[safeKey] = s; 
                        });
                        this.cloudPut(item.endpoint, cloudObject);
                    }
                    window.dispatchEvent(new CustomEvent(item.event, { detail: localData }));
                    continue;
                }

                const map = new Map();
                localData.forEach(it => {
                    const k = it.id || it.studentId || (item.idKey && it[item.idKey]);
                    if (k) map.set(k, it);
                });

                itemsList.forEach(it => {
                    const k = it.id || it.studentId || (item.idKey && it[item.idKey]);
                    if (k) {
                        const localItem = map.get(k);
                        if (!localItem) map.set(k, it);
                        else map.set(k, { ...it, ...localItem });
                    }
                });

                const merged = Array.from(map.values());

                if (merged.length > 0) {
                    this.setCache(item.key, merged);
                    if (localData.length > itemsList.length && this.isOnline) {
                        const cloudObject = {};
                        merged.forEach(s => { 
                            const safeKey = String(s.id || s.studentId || s.username || s.teacherId).replace(/[\.#\$\[\]\/]/g, '_');
                            cloudObject[safeKey] = s; 
                        });
                        this.cloudPut(item.endpoint, cloudObject);
                    }
                    window.dispatchEvent(new CustomEvent(item.event, { detail: merged }));
                }
            }
        }
    }

    // ====================================================================
    // DIRECT CLOUD FIRST ENTITY CRUD OPERATIONS
    // ====================================================================

    // 1. Students
    getStudents() {
        return this.getCache(CONFIG.STORAGE_KEYS.STUDENTS) || [];
    }

    async fetchStudentsFromCloud() {
        return await this.fetchCollectionFromCloud(CONFIG.STORAGE_KEYS.STUDENTS, CONFIG.FIREBASE.ENDPOINTS.STUDENTS, 'studentsUpdated');
    }

    async saveStudent(student) {
        const students = this.getStudents();
        if (!student.id) {
            student.id = 'STD_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
            student.createdAt = new Date().toISOString();
        }
        student.updatedAt = new Date().toISOString();

        const index = students.findIndex(s => s.id === student.id || (s.studentId && s.studentId === student.studentId));
        if (index >= 0) students[index] = { ...students[index], ...student };
        else students.unshift(student);

        // Direct Cloud First Save
        if (this.isOnline) {
            const safeKey = String(student.id).replace(/[\.#\$\[\]\/]/g, '_');
            await this.cloudPut(`${CONFIG.FIREBASE.ENDPOINTS.STUDENTS}/${safeKey}`, student);
        }

        this.setCache(CONFIG.STORAGE_KEYS.STUDENTS, students);
        this._lastSaveTime = Date.now();
        window.dispatchEvent(new CustomEvent('studentsUpdated', { detail: students }));

        if (this.isOnline) {
            const fresh = await this.fetchStudentsFromCloud();
            if (fresh && fresh.length > 0) return fresh.find(s => s.id === student.id) || student;
        }
        return student;
    }

    async saveStudentsBatch(newStudentsList) {
        let currentStudents = this.getStudents();
        const now = new Date().toISOString();

        newStudentsList.forEach((s, idx) => {
            if (!s.id) s.id = 'STD_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substr(2, 4);
            s.updatedAt = now;

            const sIdStr = String(s.studentId || '').trim();
            const index = currentStudents.findIndex(existing => {
                if (existing.id === s.id) return true;
                if (sIdStr && existing.studentId && String(existing.studentId).trim() === sIdStr) return true;
                return false;
            });

            if (index >= 0) currentStudents[index] = { ...currentStudents[index], ...s };
            else currentStudents.push(s);
        });

        // Step 1: Direct Cloud Save FIRST
        if (this.isOnline) {
            const cloudObject = {};
            currentStudents.forEach(s => { 
                const safeKey = String(s.id || s.studentId).replace(/[\.#\$\[\]\/]/g, '_');
                cloudObject[safeKey] = s; 
            });
            await this.cloudPut(CONFIG.FIREBASE.ENDPOINTS.STUDENTS, cloudObject);
        }

        // Step 2: Cache & Dispatch Event
        this.setCache(CONFIG.STORAGE_KEYS.STUDENTS, currentStudents);
        this._lastSaveTime = Date.now();
        window.dispatchEvent(new CustomEvent('studentsUpdated', { detail: currentStudents }));

        // Step 3: Direct Cloud Fetch to confirm
        if (this.isOnline) {
            const fresh = await this.fetchStudentsFromCloud();
            if (fresh && fresh.length > 0) return fresh;
        }

        return currentStudents;
    }

    async deleteStudent(studentId) {
        let students = this.getStudents();
        const target = students.find(s => s.id === studentId || s.studentId === studentId);
        const realId = target ? target.id : studentId;
        students = students.filter(s => s.id !== realId && s.studentId !== realId);

        if (this.isOnline) {
            const safeKey = String(realId).replace(/[\.#\$\[\]\/]/g, '_');
            await this.cloudDelete(`${CONFIG.FIREBASE.ENDPOINTS.STUDENTS}/${safeKey}`);
        }

        this.setCache(CONFIG.STORAGE_KEYS.STUDENTS, students);
        this._lastSaveTime = Date.now();
        window.dispatchEvent(new CustomEvent('studentsUpdated', { detail: students }));
        return true;
    }

    async deleteStudentsBatch(grade, room) {
        let students = this.getStudents();
        const normTargetGrade = (!grade || grade === 'ALL') ? 'ALL' : String(grade).trim().replace(/["']/g, '');

        let toDelete = students.filter(s => {
            let sGradeNorm = String(s.grade || '').trim().replace(/["']/g, '');
            if (sGradeNorm.includes('ม.1')) sGradeNorm = 'ม.1';
            else if (sGradeNorm.includes('ม.2')) sGradeNorm = 'ม.2';
            else if (sGradeNorm.includes('ม.3')) sGradeNorm = 'ม.3';
            else if (sGradeNorm.includes('ม.4')) sGradeNorm = 'ม.4';
            else if (sGradeNorm.includes('ม.5')) sGradeNorm = 'ม.5';
            else if (sGradeNorm.includes('ม.6')) sGradeNorm = 'ม.6';
            else if (sGradeNorm.includes('ปวช.1')) sGradeNorm = 'ปวช.1';
            else if (sGradeNorm.includes('ปวช.2')) sGradeNorm = 'ปวช.2';
            else if (sGradeNorm.includes('ปวช.3')) sGradeNorm = 'ปวช.3';

            const matchGrade = (normTargetGrade === 'ALL') ? true : (sGradeNorm.includes(normTargetGrade) || normTargetGrade.includes(sGradeNorm));
            const matchRoom = (!room || room === 'ALL') ? true : (String(s.room).trim() === String(room).trim());
            return matchGrade && matchRoom;
        });

        const deleteIds = new Set(toDelete.map(s => s.id));
        students = students.filter(s => !deleteIds.has(s.id));

        if (this.isOnline) {
            const cloudObject = {};
            students.forEach(s => { 
                const safeKey = String(s.id || s.studentId).replace(/[\.#\$\[\]\/]/g, '_');
                cloudObject[safeKey] = s; 
            });
            await this.cloudPut(CONFIG.FIREBASE.ENDPOINTS.STUDENTS, cloudObject);
        }

        this.setCache(CONFIG.STORAGE_KEYS.STUDENTS, students);
        this._lastSaveTime = Date.now();
        window.dispatchEvent(new CustomEvent('studentsUpdated', { detail: students }));
        return toDelete.length;
    }

    // 2. Teachers
    getTeachers() {
        return this.getCache(CONFIG.STORAGE_KEYS.TEACHERS) || [];
    }

    async fetchTeachersFromCloud() {
        return await this.fetchCollectionFromCloud(CONFIG.STORAGE_KEYS.TEACHERS, CONFIG.FIREBASE.ENDPOINTS.TEACHERS, 'teachersUpdated');
    }

    async saveTeacher(teacher) {
        const teachers = this.getTeachers();
        if (!teacher.id) {
            teacher.id = 'TCH_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
            teacher.createdAt = new Date().toISOString();
        }
        teacher.updatedAt = new Date().toISOString();

        const index = teachers.findIndex(t => t.id === teacher.id || (t.teacherId && t.teacherId === teacher.teacherId));
        if (index >= 0) teachers[index] = { ...teachers[index], ...teacher };
        else teachers.unshift(teacher);

        if (this.isOnline) {
            const safeKey = String(teacher.id).replace(/[\.#\$\[\]\/]/g, '_');
            await this.cloudPut(`${CONFIG.FIREBASE.ENDPOINTS.TEACHERS}/${safeKey}`, teacher);
        }

        this.setCache(CONFIG.STORAGE_KEYS.TEACHERS, teachers);
        window.dispatchEvent(new CustomEvent('teachersUpdated', { detail: teachers }));

        if (this.isOnline) {
            const fresh = await this.fetchTeachersFromCloud();
            if (fresh && fresh.length > 0) return fresh.find(t => t.id === teacher.id) || teacher;
        }
        return teacher;
    }

    async saveTeachersBatch(newTeachersList) {
        const teachers = this.getTeachers();
        const map = new Map();
        teachers.forEach(t => { const k = t.id || t.fullName; if (k) map.set(k, t); });

        newTeachersList.forEach((t, idx) => {
            if (!t.id) t.id = 'TCH_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substr(2, 4);
            t.updatedAt = new Date().toISOString();
            const k = t.id || t.fullName;
            map.set(k, t);
        });

        const merged = Array.from(map.values());

        if (this.isOnline) {
            const cloudObject = {};
            merged.forEach(t => { 
                const safeKey = String(t.id || t.teacherId || t.fullName).replace(/[\.#\$\[\]\/]/g, '_');
                cloudObject[safeKey] = t; 
            });
            await this.cloudPut(CONFIG.FIREBASE.ENDPOINTS.TEACHERS, cloudObject);
        }

        this.setCache(CONFIG.STORAGE_KEYS.TEACHERS, merged);
        window.dispatchEvent(new CustomEvent('teachersUpdated', { detail: merged }));

        if (this.isOnline) {
            const fresh = await this.fetchTeachersFromCloud();
            if (fresh && fresh.length > 0) return fresh;
        }
        return merged;
    }

    async deleteTeacher(teacherId) {
        let teachers = this.getTeachers();
        const target = teachers.find(t => t.id === teacherId || t.teacherId === teacherId);
        const realId = target ? target.id : teacherId;
        teachers = teachers.filter(t => t.id !== realId && t.teacherId !== realId);

        if (this.isOnline) {
            const safeKey = String(realId).replace(/[\.#\$\[\]\/]/g, '_');
            await this.cloudDelete(`${CONFIG.FIREBASE.ENDPOINTS.TEACHERS}/${safeKey}`);
        }

        this.setCache(CONFIG.STORAGE_KEYS.TEACHERS, teachers);
        window.dispatchEvent(new CustomEvent('teachersUpdated', { detail: teachers }));
        return true;
    }

    // 3. User Accounts
    getUsers() {
        return this.getCache(CONFIG.STORAGE_KEYS.USERS) || [];
    }

    async fetchUsersFromCloud() {
        return await this.fetchCollectionFromCloud(CONFIG.STORAGE_KEYS.USERS, CONFIG.FIREBASE.ENDPOINTS.USERS, 'usersUpdated');
    }

    async saveUser(user) {
        const users = this.getUsers();
        if (!user.id) {
            user.id = 'USR_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
            user.createdAt = new Date().toISOString();
        }
        user.updatedAt = new Date().toISOString();

        const index = users.findIndex(u => u.id === user.id || (u.username && u.username === user.username));
        if (index >= 0) users[index] = { ...users[index], ...user };
        else users.unshift(user);

        if (this.isOnline) {
            const safeKey = String(user.id || user.username).replace(/[\.#\$\[\]\/]/g, '_');
            await this.cloudPut(`${CONFIG.FIREBASE.ENDPOINTS.USERS}/${safeKey}`, user);
        }

        this.setCache(CONFIG.STORAGE_KEYS.USERS, users);
        window.dispatchEvent(new CustomEvent('usersUpdated', { detail: users }));
        return user;
    }

    async deleteUser(userId) {
        let users = this.getUsers();
        const target = users.find(u => u.id === userId || u.username === userId);
        const realId = target ? target.id : userId;
        users = users.filter(u => u.id !== realId && u.username !== realId);

        if (this.isOnline) {
            const safeKey = String(realId).replace(/[\.#\$\[\]\/]/g, '_');
            await this.cloudDelete(`${CONFIG.FIREBASE.ENDPOINTS.USERS}/${safeKey}`);
        }

        this.setCache(CONFIG.STORAGE_KEYS.USERS, users);
        window.dispatchEvent(new CustomEvent('usersUpdated', { detail: users }));
        return true;
    }

    // 4. Screenings
    getScreenings() {
        return this.getCache(CONFIG.STORAGE_KEYS.SCREENINGS) || [];
    }

    async fetchScreeningsFromCloud() {
        return await this.fetchCollectionFromCloud(CONFIG.STORAGE_KEYS.SCREENINGS, CONFIG.FIREBASE.ENDPOINTS.SCREENINGS, 'screeningsUpdated');
    }

    async saveScreening(screening) {
        const screenings = this.getScreenings();
        if (!screening.id) {
            screening.id = 'SCR_' + Date.now();
            screening.createdAt = new Date().toISOString();
        }
        screening.updatedAt = new Date().toISOString();

        const index = screenings.findIndex(s => s.id === screening.id);
        if (index >= 0) screenings[index] = screening;
        else screenings.unshift(screening);

        if (this.isOnline) {
            const safeKey = String(screening.id).replace(/[\.#\$\[\]\/]/g, '_');
            await this.cloudPut(`${CONFIG.FIREBASE.ENDPOINTS.SCREENINGS}/${safeKey}`, screening);
        }

        this.setCache(CONFIG.STORAGE_KEYS.SCREENINGS, screenings);
        window.dispatchEvent(new CustomEvent('screeningsUpdated', { detail: screenings }));
        return screening;
    }

    // 5. Merits
    getMerits() {
        return this.getCache(CONFIG.STORAGE_KEYS.MERITS) || [];
    }

    async fetchMeritsFromCloud() {
        return await this.fetchCollectionFromCloud(CONFIG.STORAGE_KEYS.MERITS, CONFIG.FIREBASE.ENDPOINTS.MERITS, 'meritsUpdated');
    }

    async saveMerit(merit) {
        const merits = this.getMerits();
        if (!merit.id) {
            merit.id = 'MRT_' + Date.now();
            merit.createdAt = new Date().toISOString();
        }
        merit.updatedAt = new Date().toISOString();

        const index = merits.findIndex(m => m.id === merit.id);
        if (index >= 0) merits[index] = merit;
        else merits.unshift(merit);

        if (this.isOnline) {
            const safeKey = String(merit.id).replace(/[\.#\$\[\]\/]/g, '_');
            await this.cloudPut(`${CONFIG.FIREBASE.ENDPOINTS.MERITS}/${safeKey}`, merit);
        }

        this.setCache(CONFIG.STORAGE_KEYS.MERITS, merits);
        window.dispatchEvent(new CustomEvent('meritsUpdated', { detail: merits }));
        return merit;
    }

    // 6. Offenses
    getOffenses() {
        return this.getCache(CONFIG.STORAGE_KEYS.OFFENSES) || [];
    }

    async fetchOffensesFromCloud() {
        return await this.fetchCollectionFromCloud(CONFIG.STORAGE_KEYS.OFFENSES, CONFIG.FIREBASE.ENDPOINTS.OFFENSES, 'offensesUpdated');
    }

    async saveOffense(offense) {
        const offenses = this.getOffenses();
        if (!offense.id) {
            offense.id = 'OFF_' + Date.now();
            offense.createdAt = new Date().toISOString();
        }
        offense.updatedAt = new Date().toISOString();

        const index = offenses.findIndex(o => o.id === offense.id);
        if (index >= 0) offenses[index] = offense;
        else offenses.unshift(offense);

        if (this.isOnline) {
            const safeKey = String(offense.id).replace(/[\.#\$\[\]\/]/g, '_');
            await this.cloudPut(`${CONFIG.FIREBASE.ENDPOINTS.OFFENSES}/${safeKey}`, offense);
        }

        this.setCache(CONFIG.STORAGE_KEYS.OFFENSES, offenses);
        window.dispatchEvent(new CustomEvent('offensesUpdated', { detail: offenses }));
        return offense;
    }

    async deleteOffense(offenseId) {
        let offenses = this.getOffenses();
        offenses = offenses.filter(o => o.id !== offenseId);

        if (this.isOnline) {
            const safeKey = String(offenseId).replace(/[\.#\$\[\]\/]/g, '_');
            await this.cloudDelete(`${CONFIG.FIREBASE.ENDPOINTS.OFFENSES}/${safeKey}`);
        }

        this.setCache(CONFIG.STORAGE_KEYS.OFFENSES, offenses);
        window.dispatchEvent(new CustomEvent('offensesUpdated', { detail: offenses }));
        return true;
    }

    // 7. Referrals
    getReferrals() {
        return this.getCache(CONFIG.STORAGE_KEYS.REFERRALS) || [];
    }

    async fetchReferralsFromCloud() {
        return await this.fetchCollectionFromCloud(CONFIG.STORAGE_KEYS.REFERRALS, CONFIG.FIREBASE.ENDPOINTS.REFERRALS, 'referralsUpdated');
    }

    async saveReferral(referral) {
        const referrals = this.getReferrals();
        if (!referral.id) {
            referral.id = 'REF_' + Date.now();
            referral.createdAt = new Date().toISOString();
        }
        referral.updatedAt = new Date().toISOString();

        const index = referrals.findIndex(r => r.id === referral.id);
        if (index >= 0) referrals[index] = referral;
        else referrals.unshift(referral);

        if (this.isOnline) {
            const safeKey = String(referral.id).replace(/[\.#\$\[\]\/]/g, '_');
            await this.cloudPut(`${CONFIG.FIREBASE.ENDPOINTS.REFERRALS}/${safeKey}`, referral);
        }

        this.setCache(CONFIG.STORAGE_KEYS.REFERRALS, referrals);
        window.dispatchEvent(new CustomEvent('referralsUpdated', { detail: referrals }));
        return referral;
    }

    // 8. Activities
    getActivities() {
        return this.getCache(CONFIG.STORAGE_KEYS.ACTIVITIES) || [
            { id: 'ACT_1', name: 'จิตอาสาพัฒนาโรงเรียน', points: 10, category: 'สาธารณประโยชน์' },
            { id: 'ACT_2', name: 'สวดมนต์ไหว้พระประจำสัปดาห์', points: 5, category: 'คุณธรรมจริยธรรม' },
            { id: 'ACT_3', name: 'ช่วยงานห้องพยาบาล/ห้องสภานักเรียน', points: 15, category: 'บำเพ็ญประโยชน์' },
            { id: 'ACT_4', name: 'ร่วมกิจกรรมต่อต้านยาเสพติด', points: 10, category: 'รณรงค์และส่งเสริม' }
        ];
    }

    async fetchActivitiesFromCloud() {
        return await this.fetchCollectionFromCloud(CONFIG.STORAGE_KEYS.ACTIVITIES, CONFIG.FIREBASE.ENDPOINTS.ACTIVITIES, 'activitiesUpdated');
    }

    async saveActivity(activity) {
        const activities = this.getActivities();
        if (!activity.id) {
            activity.id = 'ACT_' + Date.now();
        }
        const index = activities.findIndex(a => a.id === activity.id);
        if (index >= 0) activities[index] = activity;
        else activities.unshift(activity);

        if (this.isOnline) {
            const safeKey = String(activity.id).replace(/[\.#\$\[\]\/]/g, '_');
            await this.cloudPut(`${CONFIG.FIREBASE.ENDPOINTS.ACTIVITIES}/${safeKey}`, activity);
        }

        this.setCache(CONFIG.STORAGE_KEYS.ACTIVITIES, activities);
        window.dispatchEvent(new CustomEvent('activitiesUpdated', { detail: activities }));
        return activity;
    }
}

// Global Singleton Instance
const firebaseService = new FirebaseService();
