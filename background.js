const GROQ_API_KEY = "";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "askAI") {
    const messages = request.messages || [{ role: "user", content: request.prompt }];
    callGroq(messages).then(sendResponse).catch(err => {
      sendResponse("Error: " + err.message);
    });
    return true;
  }
});

async function callGroq(messages) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: messages
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content ?? "No response.";
}
