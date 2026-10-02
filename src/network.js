const os = require('os');

/**
 * Discovers and prioritizes local area network (LAN) IPv4 addresses.
 * Filters out internal/loopback and prioritizes typical Wi-Fi and Ethernet subnets.
 */
function getNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      // Check IPv4 and non-internal
      const isIpv4 = addr.family === 'IPv4' || addr.family === 4;
      if (!isIpv4 || addr.internal) continue;

      const ip = addr.address;
      // Calculate a priority score for typical LAN adapters
      let score = 0;
      const lowerName = name.toLowerCase();

      // Deprioritize virtual adapters (Hyper-V, VirtualBox, WSL, vEthernet, etc.)
      if (lowerName.includes('virtual') || lowerName.includes('vethernet') || lowerName.includes('wsl') || lowerName.includes('vmware')) {
        score -= 50;
      }
      // Prioritize Wi-Fi and WLAN
      if (lowerName.includes('wi-fi') || lowerName.includes('wifi') || lowerName.includes('wlan') || lowerName.includes('wireless')) {
        score += 30;
      }
      // Prioritize standard Ethernet
      if (lowerName.includes('ethernet') || lowerName.includes('eth')) {
        score += 20;
      }

      // Check standard private RFC 1918 subnets
      if (ip.startsWith('192.168.')) {
        score += 25;
      } else if (ip.startsWith('10.')) {
        score += 15;
      } else if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) {
        score += 10;
      }

      candidates.push({
        name,
        ip,
        netmask: addr.netmask,
        mac: addr.mac,
        score
      });
    }
  }

  // Sort by priority score descending
  candidates.sort((a, b) => b.score - a.score);

  const primaryIp = candidates.length > 0 ? candidates[0].ip : '127.0.0.1';

  return {
    primaryIp,
    candidates,
    allIps: candidates.map(c => c.ip)
  };
}

module.exports = {
  getNetworkInfo
};
