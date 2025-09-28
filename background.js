chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "trigger_explainer") return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return;
    }

// --------------
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
// ----------------------

    const hit = probes.find(r => r && r.result && r.result.sel);
    if (!hit) {
      // console.log("No text selected (or cannot access the frame).");
      return;
    }

    const { sel, ctx } = hit.result;
    console.log("Word: ", sel);
    console.log("Context:", ctx);

    chrome.storage.local.get(["OPENAI_KEY"], async (res) => {
      const OPENAI_KEY = res?.OPENAI_KEY;
      if (!OPENAI_KEY) {
        console.log("No API key set. Opening extension options page...");
        if (chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        } else {
          const url = chrome.runtime.getURL("options.html");
          chrome.tabs.create({ url });
        }
        return;
      }

      // continue with API call using OPENAI_KEY...
// ----------------------

      // console.log("Calling OpenAI for selection:", sel);
      let explanation = "No explanation returned.";

      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + OPENAI_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0,
            max_tokens: 160,
            messages: [
		{ 
		  role: "user", 
		  content: `Replace the text "${sel}" with its plain English equivalent only. 
		If it is an acronym, output only its expanded form (e.g., "IRS" = "Internal Revenue Service"). 
		If it is a foreign word or phrase, output only its English translation (e.g., "grand chien" = "big dog"). 
		If it is an uncommon word, output only a concise synonym or plain-English paraphrase (e.g., "ephemeral" = "lasting only briefly"). 
		If it is a person or proper name, output only a one-sentence identity in noun form (e.g., "Aubrey Beardsley" = "English author and illustrator"). 
		Do not explain, define, or add commentary -- output only the replacement phrase. 
		Context: ${ctx}`
		}
            ]
          })
        });

        const data = await response.json();
        // console.log("OpenAI raw response:", data);

        if (data?.error) {
          explanation = "Error: " + (data.error.message || JSON.stringify(data.error));
        } else if (data?.choices?.[0]?.message?.content) {
          explanation = data.choices[0].message.content.trim();
        } else if (data?.choices?.[0]?.text) {
          explanation = data.choices[0].text.trim();
        }
      } catch (fetchErr) {
        // console.error("Fetch/OpenAI error:", fetchErr);
        explanation = "Error: " + fetchErr.message;
      }

      // console.log("Explanation obtained:", explanation);

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
            r.deleteContents();

            const frag = document.createDocumentFragment();
            // safe insertion: create elements and use textContent (no innerHTML)
            const wrapper = document.createElement('span');
            const out = document.createElement('span');
            out.style.color = 'red';
            out.textContent = exp;      // escape any HTML from the model
            wrapper.appendChild(out);
            frag.appendChild(wrapper);

            r.insertNode(frag);
            sel.removeAllRanges();
          }
        });
        // console.log("Replaced selection with explanation.");
      } catch (injectErr) {
        // console.error("Injection failed:", injectErr);
      }
    });

  } catch (err) {
    console.error("Top-level error handling command:", err);
  }
});
