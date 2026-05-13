import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';

// SVG overlay rendered into the Leaflet container that animates a "packet"
// hopping along a bezier-arc path between mesh nodes. Lifts off the map
// plane via control-point offset → reads as 3D-ish to a non-tech audience.
//
// Lifecycle:
//   - Driven by `animationKey` — bump it to (re)start the animation.
//   - One rAF loop projects path points to screen pixels every frame and
//     re-renders. Map move/zoom hooks force a re-render so the SVG follows.
//   - Each node logs an arrival timestamp the first frame the packet
//     "reaches" it, which drives a sonar-style expanding ring.

const ARC_LIFT_RATIO = 0.28;
const PACKET_RADIUS = 9;
const RING_MAX_RADIUS = 42;
const RING_DURATION_MS = 1000;

const bezierPoint = (p1, cp, p2, t) => {
  const u = 1 - t;
  return {
    x: u * u * p1.x + 2 * u * t * cp.x + t * t * p2.x,
    y: u * u * p1.y + 2 * u * t * cp.y + t * t * p2.y,
  };
};

const arcControlPoint = (p1, p2) => {
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  // Perpendicular, normalized
  let nx = -dy / len;
  let ny = dx / len;
  // Screen y grows downward — flip if necessary so the bulge points up
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const lift = len * ARC_LIFT_RATIO;
  return { x: mx + nx * lift, y: my + ny * lift };
};

const bezierPathD = (p1, cp, p2) => `M ${p1.x} ${p1.y} Q ${cp.x} ${cp.y} ${p2.x} ${p2.y}`;

