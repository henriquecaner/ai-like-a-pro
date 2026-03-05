// ===== MODAL HELPERS =====
let _lastFocused = null;

function _getFocusable(el) {
  return [...el.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )];
}

function _trapFocus(e) {
  const box = this.querySelector('.modal-box');
  const focusable = _getFocusable(box);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.key === 'Tab') {
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  if (e.key === 'Escape') closeModal(this.id);
}

function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  _lastFocused = document.activeElement;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  const focusable = _getFocusable(overlay);
  if (focusable.length) focusable[0].focus();
  overlay.addEventListener('keydown', _trapFocus);
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('active');
  document.body.style.overflow = '';
  overlay.removeEventListener('keydown', _trapFocus);
  if (_lastFocused) _lastFocused.focus();
}

document.addEventListener('DOMContentLoaded', () => {
  const navbar = document.getElementById('nav');
  const backToTop = document.getElementById('backToTop');
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');

  // ===== SCROLL (passive) =====
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 20);
    backToTop.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });

  // ===== BACK TO TOP =====
  backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // ===== HAMBURGER =====
  hamburger.addEventListener('click', () => {
    const isOpen = hamburger.classList.toggle('open');
    mobileMenu.classList.toggle('open', isOpen);
    hamburger.setAttribute('aria-expanded', String(isOpen));
  });

  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('open');
      mobileMenu.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });

  // ===== EVENT DELEGATION — modals & close buttons =====
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-modal]');
    if (trigger) { e.preventDefault(); openModal(trigger.dataset.modal); return; }
    const closer = e.target.closest('[data-close-modal]');
    if (closer) { closeModal(closer.dataset.closeModal); return; }
    // Clicar fora do modal-box fecha o modal
    const overlay = e.target.closest('.modal-overlay.active');
    if (overlay && e.target === overlay) closeModal(overlay.id);
  });

  // ===== SCROLL REVEAL =====
  const reveals = document.querySelectorAll('.reveal');
  const observer = new IntersectionObserver(
    (entries) => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }),
    { threshold: 0.15 }
  );
  reveals.forEach(el => observer.observe(el));
  // ===== WHATSAPP MASK =====
  const whatsInput = document.getElementById('cf-whatsapp');
  if (whatsInput) {
    whatsInput.addEventListener('input', function () {
      let v = this.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 6) v = '(' + v.slice(0, 2) + ') ' + v.slice(2, 7) + '-' + v.slice(7);
      else if (v.length > 2) v = '(' + v.slice(0, 2) + ') ' + v.slice(2);
      else if (v.length > 0) v = '(' + v;
      this.value = v;
    });
  }

  // ===== CHECKOUT FORM =====
  const form = document.getElementById('checkout-form');
  const submitBtn = document.getElementById('checkout-submit');
  const errorDiv = document.getElementById('checkout-form-error');
  const EDGE_FN_URL = '/create-checkout';

  if (form) {
    // M-03: flag para prevenir duplo envio (clique duplo / rede lenta)
    let isSubmitting = false;

    function showError(msg) {
      errorDiv.textContent = msg;
      errorDiv.classList.add('show');
    }

    function hideError() {
      errorDiv.classList.remove('show');
    }

    function setLoading(loading) {
      submitBtn.disabled = loading;
      submitBtn.classList.toggle('loading', loading);
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      // M-03: rejeita envios duplicados silenciosamente
      if (isSubmitting) return;

      hideError();
      form.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));

      const nome = document.getElementById('cf-nome').value.trim();
      const sobrenome = document.getElementById('cf-sobrenome').value.trim();
      const email = document.getElementById('cf-email').value.trim();
      const whatsapp = document.getElementById('cf-whatsapp').value.trim();
      const linkedin = document.getElementById('cf-linkedin').value.trim();

      let hasError = false;
      if (!nome) { document.getElementById('cf-nome').classList.add('input-error'); hasError = true; }
      if (!sobrenome) { document.getElementById('cf-sobrenome').classList.add('input-error'); hasError = true; }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        document.getElementById('cf-email').classList.add('input-error'); hasError = true;
      }
      if (!whatsapp || whatsapp.replace(/\D/g, '').length < 11) {
        document.getElementById('cf-whatsapp').classList.add('input-error'); hasError = true;
      }

      if (hasError) {
        showError('Por favor, preencha todos os campos obrigatórios corretamente.');
        return;
      }

      // Marca como em progresso ANTES do fetch para prevenir duplos envios
      isSubmitting = true;
      setLoading(true);

      try {
        const res = await fetch(EDGE_FN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome, sobrenome, email, whatsapp, linkedin }),
        });
        const data = await res.json();
        if (!res.ok || !data.checkout_url) {
          throw new Error(data.error || 'Erro ao gerar checkout. Tente novamente.');
        }
        window.location.href = data.checkout_url;
      } catch (err) {
        console.error('Checkout error:', err);
        showError(err.message || 'Erro inesperado. Tente novamente.');
        // Em caso de erro, libera o form para retry
        isSubmitting = false;
        setLoading(false);
      }
    });

    form.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', function () {
        this.classList.remove('input-error');
        hideError();
      });
    });
  }
});