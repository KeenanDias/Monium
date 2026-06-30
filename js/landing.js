/* Landing-page interactions: sticky-nav shadow, reveal-on-scroll, beta signup. */
(function () {
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

  /* nav shadow on scroll */
  var header = document.getElementById("header");
  if (header) {
    addEventListener("scroll", function () {
      header.classList.toggle("scrolled", scrollY > 10);
    }, { passive: true });
  }

  /* reveal-on-scroll */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });

  /* helpers */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var BRAND = ["#79c9a8", "#9b8fd8", "#8fc6c2", "#a99ce0", "#5ec9a3"];
  function burstConfetti() {
    if (typeof confetti !== "function") return;
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
