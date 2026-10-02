/**
 * Utility for HTML escaping and safe text formatting.
 * Strictly prevents XSS attacks in chat messages and user nicknames.
 */

function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeNickname(rawName) {
  if (!rawName || typeof rawName !== 'string') return 'Guest';
  // Trim and limit to 24 characters
  let clean = rawName.trim().substring(0, 24);
  // Replace control characters or excessive spaces
  clean = clean.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
  // Basic fallback
  return clean || 'Guest';
}

/**
 * Parses user-agent strings into friendly Device / Browser / OS labels.
 */
function parseDeviceAgent(uaString) {
  if (!uaString || typeof uaString !== 'string') {
    return { os: 'Unknown OS', browser: 'Unknown Browser', device: 'Desktop' };
  }

  const ua = uaString.toLowerCase();
  let os = 'Unknown OS';
  let browser = 'Unknown Browser';
  let device = 'Desktop';

  // Device
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    device = 'Mobile';
  } else if (ua.includes('ipad') || ua.includes('tablet')) {
    device = 'Tablet';
  }

  // OS
  if (ua.includes('windows nt 10.0')) os = 'Windows 10/11';
  else if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('macintosh') || ua.includes('mac os')) os = 'macOS';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
  else if (ua.includes('linux')) os = 'Linux';

  // Browser
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('chrome/') && !ua.includes('edg/')) browser = 'Chrome';
  else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Safari';
  else if (ua.includes('firefox/')) browser = 'Firefox';
  else if (ua.includes('opera/') || ua.includes('opr/')) browser = 'Opera';

  return { os, browser, device };
}

module.exports = {
  escapeHtml,
  sanitizeNickname,
  parseDeviceAgent
};
