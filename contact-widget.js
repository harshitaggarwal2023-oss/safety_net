"use strict";

/*
 * Safety Net — landing page trusted-contact widget.
 *
 * Reuses contact-store.js's loadContact/saveContact/contactIsValid verbatim
 * (same localStorage key, same validation rules as every other page) — this
 * file only adds the landing-page-specific "welcome back" vs. "set up your
 * contact" presentation the spec asked for. Every task page (sos.html,
 * checkin.html, chat.html) still does its own quick loadContact() check the
 * same way the original Phase 1 app.js did; this widget does not replace
 * that, it's just the one place the *setup form itself* is now shown by
 * default.
 *
 * Same XSS discipline as the rest of the project: the contact's name (user-
 * supplied) reaches the DOM only via textContent, never innerHTML/template
 * strings assigned to innerHTML.
 */

function renderContactWidget(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = ""; // static re-render of our own widget only — no user data ever assigned via innerHTML in this file
  const contact = loadContact();

  if (contact && contactIsValid(contact)) {
    renderWelcomeBack(container, contact);
  } else {
    renderSetupForm(container);
  }
}

function renderWelcomeBack(container, contact) {
  const via = contact.email ? contact.email : contact.phone;

  const card = document.createElement("section");
  card.className = "card";
  card.id = "contact-card";
  card.setAttribute("aria-labelledby", "contact-heading");

  const heading = document.createElement("h2");
  heading.id = "contact-heading";
  heading.textContent = "Welcome back";

  const status = document.createElement("p");
  status.className = "contact-status";
  // Two separate textContent-built spans instead of one interpolated
  // string, so the contact's name (user-supplied) is never adjacent to a
  // constructed template that could later tempt someone into innerHTML.
  const nameSpan = document.createElement("strong");
  nameSpan.textContent = contact.name;
  status.append("Trusted contact saved: ", nameSpan, ` (${via})`);

  const changeBtn = document.createElement("button");
  changeBtn.type = "button";
  changeBtn.className = "btn btn-secondary";
  changeBtn.textContent = "Change contact";
  changeBtn.addEventListener("click", () => renderSetupForm(container, { prefill: contact }));

  card.append(heading, status, changeBtn);
  container.appendChild(card);
}

function renderSetupForm(container, opts) {
  const prefill = (opts && opts.prefill) || null;
  container.innerHTML = ""; // rebuild our own widget only, no user data via innerHTML

  const card = document.createElement("section");
  card.className = "card";
  card.id = "contact-card";
  card.setAttribute("aria-labelledby", "contact-heading");

  const heading = document.createElement("h2");
  heading.id = "contact-heading";
  heading.textContent = prefill ? "Update trusted contact" : "Set up your trusted contact";

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Who should we alert? Add at least an email or a phone number. This is saved only on this device.";

  const form = document.createElement("form");
  form.id = "contact-form";
  form.setAttribute("novalidate", "novalidate");

  const nameLabel = document.createElement("label");
  nameLabel.setAttribute("for", "contact-name");
  nameLabel.textContent = "Name";
  const nameInput = document.createElement("input");
  Object.assign(nameInput, { id: "contact-name", name: "name", type: "text", autocomplete: "name", maxLength: 80, required: true });
  if (prefill) nameInput.value = prefill.name || "";

  const emailLabel = document.createElement("label");
  emailLabel.setAttribute("for", "contact-email");
  emailLabel.textContent = "Email";
  const emailInput = document.createElement("input");
  Object.assign(emailInput, { id: "contact-email", name: "email", type: "email", autocomplete: "email", maxLength: 120, placeholder: "e.g. mom@example.com" });
  if (prefill) emailInput.value = prefill.email || "";
  const emailError = document.createElement("p");
  Object.assign(emailError, { id: "email-error", className: "field-error" });
  emailError.setAttribute("role", "alert");
  emailError.hidden = true;

  const phoneLabel = document.createElement("label");
  phoneLabel.setAttribute("for", "contact-phone");
  phoneLabel.textContent = "Phone";
  const phoneInput = document.createElement("input");
  Object.assign(phoneInput, { id: "contact-phone", name: "phone", type: "tel", autocomplete: "tel", maxLength: 30, placeholder: "e.g. +1 555 123 4567" });
  if (prefill) phoneInput.value = prefill.phone || "";
  const phoneError = document.createElement("p");
  Object.assign(phoneError, { id: "phone-error", className: "field-error" });
  phoneError.setAttribute("role", "alert");
  phoneError.hidden = true;

  const submitBtn = document.createElement("button");
  Object.assign(submitBtn, { type: "submit", className: "btn btn-primary" });
  submitBtn.textContent = "Save trusted contact";

  form.append(nameLabel, nameInput, emailLabel, emailInput, emailError, phoneLabel, phoneInput, phoneError, submitBtn);

  const status = document.createElement("p");
  Object.assign(status, { id: "contact-status", className: "contact-status" });
  status.setAttribute("aria-live", "polite");

  if (prefill) {
    const cancelBtn = document.createElement("button");
    Object.assign(cancelBtn, { type: "button", className: "btn btn-secondary" });
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => renderContactWidget(container.id));
    form.appendChild(cancelBtn);
  }

  card.append(heading, hint, form, status);
  container.appendChild(card);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    emailError.hidden = true;
    phoneError.hidden = true;

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const phone = phoneInput.value.trim();

    let ok = true;
    if (!name) ok = false;
    if (email && !isValidEmail(email)) {
      emailError.textContent = "That doesn't look like a valid email address.";
      emailError.hidden = false;
      ok = false;
    }
    if (phone && !isValidPhone(phone)) {
      phoneError.textContent = "That doesn't look like a valid phone number (need 7-15 digits).";
      phoneError.hidden = false;
      ok = false;
    }
    if (!email && !phone) {
      emailError.textContent = "Add at least an email or a phone number.";
      emailError.hidden = false;
      ok = false;
    }
    if (!ok) return;

    saveContact({ name, email, phone });
    renderContactWidget(container.id);
  });
}
