import React from 'react';
import { Chip, Tooltip, Stack, Typography } from '@mui/material';
import HubIcon from '@mui/icons-material/Hub';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

// Renders the delivery-path provenance of an alert/message:
//   mesh    → blue chip, "📡 Mesh · Nh"
//   direct  → amber chip, "⚠️ Direkt"
//   unknown → null (don't render — keeps legacy/demo data uncluttered)
//
// Detail diagnostics (src addr, msg id) live in the tooltip.
const SourceBadge = ({ source, hops, srcAddr, msgId, size = 'small' }) => {
  if (!source || source === 'unknown') return null;

  const isMesh = source === 'mesh';
  const Icon = isMesh ? HubIcon : WarningAmberIcon;
  // hop_count = intermediate-forwarder count (PRD §3). With 2 nodes (origin
  // → destination only) it's always 0, so showing "0h" is meaningless noise.
  // Only surface a hop suffix when relays actually forwarded (hops >= 1).
  const label = isMesh
    ? `Mesh${Number.isFinite(hops) && hops >= 1 ? ` · ${hops} hop` : ''}`
    : 'Direkt';

  const tooltip = (
    <Stack spacing={0.25} sx={{ p: 0.5 }}>
      <Typography variant="caption" sx={{ fontWeight: 700 }}>
        {isMesh ? 'LoRa mesh uplink' : 'Doğrudan HTTPS (mesh atlandı)'}
      </Typography>
      {isMesh && Number.isFinite(hops) && (
        <Typography variant="caption">Hop sayısı: <strong>{hops}</strong></Typography>
      )}
      {srcAddr && (
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
          src: {srcAddr}
        </Typography>
      )}
      {msgId && (
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
          msg_id: {msgId}
        </Typography>
      )}
      {!isMesh && (
        <Typography variant="caption" color="warning.light">
          Mesh ağı yerine telefon doğrudan backend'e POST etti.
        </Typography>
      )}
    </Stack>
  );

  return (
    <Tooltip title={tooltip} arrow>
      <Chip
        icon={<Icon sx={{ fontSize: size === 'small' ? 13 : 16 }} />}
        label={label}
        size={size}
        variant="outlined"
        color={isMesh ? 'info' : 'warning'}
        sx={{
          height: size === 'small' ? 20 : 24,
          fontSize: size === 'small' ? '0.68rem' : '0.75rem',
          fontWeight: 600,
          '& .MuiChip-icon': { ml: 0.5 },
        }}
      />
    </Tooltip>
  );
};

export default SourceBadge;
