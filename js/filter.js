/*
 * Loads posts.json and renders post cards.
 * Used on both the homepage (#latest-posts, capped list) and the
 * posts index (#post-grid, full list + topic filter chips).
 *
 * NOTE: fetch() of a local JSON file requires an http server — this
 * won't work from a double-clicked file:// page. Run a local server
 * (see README) or rely on GitHub Pages, which serves over https.
 */
(function () {
  "use strict";

  function badgeClass(difficulty) {
    var d = (difficulty || "").toLowerCase();
    if (d === "beginner") return "badge-beginner";
    if (d === "advanced") return "badge-advanced";
    return "badge-intermediate";
  }

  function formatDate(iso) {
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function cardHTML(post, urlPrefix) {
    var tags = (post.tags || []).map(function (t) {
      return '<span class="tag">' + t + "</span>";
    }).join("");
    return (
      '<article class="post-card reveal" data-tags="' + (post.tags || []).join("|").toLowerCase() + '">' +
        '<div class="meta-row">' +
          '<time datetime="' + post.date + '">' + formatDate(post.date) + "</time>" +
          '<span class="badge ' + badgeClass(post.difficulty) + '">' + post.difficulty + "</span>" +
        "</div>" +
        '<h3><a href="' + urlPrefix + post.file + '">' + post.title + "</a></h3>" +
        "<p>" + post.summary + "</p>" +
        '<div class="tag-row">' + tags + "</div>" +
      "</article>"
    );
  }

  function render(container, posts, urlPrefix) {
    if (posts.length === 0) {
      container.innerHTML = '<p class="empty-state">// no investigations match this filter</p>';
      return;
    }
    container.innerHTML = posts.map(function (p) { return cardHTML(p, urlPrefix); }).join("");
    if (window.dfirRevealInit) window.dfirRevealInit(container);
  }

  function initLatest(posts) {
    var el = document.getElementById("latest-posts");
    if (!el) return;
    var limit = parseInt(el.getAttribute("data-limit") || "3", 10);
    render(el, posts.slice(0, limit), "posts/");
  }

  function initFullIndex(posts) {
    var el = document.getElementById("post-grid");
    if (!el) return;

    var chips = document.querySelectorAll(".filter-chip");
    var activeTag = "all";

    function apply() {
      var filtered = activeTag === "all"
        ? posts
        : posts.filter(function (p) {
            return (p.tags || []).some(function (t) { return t.toLowerCase() === activeTag; });
          });
      render(el, filtered, "./");
    }

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        chips.forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        activeTag = chip.getAttribute("data-tag").toLowerCase();
        window.location.hash = activeTag === "all" ? "" : activeTag;
        apply();
      });
    });

    var initial = (window.location.hash || "").replace("#", "").toLowerCase();
    if (initial) {
      var match = Array.prototype.find.call(chips, function (c) {
        return c.getAttribute("data-tag").toLowerCase() === initial;
      });
      if (match) {
        chips.forEach(function (c) { c.classList.remove("active"); });
        match.classList.add("active");
        activeTag = initial;
      }
    }

    apply();
  }

  document.addEventListener("DOMContentLoaded", function () {
    var latestEl = document.getElementById("latest-posts");
    var gridEl = document.getElementById("post-grid");
    if (!latestEl && !gridEl) return;

    var jsonPath = document.body.getAttribute("data-posts-json") || "posts.json";

    fetch(jsonPath)
      .then(function (r) { return r.json(); })
      .then(function (posts) {
        posts.sort(function (a, b) { return b.date.localeCompare(a.date); });
        initLatest(posts);
        initFullIndex(posts);
      })
      .catch(function (err) {
        console.error("Could not load posts.json:", err);
        [latestEl, gridEl].forEach(function (el) {
          if (el) el.innerHTML = '<p class="empty-state">// posts.json not found — run build.py, and serve over http(s), not file://</p>';
        });
      });
  });
})();
