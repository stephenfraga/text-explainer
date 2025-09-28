const input = document.getElementById("keyInput");
const saveBtn = document.getElementById("save");
const clearBtn = document.getElementById("clear");
const status = document.getElementById("status");

// Load any saved key
chrome.storage.local.get(["OPENAI_KEY"], (res) => {
  if (res.OPENAI_KEY) input.value = res.OPENAI_KEY;
});

// Save the key
saveBtn.addEventListener("click", () => {
  const key = input.value.trim();
  if (key) {
    chrome.storage.local.set({ OPENAI_KEY: key }, () => {
      showStatus("API key saved.", "success");
    });
  } else {
    showStatus("Please enter a valid API key.", "error");
  }
});

// Clear the key
clearBtn.addEventListener("click", () => {
  chrome.storage.local.remove("OPENAI_KEY", () => {
    input.value = "";
    showStatus("API key cleared.", "success");
  });
});

// Helper to show messages
function showStatus(msg, type) {
  status.textContent = msg;
  status.className = type; // "success" or "error"
  setTimeout(() => {
    status.textContent = "";
    status.className = "";
  }, 3000);
}
