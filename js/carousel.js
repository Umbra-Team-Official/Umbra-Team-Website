(function () {
  document.querySelectorAll('[data-carousel]').forEach((root) => {
    const track = root.querySelector('.project__gallery-track');
    const slides = [...root.querySelectorAll('.project__screenshot')];
    const prevBtn = root.querySelector('[data-carousel-prev]');
    const nextBtn = root.querySelector('[data-carousel-next]');
    const dotsRoot = root.querySelector('[data-carousel-dots]');

    if (!track || slides.length === 0) return;

    let index = 0;

    function goTo(i) {
      index = ((i % slides.length) + slides.length) % slides.length;
      track.style.transform = `translateX(-${index * 100}%)`;
      dotsRoot?.querySelectorAll('.project__gallery-dot').forEach((dot, j) => {
        dot.classList.toggle('is-active', j === index);
      });
    }

    if (dotsRoot && slides.length > 1) {
      slides.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'project__gallery-dot' + (i === 0 ? ' is-active' : '');
        dot.setAttribute('aria-label', `Слайд ${i + 1}`);
        dot.addEventListener('click', () => goTo(i));
        dotsRoot.appendChild(dot);
      });
    }

    prevBtn?.addEventListener('click', () => goTo(index - 1));
    nextBtn?.addEventListener('click', () => goTo(index + 1));

    if (slides.length <= 1) {
      prevBtn?.setAttribute('hidden', '');
      nextBtn?.setAttribute('hidden', '');
    }
  });
})();
