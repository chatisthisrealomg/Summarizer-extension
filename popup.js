let conversation = [];
const outputDiv = document.getElementById('output');
const toolsOutputDiv = document.getElementById('tools-output');

function renderMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^[\*\-] (.+)/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, match => `<ul>${match}</ul>`);
  html = html.replace(/<\/ul>\s*<ul>/g, '');
  html = html.replace(/^### (.+)/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)/gm, '<h1>$1</h1>');
  html = html.split(/\n\n+/).map(para => {
    para = para.trim();
    if (!para) return '';
    if (para.startsWith('<ul>') || para.startsWith('<h') || para.startsWith('<pre>')) return para;
    return `<p>${para.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return html;
}

function setOutput(el, text) {
  const copyBtn = el.querySelector('.copy-btn');
  el.innerHTML = renderMarkdown(text);
  if (copyBtn) el.appendChild(copyBtn);
}

function setStatus(el, text) {
  const copyBtn = el.querySelector('.copy-btn');
  el.innerHTML = `<span class="status-text">${text}</span>`;
  if (copyBtn) el.appendChild(copyBtn);
}

// =====================
// Tab switching
// =====================
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'saved') loadSaved();
  });
});

document.addEventListener('click', e => {
  if (e.target.classList.contains('copy-btn')) {
    const target = document.getElementById(e.target.dataset.target);
    navigator.clipboard.writeText(target.innerText).then(() => {
      e.target.innerText = 'Copied!';
      setTimeout(() => e.target.innerText = 'Copy', 1500);
    });
  }
});

async function getPageContent(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const clone = document.body.cloneNode(true);
      ['script', 'style', 'nav', 'footer', 'header', 'aside'].forEach(tag => {
        clone.querySelectorAll(tag).forEach(el => el.remove());
      });
      return {
        title: document.title,
        url: window.location.href,
        text: clone.innerText.replace(/\s+/g, ' ').trim().slice(0, 4000)
      };
    }
  });
  return results[0].result;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isBrowserPage(url) {
  return url.startsWith("chrome://") || url.startsWith("chrome-extension://");
}

function sendToAI(prompt, outputEl, onSuccess) {
  chrome.runtime.sendMessage({
    action: "askAI",
    messages: [{ role: "user", content: prompt }]
  }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(outputEl, 'Error: ' + chrome.runtime.lastError.message);
    } else {
      setOutput(outputEl, response);
      if (onSuccess) onSuccess(response);
    }
  });
}

document.getElementById('clear-chat-btn').addEventListener('click', () => {
  conversation = [];
  setStatus(outputDiv, 'Chat cleared.');
});

document.getElementById('submit-btn').addEventListener('click', () => {
  const promptText = document.getElementById('user-input').value;
  if (!promptText.trim()) return;
  conversation.push({ role: "user", content: promptText });
  setStatus(outputDiv, 'Thinking...');
  document.getElementById('user-input').value = '';

  chrome.runtime.sendMessage({ action: "askAI", messages: conversation }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(outputDiv, 'Error: ' + chrome.runtime.lastError.message);
    } else {
      conversation.push({ role: "assistant", content: response });
      setOutput(outputDiv, response);
    }
  });
});

// =====================
// Summarize page
// =====================
document.getElementById('summarize-btn').addEventListener('click', async () => {
  setStatus(outputDiv, 'Scanning page...');
  try {
    const tab = await getActiveTab();
    if (!tab) { setStatus(outputDiv, 'Error: No active tab.'); return; }
    if (isBrowserPage(tab.url)) { setStatus(outputDiv, "Can't scan Chrome internal pages."); return; }
    const { title, url, text } = await getPageContent(tab.id);
    setStatus(outputDiv, 'Summarizing...');
    sendToAI(
      `Summarize this webpage in 3-5 bullet points.\n\nTitle: ${title}\nURL: ${url}\n\nContent:\n${text}`,
      outputDiv,
      (response) => autoSaveSummary(title, url, response)
    );
  } catch (err) {
    setStatus(outputDiv, 'Error: ' + err.message);
  }
});

// =====================
// TOOLS
// =====================
let lastToolResult = '';
let lastToolTitle = '';
let lastToolUrl = '';

async function runPageTool(prompt, statusMsg) {
  setStatus(toolsOutputDiv, statusMsg);
  document.getElementById('save-summary-btn').style.display = 'none';
  try {
    const tab = await getActiveTab();
    if (!tab) { setStatus(toolsOutputDiv, 'Error: No active tab.'); return; }
    if (isBrowserPage(tab.url)) { setStatus(toolsOutputDiv, "Can't scan Chrome internal pages."); return; }
    const { title, url, text } = await getPageContent(tab.id);
    lastToolTitle = title;
    lastToolUrl = url;
    sendToAI(prompt(title, url, text), toolsOutputDiv, (response) => {
      lastToolResult = response;
      document.getElementById('save-summary-btn').style.display = 'block';
    });
  } catch (err) {
    setStatus(toolsOutputDiv, 'Error: ' + err.message);
  }
}

// Credibility checker
document.getElementById('credibility-btn').addEventListener('click', () => {
  runPageTool(
    (title, url, text) => `Analyze the credibility of this webpage. Consider: use of sources, emotional language, factual claims, author transparency, and overall trustworthiness. Give a credibility rating (High/Medium/Low) and explain why.\n\nTitle: ${title}\nURL: ${url}\n\nContent:\n${text}`,
    'Checking credibility...'
  );
});

// Article vs Opinion
document.getElementById('bias-btn').addEventListener('click', () => {
  runPageTool(
    (title, url, text) => `Analyze this webpage and determine: is this a factual news article, an opinion piece, or a mix of both? Look for bias indicators, opinionated language, and whether claims are supported by evidence. Give a clear verdict and examples.\n\nTitle: ${title}\nURL: ${url}\n\nContent:\n${text}`,
    'Analyzing article type...'
  );
});

// Source finder
document.getElementById('sources-btn').addEventListener('click', () => {
  runPageTool(
    (title, url, text) => `Find and list all sources, references, citations, or external links mentioned in this webpage content. For each claim that should have a source, note whether a source is provided or missing.\n\nTitle: ${title}\nURL: ${url}\n\nContent:\n${text}`,
    'Finding sources...'
  );
});

// Language detector
document.getElementById('language-btn').addEventListener('click', () => {
  runPageTool(
    (title, url, text) => `Detect the language this webpage is written in. Then provide a brief summary of the page content in English regardless of the original language.\n\nTitle: ${title}\nURL: ${url}\n\nContent:\n${text}`,
    'Detecting language...'
  );
});

// Compare pages
document.getElementById('compare-btn').addEventListener('click', () => {
  const section = document.getElementById('compare-url-section');
  section.style.display = section.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('compare-go-btn').addEventListener('click', async () => {
  const secondUrl = document.getElementById('compare-url-input').value.trim();
  if (!secondUrl) { setStatus(toolsOutputDiv, 'Please enter a URL to compare with.'); return; }
  setStatus(toolsOutputDiv, 'Reading current page...');
  document.getElementById('save-summary-btn').style.display = 'none';

  try {
    const tab = await getActiveTab();
    if (!tab) { setStatus(toolsOutputDiv, 'Error: No active tab.'); return; }
    if (isBrowserPage(tab.url)) { setStatus(toolsOutputDiv, "Can't scan Chrome internal pages."); return; }
    const page1 = await getPageContent(tab.id);
    setStatus(toolsOutputDiv, 'Reading second page...');

    // Fetch second page content via background
    chrome.runtime.sendMessage({ action: "fetchUrl", url: secondUrl }, async (page2Text) => {
      if (chrome.runtime.lastError || !page2Text) {
        setStatus(toolsOutputDiv, 'Error: Could not fetch the second URL.');
        return;
      }
      setStatus(toolsOutputDiv, 'Comparing pages...');
      sendToAI(
        `Compare these two webpages. Highlight similarities, differences, and any conflicting information.\n\nPAGE 1:\nTitle: ${page1.title}\nURL: ${page1.url}\nContent: ${page1.text}\n\nPAGE 2:\nURL: ${secondUrl}\nContent: ${page2Text}`,
        toolsOutputDiv,
        (response) => {
          lastToolResult = response;
          lastToolTitle = `Comparison: ${page1.title}`;
          lastToolUrl = page1.url;
          document.getElementById('save-summary-btn').style.display = 'block';
        }
      );
    });
  } catch (err) {
    setStatus(toolsOutputDiv, 'Error: ' + err.message);
  }
});

// Save tool result
document.getElementById('save-summary-btn').addEventListener('click', () => {
  if (lastToolResult) {
    saveSummary(lastToolTitle, lastToolUrl, lastToolResult);
    document.getElementById('save-summary-btn').innerText = '✅ Saved!';
    setTimeout(() => {
      document.getElementById('save-summary-btn').innerText = '💾 Save This Result';
    }, 1500);
  }
});

// =====================
// Saved summaries
// =====================
function saveSummary(title, url, text) {
  const saved = JSON.parse(localStorage.getItem('saved-summaries') || '[]');
  saved.unshift({ title, url, text, time: Date.now() });
  if (saved.length > 30) saved.pop();
  localStorage.setItem('saved-summaries', JSON.stringify(saved));
}

function autoSaveSummary(title, url, text) {
  saveSummary(title, url, text);
}

function loadSaved() {
  const list = document.getElementById('saved-list');
  const saved = JSON.parse(localStorage.getItem('saved-summaries') || '[]');
  if (saved.length === 0) {
    list.innerHTML = '<p class="empty-state">No saved summaries yet.</p>';
    return;
  }
  list.innerHTML = saved.map((item, i) => `
    <div class="saved-item" id="saved-${i}">
      <div class="saved-item-title">${escapeHtml(item.title || 'Untitled')}</div>
      <div class="saved-item-url">${escapeHtml(item.url || '')}</div>
      <div class="saved-item-text">${escapeHtml(item.text.slice(0, 200))}...</div>
      <div class="saved-item-actions">
        <button class="btn-blue" onclick="expandSaved(${i})">View Full</button>
        <button class="btn-gray" onclick="deleteSaved(${i})">Delete</button>
      </div>
    </div>
  `).join('');
}

function expandSaved(i) {
  const saved = JSON.parse(localStorage.getItem('saved-summaries') || '[]');
  const item = saved[i];
  if (!item) return;
  const el = document.getElementById(`saved-${i}`);
  el.querySelector('.saved-item-text').innerHTML = escapeHtml(item.text);
}

function deleteSaved(i) {
  const saved = JSON.parse(localStorage.getItem('saved-summaries') || '[]');
  saved.splice(i, 1);
  localStorage.setItem('saved-summaries', JSON.stringify(saved));
  loadSaved();
}

document.getElementById('clear-saved-btn').addEventListener('click', () => {
  localStorage.removeItem('saved-summaries');
  loadSaved();
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
