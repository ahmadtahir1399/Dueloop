// Progressive enhancement for the pay page: a copy button next to the payment reference. Without JavaScript the
// reference is plain, selectable text and this file does nothing.
(function () {
  var ref = document.getElementById("ref-code");
  if (!ref || !navigator.clipboard) return;
  var b = document.createElement("button");
  b.type = "button";
  b.className = "secondary";
  b.textContent = "Copy";
  b.addEventListener("click", function () {
    navigator.clipboard.writeText(ref.textContent || "").then(function () {
      b.textContent = "Copied";
    });
  });
  ref.parentNode.appendChild(b);
})();
