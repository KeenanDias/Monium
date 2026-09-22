/* Landing-page interactions: smooth scroll, reveals, ambient background,
   sticky-nav shadow, beta signup.

   Everything here is progressive: if Lenis, GSAP, three or Vanta fail to load,
   the page still scrolls, still reveals its sections, and still signs people up.
   Each enhancement checks for its library and falls back. */
(function () {
  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* always open at the top — iOS otherwise restores scroll toward the bottom on reload/bfcache */
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  function pinTop() { if (!location.hash) window.scrollTo(0, 0); }
  pinTop();
  addEventListener("load", function () {
    pinTop();
    // load the embedded app only after we're pinned at the top, so it can't pull the page down
    var f = document.querySelector(".app-frame[data-src]");
    if (f) { f.src = f.getAttribute("data-src"); f.removeAttribute("data-src"); }
  });
  addEventListener("pageshow", function (e) { if (e.persisted) pinTop(); });

  /* ---------------------------------------------------------------
     Lenis — smooth scrolling
     --------------------------------------------------------------- */
  var lenis = null;

  if (typeof Lenis !== "undefined" && !reduceMotion) {
    lenis = new Lenis({
      duration: 1.05,
      // slight ease-out; the default is fine but this settles a touch softer
      easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
      smoothWheel: true,
      // Native momentum on touch is better than anything we can simulate, and
      // hijacking it on a phone is the fastest way to make a site feel broken.
      smoothTouch: false
    });

    // Lenis sets scroll-behavior itself; the CSS fallback would fight it
    document.documentElement.classList.add("lenis-active");

    if (typeof gsap !== "undefined" && gsap.ticker) {
      // Drive Lenis from GSAP's ticker so both share one RAF loop
      gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);
    } else {
      var raf = function (time) { lenis.raf(time); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }

    if (typeof ScrollTrigger !== "undefined") {
      lenis.on("scroll", ScrollTrigger.update);
    }

    // In-page anchors have to go through Lenis or they jump
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        var id = a.getAttribute("href");
        if (!id || id === "#") return;
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target, { offset: -74, duration: 1.2 });
      });
    });
  }

  /* ---------------------------------------------------------------
     Reveals — GSAP ScrollTrigger, falling back to IntersectionObserver
     --------------------------------------------------------------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

  if (reduceMotion) {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  } else if (typeof gsap !== "undefined" && typeof ScrollTrigger !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);

    // The CSS .reveal rule hides these; GSAP takes over from here, so drop the
    // transition to avoid two animations racing on the same properties.
    revealEls.forEach(function (el) { el.style.transition = "none"; });

    ScrollTrigger.batch(revealEls, {
      start: "top 88%",
      once: true,
      onEnter: function (batch) {
        gsap.to(batch, {
          opacity: 1,
          y: 0,
          duration: 0.85,
          ease: "power3.out",
          stagger: 0.09,
          overwrite: true
        });
      }
    });

    // Hero entrance — the one thing that shouldn't wait for a scroll
    var heroBits = document.querySelectorAll(
      ".hero .pill, .hero .hero-title, .hero .hero-sub, .hero .email-form, .hero .micro"
    );
    if (heroBits.length) {
      gsap.from(heroBits, {
        opacity: 0,
        y: 26,
        duration: 0.9,
        ease: "power3.out",
        stagger: 0.085,
        delay: 0.05
      });
    }

    // Parallax drift on the ambient blobs, tied to page scroll
    gsap.to(".blob.a", { yPercent: 18, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.6 } });
    gsap.to(".blob.b", { yPercent: -14, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.6 } });
    gsap.to(".blob.c", { yPercent: 10, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.8 } });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.15 });
    revealEls.forEach(function (el) { io.observe(el); });
  }

  /* ---------------------------------------------------------------
     Vanta — ambient WebGL background, desktop only

     three + vanta is ~600KB and runs a continuous render loop. That is a real
     battery and heat cost on a phone, so it only starts on wide screens, and
     never when the visitor has asked for reduced motion. The CSS blob mesh
     stays as the fallback everywhere else.
     --------------------------------------------------------------- */
  var vantaEffect = null;
  var VANTA_MIN_WIDTH = 900;

  function canRunVanta() {
    if (reduceMotion) return false;
    if (window.innerWidth < VANTA_MIN_WIDTH) return false;
    if (typeof VANTA === "undefined" || !VANTA.FOG) return false;
    if (typeof THREE === "undefined") return false;
    try {
      var c = document.createElement("canvas");
      return !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
    } catch (e) {
      return false;
    }
  }

  function syncVanta() {
    var mesh = document.querySelector(".mesh");
    if (!mesh) return;

    if (canRunVanta() && !vantaEffect) {
      try {
        vantaEffect = VANTA.FOG({
          el: mesh,
          mouseControls: true,
          touchControls: false,
          gyroControls: false,
          minHeight: 200,
          minWidth: 200,
          // brand palette, matching --grad in landing.css
          highlightColor: 0x9b8fd8,
          midtoneColor: 0x79c9a8,
          lowlightColor: 0x8fc6c2,
          baseColor: 0xfafaf8,
          blurFactor: 0.62,
          speed: 0.9,
          zoom: 0.85
        });
        document.body.classList.add("vanta-on");
      } catch (e) {
        console.warn("Vanta failed to start:", e);
        vantaEffect = null;
      }
    } else if (!canRunVanta() && vantaEffect) {
      try { vantaEffect.destroy(); } catch (e) {}
      vantaEffect = null;
      document.body.classList.remove("vanta-on");
    }
  }

  syncVanta();

  var resizeTimer = null;
  addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncVanta, 200);
  }, { passive: true });

  // Stop rendering while the tab is hidden - no reason to burn a GPU loop
  document.addEventListener("visibilitychange", function () {
    if (!vantaEffect) return;
    if (document.hidden) { try { vantaEffect.pause && vantaEffect.pause(); } catch (e) {} }
    else { try { vantaEffect.play && vantaEffect.play(); } catch (e) {} }
  });

  /* ---------------------------------------------------------------
     Sticky nav shadow
     --------------------------------------------------------------- */
  var header = document.getElementById("header");
  if (header) {
    addEventListener("scroll", function () {
      header.classList.toggle("scrolled", scrollY > 10);
    }, { passive: true });
  }

  /* ---------------------------------------------------------------
     Beta signup
     --------------------------------------------------------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var BRAND = ["#79c9a8", "#9b8fd8", "#8fc6c2", "#a99ce0", "#5ec9a3"];
  function burstConfetti() {
    if (typeof confetti !== "function" || reduceMotion) return;
    confetti({ particleCount: 110, spread: 75, startVelocity: 45, origin: { y: 0.62 }, colors: BRAND, scalar: 0.95 });
    setTimeout(function () { confetti({ particleCount: 55, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors: BRAND }); }, 140);
    setTimeout(function () { confetti({ particleCount: 55, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors: BRAND }); }, 140);
  }

  /* swap the whole form for an enthusiastic, personalized confirmation */
  function celebrate(form, firstName) {
    form.classList.add("signed-up");
    form.innerHTML =
      '<div class="signup-success">' +
        '<div class="su-check">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' +
        '</div>' +
        '<div class="su-text">' +
          '<div class="su-title">You’re in, ' + escapeHtml(firstName) + '! 🎉</div>' +
          '<div class="su-sub">Spot saved. We’ll email you the moment the beta opens.</div>' +
        '</div>' +
      '</div>';

    if (typeof gsap !== "undefined" && !reduceMotion) {
      gsap.from(form.querySelector(".signup-success"), {
        opacity: 0, scale: 0.92, duration: 0.5, ease: "back.out(1.7)"
      });
    }
    burstConfetti();
  }

  /* beta signup -> Supabase (name + email), shared via window.MoniumBackend */
  window.joinBeta = async function (e) {
    e.preventDefault();
    var form = e.target;
    var nameEl = form.querySelector('input[name="name"]');
    var emailEl = form.querySelector('input[type="email"]');
    var btn = form.querySelector("button");
    var name = nameEl.value.trim();
    var email = emailEl.value.trim().toLowerCase();
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false;

    btn.disabled = true; btn.style.opacity = ".85"; btn.textContent = "Saving…";
    try {
      await window.MoniumBackend.saveSignup(name, email);
      celebrate(form, name.split(/\s+/)[0]);
    } catch (err) {
      btn.textContent = err && err.code === "NO_CONFIG" ? "Add Supabase keys" : "Try again";
      if (!err || err.code !== "NO_CONFIG") console.error(err);
      setTimeout(function () {
        btn.textContent = "Get early access"; btn.style.opacity = "1"; btn.disabled = false;
      }, 2600);
    }
    return false;
  };
})();
