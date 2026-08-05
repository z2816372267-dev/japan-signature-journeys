(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.querySelectorAll('.day-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.day-card');
      const nextOpen = !card.classList.contains('is-open');
      card.classList.toggle('is-open', nextOpen);
      button.setAttribute('aria-expanded', String(nextOpen));
    });
  });

  const navigation = document.querySelector('.journey-nav');
  const navigationLinks = [...document.querySelectorAll('.journey-nav a[href^="#"]')];
  const sections = navigationLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      if (!visible) return;
      navigationLinks.forEach((link) => {
        link.classList.toggle('is-active', link.getAttribute('href') === `#${visible.target.id}`);
      });
    }, {
      rootMargin: '-18% 0px -68% 0px',
      threshold: [0, .1, .3],
    });
    sections.forEach((section) => observer.observe(section));
  }

  navigationLinks.forEach((link) => {
    link.addEventListener('click', () => {
      if (!navigation || window.innerWidth > 760) return;
      window.setTimeout(() => {
        link.scrollIntoView({
          behavior: reducedMotion ? 'auto' : 'smooth',
          inline: 'center',
          block: 'nearest',
        });
      }, 80);
    });
  });

  const enquiry = document.querySelector('.enquiry-section');
  const form = document.getElementById('journeyEnquiryForm');
  const departure = document.getElementById('departure');
  const adults = document.getElementById('adults');
  const children = document.getElementById('children');
  const childAges = document.getElementById('childAges');
  const ageInputs = document.getElementById('ageInputs');
  const partyTotal = document.getElementById('partyTotal');
  const maxGuests = Math.max(1, Number(enquiry?.dataset.maxGuests || 8));

  if (departure) {
    const today = new Date();
    const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
    departure.min = localDate;
  }

  function syncParty() {
    if (!adults || !children || !childAges || !ageInputs || !partyTotal) return;
    const adultCount = Number(adults.value || 1);
    let childCount = Number(children.value || 0);
    const allowedChildren = Math.max(0, maxGuests - adultCount);

    [...children.options].forEach((option) => {
      option.disabled = Number(option.value) > allowedChildren;
    });
    if (childCount > allowedChildren) {
      childCount = allowedChildren;
      children.value = String(childCount);
    }

    childAges.hidden = childCount === 0;
    ageInputs.replaceChildren(...Array.from({ length: childCount }, (_, index) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.name = `childAge${index + 1}`;
      input.min = '0';
      input.max = '17';
      input.required = true;
      input.inputMode = 'numeric';
      input.placeholder = `儿童${index + 1}年龄`;
      input.setAttribute('aria-label', `儿童${index + 1}年龄`);
      return input;
    }));
    partyTotal.textContent = `同行共 ${adultCount + childCount} 位（本行程最多 ${maxGuests} 位）`;
  }

  adults?.addEventListener('change', syncParty);
  children?.addEventListener('change', syncParty);
  syncParty();

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = '已记录咨询信息';
    const note = form.querySelector('.form-note');
    note.textContent = '演示信息已在本页完成校验；接入正式客服渠道后会在这里提交。';
  });
})();
