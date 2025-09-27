document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('apiKey');
  const status = document.getElementById('status');

  // Load stored key
  chrome.storage.local.get(['OPENAI_KEY'], (res) => {
    if (res.OPENAI_KEY) input.value = res.OPENAI_KEY;
  });

  document.getElementById('save').addEventListener('click', () => {
    const key = input.value.trim();
    chrome.storage.local.set({ OPENAI_KEY: key }, () => {
      status.textContent = 'Saved.';
      setTimeout(() => (status.textContent = ''), 1500);
    });
  });
});
