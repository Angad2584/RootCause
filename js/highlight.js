/*
 * Minimal, self-hosted syntax highlighter — no CDN dependency.
 * Tokenizes <pre><code class="language-X"> blocks for the handful of
 * languages that show up in DFIR write-ups: bash/shell, powershell,
 * log/plaintext output, and json. Good enough for readability;
 * not a full grammar.
 */
(function () {
  "use strict";

  var KEYWORDS = {
    bash: ["sudo", "cd", "ls", "grep", "find", "cat", "echo", "if", "then", "fi", "for", "do", "done", "while", "export", "chmod", "chown", "curl", "wget", "tar", "ssh"],
    powershell: ["Get-Process", "Get-WinEvent", "Get-ChildItem", "Get-Content", "Where-Object", "Select-Object", "ForEach-Object", "New-Object", "Invoke-Expression", "Import-Module", "if", "else", "foreach", "function", "return", "Get-ItemProperty", "Get-Service"],
    log: [],
    json: []
  };

  function escapeHTML(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function tokenize(line, lang) {
    // Order matters: comments/strings first so later rules don't reach inside them.
    var placeholders = [];
    var work = escapeHTML(line);

    // Placeholder markers sandwich the index between letters ("PHxPH"),
    // not bare digits. A bare-digit placeholder is still flanked by \b
    // word boundaries, so the number regex below would re-match and
    // re-stash the digits of an already-stashed comment/string, losing
    // the original text underneath. Letters on both sides of the index
    // are word characters too, so \b\d+\b never isolates just the digits.
    function stash(match, cls) {
      var token = '<span class="tok-' + cls + '">' + match + "</span>";
      placeholders.push(token);
      return "PH" + (placeholders.length - 1) + "PH";
    }

    // comments
    if (lang === "bash") {
      work = work.replace(/(#.*)$/g, function (m) { return stash(m, "comment"); });
    }
    if (lang === "powershell") {
      work = work.replace(/(#.*)$/g, function (m) { return stash(m, "comment"); });
    }

    // strings
    work = work.replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|"[^"]*"|'[^']*')/g, function (m) { return stash(m, "string"); });

    // ip addresses / hashes (log lines)
    work = work.replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g, function (m) { return stash(m, "ip"); });
    work = work.replace(/\b([a-fA-F0-9]{32,64})\b/g, function (m) { return stash(m, "hash"); });

    // numbers
    work = work.replace(/\b(0x[0-9a-fA-F]+|\d+)\b/g, function (m) { return stash(m, "number"); });

    // flags
    work = work.replace(/(\s|^)(--?[a-zA-Z][\w-]*)/g, function (m, pre, flag) { return pre + stash(flag, "flag"); });

    // powershell variables
    if (lang === "powershell") {
      work = work.replace(/(\$[A-Za-z_][\w]*)/g, function (m) { return stash(m, "variable"); });
    }

    // keywords
    var kws = KEYWORDS[lang] || [];
    kws.forEach(function (kw) {
      var re = new RegExp("\\b" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g");
      work = work.replace(re, function (m) { return stash(m, "keyword"); });
    });

    // restore placeholders
    work = work.replace(/PH(\d+)PH/g, function (_, i) { return placeholders[i]; });
    return work;
  }

  function highlightBlock(codeEl) {
    var langMatch = (codeEl.className || "").match(/language-(\w+)/);
    var lang = langMatch ? langMatch[1].toLowerCase() : "log";
    var raw = codeEl.textContent;
    var lines = raw.split("\n");
    codeEl.innerHTML = lines.map(function (line) { return tokenize(line, lang); }).join("\n");

    var pre = codeEl.closest("pre");
    if (pre && langMatch && !pre.querySelector(".code-label")) {
      var label = document.createElement("span");
      label.className = "code-label";
      label.textContent = lang;
      pre.appendChild(label);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("pre code[class*='language-']").forEach(highlightBlock);
  });
})();
