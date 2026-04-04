// ─── ChainLend Homepage Script ────────────────────────────────────────────────

// ─── Fade-in on Scroll ────────────────────────────────────────────────────────
// Uses IntersectionObserver to trigger fade-in when elements scroll into view.
(function () {
  const fadeEls = document.querySelectorAll('.h-fade-in');

  if (!fadeEls.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('h-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  fadeEls.forEach((el) => observer.observe(el));
})();

// ─── Smooth Scroll for Nav Links ──────────────────────────────────────────────
document.querySelectorAll('.h-nav-link[href^="#"]').forEach((link) => {
  link.addEventListener('click', (e) => {
    const targetId = link.getAttribute('href');
    const target = document.querySelector(targetId);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ─── Header opacity on scroll ─────────────────────────────────────────────────
(function () {
  const header = document.querySelector('.h-header');
  if (!header) return;

  let ticking = false;

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        if (window.scrollY > 80) {
          header.style.borderBottomColor = '#333';
        } else {
          header.style.borderBottomColor = '#2a2a2a';
        }
        ticking = false;
      });
      ticking = true;
    }
  });
})();
