// Build a hop animation path from real alert metadata when possible.
//
// Inputs:
//   - sourceGateway: the uplink gateway (resolved from alert.device_id /
//     incident.gateway). This is where the LoRa-to-HTTP boundary happens.
//   - meshSrcAddr:   the LoRa mesh source address on the alert (e.g.
//     '0x0002'). Identifies the physical sender, NOT the uplink.
//   - meshHopPath:   optional ordered array of hex addresses representing
//     the full chain the packet actually traversed
//     (e.g. ['0x0003','0x0005','0x0001','0x0002','0x0004']). Populated by
//     firmware that carries hop_path in the mesh packet; absent on legacy
//     firmware uplinks.
//   - gateways:      the full gateway list (each may carry .loraAddress).
//
// Returns:
//   - { kind: 'real', path: [...] } when we can resolve at least two
//     points. path = [sender, ...relays, uplink], plotted via gateway
//     locations.
//   - null when we don't have enough data — caller should fall back to
//     synthesizeHopPath for the demo-style placeholder animation.
//
// Resolution order:
//   1. meshHopPath array from firmware (real chain) when present
//   2. KNOWN_TOPOLOGY hint keyed by meshSrcAddr (legacy fallback for
//      firmware that doesn't ship hop_path yet)
//   3. Straight line sender → uplink (last-resort fallback)

// Physical mesh layout (campus deployment, May 2026) — used only as a
// fallback for legacy firmware uplinks that don't carry meshHopPath.
// Each entry: source addr → ordered chain ending at the uplink.
//   0x0003 (Hazırlık) → 0x0005 (Rektörlük) → 0x0001 (M Blok)
//                                          → 0x0002 (L Blok)
//                                          → 0x0004 (Ortak Alan, uplink)
const KNOWN_TOPOLOGY = {
  '0x0003': ['0x0003', '0x0005', '0x0001', '0x0002', '0x0004'],
  '0x0005': ['0x0005', '0x0001', '0x0002', '0x0004'],
  '0x0001': ['0x0001', '0x0002', '0x0004'],
  '0x0002': ['0x0002', '0x0004'],
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

const chainToPath = (chain, gateways) => {
  if (!Array.isArray(chain) || chain.length < 2) return null;
  const path = [];
  for (const addr of chain) {
    const g = gatewayByLora(gateways, addr);
    if (g) path.push(gatewayPoint(g));
  }
  return path.length >= 2 ? path : null;
};

export const resolveHopPath = ({
  sourceGateway,
  meshSrcAddr,
  meshHopPath,
  gateways,
}) => {
  if (!isPlottable(sourceGateway)) return null;
  if (!Array.isArray(gateways) || gateways.length === 0) return null;

  // Preferred path: firmware-supplied hop_path. Plot it directly and
  // skip both the KNOWN_TOPOLOGY guess and the sender-vs-uplink heuristic
  // — if the firmware says the packet traversed exactly these nodes, we
  // draw exactly those.
  if (Array.isArray(meshHopPath) && meshHopPath.length >= 2) {
    const realPath = chainToPath(meshHopPath, gateways);
    if (realPath) return { kind: 'real', path: realPath };
  }

  const wanted = normalize(meshSrcAddr);
  if (!wanted) return null;

  // The uplink itself sometimes appears as meshSrcAddr when meshHops === 0
  // (the sender IS the uplink, no relay). In that case there's no real
  // animation to draw — return null so the caller can show a static badge.
  if (normalize(sourceGateway.loraAddress) === wanted) return null;

  const sender = gatewayByLora(gateways, wanted);
  if (!sender) return null;
  if (sender._id === sourceGateway._id) return null;

  // Legacy fallback: walk the hard-coded KNOWN_TOPOLOGY chain. Used only
  // for firmware uplinks that predate the meshHopPath field.
  const knownChain = KNOWN_TOPOLOGY[wanted];
  const knownPath = chainToPath(knownChain, gateways);
  if (knownPath) return { kind: 'real', path: knownPath };

  // Last-resort fallback: no topology hint and no real path — draw the
  // two known endpoints (sender → uplink) as a straight line.
  return {
    kind: 'real',
    path: [gatewayPoint(sender), gatewayPoint(sourceGateway)],
  };
};
