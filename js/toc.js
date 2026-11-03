/*
 * Builds a table of contents from h2/h3 elements inside .article-body,
 * and highlights the active section while scrolling.
 * Only runs when a #toc-list element is present (long posts opt in by
 * including the sidebar markup from the post template).
 */
(function () {
  "use strict";

  function slugify(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var tocList = document.getElementById("toc-list");
    var article = document.querySelector(".article-body");
    if (!tocList || !article) return;

    var headings = article.querySelectorAll("h2, h3");
    if (headings.length < 2) {
      var sidebar = document.querySelector(".toc-sidebar");
      if (sidebar) sidebar.style.display = "none";
      return;
    }

    var usedIds = {};
    var links = [];

    headings.forEach(function (h) {
      if (!h.id) {
        var base = slugify(h.textContent);
        var id = base;
        var n = 1;
        while (usedIds[id]) { id = base + "-" + (++n); }
        usedIds[id] = true;
        h.id = id;
      }
      var li = document.createElement("li");
      li.className = h.tagName === "H3" ? "level-3" : "level-2";
      var a = document.createElement("a");
      a.href = "#" + h.id;
      a.textContent = h.textContent;
      li.appendChild(a);
      tocList.appendChild(li);
      links.push({ id: h.id, link: a });
    });

    if (!("IntersectionObserver" in window)) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var match = links.find(function (l) { return l.id === entry.target.id; });
          if (!match) return;
          if (entry.isIntersecting) {
            links.forEach(function (l) { l.link.classList.remove("active"); });
            match.link.classList.add("active");
          }
        });
      },
      { rootMargin: "-100px 0px -70% 0px" }
    );

    headings.forEach(function (h) { observer.observe(h); });
  });
})();
