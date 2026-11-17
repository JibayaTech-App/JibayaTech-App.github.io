'use strict';

/**
 * auth-success.js — منطق تسليم العودة من Google OAuth (#294).
 * يُحمَّل من auth-success.html عبر <script src>؛ الصفحة نفسها بلا منطق أعمال.
 */

(function () {
    const AUTO_LAUNCH_DELAY_MS = 1000;
    const BUTTON_COOLDOWN_MS = 1500;
    const UNCONFIRMED_DELAY_MS = 15000;
    const ALLOWED_KEYS = ['code', 'attempt_id', 'type', 'error', 'error_description'];
    const EVENT_ERROR = 'oauth_web_error';
    const EVENT_UNCONFIRMED = 'oauth_web_handoff_unconfirmed_15s';
    const REASON_UNCONFIRMED = 'handoff_unconfirmed';
    // مفتاح نشر عام (anon) عمداً: مُسمَّح به صراحةً في .gitleaks.toml، وRLS يحمي الجدول.
    const PUBLISHABLE_KEY = 'sb_publishable_58oRALrpYMsE7AJoVL9GBg_q5wtqytv';
    const DIAGNOSTICS_URL = 'https://jtjrncwyeasptvtrihep.supabase.co/rest/v1/auth_diagnostics';
    const rawParams = new Map();

    function readParams(source) {
        if (!source) return;
        new URLSearchParams(source).forEach(function (value, key) {
            // تصفية عند القراءة: لا تُخزَّن أي رموز جلسة أصلاً، لا في الرابط ولا في الذاكرة.
            if (ALLOWED_KEYS.includes(key) && !rawParams.has(key)) rawParams.set(key, value);
        });
    }

    function warnDiagnostic(err, label) {
        console.warn('[Fiscano Auth] diagnostic ' + label + ':', err && err.message);
    }

    readParams(window.location.search);
    readParams((window.location.hash || '').replace(/^#/, ''));

    // مسح فوري لشريط العنوان قبل أي محاولة فتح تلقائية
    if (window.history && typeof window.history.replaceState === 'function') {
        window.history.replaceState(null, '', window.location.pathname || '/auth-success.html');
    }

    // قائمة بيضاء صارمة: لا تُقرأ ولا تُمرَّر أي رموز جلسة
    const safeParams = new URLSearchParams();
    for (const key of ALLOWED_KEYS) {
        const value = rawParams.get(key);
        if (value) safeParams.set(key, value);
    }

    let targetUrl = "fiscano://auth-callback";
    const queryString = safeParams.toString();
    if (queryString) targetUrl += '?' + queryString;

    const attemptId = rawParams.get('attempt_id') || '';
    const openButton = document.getElementById('open-app-btn');
    const edgeHint = document.getElementById('edge-hint');
    const edgeOnlyHint = document.getElementById('edge-only-hint');
    const userAgent = (window.navigator && window.navigator.userAgent) || '';
    if (/Edg\//.test(userAgent)) {
        if (edgeHint) edgeHint.classList.add('is-edge');
        if (edgeOnlyHint) edgeOnlyHint.hidden = false;
    }

    function reportWebDiagnostic(event, reasonCode) {
        if (typeof fetch !== 'function') return;
        try {
            fetch(DIAGNOSTICS_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': PUBLISHABLE_KEY,
                    'Authorization': 'Bearer ' + PUBLISHABLE_KEY,
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    event: event,
                    reason_code: reasonCode || null,
                    context: {
                        attempt_id: attemptId.slice(0, 64) || null,
                        source: 'auth-success-page',
                        has_code: Boolean(rawParams.get('code')),
                        url_len: targetUrl.length
                    }
                })
            }).catch(function (err) { warnDiagnostic(err, 'skipped'); });
        } catch (err) {
            warnDiagnostic(err, 'error');
        }
    }

    function disableButtonTemporarily() {
        if (!openButton) return;
        openButton.disabled = true;
        openButton.classList.add('is-busy');
        setTimeout(function () {
            openButton.disabled = false;
            openButton.classList.remove('is-busy');
        }, BUTTON_COOLDOWN_MS);
    }

    function openApp() { window.location.href = targetUrl; }

    const autoLaunchTimer = { id: null };
    if (openButton) {
        openButton.href = targetUrl;
        openButton.addEventListener('click', function (event) {
            if (event && typeof event.preventDefault === 'function') event.preventDefault();
            if (openButton.disabled) return;
            if (autoLaunchTimer.id !== null) {
                clearTimeout(autoLaunchTimer.id);
                autoLaunchTimer.id = null;
            }
            disableButtonTemporarily();
            openApp();
        });
    }

    // مؤقت واحد لكل تحميل صفحة ⇒ فتح تلقائي واحد لكل attempt_id؛ لا حاجة إلى سجل تكرار.
    if (queryString) {
        autoLaunchTimer.id = setTimeout(function () {
            autoLaunchTimer.id = null;
            disableButtonTemporarily();
            // تنبيه الـ15s يبقى بعد الفتح التلقائي: Edge قد يحجب نافذة البروتوكول،
            // والصفحة لا تملك وسيلة للتحقق من استلام التطبيق للرابط.
            openApp();
        }, AUTO_LAUNCH_DELAY_MS);
    }

    if (rawParams.get('error')) {
        reportWebDiagnostic(EVENT_ERROR, rawParams.get('error'));
    } else if (queryString && attemptId) {
        // النقر اليدوي لا يؤكد الاستلام، لذا لا يُلغى هذا التنبيه عنده.
        setTimeout(function () {
            reportWebDiagnostic(EVENT_UNCONFIRMED, REASON_UNCONFIRMED);
        }, UNCONFIRMED_DELAY_MS);
    }
})();
