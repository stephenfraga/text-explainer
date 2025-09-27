// background.js -- all-in-one with text-search insertion
console.log("Background loaded");

chrome.commands.onCommand.addListener(async (command) => {
  console.log("Command received:", command);
  if (command !== "trigger_explainer") return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      console.warn("No active tab");
      return;
    }

    console.log("Probing tab for selection (tabId=%s)...", tab.id);
    const probes = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        try {
          const sel = window.getSelection?.().toString().trim() || "";
          const ctx = (document.body?.innerText || document.documentElement?.innerText || "")
            .replace(/\s+/g, " ")
            .slice(0, 600);
          return { sel, ctx };
        } catch (e) {
          return { sel: "", ctx: "" };
        }
      }
    });

    console.log("Probe results:", probes);
    const hit = probes.find(r => r && r.result && r.result.sel);
    if (!hit) {
      notify("No text selected (or cannot access the frame).");
      return;
    }

    const { sel, ctx } = hit.result;
    console.log("Found selection in frameId=%s: %s", hit.frameId, sel);

    chrome.storage.local.get(["OPENAI_KEY"], async (res) => {
      const OPENAI_KEY = res?.OPENAI_KEY;
      if (!OPENAI_KEY) {
	console.log("no API key set");
        notify("No API key set. Open extension options and add your OpenAI key.");
        return;
      }

      console.log("Calling OpenAI for selection:", sel);
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
              { role: "system", content: "You are a concise explainer. Answer in 1–2 plain sentences." },
              { role: "user", content: `Explain "${sel}" in plain English. Context: ${ctx}` }
            ]
          })
        });

        const data = await response.json();
        console.log("OpenAI raw response:", data);

        if (data?.error) {
          explanation = "Error: " + (data.error.message || JSON.stringify(data.error));
        } else if (data?.choices?.[0]?.message?.content) {
          explanation = data.choices[0].message.content.trim();
        } else if (data?.choices?.[0]?.text) {
          explanation = data.choices[0].text.trim();
        }
      } catch (fetchErr) {
        console.error("Fetch/OpenAI error:", fetchErr);
        explanation = "Error: " + fetchErr.message;
      }

      console.log("Explanation obtained:", explanation);

      // Inject the explanation by searching for the text string
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [hit.frameId] },
          args: [sel, explanation],
          func: (sel, exp) => {
            console.log("Injecting explanation for:", sel, "->", exp);
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              const idx = node.nodeValue.indexOf(sel);
              if (idx !== -1) {
                const range = document.createRange();
                range.setStart(node, idx + sel.length);
                range.collapse(true);

                const span = document.createElement("span");
                span.style.background = "yellow";
                span.style.marginLeft = "4px";
                span.style.fontStyle = "italic";
                span.textContent = ` (${exp})`;

                range.insertNode(span);
                break;
              }
            }
          }
        });
        console.log("Injected explanation into page.");
      } catch (injectErr) {
        console.error("Injection failed:", injectErr);
        notify("Failed to insert explanation into the page: " + injectErr.message);
      }
    });

  } catch (err) {
    console.error("Top-level error handling command:", err);
    notify("Unexpected error: " + (err && err.message ? err.message : String(err)));
  }
});

function notify(message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: "Text Explainer",
      message
    });
  } catch (e) {
    console.warn("Notification failed:", e);
  }
}
