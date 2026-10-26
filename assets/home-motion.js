(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduce.matches) return;

  var layer = document.querySelector("[data-parallax]");
  if (layer) {
    var ticking = false;
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var shift = Math.max(-28, Math.min(18, -window.scrollY * 0.08));
        layer.style.setProperty("--py", shift.toFixed(2));
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  var flow = document.getElementById("flow");
  var steps = flow ? Array.prototype.slice.call(flow.querySelectorAll("[data-step]")) : [];
  if (!flow || !steps.length || !window.IntersectionObserver) return;
  if (!window.matchMedia("(min-width: 980px)").matches) return;

  var active = new Set();
  var spy = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) active.add(entry.target);
      else active.delete(entry.target);
    });
    var current = null;
    steps.forEach(function (step) {
      if (active.has(step)) current = step;
    });
    if (!current) {
      flow.classList.remove("is-held");
      steps.forEach(function (step) { step.classList.remove("is-on"); });
      return;
    }
    flow.classList.add("is-held");
    flow.dataset.phase = current.getAttribute("data-step");
    steps.forEach(function (step) { step.classList.toggle("is-on", step === current); });
  }, { rootMargin: "-32% 0px -42% 0px", threshold: [0.2, 0.55] });
  steps.forEach(function (step) { spy.observe(step); });
})();
