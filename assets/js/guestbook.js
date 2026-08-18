
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
    initializeAppCheck, ReCaptchaV3Provider
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js';
import {
    getFirestore, collection, addDoc, deleteDoc, doc,
    onSnapshot, query, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
    getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const cfg = window.__FIREBASE_CONFIG__;
if (!cfg || !cfg.apiKey) {
    console.warn('[guestbook] no firebase config — skipping.');
} else {
    const listEl   = document.getElementById('guestbook-list');
    const addBtn   = document.getElementById('guestbook-add');
    const modal    = document.getElementById('gb-modal');
    const canvas   = document.getElementById('gb-canvas');
    const textEl   = document.getElementById('gb-text');
    const nameEl   = document.getElementById('gb-name');
    const submitEl = document.getElementById('gb-submit');

    if (listEl && addBtn && modal && canvas && textEl && nameEl && submitEl) {

        const app = initializeApp(cfg);

        if (cfg.appCheckSiteKey) {
            try {
                initializeAppCheck(app, {
                    provider: new ReCaptchaV3Provider(cfg.appCheckSiteKey),
                    isTokenAutoRefreshEnabled: true
                });
            } catch (e) { console.warn('[guestbook] app check init failed:', e.message); }
        }

        const db = getFirestore(app);
        const auth = getAuth(app);
        const gbRef = collection(db, 'guestbook');

        let isOwner = false;

        document.addEventListener('keydown', (e) => {
            if (e.altKey && e.shiftKey && (e.key === 'G' || e.key === 'g')) {
                e.preventDefault();
                if (auth.currentUser) {
                    signOut(auth);
                } else {
                    signInWithPopup(auth, new GoogleAuthProvider()).catch((err) => {
                        console.warn('[guestbook] sign-in failed:', err.message);
                    });
                }
            }
        });
        onAuthStateChanged(auth, (user) => {
            isOwner = !!(user && user.email === cfg.ownerEmail);
            document.documentElement.dataset.gbOwner = isOwner ? 'true' : 'false';
            if (!user) signInAnonymously(auth).catch(() => {});
        });

        function render(entries) {
            listEl.innerHTML = '';
            if (!entries.length) {
                const empty = document.createElement('li');
                empty.className = 'guestbook-empty';
                empty.textContent = 'nothing yet — be the first to leave a mark.';
                listEl.appendChild(empty);
                return;
            }
            entries.forEach((e) => {
                const li = document.createElement('li');
                li.className = 'guestbook-entry';
                li.style.setProperty('--tilt', ((Math.random() * 2 - 1) * 1.4).toFixed(2) + 'deg');

                if (e.image) {
                    const img = document.createElement('img');
                    img.className = 'guestbook-entry__img';
                    img.src = e.image;
                    img.alt = '';
                    li.appendChild(img);
                }
                if (e.text) {
                    const t = document.createElement('p');
                    t.className = 'guestbook-entry__text';
                    t.textContent = e.text;
                    li.appendChild(t);
                }
                const meta = document.createElement('p');
                meta.className = 'guestbook-entry__meta';
                const who = e.name ? e.name : 'a quiet one';
                const when = e.ts && e.ts.toDate
                    ? e.ts.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    : '';
                meta.textContent = when ? `${who} · ${when}` : who;
                li.appendChild(meta);

                if (isOwner && e.__id) {
                    const del = document.createElement('button');
                    del.type = 'button';
                    del.className = 'guestbook-entry__del';
                    del.title = 'Delete';
                    del.setAttribute('aria-label', 'Delete this mark');
                    del.textContent = '×';
                    del.addEventListener('click', async () => {
                        if (!confirm('Delete this mark?')) return;
                        try { await deleteDoc(doc(db, 'guestbook', e.__id)); }
                        catch (err) { alert('Delete failed: ' + err.message); }
                    });
                    li.appendChild(del);
                }

                listEl.appendChild(li);
            });
        }

        const q = query(gbRef, orderBy('ts', 'desc'), limit(50));
        onSnapshot(q, (snap) => {
            const rows = [];
            snap.forEach((docSnap) => rows.push(Object.assign({ __id: docSnap.id }, docSnap.data())));
            render(rows);
        }, (err) => {
            console.warn('[guestbook] snapshot error:', err.message);
            listEl.innerHTML = '';
            const el = document.createElement('li');
            el.className = 'guestbook-empty';
            el.textContent = "couldn't reach the guestbook — try again later.";
            listEl.appendChild(el);
        });

        const ctx = canvas.getContext('2d');
        const strokes = [];
        let drawing = false;
        let current = null;

        function paintBg() {
            ctx.fillStyle = '#f6f0e0';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = 'rgba(31, 28, 44, .08)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, Math.floor(canvas.height * 0.66) + .5);
            ctx.lineTo(canvas.width, Math.floor(canvas.height * 0.66) + .5);
            ctx.stroke();
        }
        function redraw() {
            paintBg();
            ctx.strokeStyle = '#1f1c2c';
            ctx.lineWidth = 1.6;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            strokes.forEach((s) => {
                if (s.length < 2) return;
                ctx.beginPath();
                ctx.moveTo(s[0].x, s[0].y);
                for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
                ctx.stroke();
            });
        }
        function pointFrom(e) {
            const r = canvas.getBoundingClientRect();
            const t = e.touches && e.touches[0];
            const cx = (t ? t.clientX : e.clientX) - r.left;
            const cy = (t ? t.clientY : e.clientY) - r.top;
            return { x: cx * (canvas.width / r.width), y: cy * (canvas.height / r.height) };
        }
        function start(e) { e.preventDefault(); drawing = true; current = [pointFrom(e)]; }
        function move(e) {
            if (!drawing) return;
            e.preventDefault();
            current.push(pointFrom(e));
            redraw();
            ctx.strokeStyle = '#1f1c2c';
            ctx.beginPath();
            ctx.moveTo(current[0].x, current[0].y);
            for (let i = 1; i < current.length; i++) ctx.lineTo(current[i].x, current[i].y);
            ctx.stroke();
        }
        function end() {
            if (!drawing) return;
            drawing = false;
            if (current && current.length > 1) strokes.push(current);
            current = null;
            redraw();
        }

        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        canvas.addEventListener('mouseup', end);
        canvas.addEventListener('mouseleave', end);
        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', end);

        document.querySelectorAll('[data-gb-tool]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.gbTool;
                if (tool === 'clear') { strokes.length = 0; redraw(); }
                else if (tool === 'undo') { strokes.pop(); redraw(); }
            });
        });

        function focusables(root) {
            return Array.from(root.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
        }
        function onTrapKey(e) {
            if (e.key !== 'Tab') return;
            const items = focusables(modal);
            if (!items.length) return;
            const first = items[0];
            const last  = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
        function openModal() {
            modal.hidden = false;
            modal.setAttribute('aria-hidden', 'false');
            requestAnimationFrame(() => modal.classList.add('is-open'));
            document.body.style.overflow = 'hidden';
            modal.addEventListener('keydown', onTrapKey);
            setTimeout(() => textEl.focus(), 100);
        }
        function closeModal() {
            modal.classList.remove('is-open');
            addBtn.focus();
            modal.setAttribute('aria-hidden', 'true');
            modal.removeEventListener('keydown', onTrapKey);
            setTimeout(() => { modal.hidden = true; document.body.style.overflow = ''; }, 250);
        }
        function reset() { strokes.length = 0; redraw(); textEl.value = ''; nameEl.value = ''; }

        addBtn.addEventListener('click', () => { reset(); openModal(); });
        modal.querySelectorAll('[data-gb-close]').forEach((el) => el.addEventListener('click', closeModal));
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !modal.hidden) closeModal();
        });

        submitEl.addEventListener('click', async () => {
            const text = textEl.value.trim();
            const hasDrawing = strokes.length > 0;
            if (!text && !hasDrawing) { textEl.focus(); return; }

            let image = hasDrawing ? canvas.toDataURL('image/webp', 0.7) : '';
            if (image.length > 200000) image = canvas.toDataURL('image/webp', 0.4);
            if (image.length > 200000) { alert('drawing too heavy — simplify a bit?'); return; }

            submitEl.disabled = true;
            const prevLabel = submitEl.textContent;
            submitEl.textContent = 'saving…';
            try {
                await addDoc(gbRef, {
                    name: nameEl.value.trim().slice(0, 24),
                    text: text.slice(0, 240),
                    image,
                    ts: serverTimestamp()
                });
                closeModal();
            } catch (err) {
                alert('Could not save: ' + err.message);
            } finally {
                submitEl.disabled = false;
                submitEl.textContent = prevLabel;
            }
        });

        paintBg();
    }
}
