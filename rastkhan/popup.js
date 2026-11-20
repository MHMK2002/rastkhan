'use strict';

const enabled = document.querySelector('#enabled');
const modes = document.querySelector('#modes');
const choices = [...modes.querySelectorAll('input')];
const statusLabel = document.querySelector('#status');
const preview = document.querySelector('section');
const english = document.querySelector('#english');
const error = document.querySelector('#error');

function show({ enabled: on = true, readingMode = 'auto' }) {
  const mode = readingMode === 'rtl' ? 'rtl' : 'auto';
  enabled.disabled = false;
  enabled.checked = on;
  statusLabel.textContent = on ? 'روشن' : 'خاموش';
  modes.disabled = !on;
  for (const choice of choices) choice.checked = choice.value === mode;
  english.dir = mode === 'rtl' ? 'rtl' : 'ltr';
  preview.hidden = !on;
}

function reportError() {
  error.textContent = 'دسترسی به تنظیمات ممکن نشد. پنجرهٔ افزونه را دوباره باز کن.';
  error.hidden = false;
}

async function load() {
  try {
    show(await chrome.storage.local.get(['enabled', 'readingMode']));
  } catch {
    reportError();
  }
}

async function save(change) {
  try {
    await chrome.storage.local.set(change);
    error.hidden = true;
  } catch {
    await load();
    reportError();
  }
}

enabled.addEventListener('change', () => save({ enabled: enabled.checked }));
modes.addEventListener('change', event => save({ readingMode: event.target.value }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ('enabled' in changes || 'readingMode' in changes)) load();
});
load();
