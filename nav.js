"use strict";

/*
 * Safety Net — shared nav bar, injected into a <div id="site-nav"></div>
 * placeholder on every page. Deliberately just a few lines of vanilla JS
 * appending a <nav> — no frontend framework, no build step, no templating
 * engine. Every page includes this same file and calls renderNav("<page>")
 * with its own page key so the current page's link gets an "active" style
 * and the rest are given as clickable navigation, so a user can reach any
 * feature (or back to the landing page) from anywhere without the browser
 * back button.
 *
 * "Session" note (ponytail-relevant, see HANDOFF.md "stay logged in"
 * section): this file also remembers, in sessionStorage (tab-scoped, wiped
 * on tab close — NOT the durable localStorage the trusted contact lives
 * in), which page the user was last on, purely so a reload lands them back
 * where they were. This is a UX nicety only. It is not a security boundary
 * and implements nothing resembling login/authentication — there is no
 * server here to authenticate against. See HANDOFF.md's honest breakdown.
 *
 * XSS note: every string used to build the nav is a hardcoded label from
 * NAV_ITEMS below, never user input or trusted-contact data — so even
 * though this uses textContent throughout (same discipline as every other
 * file in this project), there's no live example here of sanitizing
 * *dynamic* content. If a future change ever wants to show the trusted
 * contact's name in the nav, it must go through textContent exactly like
 * contact-widget.js already does — never innerHTML.
 */

const NAV_ITEMS = [
  { key: "index", href: "index.html", label: "Home" },
  { key: "sos", href: "sos.html", label: "SOS Alert" },
  { key: "route", href: "route.html", label: "Route Planner" },
  { key: "history", href: "history.html", label: "Route History" },
  { key: "checkin", href: "checkin.html", label: "Check-in" },
  { key: "chat", href: "chat.html", label: "Chat" },
];

const LAST_PAGE_SESSION_KEY = "safetyNet.session.lastPage";

function renderNav(currentPageKey) {
  const placeholder = document.getElementById("site-nav");
  if (!placeholder) return;

  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.setAttribute("aria-label", "Safety Net sections");

  const brand = document.createElement("a");
  brand.href = "index.html";
  brand.className = "site-nav-brand";
  const brandImg = document.createElement("img");
  brandImg.src = "logo.svg";
  brandImg.alt = "";
  brandImg.width = 26;
  brandImg.height = 26;
  brandImg.style.display = "inline-block";
  brandImg.style.verticalAlign = "middle";
  const brandText = document.createElement("span");
  brandText.textContent = "Safety Net";
  brand.append(brandImg, brandText);
  nav.appendChild(brand);

  const list = document.createElement("ul");
  list.className = "site-nav-list";
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
    list.appendChild(li);
  });
  nav.appendChild(list);

  placeholder.replaceWith(nav);

  // ponytail: tab-scoped "remember last page" convenience only — sessionStorage,
  // not localStorage, and not used for anything access-related. See file
  // header comment. Cleared automatically when the tab closes.
  try {
    sessionStorage.setItem(LAST_PAGE_SESSION_KEY, currentPageKey);
  } catch (err) {
    // Private-browsing modes can throw on sessionStorage writes — the nav
    // still renders fine without this nicety, so just log and move on.
    console.warn("Safety Net: couldn't persist last-page session hint.", err);
  }
}

// Landing page (index.html) reads this to offer a "continue where you left
// off" link if the user's tab still has a last-visited feature page set.
function getLastSessionPage() {
  try {
    return sessionStorage.getItem(LAST_PAGE_SESSION_KEY);
  } catch (err) {
    return null;
  }
}
