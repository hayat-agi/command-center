import { haversineM } from './meshTopology';

// Pick `meshHops + 1` other gateways from the source's cluster, ordered so
// the chain reads farthest → ... → nearest → sourceGateway. Falls back to
// fewer nodes when the cluster is small. Returns null when we can't even
// fake a single hop (no source location, or source is a true isolate).
export const synthesizeHopPath = ({ sourceGateway, gateways, meshHops, clusters }) => {
  if (!sourceGateway?.location?.lat || !sourceGateway?.location?.lng) return null;
  if (!Array.isArray(clusters) || clusters.length === 0) return null;

  const cluster = clusters.find((c) => c.some((g) => g._id === sourceGateway._id));
  if (!cluster) return null;

  const candidates = cluster
    .filter((g) => g._id !== sourceGateway._id && g.location?.lat != null && g.location?.lng != null)
    .map((g) => ({ g, d: haversineM(g.location, sourceGateway.location) }))
    .sort((a, b) => b.d - a.d); // farthest first

  if (candidates.length === 0) return null;

  // meshHops = intermediate forwarder count. For demo we always want at
  // least 1 visible relay, otherwise the animation is just a straight line
  // and the "mesh is working" story falls flat. Cap by cluster size.
  const wanted = Math.min(Math.max(meshHops ?? 1, 1) + 1, candidates.length);

  // candidates is sorted farthest-first. Take the top `wanted` — that's
  // origin (farthest) → relays → closest cluster member, in order. Then
  // append sourceGateway as the uplink endpoint.
  const chain = [...candidates.slice(0, wanted).map((c) => c.g), sourceGateway];

  return chain.map((g) => ({
    id: g._id,
    lat: g.location.lat,
    lng: g.location.lng,
    name: g.name || g.serialNumber || 'Gateway',
  }));
};
