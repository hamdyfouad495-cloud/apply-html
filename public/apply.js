/* ═══════════════════════════════════════════════════════════════
   apply.js — Application Form Logic with Turnstile & CSRF
   ═══════════════════════════════════════════════════════════════ */

let turnstileToken = null;

// Turnstile callback
window.onTurnstileSuccess = function(token) {
  turnstileToken = token;
  const field = document.getElementById('field-turnstile');
  if (field) field.classList.remove('invalid');
};

const VALIDATION_RULES = {
  name: (v) => /^[\p{L}\s'-]{3,40}$/u.test(v.trim()),
  age: (v) => /^\d+$/.test(v) && Number(v) >= 8 && Number(v) <= 99,
  discordName: (v) => v.trim().length >= 2 && v.trim().length <= 32,
  discordID: (v) => /^\d{15,20}$/.test(v.trim()),
  country: (v) => /^[\p{L}\s'-]{2,40}$/u.test(v.trim()),
  hours: (v) => /^\d+$/.test(v) && Number(v) >= 0 && Number(v) <= 24,
  experience: (v) => v.trim().length >= 10 && v.trim().length <= 1000
};

function validateField(id) {
  const input = document.getElementById(id);
  const wrapper = document.getElementById(`field-${id}`);
  if (!input || !wrapper) return true;

  const value = input.value;
  const valid = VALIDATION_RULES[id] ? VALIDATION_RULES[id](value) : true;

  if (valid) wrapper.classList.remove('invalid');
  else wrapper.classList.add('invalid');

  return valid;
}

function validateAll() {
  let valid = true;
  Object.keys(VALIDATION_RULES).forEach(id => {
    if (!validateField(id)) valid = false;
  });

  // Validate Turnstile
  const turnstileField = document.getElementById('field-turnstile');
  if (!turnstileToken && turnstileField) {
    turnstileField.classList.add('invalid');
    valid = false;
  }

  return valid;
}

function getFormData() {
  return {
    name: document.getElementById('name').value.trim(),
    age: document.getElementById('age').value.trim(),
    discordName: document.getElementById('discordName').value.trim(),
    discordID: document.getElementById('discordID').value.trim(),
    country: document.getElementById('country').value.trim(),
    hours: document.getElementById('hours').value.trim(),
    experience: document.getElementById('experience').value.trim(),
    turnstileToken: turnstileToken,
    _csrf: csrfToken
  };
}

function setLoading(loading) {
  const btn = document.getElementById('submitBtn');
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

async function handleSubmit(e) {
  e.preventDefault();

  if (!validateAll()) {
    showToast('يرجى تصحيح الأخطاء في الحقول المحددة', 'error');
    return;
  }

  setLoading(true);
  let submittedDiscordID = null;

  try {
    const data = getFormData();
    submittedDiscordID = data.discordID;
    const result = await apiPost('/api/apply', data);

    localStorage.setItem(STORAGE_KEY, data.discordID);

    showToast(result.message || 'تم إرسال طلبك بنجاح!', 'success');

    const form = document.getElementById('applyForm');
    const banner = document.getElementById('statusBanner');

    if (form) form.classList.add('hidden');
    if (banner) {
      renderStatusBanner(banner, 'pending', data.name);
      banner.classList.remove('hidden');
    }

    // Reset turnstile
    turnstileToken = null;
    if (window.turnstile) {
      window.turnstile.reset();
    }
  } catch (err) {
    console.error('Submit error:', err);

    if (err.message.includes('already submitted')) {
      const status = err.data?.status || 'pending';
      showToast('لقد قدمت طلبًا مسبقًا بهذا الآيدي', 'warning');

      const form = document.getElementById('applyForm');
      const banner = document.getElementById('statusBanner');
      if (form) form.classList.add('hidden');
      if (banner) {
        renderStatusBanner(banner, status);
        banner.classList.remove('hidden');
      }

      // Remember this ID so returning visitors see their real status banner too
      if (err.data?.id && submittedDiscordID) localStorage.setItem(STORAGE_KEY, submittedDiscordID);
    } else {
      showToast(err.message || 'حدث خطأ أثناء الإرسال، حاول مرة أخرى', 'error');
    }
  } finally {
    setLoading(false);
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('applyForm');
  if (!form) return;

  form.addEventListener('submit', handleSubmit);

  // Real-time validation
  Object.keys(VALIDATION_RULES).forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;

    input.addEventListener('blur', () => validateField(id));
    input.addEventListener('input', () => {
      const wrapper = document.getElementById(`field-${id}`);
      if (wrapper && wrapper.classList.contains('invalid')) {
        validateField(id);
      }
    });
  });

  hydrateStatusBanner();
});
