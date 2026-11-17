const $ = (id) => document.getElementById(id);

const statusLabel = (state) => {
  switch (state.lastStatus) {
    case "online":
      return "Online — waiting for iPad";
    case "synced":
      return "Synced a course";
    case "no-canvas-tab":
      return "Open a Canvas tab (logged in)";
    case "offline":
      return "Bridge unreachable";
    case "job-error":
      return "Last job failed";
    case "paired":
      return "Paired — polling";
    default:
      return state.lastStatus || "Idle";
  }
};

const render = (state) => {
  if (!state || state.error) {
    $("error").hidden = false;
    $("error").textContent = state?.error || "Could not load extension state.";
    return;
  }
  $("pairCode").textContent = state.pairCode || "······";
  $("status").textContent = statusLabel(state);
  $("canvasHost").textContent = state.canvasHost || "—";
  $("bridgeUrl").value = state.bridgeUrl || "";
  if (state.lastError) {
    $("error").hidden = false;
    $("error").textContent = state.lastError;
  } else {
    $("error").hidden = true;
    $("error").textContent = "";
  }
};

const send = (message) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response));
  });

const refresh = async () => {
  const state = await send({ type: "GET_STATE" });
  render(state);
};

$("copyCode").addEventListener("click", async () => {
  const state = await send({ type: "GET_STATE" });
  if (state?.pairCode) {
    await navigator.clipboard.writeText(state.pairCode);
    $("copyCode").textContent = "Copied";
    setTimeout(() => {
      $("copyCode").textContent = "Copy code";
    }, 1200);
  }
});

$("newCode").addEventListener("click", async () => {
  const state = await send({ type: "RESET_ROOM" });
  render(state);
});

$("saveUrl").addEventListener("click", async () => {
  const bridgeUrl = $("bridgeUrl").value.trim();
  const state = await send({ type: "SET_BRIDGE_URL", bridgeUrl });
  render(state);
});

$("refresh").addEventListener("click", async () => {
  const state = await send({ type: "POLL_NOW" });
  render(state);
});

void (async () => {
  await send({ type: "ENSURE_ROOM" });
  await refresh();
})();
