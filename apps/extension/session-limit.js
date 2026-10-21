const params = new URLSearchParams(location.search);
const domain = params.get("domain") || "this site";
const tabId = Number(params.get("tabId"));
document.getElementById("domain").textContent = domain;
if (params.get("expired") === "1") {
  document.getElementById("title").textContent = "Your session is up";
  const message = document.getElementById("message");
  message.replaceChildren(document.createTextNode("Your previous session on "), document.getElementById("domain"), document.createTextNode(" has ended. Choose another allowance?"));
}

const error = document.getElementById("error");
async function start(minutes) {
  error.textContent = "";
  const result = await chrome.runtime.sendMessage({ type: "beginSessionLimit", tabId, host: domain, minutes });
  if (!result?.ok) error.textContent = result?.error || "Could not start this session. Reopen the site and try again.";
}

for (const minutes of [5, 10, 15, 25, 45, 60]) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `${minutes} min`;
  button.addEventListener("click", () => start(minutes));
  document.getElementById("choices").append(button);
}
document.getElementById("customForm").addEventListener("submit", (event) => {
  event.preventDefault();
  start(Number(document.getElementById("customMinutes").value));
});
