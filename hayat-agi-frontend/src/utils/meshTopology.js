// Geometry + connectivity helpers for the mesh-fleet view. All functions
// are pure; gateways shape: { _id, location: { lat, lng }, status, ... }.

export const DEFAULT_COVERAGE_M = 350;

// Adaptive visual radius derived from actual gateway placement: each
// gateway's circle reaches at least its nearest neighbor (plus a small
// buffer) so circles always overlap visually, no matter how far the
// operator spreads the fleet. Cluster math still uses
// DEFAULT_COVERAGE_M — those rules follow LoRa physics, not styling.
export const adaptiveCoverageM = (
  gateways,
  { minM = 50, maxM = 2000, bufferRatio = 1.1 } = {}
) => {
  const valid = (gateways || []).filter(
    (g) => g.location?.lat != null && g.location?.lng != null
  );
  if (valid.length < 2) return minM;

  let maxNearest = 0;
  for (const g of valid) {
    let nearest = Infinity;
    for (const other of valid) {
      if (g._id === other._id) continue;
      const d = haversineM(g.location, other.location);
      if (d < nearest) nearest = d;
    }
    if (Number.isFinite(nearest) && nearest > maxNearest) maxNearest = nearest;
  }

  if (maxNearest === 0) return minM;
  return Math.min(maxM, Math.max(minM, Math.round(maxNearest * bufferRatio)));
};

// Two gateways are reachable directly when their coverage circles overlap,
// i.e. their centers are within 2 × coverage. A relay sitting between them
// joins them when each leg ≤ 1 × coverage.
export const connectionRadiusM = (cov) => 2 * cov;

export const haversineM = (a, b) => {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
};

// BFS-based connected-component analysis. Two active gateways are in the
// same component if a chain of pairwise overlaps connects them. Inactive
// gateways are excluded — they can't relay.
export const computeClusters = (gateways, coverageM = DEFAULT_COVERAGE_M) => {
  const reach = connectionRadiusM(coverageM);
  const valid = gateways.filter(
    (g) => g.location?.lat != null && g.location?.lng != null && g.status !== 'inactive'
  );
  const visited = new Set();
  const clusters = [];
  for (const g of valid) {
    if (visited.has(g._id)) continue;
    const cluster = [];
    const queue = [g];
    while (queue.length) {
      const cur = queue.shift();
      if (visited.has(cur._id)) continue;
      visited.add(cur._id);
      cluster.push(cur);
      for (const other of valid) {
        if (visited.has(other._id)) continue;
        if (haversineM(cur.location, other.location) <= reach) queue.push(other);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
};

// All intra-cluster connection lines (overlapping coverage). De-duplicated.
// Each line carries `clusterIdx` so the consumer can color-code per cluster.
export const computeMeshLines = (clusters, coverageM = DEFAULT_COVERAGE_M) => {
  const reach = connectionRadiusM(coverageM);
  const lines = [];
  const seen = new Set();
  clusters.forEach((cluster, clusterIdx) => {
    if (cluster.length < 2) return;
    for (const a of cluster) {
      for (const b of cluster) {
        if (a._id === b._id) continue;
        const key = [a._id, b._id].sort().join('|');
        if (seen.has(key)) continue;
        if (haversineM(a.location, b.location) > reach) continue;
        seen.add(key);
        lines.push({
          from: [a.location.lat, a.location.lng],
          to: [b.location.lat, b.location.lng],
          clusterIdx,
          weight: 2,
          opacity: 0.7,
        });
      }
    }
  });
  return lines;
};

// Geographic midpoint between two lat/lng. Spherical formula — accurate
// enough for the sub-kilometer relay-placement scale we care about.
const midpoint = (a, b) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const Bx = Math.cos(lat2) * Math.cos(dLng);
  const By = Math.cos(lat2) * Math.sin(dLng);
  const lat3 = Math.atan2(
    Math.sin(lat1) + Math.sin(lat2),
    Math.sqrt((Math.cos(lat1) + Bx) ** 2 + By ** 2)
  );
  const lng3 = toRad(a.lng) + Math.atan2(By, Math.cos(lat1) + Bx);
  return { lat: toDeg(lat3), lng: toDeg(lng3) };
};

// For every pair of clusters that aren't already connected, suggest 1-2
// relays that would bridge their nearest endpoints. This handles both
// singleton-to-cluster (one isolated node finding a home) and
// cluster-to-cluster (two healthy groups that should be merged into one
// mesh) cases.
//
// Decision tree given gap d between the closest endpoints:
//   d ≤ 2 × cov  → already connected (no suggestion)
//   d ≤ 4 × cov  → 1 relay at midpoint
//   d ≤ 6 × cov  → 2 relays at thirds
//   d > 6 × cov  → infrastructure-grade gear or relocation
//
// (Each leg must be ≤ cov so the relay's coverage overlaps both endpoints.)
export const suggestRelayPlacements = (gateways, coverageM = DEFAULT_COVERAGE_M) => {
  const clusters = computeClusters(gateways, coverageM);
  if (clusters.length < 2) return [];

  const suggestions = [];
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      const a = clusters[i];
      const b = clusters[j];

      // Closest pair (one gateway from each cluster).
      let from = null;
      let to = null;
      let distance = Infinity;
      for (const ga of a) {
        for (const gb of b) {
          const d = haversineM(ga.location, gb.location);
          if (d < distance) {
            distance = d;
            from = ga;
            to = gb;
          }
        }
      }
      if (!from || !to) continue;
      if (distance <= 2 * coverageM) continue; // already connected (defensive)

      let segments;
      let reason;
      let infeasible = false;
      if (distance <= 4 * coverageM) {
        segments = [midpoint(from.location, to.location)];
        reason = 'Tek röle yeterli';
      } else if (distance <= 6 * coverageM) {
        const m1 = midpoint(from.location, to.location);
        segments = [midpoint(from.location, m1), midpoint(m1, to.location)];
        reason = 'İki röle gerekli';
      } else {
        segments = [];
        reason = `Çok uzak (${(distance / 1000).toFixed(1)}km) — infrastructure röle veya konum değişikliği`;
        infeasible = true;
      }

      suggestions.push({ from, to, distance, segments, reason, infeasible });
    }
  }

  // Closest pairs first — operators care about the easiest wins.
  return suggestions.sort((x, y) => x.distance - y.distance);
};