const MeshHopAnimation = ({ path, color = '#1976d2', durationMs = 5000, animationKey, onComplete }) => {
  const map = useMap();
  const [, force] = useState(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);
  const arrivalsRef = useRef({});
  const completedRef = useRef(false);

  // (Re)start on animationKey change
  useEffect(() => {
    if (!path || path.length < 2) return undefined;

    startRef.current = performance.now();
    arrivalsRef.current = { 0: startRef.current };
    completedRef.current = false;

    const segments = path.length - 1;
    const totalDuration = durationMs + RING_DURATION_MS;

    const tick = (now) => {
      const elapsed = now - startRef.current;
      const segProgress = (elapsed / durationMs) * segments;
      const reached = Math.min(segments, Math.floor(segProgress));
      for (let i = 1; i <= reached; i++) {
        if (!arrivalsRef.current[i]) arrivalsRef.current[i] = now;
      }
      force((x) => (x + 1) % 1000000);
      if (elapsed < totalDuration) {
        rafRef.current = requestAnimationFrame(tick);
      } else if (!completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // animationKey re-triggers; durationMs/path captured at start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationKey]);

  // Re-render when the map pans/zooms so projected pixels stay aligned
  useEffect(() => {
    const update = () => force((x) => (x + 1) % 1000000);
    map.on('move', update);
    map.on('zoom', update);
    map.on('resize', update);
    return () => {
      map.off('move', update);
      map.off('zoom', update);
      map.off('resize', update);
    };
  }, [map]);

  if (!path || path.length < 2 || startRef.current == null) return null;

  const size = map.getSize();
  const pixels = path.map((p) => {
    const pt = map.latLngToContainerPoint([p.lat, p.lng]);
    return { x: pt.x, y: pt.y };
  });
  const controls = [];
  for (let i = 0; i < pixels.length - 1; i++) {
    controls.push(arcControlPoint(pixels[i], pixels[i + 1]));
  }

  const now = performance.now();
  const elapsed = now - startRef.current;
  const segments = path.length - 1;
  const segProgress = Math.max(0, (elapsed / durationMs) * segments);
  const currentSeg = Math.min(segments - 1, Math.floor(segProgress));
  const localT = Math.min(1, segProgress - currentSeg);

  // Packet position — null after final arrival so it doesn't linger past
  // the last node. Ring continues for RING_DURATION_MS after.
  let packet = null;
  if (elapsed >= 0 && elapsed < durationMs) {
    const p1 = pixels[currentSeg];
    const cp = controls[currentSeg];
    const p2 = pixels[currentSeg + 1];
    packet = bezierPoint(p1, cp, p2, localT);
  }

  // Mark final-node arrival the frame after packet reaches end
  if (elapsed >= durationMs && !arrivalsRef.current[segments]) {
    arrivalsRef.current[segments] = startRef.current + durationMs;
  }

  const uniqueId = `hop-${animationKey ?? 'static'}`;
  const glowId = `${uniqueId}-glow`;
  const packetGradId = `${uniqueId}-packet`;

  return createPortal(
    <svg
      className="mesh-hop-overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: size.x,
        height: size.y,
        pointerEvents: 'none',
        zIndex: 650,
      }}
      width={size.x}
      height={size.y}
    >
      <defs>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id={packetGradId}>
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="35%" stopColor={color} stopOpacity="0.9" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Arc background (faint dashed) + animated foreground reveal */}
      {pixels.slice(0, -1).map((p1, i) => {
        const p2 = pixels[i + 1];
        const cp = controls[i];
        const d = bezierPathD(p1, cp, p2);
        let revealed = 0;
        if (i < currentSeg) revealed = 1;
        else if (i === currentSeg) revealed = localT;
        return (
          <g key={`arc-${i}`}>
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeOpacity={0.18}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray="5 7"
            />
            {revealed > 0 && (
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={4}
                strokeOpacity={0.95}
                strokeLinecap="round"
                pathLength="1"
                strokeDasharray="1"
                strokeDashoffset={1 - revealed}
                style={{ filter: `url(#${glowId})` }}
              />
            )}
          </g>
        );
      })}

      {/* Nodes — sonar ring on arrival + solid dot once visited */}
      {pixels.map((p, i) => {
        const arrival = arrivalsRef.current[i];
        const ringAge = arrival ? now - arrival : null;
        const showRing = ringAge != null && ringAge < RING_DURATION_MS;
        const ringT = showRing ? ringAge / RING_DURATION_MS : 0;
        const reached = !!arrival;
        const nodeName = path[i]?.name;
        const role = i === 0 ? 'Kaynak' : i === pixels.length - 1 ? 'Hedef' : `Röle ${i}`;
        return (
          <g key={`node-${i}`}>
            {showRing && (
              <>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={6 + ringT * RING_MAX_RADIUS}
                  fill="none"
                  stroke={color}
                  strokeWidth={2.5}
                  strokeOpacity={1 - ringT}
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={4 + ringT * (RING_MAX_RADIUS * 0.6)}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeOpacity={(1 - ringT) * 0.6}
                />
              </>
            )}
            <circle
              cx={p.x}
              cy={p.y}
              r={reached ? 8 : 6}
              fill={reached ? color : '#ffffff'}
              stroke={color}
              strokeWidth={2.5}
              style={reached ? { filter: `url(#${glowId})` } : undefined}
            />
            {reached && nodeName && (
              <text
                x={p.x}
                y={p.y - 16}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill="#1a1a1a"
                stroke="#ffffff"
                strokeWidth="3"
                paintOrder="stroke"
              >
                {role}
              </text>
            )}
          </g>
        );
      })}

      {/* Packet — outer glow + bright core */}
      {packet && (
        <g>
          <circle
            cx={packet.x}
            cy={packet.y}
            r={PACKET_RADIUS * 2.4}
            fill={`url(#${packetGradId})`}
          />
          <circle
            cx={packet.x}
            cy={packet.y}
            r={PACKET_RADIUS}
            fill="#ffffff"
            stroke={color}
            strokeWidth={2.5}
            style={{ filter: `url(#${glowId})` }}
          />
        </g>
      )}
    </svg>,
    map.getContainer()
  );
};

export default MeshHopAnimation;
