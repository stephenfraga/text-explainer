// background.js

// Create the right-click menu item on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "explain-text",
    title: "Text Explainer",
    contexts: ["selection"]
  });
});

// Handle right-click menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "explain-text") {
    runExplainer(tab);
  }
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "trigger_explainer") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    runExplainer(tab);
  }
});

// Main function to run the explainer
async function runExplainer(tab) {
  try {
    // -----------------------
    // Probe page for selection and nearby context using parent element text
    const probes = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        try {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return { sel: "", ctx: "" };

          const range = sel.getRangeAt(0);
          const term = sel.toString().trim();
          if (!term) return { sel: "", ctx: "" };

          // Use the parent element’s full text
          let parent = range.commonAncestorContainer;
          if (parent.nodeType !== Node.ELEMENT_NODE) {
            parent = parent.parentElement;
          }
          const fullText = parent.textContent || "";

          // Find the index of the selected text within that full text
          const idx = fullText.indexOf(term);
          if (idx === -1) return { sel: term, ctx: "" };

          // Take 200 characters before and after the selected term
          const start = Math.max(0, idx - 200);
          const end = Math.min(fullText.length, idx + term.length + 200);
          const ctx = fullText.slice(start, end).replace(/\s+/g, " ");
          return { sel: term, ctx };
        } catch {
          return { sel: "", ctx: "" };
        }
      }
    });
    // -----------------------

    const hit = probes.find(r => r && r.result && r.result.sel);
    if (!hit) return;

    const { sel, ctx } = hit.result;

    chrome.storage.local.get(["API_KEY"], async (res) => {
      const API_KEY = res?.API_KEY;
      if (!API_KEY) {
        if (chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        } else {
          const url = chrome.runtime.getURL("options.html");
          chrome.tabs.create({ url });
        }
        return;
      }

      // ----------------------
      let explanation = "No explanation returned.";
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + API_KEY,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/stephenfraga/text-explainer",
            "X-Title": "Text Explainer Chrome Extension"
          },
          body: JSON.stringify({
            model: "deepseek/deepseek-chat-v3.1:free", // try swapping out others: "meta-llama/llama-3.3-70b-instruct:free", "deepseek/deepseek-chat-v3.1:free" or "google/gemini-2.0-flash-exp:free"
            messages: [
              { role: "system", content: "You are a concise explainer. Output only the replacement phrase." },
              { role: "user", content: `Replace the text "${sel}" with its plain English equivalent only. 
                If it is an acronym, output only its expanded form.
                If it is a foreign word or phrase, output only its English translation.
                If it is an uncommon word, output only a concise synonym or plain-English paraphrase.
                If it is a person or proper name, output only a one-sentence identity in noun form.
                Do not explain or define — output only the replacement phrase.
                Context: ${ctx}` }
            ]
          })
        });

        const data = await response.json();
        if (data?.error) {
          explanation = "Error: " + (data.error.message || JSON.stringify(data.error));
        } else if (data?.choices?.[0]?.message?.content) {
          explanation = data.choices[0].message.content.trim();
        } else if (data?.choices?.[0]?.text) {
          explanation = data.choices[0].text.trim();
        }
      } catch (fetchErr) {
        explanation = "Error: " + fetchErr.message;
      }

      if (!explanation.startsWith("Error:")) {
        explanation = cleanOutput(explanation);
      }

      // --------------------------
      // Inject into page, replacing the highlighted text
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [hit.frameId] },
          args: [explanation],
          func: (exp) => {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) {
              alert(exp);
              return;
            }

            const r = sel.getRangeAt(0);
            const original = sel.toString();

            // Detect if original selection ended with a space
            const keepSpace = /\s$/.test(original);

            r.deleteContents();

            const frag = document.createDocumentFragment();
            const wrapper = document.createElement("span");
            const out = document.createElement("span");
            out.style.color = "red";
            out.textContent = exp + (keepSpace ? " " : ""); // append space if needed
            wrapper.appendChild(out);
            frag.appendChild(wrapper);

            r.insertNode(frag);
            sel.removeAllRanges();
          }
        });
      } catch (injectErr) {
        // injection failed
      }
      // --------------------------
    });
  } catch (err) {
    console.error("Top-level error in runExplainer:", err);
  }
}

// Cleanup function for model output
function cleanOutput(raw) {
  if (!raw) return "";
  let out = raw.trim();
  out = out.replace(/[.,;:]+$/, "");        // drop trailing punctuation
  out = out.replace(/^(is|means|refers to)\s+/i, ""); // strip leading phrases
  out = out.replace(/^["'](.*)["']$/, "$1");          // strip quotes
  return out.trim();
}
