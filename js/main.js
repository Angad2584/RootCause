/* Theme toggle, mobile nav, scroll-reveal animations, active nav highlight. */
(function () {
  "use strict";

  var STORAGE_KEY = "dfir-blog-theme";
  var root = document.documentElement;

  function applyTheme(theme) {
    if (theme === "light") {
      root.setAttribute("data-theme", "light");
    } else {
      root.removeAttribute("data-theme");
    }
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* storage disabled */ }
    applyTheme(saved || "dark");

    var toggle = document.querySelector("[data-theme-toggle]");
    if (toggle) {
      toggle.addEventListener("click", function () {
        var current = root.getAttribute("data-theme") === "light" ? "light" : "dark";
        var next = current === "light" ? "dark" : "light";
        applyTheme(next);
        try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* ignore */ }
      });
    }
  }

  function initMobileNav() {
    var burger = document.querySelector("[data-nav-burger]");
    var drawer = document.querySelector("[data-mobile-nav]");
    if (!burger || !drawer) return;
    burger.addEventListener("click", function () {
      drawer.classList.toggle("open");
    });
    drawer.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { drawer.classList.remove("open"); });
    });
  }

  // Each page hardcodes class="active" on its own nav link directly in the
  // markup (see the header block in any .html file) — simpler and less
  // error-prone than pattern-matching window.location.pathname here, since
  // e.g. a "home" matcher of "index.html" would also match "/posts/index.html".

  var revealObserver = null;

  function getRevealObserver() {
    if (revealObserver || !("IntersectionObserver" in window)) return revealObserver;
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -40px 0px" });
    return revealObserver;
  }

  function initScrollReveal(scope) {
    var targets = (scope || document).querySelectorAll(".reveal, .post-card");
    var observer = getRevealObserver();
    if (!observer) {
      targets.forEach(function (t) { t.classList.add("in-view"); });
      return;
    }
    targets.forEach(function (t) { observer.observe(t); });
  }

  // Exposed so scripts that inject content after DOMContentLoaded
  // (e.g. filter.js rendering post cards from posts.json) can hook
  // the same reveal-on-scroll animation.
  window.dfirRevealInit = initScrollReveal;

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initMobileNav();
    initScrollReveal(document);
  });
})();
