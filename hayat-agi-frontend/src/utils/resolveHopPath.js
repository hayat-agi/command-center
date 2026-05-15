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
//     gateway with location. path = [sender, ...relays, uplink].
//   - null when we don't have enough data — caller should fall back to
//     synthesizeHopPath for the demo-style placeholder animation.
//
// Hop chain resolution:
// The firmware currently uplinks only meshSrcAddr (start) and hop_count.
// The intermediate node addresses are NOT in the HTTP payload because the
// mesh_packet struct holds prev_hop (last forwarder) but not the full
// path. Until the firmware ships full-chain in a header, we use the
// KNOWN_TOPOLOGY hint below to draw the animation through the physically
// correct relays. When firmware ships hop_path, replace this table with
// the parsed array (see backend X-Mesh-Path → alert.meshHopsPath field).

// Physical mesh layout (campus deployment, May 2026):
//   0x0005 (Rektörlük) → 0x0003 (Hazırlık) → 0x0002 (L Blok)
//                                          → 0x0001 (M Blok)
//                                          → 0x0004 (Ortak Alan, uplink)
// Each entry: source addr → ordered chain ending at the uplink.
const KNOWN_TOPOLOGY = {
  '0x0005': ['0x0005', '0x0003', '0x0002', '0x0001', '0x0004'],
  '0x0003': ['0x0003', '0x0002', '0x0001', '0x0004'],
  '0x0002': ['0x0002', '0x0001', '0x0004'],
  '0x0001': ['0x0001', '0x0004'],
};

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

const gatewayByLora = (gateways, addr) => {
  const wanted = normalize(addr);
  if (!wanted) return null;
  return gateways.find(
    (g) => isPlottable(g) && normalize(g.loraAddress) === wanted
  ) || null;
};

export const resolveHopPath = ({ sourceGateway, meshSrcAddr, gateways }) => {
  if (!isPlottable(sourceGateway)) return null;
  const wanted = normalize(meshSrcAddr);
  if (!wanted) return null;
  if (!Array.isArray(gateways) || gateways.length === 0) return null;

  // The uplink itself sometimes appears as meshSrcAddr when meshHops === 0
  // (the sender IS the uplink, no relay). In that case there's no real
  // animation to draw — return null so the caller can show a static badge.
  if (normalize(sourceGateway.loraAddress) === wanted) return null;

  const sender = gatewayByLora(gateways, wanted);
  if (!sender) return null;
  if (sender._id === sourceGateway._id) return null;

  // If we have a known multi-hop topology for this source, walk it through
  // each LoRa address and collect the gateway points. Skip addresses that
  // don't map to a registered gateway (operator hasn't bound them yet) so
  // a partial chain still draws.
  const knownChain = KNOWN_TOPOLOGY[wanted];
  if (Array.isArray(knownChain) && knownChain.length >= 2) {
    const path = [];
    for (const addr of knownChain) {
      const g = gatewayByLora(gateways, addr);
      if (g) path.push(gatewayPoint(g));
    }
    if (path.length >= 2) {
      return { kind: 'real', path };
    }
  }

  // Fallback: no topology hint for this source — draw the two known
  // endpoints (sender → uplink) as a straight line.
  return {
    kind: 'real',
    path: [gatewayPoint(sender), gatewayPoint(sourceGateway)],
  };
};
