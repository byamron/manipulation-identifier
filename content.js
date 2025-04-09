console.log("Manipulation Identifier content script loaded.");

const manipulativePhrases = [
  "everyone knows that",
  "only an idiot would",
  "clearly",
  "it's obvious that"
];

// Function to wrap found phrases in a highlight span
function highlightManipulativePhrases(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    let text = node.textContent;
    manipulativePhrases.forEach(phrase => {
      const regex = new RegExp(`\\b(${phrase})\\b`, "gi");
      if (regex.test(text)) {
        const span = document.createElement("span");
        span.innerHTML = text.replace(regex, `<mark style="background: orange; color: black;">$1</mark>`);
        node.replaceWith(span);
      }
    });
  } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== "SCRIPT" && node.tagName !== "STYLE") {
    node.childNodes.forEach(highlightManipulativePhrases);
  }
}

// Start scanning from the body
highlightManipulativePhrases(document.body);
