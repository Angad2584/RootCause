/*
 * Powers the "Artifact correlation" evidence table embedded in a post:
 * a free-text search box plus confidence chips (All/High/Medium/Low),
 * combined with AND logic. Also tags each <td> with a data-label so the
 * table can re-flow into stacked cards on narrow screens (see the
 * .ev-table media query in css/style.css) without duplicating markup.
 */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var rows = document.querySelectorAll(".ev-table tbody tr");
    if (rows.length === 0) return;

    var searchInput = document.getElementById("ev-q");
    var confChips = document.querySelectorAll("[data-conf]");
    var emptyMsg = document.getElementById("ev-none");
    var activeConf = "all";

    var heads = document.querySelectorAll(".ev-table thead th");
    rows.forEach(function (tr) {
      tr.querySelectorAll("td").forEach(function (td, i) {
        if (heads[i]) td.setAttribute("data-label", heads[i].textContent);
      });
    });

    function apply() {
      var term = ((searchInput && searchInput.value) || "").toLowerCase().trim();
      var shown = 0;
      rows.forEach(function (tr) {
        var okConf = activeConf === "all" || tr.getAttribute("data-conf") === activeConf;
        var okTerm = !term || tr.textContent.toLowerCase().indexOf(term) !== -1;
        var show = okConf && okTerm;
        if (show) {
          tr.removeAttribute("hidden");
          shown++;
        } else {
          tr.setAttribute("hidden", "");
        }
      });
      if (emptyMsg) emptyMsg.hidden = shown > 0;
    }

    if (searchInput) searchInput.addEventListener("input", apply);

    confChips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        activeConf = chip.getAttribute("data-conf");
        confChips.forEach(function (c) { c.classList.toggle("active", c === chip); });
        apply();
      });
    });
  });
})();
