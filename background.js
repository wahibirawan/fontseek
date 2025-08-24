chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      files: ["content.js"],
      world: "MAIN" // run in page context for accurate font metrics
    });
  } catch (e) {
    console.error("FontSeek injection failed:", e);
  }
});
