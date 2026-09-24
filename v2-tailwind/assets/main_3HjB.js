'use strict';

(() => {
    const header = document.querySelector('.ms-header');
    const toggle = document.querySelector('.ms-menu-toggle');
    const navigation = document.querySelector('.ms-navigation');
    const sequence = document.querySelector('[data-bottle-sequence]');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mobileMenu = window.matchMedia('(max-width: 760px)');
    const menuSlideDuration = 700;
    let frame = 0;
    let menuCloseTimer = 0;

    const finishMenuClose = (restoreFocus, onClosed) => {
        header?.classList.remove('is-menu-closing');
        document.body.classList.remove('is-menu-open');
        if (restoreFocus) toggle?.focus();
        onClosed?.();
    };

    const closeMenu = (restoreFocus = false, onClosed = null) => {
        window.clearTimeout(menuCloseTimer);
        const wasOpen = header?.classList.contains('is-menu-open');

        header?.classList.remove('is-menu-open');
        toggle?.setAttribute('aria-expanded', 'false');
        toggle?.setAttribute('aria-label', 'Abrir menú');

        if (!wasOpen || !mobileMenu.matches || reduceMotion.matches) {
            finishMenuClose(restoreFocus, onClosed);
            return;
        }

        header?.classList.add('is-menu-closing');
        menuCloseTimer = window.setTimeout(
            () => finishMenuClose(restoreFocus, onClosed),
            menuSlideDuration
        );
    };

    const openMenu = () => {
        window.clearTimeout(menuCloseTimer);
        header?.classList.remove('is-menu-closing');
        header?.classList.add('is-menu-open');
        document.body.classList.add('is-menu-open');
        toggle?.setAttribute('aria-expanded', 'true');
        toggle?.setAttribute('aria-label', 'Cerrar menú');
        window.requestAnimationFrame(() => navigation?.querySelector('a')?.focus());
    };

    toggle?.addEventListener('click', () => {
        if (header?.classList.contains('is-menu-open')) closeMenu(false);
        else openMenu();
    });

    const getSamePageDestination = link => {
        try {
            const url = new URL(link.href, window.location.href);
            const samePage = url.origin === window.location.origin
                && url.pathname === window.location.pathname
                && url.search === window.location.search;

            if (!samePage || !url.hash) return null;

            const id = decodeURIComponent(url.hash.slice(1));
            const target = id ? document.getElementById(id) : document.documentElement;
            return target ? {target, url} : null;
        } catch (error) {
            return null;
        }
    };

    const scrollToDestination = ({target, url}) => {
        if (window.location.hash !== url.hash) {
            window.history.pushState(null, '', url.hash);
        }
        target.scrollIntoView({
            behavior: reduceMotion.matches ? 'auto' : 'smooth',
            block: 'start'
        });
    };

    document.querySelectorAll('a[href*="#"]').forEach(link => {
        link.addEventListener('click', event => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

            const destination = getSamePageDestination(link);
            if (!destination) return;

            event.preventDefault();
            closeMenu(false, () => scrollToDestination(destination));
        });
    });

    window.addEventListener('hashchange', () => closeMenu(false));
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && header?.classList.contains('is-menu-open')) {
            closeMenu(true);
        }

        if (event.key === 'Tab' && mobileMenu.matches && header?.classList.contains('is-menu-open')) {
            const focusable = [toggle, ...(navigation?.querySelectorAll('a') || [])].filter(Boolean);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });
    mobileMenu.addEventListener?.('change', event => {
        if (!event.matches) closeMenu(false);
    });

    const updateHeader = () => {
        frame = 0;
        header?.classList.toggle('is-scrolled', window.scrollY > 40);
    };
    const schedule = () => {
        if (!frame) frame = window.requestAnimationFrame(updateHeader);
    };
    window.addEventListener('scroll', schedule, {passive: true});
    schedule();

    const reveal = [...document.querySelectorAll('[data-ms-reveal]')];
    const gsapControlsSequence = Boolean(sequence && window.gsap && window.ScrollTrigger);
    const gsapReveal = gsapControlsSequence ? reveal.filter(item => sequence.contains(item)) : [];
    const standardReveal = reveal.filter(item => !gsapReveal.includes(item));

    if (gsapControlsSequence) {
        const {gsap, ScrollTrigger} = window;
        gsap.registerPlugin(ScrollTrigger);
        document.documentElement.classList.add('has-gsap-scroll');

        const media = gsap.matchMedia();
        media.add('(prefers-reduced-motion: reduce)', () => {
            gsap.set(gsapReveal, {autoAlpha: 1, y: 0});
        });
        media.add('(prefers-reduced-motion: no-preference)', () => {
            gsapReveal.forEach(item => {
                gsap.fromTo(item, {autoAlpha: 0, y: 34}, {
                    autoAlpha: 1,
                    y: 0,
                    duration: 0.85,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: item,
                        start: 'top 88%',
                        toggleActions: 'play none none reverse'
                    }
                });
            });

            gsap.utils.toArray('.ms-scrolly .ms-panel__inner').forEach(inner => {
                gsap.fromTo(inner, {yPercent: -1.5}, {
                    yPercent: 1.5,
                    ease: 'none',
                    scrollTrigger: {
                        trigger: inner.closest('.ms-panel'),
                        start: 'top bottom',
                        end: 'bottom top',
                        scrub: 1
                    }
                });
            });
        });
    }

    if (reduceMotion.matches || !('IntersectionObserver' in window)) {
        standardReveal.forEach(item => item.classList.add('is-visible'));
    } else {
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            });
        }, {rootMargin: '0px 0px -8% 0px', threshold: .08});
        standardReveal.forEach(item => observer.observe(item));
        reduceMotion.addEventListener('change', () => {
            if (reduceMotion.matches) reveal.forEach(item => item.classList.add('is-visible'));
        });
    }
})();
