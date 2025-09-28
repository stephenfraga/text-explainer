chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "trigger_explainer") return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return;
    }

// Probe page for selection and nearby context
const probes = await chrome.scripting.executeScript({
  target: { tabId: tab.id, allFrames: true },
  func: () => {
    try {
      const selObj = window.getSelection();
      if (!selObj || selObj.rangeCount === 0) {
        return { sel: "", ctx: "" };
      }

      const range = selObj.getRangeAt(0);
      const sel = selObj.toString().trim();

      // Climb to a larger container (like a <p> or <div>)
      let container = range.commonAncestorContainer;
      if (container.nodeType !== Node.ELEMENT_NODE) {
        container = container.parentElement;
      }

      const fullText = container.innerText || container.textContent || "";
      const idx = fullText.indexOf(sel);
      if (idx === -1) {
        return { sel, ctx: "" };
      }

      // Get 100 characters before and after selection
      const before = Math.max(0, idx - 100);
      const after = Math.min(fullText.length, idx + sel.length + 100);
      const ctx = fullText.slice(before, after).replace(/\s+/g, " ");

      return { sel, ctx };
    } catch (e) {
      return { sel: "", ctx: "" };
    }
  }
});

    console.log("Probe results:", probes);
    const hit = probes.find(r => r && r.result && r.result.sel);
    if (!hit) {
      // console.log("No text selected (or cannot access the frame).");
      return;
    }

    const { sel, ctx } = hit.result;
    // console.log("Found selection in frameId=%s: %s", hit.frameId, sel);
    console.log("Context extracted:", ctx);

    chrome.storage.local.get(["OPENAI_KEY"], async (res) => {
      const OPENAI_KEY = res?.OPENAI_KEY;
      if (!OPENAI_KEY) {
        // console.log("No API key set. Open extension options and add your OpenAI key.");
        return;
      }

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
              { role: "system", content: "You are a concise explainer. Answer in 1-2 plain sentences." },
              { role: "user", content: `Explain "${sel}" in plain English. Context: ${ctx}` }
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
