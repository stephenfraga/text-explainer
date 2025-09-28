// options.js

const input = document.getElementById("keyInput");
const saveBtn = document.getElementById("save");
const clearBtn = document.getElementById("clear");
const status = document.getElementById("status");

// Load saved key
chrome.storage.local.get(["API_KEY"], (res) => {
  if (res.API_KEY) input.value = res.API_KEY;
});

// Save key
saveBtn.addEventListener("click", () => {
  const key = input.value.trim();
  if (key) {
    chrome.storage.local.set({ API_KEY: key }, () => {
      status.textContent = "API key saved. Close this tab to return.";
      status.style.color = "green";
    });
  }
});

// Clear key
clearBtn.addEventListener("click", () => {
  chrome.storage.local.remove("API_KEY", () => {
    input.value = "";
    status.textContent = "API key cleared. Close this tab to return.";
    status.style.color = "red";
  });
});
