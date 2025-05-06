// Define manipulation tactics (expandable in future)
const tactics = [
  {
    name: 'Emotional Language',
    keywords: ['fear', 'outrage', 'hate', 'love', 'anger', 'shocking', 'devastating', 'destruction'],
    description: 'This text uses emotionally charged language, designed to elicit strong feelings.'
  }
];

// Escape HTML to prevent DOM injection issues
function escapeHTML(str) {
  return str.replace(/[&<>"']/g, match =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match])
  );
}

// Function to send text to the server for LLM analysis
const analyzeTextWithLLM = async (text) => {
  try {
    const response = await fetch('http://localhost:3000/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    const data = await response.json();
    console.log('LLM analysis result:', data);
    // You could use this data to influence UI later
  } catch (error) {
    console.error('Error sending text to LLM:', error);
  }
};

// Collect visible text and optionally highlight it in place
function collectAndHighlightText(node, collected = []) {
  if (node.nodeType === Node.TEXT_NODE && node.parentNode) {
    const parentTag = node.parentNode.tagName;
    const trimmedText = node.textContent.trim();

    if (
      trimmedText.length > 0 &&
      parentTag !== 'SCRIPT' &&
      parentTag !== 'STYLE' &&
      parentTag !== 'A'
    ) {
      collected.push(trimmedText);

      // Only highlight the first matched tactic per node
      for (let tactic of tactics) {
        for (let keyword of tactic.keywords) {
          const regex = new RegExp(`(${keyword})`, 'gi');
          if (regex.test(trimmedText)) {
            const newText = escapeHTML(trimmedText).replace(regex, (match) => {
              return `<span class="highlighted" title="${tactic.description}">${match}</span>`;
            });

            const span = document.createElement('span');
            span.innerHTML = newText;

            node.parentNode.replaceChild(span, node);
            return collected; // Stop after first match
          }
        }
      }
    }
  } else if (node.nodeType === Node.ELEMENT_NODE && !['SCRIPT', 'STYLE'].includes(node.tagName)) {
    for (let child of node.childNodes) {
      collectAndHighlightText(child, collected);
    }
  }

  return collected;
}

// === Run everything on page load ===
(() => {
  const visibleTextArray = collectAndHighlightText(document.body);
  const combinedText = visibleTextArray.join(' ').slice(0, 3000); // Trim to 3,000 chars for LLM

  analyzeTextWithLLM(combinedText);
})();