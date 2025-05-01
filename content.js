// Define the tactic and its keywords
const tactic = {
  name: 'Emotional Language',
  keywords: ['fear', 'outrage', 'hate', 'love', 'anger', 'shocking', 'devastating', 'destruction'],
  description: 'This text uses emotionally charged language, designed to elicit strong feelings.'
};

// Function to recursively check text content in the DOM and highlight matches, excluding links
function highlightTextInNodes(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    // Ensure that we're not modifying text within links
    if (node.parentNode && node.parentNode.tagName !== 'A') {
      let newText = node.textContent;
      tactic.keywords.forEach(keyword => {
        const regex = new RegExp(`(${keyword})`, 'gi');
        if (regex.test(newText)) {
          console.log("Matching text found: ", newText); // Log matching text

          // Split the text content based on the keyword and wrap only the keyword in <span>
          newText = newText.replace(regex, (match) => {
            return `<span class="highlighted" title="${tactic.description}">${match}</span>`;
          });

          // Ensure parentNode exists and is a valid parent for text replacement
          if (node.parentNode && node.parentNode.nodeType === Node.ELEMENT_NODE) {
            const span = document.createElement('span');
            span.innerHTML = newText;

            // Only replace if the parentNode is valid
            if (node.parentNode) {
              node.parentNode.replaceChild(span, node);
            }
          }
        }
      });
    }
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    // Only continue for elements that can contain text, avoid unnecessary checks on script/style elements
    if (node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
      for (let childNode of node.childNodes) {
        highlightTextInNodes(childNode);
      }
    }
  }
}

// Start the highlighting process from the body of the document
highlightTextInNodes(document.body);