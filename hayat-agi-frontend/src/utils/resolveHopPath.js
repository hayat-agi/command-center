// Build a hop animation path from real alert metadata when possible.
//
// Inputs:
//   - sourceGateway: the uplink gateway (resolved from alert.device_id /
//     incident.gateway). This is where the LoRa-to-HTTP boundary happens.
//   - meshSrcAddr:   the LoRa mesh source address on the alert (e.g.
//     '0x0002'). Identifies the physical sender, NOT the uplink.
//   - gateways:      the full gateway list (each may carry .loraAddress).
//
// Returns:
//   - { kind: 'real', path: [...] } when meshSrcAddr resolves to a known
//     gateway with location. path = [sender, uplink].
//   - null when we don't have enough data — caller should fall back to
//     synthesizeHopPath for the demo-style placeholder animation.

const normalize = (value) => {
  if (value == null) return null;
  const str = String(value).trim().toLowerCase();
  return str || null;
};

const gatewayPoint = (g) => ({
  id: g._id,
  lat: g.location.lat,
  lng: g.location.lng,
  name: g.name || g.serialNumber || 'Gateway',
});

const isPlottable = (g) => (
  g
  && g.location
  && g.location.lat != null
  && g.location.lng != null
);

export const resolveHopPath = ({ sourceGateway, meshSrcAddr, gateways }) => {
  if (!isPlottable(sourceGateway)) return null;
  const wanted = normalize(meshSrcAddr);
  if (!wanted) return null;
  if (!Array.isArray(gateways) || gateways.length === 0) return null;

  // The uplink itself sometimes appears as meshSrcAddr when meshHops === 0
  // (the sender IS the uplink, no relay). In that case there's no real
  // animation to draw — return null so the caller can show a static badge.
  if (normalize(sourceGateway.loraAddress) === wanted) return null;

  const sender = gateways.find(
    (g) => isPlottable(g) && normalize(g.loraAddress) === wanted
  );
  if (!sender) return null;
  if (sender._id === sourceGateway._id) return null;

  return {
    kind: 'real',
    path: [gatewayPoint(sender), gatewayPoint(sourceGateway)],
  };
};
