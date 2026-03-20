// Pixadvisor Shared Utilities
const PIX_VERSION = '3.1.0';

/**
 * Escape HTML special characters to prevent XSS
 * @param {*} str - Value to escape
 * @returns {string} Escaped string safe for innerHTML
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
