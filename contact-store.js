"use strict";

/*
 * Safety Net — shared trusted-contact storage + validation.
 *
 * Extracted from the original Phase 1 app.js UNCHANGED (same localStorage
 * key, same validation rules) so every page — the new landing page
 * (index.html), sos.html, checkin.html, and chat.html — reads and writes
 * the exact same trusted contact record. This is the reuse point that lets
 * "stay logged in" work across the new multi-page structure: nothing new
 * is invented here, this file just gives the old app.js functions their
 * own <script> tag so more than one page can include them without copying
 * the code.
 *
 * No DOM access in this file on purpose — it's loaded by pages that render
 * the contact differently (landing page welcome-back state vs. SOS page
 * status line vs. check-in gate check).
 */

const CONTACT_STORAGE_KEY = "safetyNet.trustedContact";

function loadContact() {
  try {
    const raw = localStorage.getItem(CONTACT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (err) {
    console.warn("Safety Net: couldn't read saved contact, ignoring.", err);
    return null;
  }
}

function saveContact(contact) {
  localStorage.setItem(CONTACT_STORAGE_KEY, JSON.stringify(contact));
}

function clearContact() {
  localStorage.removeItem(CONTACT_STORAGE_KEY);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value) {
  return EMAIL_RE.test(value.trim());
}

function isValidPhone(value) {
  const digits = value.replace(/[^0-9]/g, "");
  // ponytail: a real phone-validation library (e.g. libphonenumber) would
  // catch more malformed numbers correctly across countries. Ceiling: this
  // only checks digit count (7-15) after stripping formatting characters.
  // Upgrade path: swap this function for libphonenumber-js if phone-based
  // sending becomes a primary path rather than a fallback.
  return digits.length >= 7 && digits.length <= 15;
}

function contactIsValid(contact) {
  if (!contact || !contact.name || !contact.name.trim()) return false;
  const hasEmail = !!contact.email && contact.email.trim().length > 0;
  const hasPhone = !!contact.phone && contact.phone.trim().length > 0;
  if (!hasEmail && !hasPhone) return false;
  if (hasEmail && !isValidEmail(contact.email)) return false;
  if (hasPhone && !isValidPhone(contact.phone)) return false;
  return true;
}
