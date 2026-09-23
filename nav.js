"use strict";

/*
 * Safety Net — Modern Floating Resizable Navbar.
 * Inspired by Aceternity UI floating resizable navigation bar.
 * Features desktop glassmorphic pill bar, action buttons (112, SOS),
 * and an animated mobile drawer toggle with smooth transitions.
 */

const NAV_ITEMS = [
  { key: "index", href: "index.html", label: "Home" },
  { key: "sos", href: "sos.html", label: "SOS Alert" },
  { key: "route", href: "route.html", label: "Route Planner" },
  { key: "history", href: "history.html", label: "Route History" },
  { key: "checkin", href: "checkin.html", label: "Check-in" },
  { key: "chat", href: "chat.html", label: "AI Safety Chat" },
];

const LAST_PAGE_SESSION_KEY = "safetyNet.session.lastPage";

function renderNav(currentPageKey) {
  const placeholder = document.getElementById("site-nav");
  if (!placeholder) return;

  const wrapper = document.createElement("div");
  wrapper.className = "nav-floating-wrapper";

  const nav = document.createElement("nav");
  nav.className = "nav-capsule";
  nav.setAttribute("aria-label", "Main navigation");

  // --- Brand ---
  const brand = document.createElement("a");
  brand.href = "index.html";
  brand.className = "nav-brand";
  const brandImg = document.createElement("img");
  brandImg.src = "logo.svg";
  brandImg.alt = "";
  brandImg.width = 28;
  brandImg.height = 28;
  const brandText = document.createElement("span");
  brandText.textContent = "Safety Net";
  brand.append(brandImg, brandText);

  // --- Desktop Navigation Links ---
  const desktopList = document.createElement("ul");
  desktopList.className = "nav-desktop-links site-nav-list";
  NAV_ITEMS.forEach((item) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = item.href;
    a.textContent = item.label;
    if (item.key === currentPageKey) {
      a.className = "site-nav-active";
      a.setAttribute("aria-current", "page");
    }
    li.appendChild(a);
    desktopList.appendChild(li);
  });

  // --- Action Buttons ---
  const actions = document.createElement("div");
  actions.className = "nav-actions";

  const dialBtn = document.createElement("a");
  dialBtn.href = "tel:112";
  dialBtn.className = "nav-action-btn nav-action-btn-secondary";
  dialBtn.title = "Call 112 National Emergency";
  dialBtn.textContent = "📞 112";

  const sosBtn = document.createElement("a");
  sosBtn.href = "sos.html";
  sosBtn.className = "nav-action-btn nav-action-btn-primary";
  sosBtn.textContent = "🚨 SOS";

  actions.append(dialBtn, sosBtn);

  // --- Mobile Toggle ---
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "mobile-nav-toggle";
  toggleBtn.setAttribute("aria-label", "Toggle navigation menu");
  toggleBtn.setAttribute("aria-expanded", "false");
  toggleBtn.innerHTML = `
    <span class="bar bar-1"></span>
    <span class="bar bar-2"></span>
    <span class="bar bar-3"></span>
  `;

  nav.append(brand, desktopList, actions, toggleBtn);

  // --- Mobile Drawer Menu ---
  const mobileMenu = document.createElement("div");
  mobileMenu.className = "mobile-nav-menu";
  mobileMenu.hidden = true;

  const mobileList = document.createElement("ul");
  mobileList.className = "mobile-nav-list";
  NAV_ITEMS.forEach((item) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = item.href;
    a.textContent = item.label;
    if (item.key === currentPageKey) {
      a.className = "mobile-nav-active";
      a.setAttribute("aria-current", "page");
    }
    a.addEventListener("click", () => closeMobileMenu());
    li.appendChild(a);
    mobileList.appendChild(li);
  });

  const mobileActions = document.createElement("div");
  mobileActions.className = "mobile-nav-actions";
  const mobileSos = document.createElement("a");
  mobileSos.href = "sos.html";
  mobileSos.className = "btn btn-primary";
  mobileSos.style.width = "100%";
  mobileSos.style.background = "#dc2626";
  mobileSos.style.justifyContent = "center";
  mobileSos.textContent = "🚨 Quick SOS Panic Alert";

  const mobileDial = document.createElement("a");
  mobileDial.href = "tel:112";
  mobileDial.className = "btn btn-secondary";
  mobileDial.style.width = "100%";
  mobileDial.style.justifyContent = "center";
  mobileDial.textContent = "📞 Call 112 National Emergency";

  mobileActions.append(mobileSos, mobileDial);
  mobileMenu.append(mobileList, mobileActions);

  function openMobileMenu() {
    mobileMenu.hidden = false;
    toggleBtn.classList.add("open");
    toggleBtn.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      mobileMenu.classList.add("is-visible");
    });
  }

  function closeMobileMenu() {
    mobileMenu.classList.remove("is-visible");
    toggleBtn.classList.remove("open");
    toggleBtn.setAttribute("aria-expanded", "false");
    setTimeout(() => {
      if (!toggleBtn.classList.contains("open")) {
        mobileMenu.hidden = true;
      }
    }, 250);
  }

  toggleBtn.addEventListener("click", () => {
    const isOpen = toggleBtn.classList.contains("open");
    if (isOpen) {
      closeMobileMenu();
    } else {
      openMobileMenu();
    }
  });

  wrapper.append(nav, mobileMenu);
  placeholder.replaceWith(wrapper);

  const handleScroll = () => {
    if (window.scrollY > 16) {
      wrapper.classList.add("nav-scrolled");
    } else {
      wrapper.classList.remove("nav-scrolled");
    }
  };
  window.addEventListener("scroll", handleScroll, { passive: true });
  handleScroll();

  try {
    sessionStorage.setItem(LAST_PAGE_SESSION_KEY, currentPageKey);
  } catch (err) {
    console.warn("Safety Net: couldn't persist last-page session hint.", err);
  }
}

function getLastSessionPage() {
  try {
    return sessionStorage.getItem(LAST_PAGE_SESSION_KEY);
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Smooth Page Navigation Interceptor
// ---------------------------------------------------------------------------

document.addEventListener("click", (e) => {
  const link = e.target.closest("a");
  if (!link || !link.href) return;

  // Ignore external links, downloads, new tabs, tel:, mailto:
  if (link.target === "_blank" || link.hasAttribute("download")) return;
  if (link.href.startsWith("tel:") || link.href.startsWith("mailto:") || link.href.startsWith("javascript:")) return;

  try {
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && (url.hash || url.search === window.location.search)) return;

    const targetFile = url.pathname.split("/").pop() || "index.html";
    const currentFile = window.location.pathname.split("/").pop() || "index.html";

    if (targetFile !== currentFile) {
      const appEl = document.querySelector(".app");
      if (appEl) {
        e.preventDefault();
        appEl.classList.add("page-leaving");
        setTimeout(() => {
          window.location.href = link.href;
        }, 130);
      }
    }
  } catch (err) {
    // allow default navigation
  }
});

window.addEventListener("pageshow", () => {
  const appEl = document.querySelector(".app");
  if (appEl) {
    appEl.classList.remove("page-leaving");
  }
});


