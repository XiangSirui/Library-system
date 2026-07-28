(function () {
  const menuButton = document.getElementById('gardenMenuBtn');
  const mobileMenu = document.getElementById('gardenMobileMenu');
  const header = document.getElementById('header');
  const lightbox = document.getElementById('gardenLightbox');
  const lightboxImage = document.getElementById('gardenLightboxImage');
  const lightboxCaption = document.getElementById('gardenLightboxCaption');
  const closeButton = document.getElementById('gardenLightboxClose');
  const previousButton = document.getElementById('gardenLightboxPrev');
  const nextButton = document.getElementById('gardenLightboxNext');

  const galleryItems = [
    {
      src: '/static/images/garden/garden-plan.jpg',
      caption: '社区共建花园整体平面图',
      alt: '社区共建花园整体平面图',
      isMap: true,
    },
    ...Array.from(document.querySelectorAll('.garden-photo')).map(button => ({
      src: button.dataset.image,
      caption: button.dataset.caption || '',
      alt: button.querySelector('img')?.alt || '花园共建照片',
      isMap: false,
    })),
  ];
  let activeIndex = 0;
  let lastFocusedElement = null;

  function closeMenu() {
    mobileMenu?.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
  }

  menuButton?.addEventListener('click', () => {
    const isOpen = mobileMenu.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(isOpen));
  });

  mobileMenu?.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeMenu);
  });

  window.addEventListener('scroll', () => {
    header?.classList.toggle('scrolled', window.scrollY > 24);
  }, { passive: true });

  function showLightbox(index) {
    if (!galleryItems.length) return;
    activeIndex = (index + galleryItems.length) % galleryItems.length;
    const item = galleryItems[activeIndex];
    const isOpening = !lightbox.classList.contains('open');
    if (isOpening) lastFocusedElement = document.activeElement;
    lightboxImage.src = item.src;
    lightboxImage.alt = item.alt;
    lightboxImage.classList.toggle('plan-image', item.isMap);
    lightboxCaption.textContent = item.caption;
    lightbox.classList.add('open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lightbox-open');
    if (isOpening) closeButton.focus();
  }

  function closeLightbox() {
    lightbox.classList.remove('open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lightbox-open');
    lightboxImage.src = '';
    lastFocusedElement?.focus();
  }

  document.getElementById('openGardenMap')?.addEventListener('click', () => showLightbox(0));

  document.querySelectorAll('.garden-photo').forEach((button, index) => {
    button.addEventListener('click', () => showLightbox(index + 1));
  });

  closeButton?.addEventListener('click', closeLightbox);
  previousButton?.addEventListener('click', () => showLightbox(activeIndex - 1));
  nextButton?.addEventListener('click', () => showLightbox(activeIndex + 1));

  lightbox?.addEventListener('click', event => {
    if (event.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', event => {
    if (!lightbox?.classList.contains('open')) return;
    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'ArrowLeft') showLightbox(activeIndex - 1);
    if (event.key === 'ArrowRight') showLightbox(activeIndex + 1);
  });
})();
