(function () {
  var skool = document.querySelector(".skool-link");
  if (skool && window.SKOOL_URL) {
    skool.setAttribute("href", window.SKOOL_URL);
    var soon = skool.querySelector(".soon");
    if (soon) soon.hidden = true;
  }
  var burger = document.querySelector(".nav-burger");
  var bar = document.querySelector(".top");
  if (burger && bar) {
    burger.addEventListener("click", function () {
      var open = bar.classList.toggle("is-open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduce.matches) return;
  document.documentElement.classList.add("js-motion");

  var top = document.querySelector(".top");
  var layer = document.querySelector("[data-parallax]");
  var shell = document.querySelector(".vsl-shell");
  var mesh = document.querySelector(".mesh");
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var scrollTicking = false;

  function onScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(function () {
      if (top) top.classList.toggle("is-scrolled", window.scrollY > 12);
      if (layer) {
        var shift = Math.max(-28, Math.min(18, -window.scrollY * 0.08));
        layer.style.setProperty("--py", shift.toFixed(2));
      }
      if (shell) {
        var box = shell.getBoundingClientRect();
        var visible = Math.max(0, Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0));
        var ratio = box.height ? Math.min(1, visible / box.height) : 0;
        shell.style.setProperty("--glow", Math.max(ratio, 0.2).toFixed(3));
      }
      scrollTicking = false;
    });
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  if (mesh && fine) {
    var mx = 0;
    var my = 0;
    var meshTicking = false;
    window.addEventListener("pointermove", function (e) {
      mx = (e.clientX / window.innerWidth - 0.5) * 22;
      my = (e.clientY / window.innerHeight - 0.5) * 14;
      if (meshTicking) return;
      meshTicking = true;
      requestAnimationFrame(function () {
        mesh.style.transform = "translate3d(" + mx.toFixed(1) + "px," + my.toFixed(1) + "px,0)";
        meshTicking = false;
      });
    }, { passive: true });
  }

  var reveals = document.querySelectorAll("[data-reveal]");
  if (reveals.length && window.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -8% 0px" });
    Array.prototype.forEach.call(reveals, function (el) { io.observe(el); });
  }

  if (fine) {
    var dot = document.createElement("div");
    dot.className = "cursor-glow";
    dot.setAttribute("aria-hidden", "true");
    document.body.appendChild(dot);
    var cx = 0;
    var cy = 0;
    var tx = 0;
    var ty = 0;
    var running = false;
    function tick() {
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      dot.style.transform = "translate3d(" + cx.toFixed(1) + "px," + cy.toFixed(1) + "px,0)";
      if (Math.abs(tx - cx) > 0.4 || Math.abs(ty - cy) > 0.4) requestAnimationFrame(tick);
      else running = false;
    }
    window.addEventListener("pointermove", function (e) {
      tx = e.clientX;
      ty = e.clientY;
      if (!dot.classList.contains("is-on")) dot.classList.add("is-on");
      if (!running) {
        running = true;
        requestAnimationFrame(tick);
      }
    }, { passive: true });
    document.addEventListener("pointerdown", function () { dot.classList.add("is-press"); });
    document.addEventListener("pointerup", function () { dot.classList.remove("is-press"); });
    document.addEventListener("pointerover", function (e) {
      var hit = e.target && e.target.closest ? e.target.closest("a, button, summary") : null;
      dot.classList.toggle("is-press", !!hit);
    });
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
